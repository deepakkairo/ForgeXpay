import { eq, and, ne, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  paymentAttempts,
  paymentRequests,
  invoices,
  projects,
  customers,
  verificationActions,
  financialLedgerEntries,
  receipts,
  bankTransactions,
  systemSettings,
} from '../db/schema.ts';
import {
  assertValidPaymentTransition,
  PaymentAttemptStatus,
} from './stateMachine.ts';
import {
  generateLedgerRef,
  generateReceiptRef,
  validateUtr,
} from './crypto.ts';
import { emitNotification } from './notifications.ts';
import { recordAuditLog } from './audit.ts';
import { formatInrFromPaise } from './upi.ts';

export interface ConfirmVerificationInput {
  paymentAttemptIdOrRef: string;
  verifiedUtr: string;
  creditedAmountPaise: number;
  bankTransactionDate: Date;
  notes?: string;
  bankTransactionId?: string | null;
  source: 'MANUAL' | 'RECONCILED';
  actorUserId: string;
  actorEmail: string;
  actorRole: string;
  ipAddress?: string;
}

export interface ConfirmVerificationResult {
  stage: 'FIRST_APPROVAL_RECORDED' | 'VERIFIED';
  paymentRef: string;
  receiptNumber?: string;
  ledgerRef?: string;
  amountDiscrepancy?: 'EXACT' | 'PARTIAL' | 'OVERPAYMENT';
}

export async function confirmPaymentVerification(
  input: ConfirmVerificationInput
): Promise<ConfirmVerificationResult> {
  const normalizedUtr = input.verifiedUtr.trim().toUpperCase();
  if (!validateUtr(normalizedUtr)) {
    throw new Error('Bank reference / UTR must be 6–35 alphanumeric characters.');
  }
  if (!Number.isInteger(input.creditedAmountPaise) || input.creditedAmountPaise <= 0) {
    throw new Error('Credited amount must be a positive integer in paise.');
  }

  // Load dual approval threshold & business profile
  const settingsRows = await db.select().from(systemSettings);
  const settingsMap = new Map(settingsRows.map((s) => [s.key, s.valueJson as Record<string, unknown>]));
  const paymentPolicy = (settingsMap.get('payment_policy') || {}) as {
    dualApprovalThresholdPaise?: number;
  };
  const businessProfile = (settingsMap.get('business_profile') || {}) as {
    legalName?: string;
    address?: string;
    email?: string;
    taxRegime?: string;
    gstin?: string;
    taxNote?: string;
  };
  const dualThreshold = Number(paymentPolicy.dualApprovalThresholdPaise ?? 5000000);

  // Locate payment attempt by UUID or public paymentRef
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    input.paymentAttemptIdOrRef
  );

  const txResult = await db.transaction(async (tx) => {
    const foundAttempts = await tx
      .select()
      .from(paymentAttempts)
      .where(
        isUuid
          ? eq(paymentAttempts.id, input.paymentAttemptIdOrRef)
          : eq(paymentAttempts.paymentRef, input.paymentAttemptIdOrRef)
      )
      .limit(1);

    if (foundAttempts.length === 0) {
      throw new Error('Payment attempt not found.');
    }
    const attempt = foundAttempts[0];

    if (attempt.status === 'VERIFIED') {
      throw new Error(`Payment ${attempt.paymentRef} is already VERIFIED. Duplicate approval blocked.`);
    }

    assertValidPaymentTransition(
      attempt.status as PaymentAttemptStatus,
      'VERIFIED',
      'FINANCE_BACKEND'
    );

    // CRITICAL: Check if this UTR has already settled another payment attempt
    const duplicateUtr = await tx
      .select({ id: paymentAttempts.id, paymentRef: paymentAttempts.paymentRef })
      .from(paymentAttempts)
      .where(
        and(
          eq(paymentAttempts.verifiedUtr, normalizedUtr),
          ne(paymentAttempts.id, attempt.id)
        )
      )
      .limit(1);

    if (duplicateUtr.length > 0) {
      throw new Error(
        `Duplicate UTR detected: ${normalizedUtr} is already assigned to verified payment ${duplicateUtr[0].paymentRef}. The same bank credit cannot settle two obligations.`
      );
    }

    const amountDiscrepancy: 'EXACT' | 'PARTIAL' | 'OVERPAYMENT' =
      input.creditedAmountPaise === attempt.expectedAmountPaise
        ? 'EXACT'
        : input.creditedAmountPaise < attempt.expectedAmountPaise
          ? 'PARTIAL'
          : 'OVERPAYMENT';

    // Dual approval enforcement for high-value payments
    const needsDual =
      attempt.requiresDualApproval || input.creditedAmountPaise >= dualThreshold;

    if (needsDual && !attempt.firstApproverUserId) {
      // First approver records approval; payment stays VERIFICATION_PENDING until second person confirms
      await tx
        .update(paymentAttempts)
        .set({
          requiresDualApproval: true,
          firstApproverUserId: input.actorUserId,
          firstApprovedAt: new Date(),
          status: 'VERIFICATION_PENDING',
          updatedAt: new Date(),
        })
        .where(and(eq(paymentAttempts.id, attempt.id), ne(paymentAttempts.status, 'VERIFIED')));

      await tx.insert(verificationActions).values({
        paymentAttemptId: attempt.id,
        bankTransactionId: input.bankTransactionId ?? null,
        actionType: 'FIRST_APPROVAL',
        recordedUtr: normalizedUtr,
        recordedAmountPaise: input.creditedAmountPaise,
        recordedBankDate: input.bankTransactionDate,
        notes:
          input.notes ||
          `First approval recorded for high-value payment (>= ${formatInrFromPaise(dualThreshold)}). Second-person confirmation required.`,
        actorUserId: input.actorUserId,
      });

      return {
        stage: 'FIRST_APPROVAL_RECORDED' as const,
        attempt,
        amountDiscrepancy,
      };
    }

    if (needsDual && attempt.firstApproverUserId === input.actorUserId) {
      throw new Error(
        'Second-person approval required: a different Finance Admin or Super Admin must confirm this high-value payment.'
      );
    }

    // Atomic status lock: only update if not already VERIFIED (guards concurrent verifications!)
    const updatedAttemptRows = await tx
      .update(paymentAttempts)
      .set({
        status: 'VERIFIED',
        verifiedUtr: normalizedUtr,
        verifiedAmountPaise: input.creditedAmountPaise,
        verifiedAt: new Date(),
        verifiedByUserId: input.actorUserId,
        updatedAt: new Date(),
      })
      .where(and(eq(paymentAttempts.id, attempt.id), ne(paymentAttempts.status, 'VERIFIED')))
      .returning();

    if (updatedAttemptRows.length === 0) {
      throw new Error('Concurrent verification conflict: payment was already verified.');
    }

    const updatedAttempt = updatedAttemptRows[0];

    await tx.insert(verificationActions).values({
      paymentAttemptId: attempt.id,
      bankTransactionId: input.bankTransactionId ?? null,
      actionType: input.source === 'RECONCILED' ? 'CONFIRMED_RECONCILED' : 'CONFIRMED_MANUAL',
      recordedUtr: normalizedUtr,
      recordedAmountPaise: input.creditedAmountPaise,
      recordedBankDate: input.bankTransactionDate,
      notes:
        input.notes ||
        (amountDiscrepancy === 'EXACT'
          ? 'Verified against actual receiving bank credit.'
          : `Verified with ${amountDiscrepancy} (${formatInrFromPaise(input.creditedAmountPaise)} credited vs ${formatInrFromPaise(attempt.expectedAmountPaise)} expected).`),
      actorUserId: input.actorUserId,
    });

    if (input.bankTransactionId) {
      await tx
        .update(bankTransactions)
        .set({ settlementStatus: 'CONFIRMED' })
        .where(eq(bankTransactions.id, input.bankTransactionId));
    }

    const [payReq] = await tx
      .select()
      .from(paymentRequests)
      .where(eq(paymentRequests.id, attempt.paymentRequestId))
      .limit(1);

    // Exactly-once financial ledger credit entry
    const ledgerRef = generateLedgerRef();
    await tx.insert(financialLedgerEntries).values({
      ledgerRef,
      entryType: 'VERIFIED_CREDIT',
      paymentAttemptId: attempt.id,
      paymentRequestId: attempt.paymentRequestId,
      invoiceId: attempt.invoiceId,
      projectId: payReq.projectId,
      customerId: attempt.customerId,
      receivingAccountId: attempt.receivingAccountId,
      amountPaise: input.creditedAmountPaise,
      currency: attempt.currency,
      verifiedUtr: normalizedUtr,
      createdByUserId: input.actorUserId,
    });

    // Recompute verified total on payment_request from ledger entries
    const reqLedgerSumRows = await tx
      .select({
        total: sql<string>`COALESCE(SUM(${financialLedgerEntries.amountPaise}), 0)`,
      })
      .from(financialLedgerEntries)
      .where(
        and(
          eq(financialLedgerEntries.paymentRequestId, attempt.paymentRequestId),
          eq(financialLedgerEntries.entryType, 'VERIFIED_CREDIT')
        )
      );

    const newReqVerified = Number(reqLedgerSumRows[0]?.total || 0);
    const newReqStatus =
      newReqVerified >= payReq.amountDuePaise ? 'PAID' : 'PARTIALLY_VERIFIED';

    await tx
      .update(paymentRequests)
      .set({
        amountVerifiedPaise: newReqVerified,
        status: newReqStatus,
        updatedAt: new Date(),
      })
      .where(eq(paymentRequests.id, payReq.id));

    // Recompute invoice status from verified ledger entries
    const [inv] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, attempt.invoiceId))
      .limit(1);

    const invLedgerSumRows = await tx
      .select({
        total: sql<string>`COALESCE(SUM(${financialLedgerEntries.amountPaise}), 0)`,
      })
      .from(financialLedgerEntries)
      .where(
        and(
          eq(financialLedgerEntries.invoiceId, attempt.invoiceId),
          eq(financialLedgerEntries.entryType, 'VERIFIED_CREDIT')
        )
      );

    const newInvVerified = Number(invLedgerSumRows[0]?.total || 0);
    const newInvStatus = newInvVerified >= inv.totalPaise ? 'PAID' : 'PARTIALLY_PAID';

    await tx
      .update(invoices)
      .set({
        status: newInvStatus,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, inv.id));

    // Issue official receipt strictly AFTER verification
    const receiptNumber = generateReceiptRef();
    await tx.insert(receipts).values({
      receiptNumber,
      paymentAttemptId: attempt.id,
      invoiceId: attempt.invoiceId,
      projectId: payReq.projectId,
      customerId: attempt.customerId,
      category: payReq.category,
      paidAmountPaise: input.creditedAmountPaise,
      currency: attempt.currency,
      verifiedUtr: normalizedUtr,
      paymentMethod: 'UPI',
      businessIdentitySnapshotJson: {
        legalName: businessProfile.legalName || 'ForgeX',
        address: businessProfile.address || '',
        email: businessProfile.email || '',
      },
      taxDetailsSnapshotJson: {
        taxRegime: businessProfile.taxRegime || 'UNCONFIGURED',
        gstin: businessProfile.gstin || '',
        note:
          businessProfile.taxNote ||
          'Tax registration details unconfigured; not a GST tax invoice.',
      },
      issuedAt: new Date(),
      issuedByUserId: input.actorUserId,
    });

    const [customer] = await tx
      .select()
      .from(customers)
      .where(eq(customers.id, attempt.customerId))
      .limit(1);

    const [project] = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, payReq.projectId))
      .limit(1);

    return {
      stage: 'VERIFIED' as const,
      attempt: updatedAttempt,
      receiptNumber,
      ledgerRef,
      amountDiscrepancy,
      customer,
      project,
    };
  });

  // Post-commit audit log & non-blocking notifications
  await recordAuditLog({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    actorRole: input.actorRole,
    action:
      txResult.stage === 'VERIFIED'
        ? 'PAYMENT_VERIFIED_CONFIRMED'
        : 'PAYMENT_FIRST_APPROVAL_RECORDED',
    resourceType: 'PAYMENT_ATTEMPT',
    resourceId: txResult.attempt.paymentRef,
    newState: {
      stage: txResult.stage,
      verifiedUtr: normalizedUtr,
      creditedAmountPaise: input.creditedAmountPaise,
      amountDiscrepancy: txResult.amountDiscrepancy,
      receiptNumber: txResult.stage === 'VERIFIED' ? txResult.receiptNumber : undefined,
      ledgerRef: txResult.stage === 'VERIFIED' ? txResult.ledgerRef : undefined,
    },
    ipAddress: input.ipAddress,
    status: 'SUCCESS',
  });

  if (txResult.stage === 'VERIFIED') {
    if (txResult.customer?.linkedUserId) {
      await emitNotification({
        recipientUserId: txResult.customer.linkedUserId,
        eventType: 'PAYMENT_VERIFIED',
        title: `Payment Verified — ${txResult.attempt.paymentRef}`,
        message: `${formatInrFromPaise(input.creditedAmountPaise)} verified for ${txResult.project?.name || 'your project'}. Receipt ${txResult.receiptNumber} is now available for download.`,
        entityType: 'RECEIPT',
        entityId: txResult.receiptNumber,
      });
    }
    await emitNotification({
      recipientRole: 'ADMIN_HQ',
      eventType: 'PAYMENT_VERIFIED',
      title: `Payment Verified: ${txResult.attempt.paymentRef}`,
      message: `${formatInrFromPaise(input.creditedAmountPaise)} verified (UTR ${normalizedUtr}) for project ${txResult.project?.projectRef || ''}.`,
      entityType: 'PAYMENT_ATTEMPT',
      entityId: txResult.attempt.paymentRef,
    });
  } else {
    await emitNotification({
      recipientRole: 'FINANCE_ADMIN',
      eventType: 'VERIFICATION_REQUIRED',
      title: `Second Approval Required — ${txResult.attempt.paymentRef}`,
      message: `High-value payment of ${formatInrFromPaise(input.creditedAmountPaise)} received first approval and awaits second-person confirmation.`,
      entityType: 'PAYMENT_ATTEMPT',
      entityId: txResult.attempt.paymentRef,
    });
  }

  return {
    stage: txResult.stage,
    paymentRef: txResult.attempt.paymentRef,
    receiptNumber: txResult.stage === 'VERIFIED' ? txResult.receiptNumber : undefined,
    ledgerRef: txResult.stage === 'VERIFIED' ? txResult.ledgerRef : undefined,
    amountDiscrepancy: txResult.amountDiscrepancy,
  };
}
