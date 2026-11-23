import { Router, Response } from 'express';
import { z } from 'zod';
import { eq, desc, and, sql, inArray, or } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  users,
  roles,
  userRoleAssignments,
  receivingAccounts,
  customers,
  projects,
  invoices,
  invoiceItems,
  paymentRequests,
  paymentAttempts,
  reconciliationImports,
  bankTransactions,
  reconciliationMatches,
  verificationActions,
  financialLedgerEntries,
  receipts,
  paymentDisputes,
  connectedApplications,
  applicationCredentials,
  notifications,
  auditLogs,
  systemSettings,
} from '../db/schema.ts';
import {
  AuthRequest,
  RoleCode,
  requireUserAuth,
  requireRoles,
  requireAuthOrApiKey,
  requireSecurityConfirmation,
  rateLimit,
} from './auth.ts';
import {
  encryptSensitive,
  maskAccountNumber,
  validateIfsc,
  validateUpiId,
  validateBankAccountNumber,
  validateUtr,
  generateAccountCode,
  generateCustomerRef,
  generateProjectRef,
  generateInvoiceRef,
  generatePaymentRequestRef,
  generatePaymentRef,
  generateDisputeRef,
  generateImportRef,
  generateApiKey,
  generateTotpSecret,
  buildTotpUri,
  verifyTotpCode,
  decryptSensitive,
  createDocumentDownloadToken,
  verifyDocumentDownloadToken,
  sha256Hex,
  isProductionEncryptionKeyConfigured,
} from './crypto.ts';
import {
  buildUpiUri,
  generateUpiQrDataUrl,
  generateUpiQrPngBuffer,
  formatInrFromPaise,
} from './upi.ts';
import {
  assertValidPaymentTransition,
  PaymentAttemptStatus,
} from './stateMachine.ts';
import { confirmPaymentVerification } from './verificationService.ts';
import {
  parseCsvText,
  normalizeBankStatementRows,
  evaluateCreditMatch,
} from './reconciliation.ts';
import { renderReceiptPdfBuffer, renderInvoicePdfBuffer } from './receipts.ts';
import { recordAuditLog } from './audit.ts';
import { emitNotification } from './notifications.ts';
import { ensureSystemBootstrapped } from './bootstrap.ts';

export const apiRouter = Router();

// Helper to get actor context cleanly
function actorMeta(req: AuthRequest) {
  return {
    actorUserId: req.authUser?.id ?? null,
    actorEmail: req.authUser?.email || req.authApp?.appCode || 'system',
    actorRole: req.authUser?.roles.join(',') || (req.authApp ? `API:${req.authApp.category}` : 'SYSTEM'),
    sourceAppId: req.authApp?.applicationId ?? null,
    ipAddress: req.ip || '',
    userAgent: req.headers['user-agent'] || '',
  };
}

// =============================================================================
// 1. HEALTH & CURRENT USER PROFILE
// =============================================================================

apiRouter.get('/health', async (_req, res: Response) => {
  try {
    await db.execute(sql`SELECT 1`);
    const activeAccounts = await db
      .select({ id: receivingAccounts.id })
      .from(receivingAccounts)
      .where(eq(receivingAccounts.isActive, true))
      .limit(1);

    res.json({
      status: 'HEALTHY',
      service: 'ForgeX 4XPay',
      timestampUtc: new Date().toISOString(),
      databaseConnected: true,
      activeReceivingAccountConfigured: activeAccounts.length > 0,
      encryptionKeyConfigured: isProductionEncryptionKeyConfigured(),
      uptimeSeconds: Math.floor(process.uptime()),
    });
  } catch (err) {
    console.error('Health check error:', err);
    res.status(503).json({
      status: 'DEGRADED',
      service: 'ForgeX 4XPay',
      timestampUtc: new Date().toISOString(),
      databaseConnected: false,
    });
  }
});

apiRouter.get('/me', requireUserAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.authUser!;
    const unreadRows = await db
      .select({ count: sql<string>`COUNT(*)` })
      .from(notifications)
      .where(
        and(
          eq(notifications.isRead, false),
          or(
            eq(notifications.recipientUserId, user.id),
            user.roles.length > 0 ? inArray(notifications.recipientRole, user.roles) : sql`false`
          )
        )
      );

    const activeAccount = await db
      .select({
        id: receivingAccounts.id,
        accountCode: receivingAccounts.accountCode,
        upiId: receivingAccounts.upiId,
        displayPayeeName: receivingAccounts.displayPayeeName,
        manualCheckAttested: receivingAccounts.manualCheckAttested,
      })
      .from(receivingAccounts)
      .where(eq(receivingAccounts.isActive, true))
      .limit(1);

    res.json({
      user,
      unreadNotifications: Number(unreadRows[0]?.count || 0),
      activeReceivingConfigured: activeAccount.length > 0,
      activeReceivingSummary: user.roles.some((r) => r === 'SUPER_ADMIN' || r === 'FINANCE_ADMIN')
        ? activeAccount[0] || null
        : null,
    });
  } catch (err) {
    console.error('GET /me failed:', err);
    res.status(500).json({ error: 'Unable to load profile.' });
  }
});

// =============================================================================
// 2. SECURITY SETTINGS, MFA (TOTP), REAUTHENTICATION & RBAC
// =============================================================================

apiRouter.post('/security/reauth', requireUserAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.authUser!;
    const [dbUser] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    if (dbUser.mfaEnabled && dbUser.mfaSecretEnc) {
      const code = String(req.body?.mfaCode || '').trim();
      const secret = decryptSensitive(dbUser.mfaSecretEnc);
      if (!verifyTotpCode(secret, code)) {
        return res.status(403).json({ error: 'Invalid 6-digit authenticator code.' });
      }
    }
    const now = new Date();
    await db.update(users).set({ lastReauthAt: now, updatedAt: now }).where(eq(users.id, user.id));
    await recordAuditLog({
      ...actorMeta(req),
      action: 'SECURITY_REAUTH',
      resourceType: 'USER',
      resourceId: user.id,
    });
    res.json({ reauthenticatedAt: now.toISOString(), validForMinutes: 15 });
  } catch (err) {
    console.error('Reauth error:', err);
    res.status(500).json({ error: 'Reauthentication failed.' });
  }
});

apiRouter.post('/security/mfa/setup', requireUserAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.authUser!;
    const secret = generateTotpSecret();
    const otpauthUri = buildTotpUri(secret, user.email);
    const qrDataUrl = await generateUpiQrDataUrl(otpauthUri);
    await db
      .update(users)
      .set({ mfaSecretEnc: encryptSensitive(secret), updatedAt: new Date() })
      .where(eq(users.id, user.id));
    res.json({ secret, otpauthUri, qrDataUrl });
  } catch (err) {
    console.error('MFA setup error:', err);
    res.status(500).json({ error: 'Failed to initialize MFA.' });
  }
});

apiRouter.post('/security/mfa/enable', requireUserAuth, async (req: AuthRequest, res: Response) => {
  try {
    const code = String(req.body?.code || '').trim();
    const [dbUser] = await db.select().from(users).where(eq(users.id, req.authUser!.id)).limit(1);
    if (!dbUser?.mfaSecretEnc) {
      return res.status(400).json({ error: 'Start MFA setup before enabling.' });
    }
    const secret = decryptSensitive(dbUser.mfaSecretEnc);
    if (!verifyTotpCode(secret, code)) {
      return res.status(400).json({ error: 'Invalid 6-digit TOTP code. Please verify your authenticator clock.' });
    }
    await db
      .update(users)
      .set({ mfaEnabled: true, lastReauthAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, dbUser.id));

    await recordAuditLog({
      ...actorMeta(req),
      action: 'MFA_ENABLED',
      resourceType: 'USER',
      resourceId: dbUser.id,
    });
    res.json({ mfaEnabled: true });
  } catch (err) {
    console.error('MFA enable error:', err);
    res.status(500).json({ error: 'Failed to enable MFA.' });
  }
});

apiRouter.post('/security/mfa/disable', requireUserAuth, async (req: AuthRequest, res: Response) => {
  try {
    const code = String(req.body?.code || '').trim();
    const [dbUser] = await db.select().from(users).where(eq(users.id, req.authUser!.id)).limit(1);
    if (!dbUser?.mfaEnabled || !dbUser.mfaSecretEnc) {
      return res.status(400).json({ error: 'MFA is not currently enabled.' });
    }
    const secret = decryptSensitive(dbUser.mfaSecretEnc);
    if (!verifyTotpCode(secret, code)) {
      return res.status(403).json({ error: 'Current 6-digit TOTP code is required to disable MFA.' });
    }
    await db
      .update(users)
      .set({ mfaEnabled: false, mfaSecretEnc: null, updatedAt: new Date() })
      .where(eq(users.id, dbUser.id));
    await recordAuditLog({
      ...actorMeta(req),
      action: 'MFA_DISABLED',
      resourceType: 'USER',
      resourceId: dbUser.id,
    });
    res.json({ mfaEnabled: false });
  } catch (err) {
    console.error('MFA disable error:', err);
    res.status(500).json({ error: 'Failed to disable MFA.' });
  }
});

apiRouter.get(
  '/security/users',
  requireUserAuth,
  requireRoles('SUPER_ADMIN'),
  async (_req: AuthRequest, res: Response) => {
    try {
      const allUsers = await db.select().from(users).orderBy(desc(users.createdAt));
      const allAssignments = await db
        .select({
          userId: userRoleAssignments.userId,
          roleCode: roles.code,
          roleName: roles.name,
        })
        .from(userRoleAssignments)
        .innerJoin(roles, eq(userRoleAssignments.roleId, roles.id));
      const allRoles = await db.select().from(roles);

      const roleMap = new Map<string, string[]>();
      for (const a of allAssignments) {
        const list = roleMap.get(a.userId) || [];
        list.push(a.roleCode);
        roleMap.set(a.userId, list);
      }

      res.json({
        users: allUsers.map((u) => ({
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          mfaEnabled: u.mfaEnabled,
          status: u.status,
          roles: roleMap.get(u.id) || [],
          createdAt: u.createdAt,
        })),
        availableRoles: allRoles,
      });
    } catch (err) {
      console.error('List users failed:', err);
      res.status(500).json({ error: 'Failed to load users.' });
    }
  }
);

apiRouter.post(
  '/security/users/:userId/roles',
  requireUserAuth,
  requireRoles('SUPER_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const schema = z.object({
        roles: z.array(z.enum(['SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ', 'EMPLOYEE', 'CLIENT'])).min(1),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'At least one valid role code is required.' });
      }
      const targetUserId = String(req.params.userId);
      const roleRecords = await db
        .select()
        .from(roles)
        .where(inArray(roles.code, parsed.data.roles));

      await db.transaction(async (tx) => {
        await tx.delete(userRoleAssignments).where(eq(userRoleAssignments.userId, targetUserId));
        for (const roleRec of roleRecords) {
          await tx.insert(userRoleAssignments).values({
            userId: targetUserId,
            roleId: roleRec.id,
            assignedByUserId: req.authUser!.id,
          });
        }
      });

      await recordAuditLog({
        ...actorMeta(req),
        action: 'USER_ROLES_UPDATED',
        resourceType: 'USER',
        resourceId: targetUserId,
        newState: { roles: parsed.data.roles },
      });

      res.json({ userId: targetUserId, roles: parsed.data.roles });
    } catch (err) {
      console.error('Update user roles failed:', err);
      res.status(500).json({ error: 'Failed to update user roles.' });
    }
  }
);

// System & Business Tax Configuration
apiRouter.get(
  '/settings',
  requireUserAuth,
  requireRoles('SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ'),
  async (_req: AuthRequest, res: Response) => {
    try {
      await ensureSystemBootstrapped();
      const rows = await db.select().from(systemSettings);
      const out: Record<string, unknown> = {};
      for (const r of rows) out[r.key] = r.valueJson;
      res.json(out);
    } catch (err) {
      console.error('GET /settings failed:', err);
      res.status(500).json({ error: 'Failed to load settings.' });
    }
  }
);

apiRouter.patch(
  '/settings',
  requireUserAuth,
  requireRoles('SUPER_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const schema = z.object({
        businessProfile: z
          .object({
            legalName: z.string().min(2).max(120),
            address: z.string().max(300),
            email: z.string().max(120),
            taxRegime: z.enum(['UNCONFIGURED', 'NON_GST', 'GST']),
            gstin: z.string().max(20),
            taxNote: z.string().max(300),
          })
          .optional(),
        paymentPolicy: z
          .object({
            dualApprovalThresholdPaise: z.number().int().min(10000),
            qrExpiryMinutes: z.number().int().min(5).max(1440),
            maxDisputesPerAttempt: z.number().int().min(1).max(10),
          })
          .optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid settings payload.', details: parsed.error.issues });
      }
      if (parsed.data.businessProfile) {
        const bp = parsed.data.businessProfile;
        if (bp.taxRegime === 'GST' && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(bp.gstin.trim().toUpperCase())) {
          return res.status(400).json({
            error: 'Valid 15-character Indian GSTIN is required when tax regime is set to GST.',
          });
        }
        await db
          .insert(systemSettings)
          .values({
            key: 'business_profile',
            valueJson: { ...bp, gstin: bp.gstin.trim().toUpperCase() },
            updatedByUserId: req.authUser!.id,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: systemSettings.key,
            set: {
              valueJson: { ...bp, gstin: bp.gstin.trim().toUpperCase() },
              updatedByUserId: req.authUser!.id,
              updatedAt: new Date(),
            },
          });
      }
      if (parsed.data.paymentPolicy) {
        await db
          .insert(systemSettings)
          .values({
            key: 'payment_policy',
            valueJson: parsed.data.paymentPolicy,
            updatedByUserId: req.authUser!.id,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: systemSettings.key,
            set: {
              valueJson: parsed.data.paymentPolicy,
              updatedByUserId: req.authUser!.id,
              updatedAt: new Date(),
            },
          });
      }

      await recordAuditLog({
        ...actorMeta(req),
        action: 'SYSTEM_SETTINGS_UPDATED',
        resourceType: 'SYSTEM_SETTINGS',
        resourceId: 'global',
        newState: parsed.data,
      });
      await emitNotification({
        recipientRole: 'SUPER_ADMIN',
        eventType: 'SECURITY_CONFIG_CHANGE',
        title: 'System & Tax Settings Updated',
        message: `Configuration updated by ${req.authUser!.email}.`,
        entityType: 'SYSTEM_SETTINGS',
        entityId: 'global',
      });

      res.json({ updated: true });
    } catch (err) {
      console.error('PATCH /settings failed:', err);
      res.status(500).json({ error: 'Failed to save settings.' });
    }
  }
);

// =============================================================================
// 3. RECEIVING BANK ACCOUNTS (SUPER ADMIN ONLY, AES-256-GCM, EMPTY INITIAL STATE)
// =============================================================================

const createReceivingAccountSchema = z.object({
  accountHolderName: z.string().min(2).max(120),
  bankName: z.string().min(2).max(120),
  accountNumber: z.string().refine(validateBankAccountNumber, 'Account number must be 9–18 digits'),
  ifsc: z.string().refine(validateIfsc, 'Invalid Indian IFSC format (e.g., HDFC0001234)'),
  accountType: z.enum(['SAVINGS', 'CURRENT']),
  upiId: z.string().refine(validateUpiId, 'Invalid UPI ID format (e.g., forgex@hdfcbank)'),
  displayPayeeName: z.string().min(2).max(80),
  internalLabel: z.string().max(80).optional().default(''),
  activateImmediately: z.boolean().optional().default(false),
});

function serializeReceivingAccountSafe(acc: typeof receivingAccounts.$inferSelect) {
  return {
    id: acc.id,
    accountCode: acc.accountCode,
    accountHolderName: acc.accountHolderName,
    bankName: acc.bankName,
    accountNumberMasked: acc.accountNumberMasked,
    ifsc: acc.ifsc,
    accountType: acc.accountType,
    upiId: acc.upiId,
    displayPayeeName: acc.displayPayeeName,
    internalLabel: acc.internalLabel,
    isActive: acc.isActive,
    manualCheckAttested: acc.manualCheckAttested,
    manualCheckAttestedAt: acc.manualCheckAttestedAt,
    manualCheckNote: acc.manualCheckNote,
    createdAt: acc.createdAt,
    updatedAt: acc.updatedAt,
  };
}

apiRouter.get(
  '/admin/receiving-accounts',
  requireUserAuth,
  requireRoles('SUPER_ADMIN', 'FINANCE_ADMIN'),
  async (_req: AuthRequest, res: Response) => {
    try {
      const list = await db
        .select()
        .from(receivingAccounts)
        .orderBy(desc(receivingAccounts.isActive), desc(receivingAccounts.createdAt));

      const history = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.resourceType, 'RECEIVING_ACCOUNT'))
        .orderBy(desc(auditLogs.createdAt))
        .limit(25);

      res.json({
        accounts: list.map(serializeReceivingAccountSafe),
        changeHistory: history,
      });
    } catch (err) {
      console.error('GET receiving-accounts failed:', err);
      res.status(500).json({ error: 'Failed to load receiving accounts.' });
    }
  }
);

apiRouter.post(
  '/admin/receiving-accounts',
  requireUserAuth,
  requireRoles('SUPER_ADMIN'),
  requireSecurityConfirmation,
  async (req: AuthRequest, res: Response) => {
    try {
      const parsed = createReceivingAccountSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid bank account details.',
          details: parsed.error.issues,
        });
      }
      const d = parsed.data;
      const accountCode = generateAccountCode();
      const encrypted = encryptSensitive(d.accountNumber.trim());
      const masked = maskAccountNumber(d.accountNumber.trim());

      const created = await db.transaction(async (tx) => {
        if (d.activateImmediately) {
          await tx
            .update(receivingAccounts)
            .set({ isActive: false, updatedAt: new Date() })
            .where(eq(receivingAccounts.isActive, true));
        }

        const [row] = await tx
          .insert(receivingAccounts)
          .values({
            accountCode,
            accountHolderName: d.accountHolderName.trim(),
            bankName: d.bankName.trim(),
            accountNumberEncrypted: encrypted,
            accountNumberMasked: masked,
            ifsc: d.ifsc.trim().toUpperCase(),
            accountType: d.accountType,
            upiId: d.upiId.trim(),
            displayPayeeName: d.displayPayeeName.trim(),
            internalLabel: d.internalLabel.trim(),
            isActive: d.activateImmediately,
            manualCheckAttested: false,
            createdByUserId: req.authUser!.id,
          })
          .returning();
        return row;
      });

      await recordAuditLog({
        ...actorMeta(req),
        action: 'RECEIVING_ACCOUNT_CREATED',
        resourceType: 'RECEIVING_ACCOUNT',
        resourceId: created.accountCode,
        newState: serializeReceivingAccountSafe(created),
      });

      await emitNotification({
        recipientRole: 'SUPER_ADMIN',
        eventType: 'SECURITY_CONFIG_CHANGE',
        title: `Receiving Account Registered (${created.accountCode})`,
        message: `${created.bankName} (${created.accountNumberMasked}) / UPI ${created.upiId} registered by ${req.authUser!.email}.`,
        entityType: 'RECEIVING_ACCOUNT',
        entityId: created.id,
      });

      res.status(201).json({ account: serializeReceivingAccountSafe(created) });
    } catch (err) {
      console.error('POST receiving-accounts failed:', err);
      res.status(500).json({ error: 'Failed to register receiving account.' });
    }
  }
);

apiRouter.patch(
  '/admin/receiving-accounts/:id',
  requireUserAuth,
  requireRoles('SUPER_ADMIN'),
  requireSecurityConfirmation,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = String(req.params.id);
      const [existing] = await db
        .select()
        .from(receivingAccounts)
        .where(eq(receivingAccounts.id, id))
        .limit(1);
      if (!existing) {
        return res.status(404).json({ error: 'Receiving account not found.' });
      }

      const patchSchema = z.object({
        accountHolderName: z.string().min(2).max(120).optional(),
        bankName: z.string().min(2).max(120).optional(),
        accountNumber: z
          .string()
          .refine(validateBankAccountNumber, 'Account number must be 9–18 digits')
          .optional(),
        ifsc: z.string().refine(validateIfsc, 'Invalid IFSC format').optional(),
        accountType: z.enum(['SAVINGS', 'CURRENT']).optional(),
        upiId: z.string().refine(validateUpiId, 'Invalid UPI ID format').optional(),
        displayPayeeName: z.string().min(2).max(80).optional(),
        internalLabel: z.string().max(80).optional(),
        isActive: z.boolean().optional(),
      });

      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid update payload.',
        });
      }

      const d = parsed.data;
      const updateSet: Record<string, unknown> = { updatedAt: new Date() };
      if (d.accountHolderName !== undefined) updateSet.accountHolderName = d.accountHolderName.trim();
      if (d.bankName !== undefined) updateSet.bankName = d.bankName.trim();
      if (d.ifsc !== undefined) updateSet.ifsc = d.ifsc.trim().toUpperCase();
      if (d.accountType !== undefined) updateSet.accountType = d.accountType;
      if (d.upiId !== undefined) {
        updateSet.upiId = d.upiId.trim();
        // Reset manual attestation whenever UPI ID changes
        updateSet.manualCheckAttested = false;
        updateSet.manualCheckAttestedAt = null;
      }
      if (d.displayPayeeName !== undefined) updateSet.displayPayeeName = d.displayPayeeName.trim();
      if (d.internalLabel !== undefined) updateSet.internalLabel = d.internalLabel.trim();
      if (d.accountNumber !== undefined) {
        updateSet.accountNumberEncrypted = encryptSensitive(d.accountNumber.trim());
        updateSet.accountNumberMasked = maskAccountNumber(d.accountNumber.trim());
        updateSet.manualCheckAttested = false;
        updateSet.manualCheckAttestedAt = null;
      }

      const updated = await db.transaction(async (tx) => {
        if (d.isActive === true) {
          await tx
            .update(receivingAccounts)
            .set({ isActive: false, updatedAt: new Date() })
            .where(eq(receivingAccounts.isActive, true));
          updateSet.isActive = true;
        } else if (d.isActive === false) {
          updateSet.isActive = false;
        }
        const [row] = await tx
          .update(receivingAccounts)
          .set(updateSet)
          .where(eq(receivingAccounts.id, id))
          .returning();
        return row;
      });

      await recordAuditLog({
        ...actorMeta(req),
        action: 'RECEIVING_ACCOUNT_UPDATED',
        resourceType: 'RECEIVING_ACCOUNT',
        resourceId: updated.accountCode,
        previousState: serializeReceivingAccountSafe(existing),
        newState: serializeReceivingAccountSafe(updated),
      });

      res.json({ account: serializeReceivingAccountSafe(updated) });
    } catch (err) {
      console.error('PATCH receiving-accounts failed:', err);
      res.status(500).json({ error: 'Failed to update receiving account.' });
    }
  }
);

apiRouter.post(
  '/admin/receiving-accounts/:id/activate',
  requireUserAuth,
  requireRoles('SUPER_ADMIN'),
  requireSecurityConfirmation,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = String(req.params.id);
      const [existing] = await db
        .select()
        .from(receivingAccounts)
        .where(eq(receivingAccounts.id, id))
        .limit(1);
      if (!existing) {
        return res.status(404).json({ error: 'Receiving account not found.' });
      }

      const activated = await db.transaction(async (tx) => {
        await tx
          .update(receivingAccounts)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(receivingAccounts.isActive, true));
        const [row] = await tx
          .update(receivingAccounts)
          .set({ isActive: true, updatedAt: new Date() })
          .where(eq(receivingAccounts.id, id))
          .returning();
        return row;
      });

      await recordAuditLog({
        ...actorMeta(req),
        action: 'RECEIVING_ACCOUNT_ACTIVATED',
        resourceType: 'RECEIVING_ACCOUNT',
        resourceId: activated.accountCode,
        newState: { activeUpiId: activated.upiId, accountNumberMasked: activated.accountNumberMasked },
      });

      await emitNotification({
        recipientRole: 'FINANCE_ADMIN',
        eventType: 'SECURITY_CONFIG_CHANGE',
        title: `Active Receiving UPI Changed to ${activated.upiId}`,
        message: `Super Admin ${req.authUser!.email} activated ${activated.accountCode} (${activated.bankName}).`,
        entityType: 'RECEIVING_ACCOUNT',
        entityId: activated.id,
      });

      res.json({ account: serializeReceivingAccountSafe(activated) });
    } catch (err) {
      console.error('POST activate receiving account failed:', err);
      res.status(500).json({ error: 'Failed to activate receiving account.' });
    }
  }
);

// Manual Configuration Check Attestation (explicitly NOT an API bank verification)
apiRouter.post(
  '/admin/receiving-accounts/:id/attest',
  requireUserAuth,
  requireRoles('SUPER_ADMIN'),
  requireSecurityConfirmation,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = String(req.params.id);
      const note = String(req.body?.note || '').trim();
      if (note.length < 5) {
        return res.status(400).json({
          error: 'Please enter a brief note describing your manual check in your actual banking application.',
        });
      }
      const [updated] = await db
        .update(receivingAccounts)
        .set({
          manualCheckAttested: true,
          manualCheckAttestedAt: new Date(),
          manualCheckAttestedBy: req.authUser!.id,
          manualCheckNote: note.slice(0, 300),
          updatedAt: new Date(),
        })
        .where(eq(receivingAccounts.id, id))
        .returning();

      if (!updated) {
        return res.status(404).json({ error: 'Receiving account not found.' });
      }

      await recordAuditLog({
        ...actorMeta(req),
        action: 'RECEIVING_ACCOUNT_MANUAL_CHECK_ATTESTED',
        resourceType: 'RECEIVING_ACCOUNT',
        resourceId: updated.accountCode,
        newState: { manualCheckNote: updated.manualCheckNote },
      });

      res.json({ account: serializeReceivingAccountSafe(updated) });
    } catch (err) {
      console.error('POST attest receiving account failed:', err);
      res.status(500).json({ error: 'Failed to record manual configuration check.' });
    }
  }
);

// =============================================================================
// 4. CUSTOMERS, PROJECTS & INVOICES (ADMIN HQ / SUPER ADMIN / FINANCE)
// =============================================================================

apiRouter.get(
  '/customers',
  requireAuthOrApiKey({
    allowedRoles: ['SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ'],
    requiredScopes: ['customers:read'],
  }),
  async (_req: AuthRequest, res: Response) => {
    try {
      const rows = await db.select().from(customers).orderBy(desc(customers.createdAt));
      const allProjects = await db.select().from(projects);
      const ledgerTotals = await db
        .select({
          customerId: financialLedgerEntries.customerId,
          verifiedPaise: sql<string>`COALESCE(SUM(${financialLedgerEntries.amountPaise}), 0)`,
        })
        .from(financialLedgerEntries)
        .where(eq(financialLedgerEntries.entryType, 'VERIFIED_CREDIT'))
        .groupBy(financialLedgerEntries.customerId);

      const verifiedMap = new Map(ledgerTotals.map((l) => [l.customerId, Number(l.verifiedPaise)]));

      res.json({
        customers: rows.map((c) => {
          const custProjects = allProjects.filter((p) => p.customerId === c.id);
          const totalContractPaise = custProjects.reduce((acc, p) => acc + p.totalContractPaise, 0);
          const verifiedPaise = verifiedMap.get(c.id) || 0;
          return {
            ...c,
            projectCount: custProjects.length,
            totalContractPaise,
            verifiedPaidPaise: verifiedPaise,
            outstandingPaise: Math.max(0, totalContractPaise - verifiedPaise),
          };
        }),
      });
    } catch (err) {
      console.error('GET /customers failed:', err);
      res.status(500).json({ error: 'Failed to load customers.' });
    }
  }
);

apiRouter.post(
  '/customers',
  requireAuthOrApiKey({
    allowedRoles: ['SUPER_ADMIN', 'ADMIN_HQ'],
    requiredScopes: ['customers:write'],
  }),
  async (req: AuthRequest, res: Response) => {
    try {
      const schema = z.object({
        name: z.string().min(2).max(120),
        email: z.string().email(),
        phone: z.string().max(30).optional().default(''),
        companyName: z.string().max(120).optional().default(''),
        linkCurrentUser: z.boolean().optional().default(false),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid customer payload.' });
      }
      const d = parsed.data;
      const normalizedEmail = d.email.trim().toLowerCase();

      // Auto-link if a user with that email exists
      const [matchingUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);

      const linkedUserId =
        d.linkCurrentUser && req.authUser ? req.authUser.id : matchingUser?.id ?? null;

      const [created] = await db
        .insert(customers)
        .values({
          customerRef: generateCustomerRef(),
          name: d.name.trim(),
          email: normalizedEmail,
          phone: d.phone.trim(),
          companyName: d.companyName.trim(),
          linkedUserId,
          externalSourceApp: req.authApp?.appCode || 'ADMIN_HQ',
        })
        .returning();

      await recordAuditLog({
        ...actorMeta(req),
        action: 'CUSTOMER_CREATED',
        resourceType: 'CUSTOMER',
        resourceId: created.customerRef,
        newState: { name: created.name, email: created.email },
      });

      res.status(201).json({ customer: created });
    } catch (err) {
      console.error('POST /customers failed:', err);
      res.status(500).json({ error: 'Failed to create customer.' });
    }
  }
);

apiRouter.get(
  '/projects',
  requireAuthOrApiKey({
    allowedRoles: ['SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ'],
    requiredScopes: ['projects:read'],
  }),
  async (_req: AuthRequest, res: Response) => {
    try {
      const rows = await db
        .select({
          project: projects,
          customer: customers,
        })
        .from(projects)
        .innerJoin(customers, eq(projects.customerId, customers.id))
        .orderBy(desc(projects.createdAt));

      const ledgerSums = await db
        .select({
          projectId: financialLedgerEntries.projectId,
          verifiedPaise: sql<string>`COALESCE(SUM(${financialLedgerEntries.amountPaise}), 0)`,
        })
        .from(financialLedgerEntries)
        .where(eq(financialLedgerEntries.entryType, 'VERIFIED_CREDIT'))
        .groupBy(financialLedgerEntries.projectId);

      const verifiedMap = new Map(ledgerSums.map((l) => [l.projectId, Number(l.verifiedPaise)]));

      res.json({
        projects: rows.map(({ project, customer }) => {
          const verifiedPaidPaise = verifiedMap.get(project.id) || 0;
          return {
            ...project,
            customerRef: customer.customerRef,
            customerName: customer.name,
            verifiedPaidPaise,
            outstandingPaise: Math.max(0, project.totalContractPaise - verifiedPaidPaise),
          };
        }),
      });
    } catch (err) {
      console.error('GET /projects failed:', err);
      res.status(500).json({ error: 'Failed to load projects.' });
    }
  }
);

apiRouter.post(
  '/projects',
  requireAuthOrApiKey({
    allowedRoles: ['SUPER_ADMIN', 'ADMIN_HQ'],
    requiredScopes: ['projects:write'],
  }),
  async (req: AuthRequest, res: Response) => {
    try {
      const schema = z.object({
        customerId: z.string().uuid(),
        name: z.string().min(2).max(160),
        description: z.string().max(500).optional().default(''),
        totalContractPaise: z.number().int().positive(),
        progressPercent: z.number().int().min(0).max(100).optional().default(0),
        assignedEmployeeUserId: z.string().uuid().nullable().optional(),
        schedule: z
          .array(
            z.object({
              category: z.enum(['ADVANCE', 'MILESTONE', 'FINAL']),
              title: z.string().min(2).max(140),
              amountDuePaise: z.number().int().positive(),
              dueDate: z.string().optional(),
            })
          )
          .optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid project payload.' });
      }
      const d = parsed.data;

      // Ensure sum of scheduled instalments doesn't exceed total contract if provided
      if (d.schedule && d.schedule.length > 0) {
        const sumSchedule = d.schedule.reduce((a, b) => a + b.amountDuePaise, 0);
        if (sumSchedule > d.totalContractPaise) {
          return res.status(400).json({
            error: 'Sum of scheduled payment milestones cannot exceed the agreed total contract value.',
          });
        }
      }

      const [bpRow] = await db
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.key, 'business_profile'))
        .limit(1);
      const bp = (bpRow?.valueJson || {}) as { taxRegime?: string; gstin?: string };

      const result = await db.transaction(async (tx) => {
        const [project] = await tx
          .insert(projects)
          .values({
            projectRef: generateProjectRef(),
            customerId: d.customerId,
            name: d.name.trim(),
            description: d.description.trim(),
            totalContractPaise: d.totalContractPaise,
            currency: 'INR',
            progressPercent: d.progressPercent,
            assignedEmployeeUserId: d.assignedEmployeeUserId ?? null,
          })
          .returning();

        let createdInvoice = null;
        const createdRequests = [];

        if (d.schedule && d.schedule.length > 0) {
          const subtotal = d.schedule.reduce((sum, item) => sum + item.amountDuePaise, 0);
          const [inv] = await tx
            .insert(invoices)
            .values({
              invoiceRef: generateInvoiceRef(),
              customerId: d.customerId,
              projectId: project.id,
              title: `${project.name} — Payment Schedule`,
              subtotalPaise: subtotal,
              taxPaise: 0,
              totalPaise: subtotal,
              currency: 'INR',
              taxRegime: bp.taxRegime || 'UNCONFIGURED',
              businessGstin: bp.gstin || '',
              status: 'ISSUED',
              createdByUserId: req.authUser?.id ?? null,
            })
            .returning();
          createdInvoice = inv;

          for (let i = 0; i < d.schedule.length; i++) {
            const s = d.schedule[i];
            await tx.insert(invoiceItems).values({
              invoiceId: inv.id,
              description: s.title.trim(),
              category: s.category,
              quantity: 1,
              unitPricePaise: s.amountDuePaise,
              totalPaise: s.amountDuePaise,
              sortOrder: i,
            });

            const [pr] = await tx
              .insert(paymentRequests)
              .values({
                requestRef: generatePaymentRequestRef(),
                invoiceId: inv.id,
                projectId: project.id,
                customerId: d.customerId,
                category: s.category,
                title: s.title.trim(),
                amountDuePaise: s.amountDuePaise,
                currency: 'INR',
                status: 'OPEN',
                dueDate: s.dueDate ? new Date(s.dueDate) : null,
                createdByUserId: req.authUser?.id ?? null,
              })
              .returning();
            createdRequests.push(pr);
          }
        }

        return { project, invoice: createdInvoice, paymentRequests: createdRequests };
      });

      await recordAuditLog({
        ...actorMeta(req),
        action: 'PROJECT_CREATED',
        resourceType: 'PROJECT',
        resourceId: result.project.projectRef,
        newState: {
          name: result.project.name,
          totalContractPaise: result.project.totalContractPaise,
          scheduleCount: result.paymentRequests.length,
        },
      });

      res.status(201).json(result);
    } catch (err) {
      console.error('POST /projects failed:', err);
      res.status(500).json({ error: 'Failed to create project.' });
    }
  }
);

apiRouter.get(
  '/invoices',
  requireAuthOrApiKey({
    allowedRoles: ['SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ'],
    requiredScopes: ['invoices:read'],
  }),
  async (_req: AuthRequest, res: Response) => {
    try {
      const rows = await db
        .select({
          invoice: invoices,
          customer: customers,
          project: projects,
        })
        .from(invoices)
        .innerJoin(customers, eq(invoices.customerId, customers.id))
        .innerJoin(projects, eq(invoices.projectId, projects.id))
        .orderBy(desc(invoices.createdAt));

      const ledgerByInv = await db
        .select({
          invoiceId: financialLedgerEntries.invoiceId,
          verifiedPaise: sql<string>`COALESCE(SUM(${financialLedgerEntries.amountPaise}), 0)`,
        })
        .from(financialLedgerEntries)
        .where(eq(financialLedgerEntries.entryType, 'VERIFIED_CREDIT'))
        .groupBy(financialLedgerEntries.invoiceId);

      const paidMap = new Map(ledgerByInv.map((l) => [l.invoiceId, Number(l.verifiedPaise)]));

      res.json({
        invoices: rows.map(({ invoice, customer, project }) => {
          const verifiedPaidPaise = paidMap.get(invoice.id) || 0;
          return {
            ...invoice,
            customerRef: customer.customerRef,
            customerName: customer.name,
            projectRef: project.projectRef,
            projectName: project.name,
            verifiedPaidPaise,
            outstandingPaise: Math.max(0, invoice.totalPaise - verifiedPaidPaise),
          };
        }),
      });
    } catch (err) {
      console.error('GET /invoices failed:', err);
      res.status(500).json({ error: 'Failed to load invoices.' });
    }
  }
);

apiRouter.get(
  '/invoices/:id',
  requireAuthOrApiKey({
    allowedRoles: ['SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ', 'CLIENT'],
    requiredScopes: ['invoices:read'],
  }),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = String(req.params.id);
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      const rows = await db
        .select({ invoice: invoices, customer: customers, project: projects })
        .from(invoices)
        .innerJoin(customers, eq(invoices.customerId, customers.id))
        .innerJoin(projects, eq(invoices.projectId, projects.id))
        .where(isUuid ? eq(invoices.id, id) : eq(invoices.invoiceRef, id))
        .limit(1);

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Invoice not found.' });
      }
      const { invoice, customer, project } = rows[0];

      // Enforce ownership if user is strictly CLIENT
      if (
        req.authUser &&
        req.authUser.roles.every((r) => r === 'CLIENT') &&
        customer.linkedUserId !== req.authUser.id &&
        customer.email.toLowerCase() !== req.authUser.email.toLowerCase()
      ) {
        return res.status(403).json({ error: 'Access denied to this invoice.' });
      }

      const items = await db
        .select()
        .from(invoiceItems)
        .where(eq(invoiceItems.invoiceId, invoice.id))
        .orderBy(invoiceItems.sortOrder);

      const downloadToken = createDocumentDownloadToken(
        'invoice',
        invoice.id,
        req.authUser?.id || req.authApp?.applicationId || 'api',
        300
      );

      res.json({
        invoice,
        customer,
        project,
        items,
        pdfDownloadUrl: `/api/v1/documents/invoice/${downloadToken}`,
      });
    } catch (err) {
      console.error('GET /invoices/:id failed:', err);
      res.status(500).json({ error: 'Failed to load invoice.' });
    }
  }
);

apiRouter.get('/documents/invoice/:token', async (req, res: Response) => {
  try {
    const verified = verifyDocumentDownloadToken(String(req.params.token), 'invoice');
    if (!verified) {
      return res.status(403).json({ error: 'Invoice download link is invalid or expired.' });
    }
    const rows = await db
      .select({ invoice: invoices, customer: customers, project: projects })
      .from(invoices)
      .innerJoin(customers, eq(invoices.customerId, customers.id))
      .innerJoin(projects, eq(invoices.projectId, projects.id))
      .where(eq(invoices.id, verified.resourceId))
      .limit(1);

    if (rows.length === 0) return res.status(404).json({ error: 'Invoice not found.' });
    const { invoice, customer, project } = rows[0];
    const items = await db
      .select()
      .from(invoiceItems)
      .where(eq(invoiceItems.invoiceId, invoice.id))
      .orderBy(invoiceItems.sortOrder);

    const paidRows = await db
      .select({ total: sql<string>`COALESCE(SUM(${financialLedgerEntries.amountPaise}), 0)` })
      .from(financialLedgerEntries)
      .where(
        and(
          eq(financialLedgerEntries.invoiceId, invoice.id),
          eq(financialLedgerEntries.entryType, 'VERIFIED_CREDIT')
        )
      );

    const [bpRow] = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, 'business_profile'))
      .limit(1);
    const bp = (bpRow?.valueJson || {}) as { legalName?: string; address?: string; email?: string };

    const pdf = await renderInvoicePdfBuffer({
      invoiceRef: invoice.invoiceRef,
      title: invoice.title,
      status: invoice.status,
      issuedAt: invoice.createdAt,
      dueDate: invoice.dueDate,
      projectRef: project.projectRef,
      projectName: project.name,
      customerRef: customer.customerRef,
      customerName: customer.name,
      customerEmail: customer.email,
      subtotalPaise: invoice.subtotalPaise,
      taxPaise: invoice.taxPaise,
      totalPaise: invoice.totalPaise,
      verifiedPaidPaise: Number(paidRows[0]?.total || 0),
      currency: invoice.currency,
      taxRegime: invoice.taxRegime,
      businessGstin: invoice.businessGstin,
      businessIdentity: {
        legalName: bp.legalName || 'ForgeX',
        address: bp.address || '',
        email: bp.email || '',
      },
      items,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceRef}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error('Invoice PDF generation failed:', err);
    res.status(500).json({ error: 'Failed to generate invoice PDF.' });
  }
});

// =============================================================================
// 5. PAYMENT REQUESTS & UNIQUE PAYMENT ATTEMPTS + UPI QR ENGINE
// =============================================================================

apiRouter.get(
  '/payment-requests',
  requireAuthOrApiKey({
    allowedRoles: ['SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ'],
    requiredScopes: ['payment_requests:read'],
  }),
  async (_req: AuthRequest, res: Response) => {
    try {
      const rows = await db
        .select({
          request: paymentRequests,
          customer: customers,
          project: projects,
          invoice: invoices,
        })
        .from(paymentRequests)
        .innerJoin(customers, eq(paymentRequests.customerId, customers.id))
        .innerJoin(projects, eq(paymentRequests.projectId, projects.id))
        .innerJoin(invoices, eq(paymentRequests.invoiceId, invoices.id))
        .orderBy(desc(paymentRequests.createdAt));

      res.json({
        paymentRequests: rows.map(({ request, customer, project, invoice }) => ({
          ...request,
          customerRef: customer.customerRef,
          customerName: customer.name,
          projectRef: project.projectRef,
          projectName: project.name,
          invoiceRef: invoice.invoiceRef,
          remainingDuePaise: Math.max(0, request.amountDuePaise - request.amountVerifiedPaise),
        })),
      });
    } catch (err) {
      console.error('GET /payment-requests failed:', err);
      res.status(500).json({ error: 'Failed to load payment requests.' });
    }
  }
);

apiRouter.post(
  '/payment-requests',
  requireAuthOrApiKey({
    allowedRoles: ['SUPER_ADMIN', 'ADMIN_HQ'],
    requiredScopes: ['payment_requests:write'],
  }),
  async (req: AuthRequest, res: Response) => {
    try {
      const schema = z.object({
        projectId: z.string().uuid(),
        invoiceId: z.string().uuid().optional(),
        category: z.enum(['ADVANCE', 'MILESTONE', 'FINAL']),
        title: z.string().min(2).max(160),
        amountDuePaise: z.number().int().positive(),
        dueDate: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid payment request.' });
      }
      const d = parsed.data;

      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, d.projectId))
        .limit(1);
      if (!project) return res.status(404).json({ error: 'Project not found.' });

      const [bpRow] = await db
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.key, 'business_profile'))
        .limit(1);
      const bp = (bpRow?.valueJson || {}) as { taxRegime?: string; gstin?: string };

      const created = await db.transaction(async (tx) => {
        let invId = d.invoiceId;
        if (!invId) {
          const [newInv] = await tx
            .insert(invoices)
            .values({
              invoiceRef: generateInvoiceRef(),
              customerId: project.customerId,
              projectId: project.id,
              title: d.title.trim(),
              subtotalPaise: d.amountDuePaise,
              taxPaise: 0,
              totalPaise: d.amountDuePaise,
              currency: 'INR',
              taxRegime: bp.taxRegime || 'UNCONFIGURED',
              businessGstin: bp.gstin || '',
              status: 'ISSUED',
              dueDate: d.dueDate ? new Date(d.dueDate) : null,
              createdByUserId: req.authUser?.id ?? null,
            })
            .returning();
          invId = newInv.id;

          await tx.insert(invoiceItems).values({
            invoiceId: newInv.id,
            description: d.title.trim(),
            category: d.category,
            quantity: 1,
            unitPricePaise: d.amountDuePaise,
            totalPaise: d.amountDuePaise,
            sortOrder: 0,
          });
        }

        const [pr] = await tx
          .insert(paymentRequests)
          .values({
            requestRef: generatePaymentRequestRef(),
            invoiceId: invId,
            projectId: project.id,
            customerId: project.customerId,
            category: d.category,
            title: d.title.trim(),
            amountDuePaise: d.amountDuePaise,
            currency: 'INR',
            status: 'OPEN',
            dueDate: d.dueDate ? new Date(d.dueDate) : null,
            createdByUserId: req.authUser?.id ?? null,
          })
          .returning();

        return pr;
      });

      const [cust] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, project.customerId))
        .limit(1);

      await recordAuditLog({
        ...actorMeta(req),
        action: 'PAYMENT_REQUEST_CREATED',
        resourceType: 'PAYMENT_REQUEST',
        resourceId: created.requestRef,
        newState: {
          category: created.category,
          amountDuePaise: created.amountDuePaise,
          projectRef: project.projectRef,
        },
      });

      if (cust?.linkedUserId) {
        await emitNotification({
          recipientUserId: cust.linkedUserId,
          eventType: 'NEW_PAYMENT_REQUEST',
          title: `New Payment Request — ${created.requestRef}`,
          message: `${created.title}: ${formatInrFromPaise(created.amountDuePaise)} due for ${project.name}.`,
          entityType: 'PAYMENT_REQUEST',
          entityId: created.requestRef,
        });
      }

      res.status(201).json({ paymentRequest: created });
    } catch (err) {
      console.error('POST /payment-requests failed:', err);
      res.status(500).json({ error: 'Failed to create payment request.' });
    }
  }
);

apiRouter.patch(
  '/payment-requests/:id',
  requireAuthOrApiKey({
    allowedRoles: ['SUPER_ADMIN', 'ADMIN_HQ'],
    requiredScopes: ['payment_requests:write'],
  }),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = String(req.params.id);
      const [existing] = await db
        .select()
        .from(paymentRequests)
        .where(eq(paymentRequests.id, id))
        .limit(1);
      if (!existing) return res.status(404).json({ error: 'Payment request not found.' });
      if (existing.amountVerifiedPaise > 0 || existing.status === 'PAID') {
        return res.status(409).json({
          error: 'Cannot revise or cancel a payment request that already has verified funds.',
        });
      }

      const schema = z.object({
        action: z.enum(['CANCEL', 'REVISE']),
        amountDuePaise: z.number().int().positive().optional(),
        title: z.string().min(2).max(160).optional(),
        reason: z.string().min(3).max(240),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Valid action and reason are required.' });
      }
      const d = parsed.data;
      const updateSet: Record<string, unknown> = { updatedAt: new Date() };
      if (d.action === 'CANCEL') {
        updateSet.status = 'CANCELLED';
        updateSet.cancelReason = d.reason;
      } else {
        if (d.amountDuePaise) updateSet.amountDuePaise = d.amountDuePaise;
        if (d.title) updateSet.title = d.title.trim();
        updateSet.revisionNumber = existing.revisionNumber + 1;
      }

      const [updated] = await db
        .update(paymentRequests)
        .set(updateSet)
        .where(eq(paymentRequests.id, id))
        .returning();

      await recordAuditLog({
        ...actorMeta(req),
        action: d.action === 'CANCEL' ? 'PAYMENT_REQUEST_CANCELLED' : 'PAYMENT_REQUEST_REVISED',
        resourceType: 'PAYMENT_REQUEST',
        resourceId: existing.requestRef,
        previousState: { amountDuePaise: existing.amountDuePaise, status: existing.status },
        newState: { amountDuePaise: updated.amountDuePaise, status: updated.status, reason: d.reason },
      });

      res.json({ paymentRequest: updated });
    } catch (err) {
      console.error('PATCH /payment-requests/:id failed:', err);
      res.status(500).json({ error: 'Failed to update payment request.' });
    }
  }
);

// Initiate a unique Payment Attempt (FXPAY-YYYY-XXXX) with idempotency protection & UPI QR generation
apiRouter.post(
  '/payment-requests/:id/attempts',
  rateLimit(60_000, 30),
  requireAuthOrApiKey({
    allowedRoles: ['SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ', 'CLIENT'],
    requiredScopes: ['payments:initiate'],
  }),
  async (req: AuthRequest, res: Response) => {
    try {
      const requestId = String(req.params.id);
      const idempotencyKey = String(
        req.headers['idempotency-key'] || req.body?.idempotencyKey || ''
      ).trim();

      if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
        return res.status(400).json({
          error: 'An Idempotency-Key header or field (8–128 characters) is required to protect against duplicate clicks.',
          code: 'IDEMPOTENCY_KEY_REQUIRED',
        });
      }

      // Reject any client attempt to override invoice amount or supply verified flag
      if (req.body?.verified === true || req.body?.status === 'VERIFIED') {
        await recordAuditLog({
          ...actorMeta(req),
          action: 'PAYMENT_TAMPER_ATTEMPT',
          resourceType: 'PAYMENT_REQUEST',
          resourceId: requestId,
          newState: { attemptedPayload: req.body },
          status: 'DENIED',
        });
        return res.status(400).json({
          error: 'Client cannot supply payment verification flags.',
          code: 'CLIENT_VERIFICATION_FORBIDDEN',
        });
      }

      const [payReq] = await db
        .select()
        .from(paymentRequests)
        .where(eq(paymentRequests.id, requestId))
        .limit(1);
      if (!payReq) {
        return res.status(404).json({ error: 'Payment request not found.' });
      }
      if (payReq.status === 'PAID' || payReq.status === 'CANCELLED') {
        return res.status(409).json({
          error: `Cannot initiate payment for a request with status ${payReq.status}.`,
        });
      }

      const [customer] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, payReq.customerId))
        .limit(1);

      // Verify ownership when caller is strictly CLIENT
      if (
        req.authUser &&
        req.authUser.roles.every((r) => r === 'CLIENT') &&
        customer.linkedUserId !== req.authUser.id &&
        customer.email.toLowerCase() !== req.authUser.email.toLowerCase()
      ) {
        await recordAuditLog({
          ...actorMeta(req),
          action: 'CROSS_CUSTOMER_ACCESS_DENIED',
          resourceType: 'PAYMENT_REQUEST',
          resourceId: payReq.requestRef,
          status: 'DENIED',
        });
        return res.status(403).json({
          error: 'You are not authorized to initiate payment for this invoice.',
        });
      }

      // Check idempotency key first (duplicate click returns exact existing attempt!)
      const existingIdempotent = await db
        .select()
        .from(paymentAttempts)
        .where(
          and(
            eq(paymentAttempts.paymentRequestId, payReq.id),
            eq(paymentAttempts.idempotencyKey, idempotencyKey)
          )
        )
        .limit(1);

      if (existingIdempotent.length > 0) {
        const existing = existingIdempotent[0];
        const qrDataUrl = await generateUpiQrDataUrl(existing.upiUri);
        return res.status(200).json({
          idempotentReplay: true,
          attempt: existing,
          checkout: {
            paymentRef: existing.paymentRef,
            expectedAmountPaise: existing.expectedAmountPaise,
            currency: existing.currency,
            receivingUpiId: existing.receivingUpiSnapshot,
            payeeName: existing.receivingPayeeSnapshot,
            upiUri: existing.upiUri,
            qrDataUrl,
            expiresAt: existing.expiresAt,
            notice:
              'Payment initiated. After completing the UPI transfer in your app, report your transfer reference. We will verify the incoming bank credit before issuing a receipt.',
          },
        });
      }

      // Read active receiving UPI account (MUST be configured by Super Admin!)
      const [activeAcc] = await db
        .select()
        .from(receivingAccounts)
        .where(eq(receivingAccounts.isActive, true))
        .limit(1);

      if (!activeAcc) {
        return res.status(422).json({
          error:
            'No active receiving UPI account is configured. Super Admin must register and activate a receiving bank account in Settings → Payment Configuration → Receiving Accounts.',
          code: 'RECEIVING_ACCOUNT_NOT_CONFIGURED',
        });
      }

      // Authoritative remaining amount due calculated strictly on backend (ignore any client amount override!)
      const remainingDuePaise = payReq.amountDuePaise - payReq.amountVerifiedPaise;
      if (remainingDuePaise <= 0) {
        return res.status(409).json({ error: 'No remaining balance due on this payment request.' });
      }

      const [inv] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, payReq.invoiceId))
        .limit(1);

      const [policyRow] = await db
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.key, 'payment_policy'))
        .limit(1);
      const policy = (policyRow?.valueJson || {}) as {
        qrExpiryMinutes?: number;
        dualApprovalThresholdPaise?: number;
      };
      const expiryMinutes = Number(policy.qrExpiryMinutes || 30);
      const dualThreshold = Number(policy.dualApprovalThresholdPaise || 5000000);

      const paymentRef = generatePaymentRef();
      const upiUri = buildUpiUri({
        pa: activeAcc.upiId,
        pn: activeAcc.displayPayeeName,
        amPaise: remainingDuePaise,
        tr: paymentRef,
        tn: `${inv.invoiceRef} ${payReq.category} ${paymentRef}`,
        cu: 'INR',
      });

      const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

      const [attempt] = await db
        .insert(paymentAttempts)
        .values({
          paymentRef,
          paymentRequestId: payReq.id,
          invoiceId: payReq.invoiceId,
          customerId: payReq.customerId,
          receivingAccountId: activeAcc.id,
          receivingUpiSnapshot: activeAcc.upiId,
          receivingPayeeSnapshot: activeAcc.displayPayeeName,
          expectedAmountPaise: remainingDuePaise,
          currency: 'INR',
          status: 'AWAITING_PAYMENT',
          idempotencyKey,
          upiUri,
          requiresDualApproval: remainingDuePaise >= dualThreshold,
          expiresAt,
        })
        .returning();

      const qrDataUrl = await generateUpiQrDataUrl(upiUri);

      await recordAuditLog({
        ...actorMeta(req),
        action: 'PAYMENT_ATTEMPT_CREATED',
        resourceType: 'PAYMENT_ATTEMPT',
        resourceId: attempt.paymentRef,
        newState: {
          paymentRequestRef: payReq.requestRef,
          expectedAmountPaise: attempt.expectedAmountPaise,
          receivingUpiId: attempt.receivingUpiSnapshot,
        },
      });

      res.status(201).json({
        idempotentReplay: false,
        attempt,
        checkout: {
          paymentRef: attempt.paymentRef,
          expectedAmountPaise: attempt.expectedAmountPaise,
          currency: attempt.currency,
          receivingUpiId: attempt.receivingUpiSnapshot,
          payeeName: attempt.receivingPayeeSnapshot,
          upiUri: attempt.upiUri,
          qrDataUrl,
          expiresAt: attempt.expiresAt,
          notice:
            'Payment initiated. We are awaiting verification of the incoming transfer once you complete payment in your UPI app.',
        },
      });
    } catch (err) {
      console.error('POST payment attempt failed:', err);
      res.status(500).json({ error: 'Failed to initiate UPI payment attempt.' });
    }
  }
);

apiRouter.get(
  '/payments/:paymentId',
  requireAuthOrApiKey({
    allowedRoles: ['SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ', 'CLIENT'],
    requiredScopes: ['payments:read'],
  }),
  async (req: AuthRequest, res: Response) => {
    try {
      const pid = String(req.params.paymentId);
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pid);
      const rows = await db
        .select({
          attempt: paymentAttempts,
          request: paymentRequests,
          customer: customers,
          project: projects,
          invoice: invoices,
        })
        .from(paymentAttempts)
        .innerJoin(paymentRequests, eq(paymentAttempts.paymentRequestId, paymentRequests.id))
        .innerJoin(customers, eq(paymentAttempts.customerId, customers.id))
        .innerJoin(projects, eq(paymentRequests.projectId, projects.id))
        .innerJoin(invoices, eq(paymentAttempts.invoiceId, invoices.id))
        .where(isUuid ? eq(paymentAttempts.id, pid) : eq(paymentAttempts.paymentRef, pid))
        .limit(1);

      if (rows.length === 0) return res.status(404).json({ error: 'Payment attempt not found.' });
      const row = rows[0];

      if (
        req.authUser &&
        req.authUser.roles.every((r) => r === 'CLIENT') &&
        row.customer.linkedUserId !== req.authUser.id &&
        row.customer.email.toLowerCase() !== req.authUser.email.toLowerCase()
      ) {
        return res.status(403).json({ error: 'Access denied.' });
      }

      const [receipt] = await db
        .select()
        .from(receipts)
        .where(eq(receipts.paymentAttemptId, row.attempt.id))
        .limit(1);

      const history = await db
        .select()
        .from(verificationActions)
        .where(eq(verificationActions.paymentAttemptId, row.attempt.id))
        .orderBy(desc(verificationActions.createdAt));

      res.json({
        attempt: row.attempt,
        paymentRequest: row.request,
        customer: {
          id: row.customer.id,
          customerRef: row.customer.customerRef,
          name: row.customer.name,
          email: row.customer.email,
        },
        project: {
          id: row.project.id,
          projectRef: row.project.projectRef,
          name: row.project.name,
        },
        invoice: {
          id: row.invoice.id,
          invoiceRef: row.invoice.invoiceRef,
        },
        receipt: receipt || null,
        verificationHistory: history,
      });
    } catch (err) {
      console.error('GET /payments/:paymentId failed:', err);
      res.status(500).json({ error: 'Failed to load payment details.' });
    }
  }
);

apiRouter.get(
  '/payments/:paymentId/upi-qr',
  requireAuthOrApiKey({
    allowedRoles: ['SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ', 'CLIENT'],
    requiredScopes: ['payments:read'],
  }),
  async (req: AuthRequest, res: Response) => {
    try {
      const pid = String(req.params.paymentId);
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pid);
      const [attempt] = await db
        .select()
        .from(paymentAttempts)
        .where(isUuid ? eq(paymentAttempts.id, pid) : eq(paymentAttempts.paymentRef, pid))
        .limit(1);
      if (!attempt) return res.status(404).json({ error: 'Payment attempt not found.' });

      if (req.query.format === 'png') {
        const png = await generateUpiQrPngBuffer(attempt.upiUri);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', `attachment; filename="${attempt.paymentRef}-UPI-QR.png"`);
        return res.send(png);
      }

      const qrDataUrl = await generateUpiQrDataUrl(attempt.upiUri);
      res.json({
        paymentRef: attempt.paymentRef,
        expectedAmountPaise: attempt.expectedAmountPaise,
        receivingUpiId: attempt.receivingUpiSnapshot,
        payeeName: attempt.receivingPayeeSnapshot,
        upiUri: attempt.upiUri,
        qrDataUrl,
        expiresAt: attempt.expiresAt,
      });
    } catch (err) {
      console.error('GET /upi-qr failed:', err);
      res.status(500).json({ error: 'Failed to generate UPI QR.' });
    }
  }
);

// Customer reports payment completed or failed (NEVER marks VERIFIED!)
apiRouter.post(
  '/payments/:paymentId/report',
  rateLimit(60_000, 20),
  requireAuthOrApiKey({
    allowedRoles: ['SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ', 'CLIENT'],
    requiredScopes: ['payments:report'],
  }),
  async (req: AuthRequest, res: Response) => {
    try {
      // Strictly reject any client-side tamper attempt
      if (req.body?.verified === true || req.body?.status === 'VERIFIED') {
        await recordAuditLog({
          ...actorMeta(req),
          action: 'PAYMENT_VERIFICATION_TAMPER_BLOCKED',
          resourceType: 'PAYMENT_ATTEMPT',
          resourceId: String(req.params.paymentId),
          status: 'DENIED',
        });
        return res.status(403).json({
          error: 'Clients cannot self-verify payments. Finance verification against bank records is mandatory.',
          code: 'CLIENT_VERIFICATION_FORBIDDEN',
        });
      }

      const schema = z.object({
        outcome: z.enum(['PAID', 'FAILED']),
        utrReference: z.string().max(40).optional().default(''),
        reportedAmountPaise: z.number().int().positive().optional(),
        note: z.string().max(300).optional().default(''),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid payment report payload.' });
      }
      const d = parsed.data;
      const pid = String(req.params.paymentId);
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pid);

      const [attempt] = await db
        .select()
        .from(paymentAttempts)
        .where(isUuid ? eq(paymentAttempts.id, pid) : eq(paymentAttempts.paymentRef, pid))
        .limit(1);
      if (!attempt) return res.status(404).json({ error: 'Payment attempt not found.' });

      if (attempt.status === 'VERIFIED') {
        return res.status(409).json({ error: 'Payment is already verified.' });
      }

      const [customer] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, attempt.customerId))
        .limit(1);

      if (
        req.authUser &&
        req.authUser.roles.every((r) => r === 'CLIENT') &&
        customer.linkedUserId !== req.authUser.id &&
        customer.email.toLowerCase() !== req.authUser.email.toLowerCase()
      ) {
        return res.status(403).json({ error: 'Access denied.' });
      }

      const targetStatus: PaymentAttemptStatus =
        d.outcome === 'PAID' ? 'VERIFICATION_PENDING' : 'FAILED_REPORTED';

      assertValidPaymentTransition(attempt.status as PaymentAttemptStatus, targetStatus, 'CLIENT');

      const cleanedUtr = d.utrReference.trim().toUpperCase();
      if (d.outcome === 'PAID' && cleanedUtr && !validateUtr(cleanedUtr)) {
        return res.status(400).json({ error: 'UTR / UPI Reference must be 6–35 alphanumeric characters.' });
      }

      const [updated] = await db
        .update(paymentAttempts)
        .set({
          status: targetStatus,
          customerReportedUtr: cleanedUtr || attempt.customerReportedUtr,
          reportedAmountPaise: d.reportedAmountPaise ?? attempt.expectedAmountPaise,
          customerReportedAt: new Date(),
          customerReportNote: d.note.trim(),
          updatedAt: new Date(),
        })
        .where(eq(paymentAttempts.id, attempt.id))
        .returning();

      await db.insert(verificationActions).values({
        paymentAttemptId: attempt.id,
        actionType: 'REPORTED_BY_CUSTOMER',
        recordedUtr: cleanedUtr || null,
        recordedAmountPaise: d.reportedAmountPaise ?? attempt.expectedAmountPaise,
        notes:
          d.outcome === 'PAID'
            ? d.note.trim() || 'Customer reported UPI transfer completed; queued for Finance verification.'
            : d.note.trim() || 'Customer reported UPI attempt failed.',
        actorUserId: req.authUser?.id ?? null,
      });

      await recordAuditLog({
        ...actorMeta(req),
        action: d.outcome === 'PAID' ? 'CUSTOMER_REPORTED_PAYMENT' : 'CUSTOMER_REPORTED_FAILURE',
        resourceType: 'PAYMENT_ATTEMPT',
        resourceId: attempt.paymentRef,
        newState: { status: targetStatus, customerReportedUtr: cleanedUtr || null },
      });

      if (d.outcome === 'PAID') {
        await emitNotification({
          recipientRole: 'FINANCE_ADMIN',
          eventType: 'PAYMENT_REPORTED',
          title: `Verification Pending — ${attempt.paymentRef}`,
          message: `${customer.name} reported ${formatInrFromPaise(updated.reportedAmountPaise || attempt.expectedAmountPaise)} (UTR: ${cleanedUtr || 'not supplied'}). Check actual bank statement before confirming.`,
          entityType: 'PAYMENT_ATTEMPT',
          entityId: attempt.paymentRef,
        });
      }

      res.json({
        attempt: updated,
        message:
          d.outcome === 'PAID'
            ? 'Payment reported. We are awaiting Finance verification of the incoming bank transfer.'
            : 'Attempt marked as customer-reported failure. You may initiate a fresh payment attempt with a new Payment ID.',
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to report payment status.';
      res.status(400).json({ error: message });
    }
  }
);

// =============================================================================
// 6. HYBRID VERIFICATION QUEUE (FINANCE ADMIN & SUPER ADMIN ONLY)
// =============================================================================

apiRouter.get(
  '/verification-queue',
  requireAuthOrApiKey({
    allowedRoles: ['SUPER_ADMIN', 'FINANCE_ADMIN'],
    requiredScopes: ['verification:read'],
  }),
  async (_req: AuthRequest, res: Response) => {
    try {
      const queueRows = await db
        .select({
          attempt: paymentAttempts,
          request: paymentRequests,
          customer: customers,
          project: projects,
          invoice: invoices,
          account: receivingAccounts,
        })
        .from(paymentAttempts)
        .innerJoin(paymentRequests, eq(paymentAttempts.paymentRequestId, paymentRequests.id))
        .innerJoin(customers, eq(paymentAttempts.customerId, customers.id))
        .innerJoin(projects, eq(paymentRequests.projectId, projects.id))
        .innerJoin(invoices, eq(paymentAttempts.invoiceId, invoices.id))
        .innerJoin(receivingAccounts, eq(paymentAttempts.receivingAccountId, receivingAccounts.id))
        .where(
          inArray(paymentAttempts.status, [
            'PAYMENT_REPORTED',
            'VERIFICATION_PENDING',
            'REVIEW_REQUIRED',
            'DISPUTED',
            'AWAITING_PAYMENT',
            'EXPIRED',
          ])
        )
        .orderBy(desc(paymentAttempts.updatedAt));

      const attemptIds = queueRows.map((r) => r.attempt.id);
      const matches =
        attemptIds.length > 0
          ? await db
              .select({
                match: reconciliationMatches,
                bankTx: bankTransactions,
              })
              .from(reconciliationMatches)
              .innerJoin(
                bankTransactions,
                eq(reconciliationMatches.bankTransactionId, bankTransactions.id)
              )
              .where(inArray(reconciliationMatches.paymentAttemptId, attemptIds))
          : [];

      const matchMap = new Map<string, Array<{ match: typeof reconciliationMatches.$inferSelect; bankTx: typeof bankTransactions.$inferSelect }>>();
      for (const m of matches) {
        if (!m.match.paymentAttemptId) continue;
        const arr = matchMap.get(m.match.paymentAttemptId) || [];
        arr.push(m);
        matchMap.set(m.match.paymentAttemptId, arr);
      }

      res.json({
        queue: queueRows.map((r) => ({
          attempt: r.attempt,
          paymentRequest: {
            id: r.request.id,
            requestRef: r.request.requestRef,
            category: r.request.category,
            title: r.request.title,
          },
          customer: {
            customerRef: r.customer.customerRef,
            name: r.customer.name,
            email: r.customer.email,
          },
          project: {
            projectRef: r.project.projectRef,
            name: r.project.name,
          },
          invoice: {
            invoiceRef: r.invoice.invoiceRef,
          },
          receivingAccount: {
            accountCode: r.account.accountCode,
            bankName: r.account.bankName,
            accountNumberMasked: r.account.accountNumberMasked,
            upiId: r.account.upiId,
          },
          suggestedBankMatches: matchMap.get(r.attempt.id) || [],
        })),
      });
    } catch (err) {
      console.error('GET /verification-queue failed:', err);
      res.status(500).json({ error: 'Failed to load verification queue.' });
    }
  }
);

apiRouter.post(
  '/verifications/:paymentId/confirm',
  requireAuthOrApiKey({
    allowedRoles: ['SUPER_ADMIN', 'FINANCE_ADMIN'],
    requiredScopes: ['verification:confirm'],
  }),
  async (req: AuthRequest, res: Response) => {
    try {
      const schema = z.object({
        verifiedUtr: z.string().min(6).max(35),
        creditedAmountPaise: z.number().int().positive(),
        bankTransactionDate: z.string().optional(),
        notes: z.string().max(400).optional().default(''),
        bankTransactionId: z.string().uuid().nullable().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Valid UTR and credited amount in paise are required.',
        });
      }
      const d = parsed.data;
      const bankDate = d.bankTransactionDate ? new Date(d.bankTransactionDate) : new Date();

      const result = await confirmPaymentVerification({
        paymentAttemptIdOrRef: String(req.params.paymentId),
        verifiedUtr: d.verifiedUtr,
        creditedAmountPaise: d.creditedAmountPaise,
        bankTransactionDate: Number.isNaN(bankDate.getTime()) ? new Date() : bankDate,
        notes: d.notes,
        bankTransactionId: d.bankTransactionId ?? null,
        source: d.bankTransactionId ? 'RECONCILED' : 'MANUAL',
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        actorRole: req.authUser!.roles.join(','),
        ipAddress: req.ip,
      });

      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Verification confirmation failed.';
      const status = message.includes('Duplicate UTR') || message.includes('already VERIFIED') ? 409 : 400;
      res.status(status).json({ error: message });
    }
  }
);

apiRouter.post(
  '/verifications/:paymentId/reject',
  requireAuthOrApiKey({
    allowedRoles: ['SUPER_ADMIN', 'FINANCE_ADMIN'],
    requiredScopes: ['verification:confirm'],
  }),
  async (req: AuthRequest, res: Response) => {
    try {
      const reason = String(req.body?.reason || '').trim();
      const target = req.body?.markAsReview ? 'REVIEW_REQUIRED' : 'FAILED_REPORTED';
      if (reason.length < 4) {
        return res.status(400).json({ error: 'A clear verification rejection reason is required.' });
      }
      const pid = String(req.params.paymentId);
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pid);

      const [attempt] = await db
        .select()
        .from(paymentAttempts)
        .where(isUuid ? eq(paymentAttempts.id, pid) : eq(paymentAttempts.paymentRef, pid))
        .limit(1);
      if (!attempt) return res.status(404).json({ error: 'Payment attempt not found.' });
      if (attempt.status === 'VERIFIED') {
        return res.status(409).json({ error: 'Cannot reject an already verified payment.' });
      }

      assertValidPaymentTransition(
        attempt.status as PaymentAttemptStatus,
        target,
        'FINANCE_BACKEND'
      );

      const [updated] = await db
        .update(paymentAttempts)
        .set({ status: target, updatedAt: new Date() })
        .where(eq(paymentAttempts.id, attempt.id))
        .returning();

      await db.insert(verificationActions).values({
        paymentAttemptId: attempt.id,
        actionType: target === 'REVIEW_REQUIRED' ? 'FLAGGED_REVIEW' : 'REJECTED',
        notes: reason,
        actorUserId: req.authUser?.id ?? null,
      });

      await recordAuditLog({
        ...actorMeta(req),
        action: target === 'REVIEW_REQUIRED' ? 'PAYMENT_FLAGGED_REVIEW' : 'PAYMENT_VERIFICATION_REJECTED',
        resourceType: 'PAYMENT_ATTEMPT',
        resourceId: attempt.paymentRef,
        newState: { status: target, reason },
      });

      res.json({ attempt: updated });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Rejection failed.' });
    }
  }
);

// =============================================================================
// 7. BANK STATEMENT CSV RECONCILIATION (FINANCE ADMIN & SUPER ADMIN ONLY)
// =============================================================================

apiRouter.post(
  '/reconciliation/imports',
  requireAuthOrApiKey({
    allowedRoles: ['SUPER_ADMIN', 'FINANCE_ADMIN'],
    requiredScopes: ['reconciliation:write'],
  }),
  async (req: AuthRequest, res: Response) => {
    try {
      const schema = z.object({
        receivingAccountId: z.string().uuid(),
        sourceFilename: z.string().min(1).max(200),
        csvContent: z.string().min(10),
        columnMapping: z.object({
          dateColumn: z.string().min(1),
          amountColumn: z.string().default(''),
          directionColumn: z.string().optional(),
          creditColumn: z.string().optional(),
          debitColumn: z.string().optional(),
          utrColumn: z.string().min(1),
          descriptionColumn: z.string().min(1),
        }),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid CSV import payload.' });
      }
      const d = parsed.data;

      const [account] = await db
        .select()
        .from(receivingAccounts)
        .where(eq(receivingAccounts.id, d.receivingAccountId))
        .limit(1);
      if (!account) return res.status(404).json({ error: 'Selected receiving account not found.' });

      const { rows } = parseCsvText(d.csvContent);
      if (rows.length === 0) {
        return res.status(400).json({ error: 'CSV file contains no data rows.' });
      }

      const normalizedRows = normalizeBankStatementRows(rows, d.columnMapping, d.receivingAccountId);
      const fileHash = sha256Hex(d.csvContent);

      // Load existing fingerprints for duplicate quarantine & candidate open payment attempts
      const existingFingerprints = new Set(
        (
          await db
            .select({ fp: bankTransactions.dedupFingerprint })
            .from(bankTransactions)
            .where(eq(bankTransactions.receivingAccountId, d.receivingAccountId))
        ).map((r) => r.fp)
      );

      const openAttempts = await db
        .select({
          id: paymentAttempts.id,
          paymentRef: paymentAttempts.paymentRef,
          paymentRequestId: paymentAttempts.paymentRequestId,
          receivingAccountId: paymentAttempts.receivingAccountId,
          expectedAmountPaise: paymentAttempts.expectedAmountPaise,
          status: paymentAttempts.status,
          customerReportedUtr: paymentAttempts.customerReportedUtr,
        })
        .from(paymentAttempts)
        .where(
          and(
            eq(paymentAttempts.receivingAccountId, d.receivingAccountId),
            inArray(paymentAttempts.status, [
              'AWAITING_PAYMENT',
              'PAYMENT_REPORTED',
              'VERIFICATION_PENDING',
              'REVIEW_REQUIRED',
              'DISPUTED',
              'EXPIRED',
            ])
          )
        );

      const summary = await db.transaction(async (tx) => {
        const [imp] = await tx
          .insert(reconciliationImports)
          .values({
            importRef: generateImportRef(),
            receivingAccountId: d.receivingAccountId,
            sourceFilename: d.sourceFilename,
            fileHash,
            columnMappingJson: d.columnMapping as Record<string, string>,
            totalRows: normalizedRows.length,
            importedByUserId: req.authUser?.id ?? null,
          })
          .returning();

        let creditRows = 0;
        let matchedCount = 0;
        let ambiguousCount = 0;
        let unmatchedCount = 0;
        let duplicateQuarantinedCount = 0;
        const batchFingerprints = new Set<string>();

        for (const nr of normalizedRows) {
          const isDup =
            existingFingerprints.has(nr.dedupFingerprint) ||
            batchFingerprints.has(nr.dedupFingerprint);
          batchFingerprints.add(nr.dedupFingerprint);

          if (isDup) {
            duplicateQuarantinedCount++;
            await tx.insert(bankTransactions).values({
              reconciliationImportId: imp.id,
              receivingAccountId: d.receivingAccountId,
              direction: nr.direction,
              amountPaise: nr.amountPaise,
              currency: 'INR',
              bankReferenceUtr: nr.bankReferenceUtr,
              transactionDate: nr.transactionDate,
              description: nr.description,
              dedupFingerprint: nr.dedupFingerprint,
              isDuplicateQuarantined: true,
              settlementStatus: 'REJECTED',
              rawRowJson: nr.rawRow,
            });
            continue;
          }

          if (nr.direction !== 'CREDIT' || nr.amountPaise <= 0) {
            await tx.insert(bankTransactions).values({
              reconciliationImportId: imp.id,
              receivingAccountId: d.receivingAccountId,
              direction: 'DEBIT',
              amountPaise: nr.amountPaise,
              currency: 'INR',
              bankReferenceUtr: nr.bankReferenceUtr,
              transactionDate: nr.transactionDate,
              description: nr.description,
              dedupFingerprint: nr.dedupFingerprint,
              isDuplicateQuarantined: false,
              settlementStatus: 'IGNORED_DEBIT',
              rawRowJson: nr.rawRow,
            });
            continue;
          }

          creditRows++;
          const evaluation = evaluateCreditMatch(
            {
              receivingAccountId: d.receivingAccountId,
              amountPaise: nr.amountPaise,
              bankReferenceUtr: nr.bankReferenceUtr,
              description: nr.description,
            },
            openAttempts
          );

          if (evaluation.classification === 'MATCHED') matchedCount++;
          else if (evaluation.classification === 'AMBIGUOUS') ambiguousCount++;
          else if (evaluation.classification === 'UNMATCHED') unmatchedCount++;

          const [savedTx] = await tx
            .insert(bankTransactions)
            .values({
              reconciliationImportId: imp.id,
              receivingAccountId: d.receivingAccountId,
              direction: 'CREDIT',
              amountPaise: nr.amountPaise,
              currency: 'INR',
              bankReferenceUtr: nr.bankReferenceUtr,
              transactionDate: nr.transactionDate,
              description: nr.description,
              dedupFingerprint: nr.dedupFingerprint,
              isDuplicateQuarantined: false,
              settlementStatus:
                evaluation.classification === 'MATCHED' ? 'MATCHED' : 'UNALLOCATED',
              rawRowJson: nr.rawRow,
            })
            .returning();

          await tx.insert(reconciliationMatches).values({
            bankTransactionId: savedTx.id,
            paymentAttemptId: evaluation.matchedAttemptId,
            paymentRequestId: evaluation.matchedRequestId,
            matchClassification: evaluation.classification,
            confidenceScore: evaluation.confidenceScore,
            matchReasonsJson: evaluation.reasons,
          });
        }

        const [updatedImp] = await tx
          .update(reconciliationImports)
          .set({
            creditRows,
            matchedCount,
            ambiguousCount,
            unmatchedCount,
            duplicateQuarantinedCount,
          })
          .where(eq(reconciliationImports.id, imp.id))
          .returning();

        return updatedImp;
      });

      await recordAuditLog({
        ...actorMeta(req),
        action: 'BANK_STATEMENT_IMPORTED',
        resourceType: 'RECONCILIATION_IMPORT',
        resourceId: summary.importRef,
        newState: {
          sourceFilename: summary.sourceFilename,
          totalRows: summary.totalRows,
          creditRows: summary.creditRows,
          matchedCount: summary.matchedCount,
          ambiguousCount: summary.ambiguousCount,
          duplicateQuarantinedCount: summary.duplicateQuarantinedCount,
        },
      });

      if (summary.ambiguousCount > 0 || summary.unmatchedCount > 0) {
        await emitNotification({
          recipientRole: 'FINANCE_ADMIN',
          eventType: 'RECONCILIATION_EXCEPTION',
          title: `Statement ${summary.importRef} Has Review Exceptions`,
          message: `${summary.ambiguousCount} ambiguous and ${summary.unmatchedCount} unmatched credits require Finance review.`,
          entityType: 'RECONCILIATION_IMPORT',
          entityId: summary.importRef,
        });
      }

      res.status(201).json({ importBatch: summary });
    } catch (err: unknown) {
      console.error('CSV import failed:', err);
      res.status(400).json({ error: err instanceof Error ? err.message : 'Statement import failed.' });
    }
  }
);

apiRouter.get(
  '/reconciliation/matches',
  requireAuthOrApiKey({
    allowedRoles: ['SUPER_ADMIN', 'FINANCE_ADMIN'],
    requiredScopes: ['reconciliation:read'],
  }),
  async (_req: AuthRequest, res: Response) => {
    try {
      const imports = await db
        .select({
          batch: reconciliationImports,
          account: receivingAccounts,
        })
        .from(reconciliationImports)
        .innerJoin(
          receivingAccounts,
          eq(reconciliationImports.receivingAccountId, receivingAccounts.id)
        )
        .orderBy(desc(reconciliationImports.createdAt))
        .limit(20);

      const matches = await db
        .select({
          match: reconciliationMatches,
          bankTx: bankTransactions,
          account: receivingAccounts,
        })
        .from(reconciliationMatches)
        .innerJoin(bankTransactions, eq(reconciliationMatches.bankTransactionId, bankTransactions.id))
        .innerJoin(receivingAccounts, eq(bankTransactions.receivingAccountId, receivingAccounts.id))
        .orderBy(desc(reconciliationMatches.createdAt))
        .limit(100);

      const attemptIds = matches
        .map((m) => m.match.paymentAttemptId)
        .filter((x): x is string => Boolean(x));

      const linkedAttempts =
        attemptIds.length > 0
          ? await db
              .select({
                attempt: paymentAttempts,
                customer: customers,
                invoice: invoices,
              })
              .from(paymentAttempts)
              .innerJoin(customers, eq(paymentAttempts.customerId, customers.id))
              .innerJoin(invoices, eq(paymentAttempts.invoiceId, invoices.id))
              .where(inArray(paymentAttempts.id, attemptIds))
          : [];

      const attemptMap = new Map(linkedAttempts.map((a) => [a.attempt.id, a]));

      res.json({
        imports: imports.map((i) => ({
          ...i.batch,
          accountCode: i.account.accountCode,
          bankName: i.account.bankName,
          accountNumberMasked: i.account.accountNumberMasked,
        })),
        matches: matches.map((m) => {
          const linked = m.match.paymentAttemptId
            ? attemptMap.get(m.match.paymentAttemptId) || null
            : null;
          return {
            ...m.match,
            bankTransaction: m.bankTx,
            receivingAccount: {
              accountCode: m.account.accountCode,
              bankName: m.account.bankName,
              upiId: m.account.upiId,
            },
            linkedPayment: linked
              ? {
                  id: linked.attempt.id,
                  paymentRef: linked.attempt.paymentRef,
                  expectedAmountPaise: linked.attempt.expectedAmountPaise,
                  status: linked.attempt.status,
                  customerName: linked.customer.name,
                  invoiceRef: linked.invoice.invoiceRef,
                }
              : null,
          };
        }),
      });
    } catch (err) {
      console.error('GET /reconciliation/matches failed:', err);
      res.status(500).json({ error: 'Failed to load reconciliation matches.' });
    }
  }
);

apiRouter.post(
  '/reconciliation/matches/:matchId/confirm',
  requireUserAuth,
  requireRoles('SUPER_ADMIN', 'FINANCE_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const matchId = String(req.params.matchId);
      const overridePaymentAttemptId = req.body?.paymentAttemptId
        ? String(req.body.paymentAttemptId)
        : null;
      const reviewNote = String(req.body?.note || '').trim();

      const rows = await db
        .select({
          match: reconciliationMatches,
          bankTx: bankTransactions,
        })
        .from(reconciliationMatches)
        .innerJoin(bankTransactions, eq(reconciliationMatches.bankTransactionId, bankTransactions.id))
        .where(eq(reconciliationMatches.id, matchId))
        .limit(1);

      if (rows.length === 0) return res.status(404).json({ error: 'Reconciliation match not found.' });
      const { match, bankTx } = rows[0];

      if (bankTx.settlementStatus === 'CONFIRMED') {
        return res.status(409).json({
          error: 'This bank credit has already been settled and cannot be applied again.',
        });
      }

      const targetAttemptId = overridePaymentAttemptId || match.paymentAttemptId;
      if (!targetAttemptId) {
        return res.status(400).json({
          error: 'Select a target Payment Attempt ID before confirming an ambiguous or unmatched bank credit.',
        });
      }

      const utrToUse =
        bankTx.bankReferenceUtr ||
        String(req.body?.utrOverride || '').trim().toUpperCase();
      if (!utrToUse || !validateUtr(utrToUse)) {
        return res.status(400).json({
          error: 'A valid bank UTR reference (6–35 alphanumeric chars) is required to settle this bank credit.',
        });
      }

      const result = await confirmPaymentVerification({
        paymentAttemptIdOrRef: targetAttemptId,
        verifiedUtr: utrToUse,
        creditedAmountPaise: bankTx.amountPaise,
        bankTransactionDate: bankTx.transactionDate,
        notes: reviewNote || `Confirmed via bank statement reconciliation (${bankTx.description}).`,
        bankTransactionId: bankTx.id,
        source: 'RECONCILED',
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        actorRole: req.authUser!.roles.join(','),
        ipAddress: req.ip,
      });

      await db
        .update(reconciliationMatches)
        .set({
          paymentAttemptId: targetAttemptId,
          matchClassification: 'CONFIRMED',
          reviewedByUserId: req.authUser!.id,
          reviewedAt: new Date(),
          reviewNote,
          updatedAt: new Date(),
        })
        .where(eq(reconciliationMatches.id, matchId));

      res.json({ confirmed: true, verification: result });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to confirm match.' });
    }
  }
);

apiRouter.post(
  '/reconciliation/matches/:matchId/reject',
  requireUserAuth,
  requireRoles('SUPER_ADMIN', 'FINANCE_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const matchId = String(req.params.matchId);
      const reviewNote = String(req.body?.note || 'Rejected by Finance Admin').trim();
      const [updated] = await db
        .update(reconciliationMatches)
        .set({
          matchClassification: 'REJECTED',
          reviewedByUserId: req.authUser!.id,
          reviewedAt: new Date(),
          reviewNote,
          updatedAt: new Date(),
        })
        .where(eq(reconciliationMatches.id, matchId))
        .returning();
      if (!updated) return res.status(404).json({ error: 'Match not found.' });

      await recordAuditLog({
        ...actorMeta(req),
        action: 'RECONCILIATION_MATCH_REJECTED',
        resourceType: 'RECONCILIATION_MATCH',
        resourceId: matchId,
        newState: { reviewNote },
      });

      res.json({ match: updated });
    } catch (err) {
      console.error('Reject match failed:', err);
      res.status(500).json({ error: 'Failed to reject match.' });
    }
  }
);

// =============================================================================
// 8. OVERVIEW, TRANSACTIONS & RECEIPTS
// =============================================================================

apiRouter.get(
  '/overview',
  requireAuthOrApiKey({
    allowedRoles: ['SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ'],
    requiredScopes: ['overview:read'],
  }),
  async (_req: AuthRequest, res: Response) => {
    try {
      const [verifiedLedger] = await db
        .select({ total: sql<string>`COALESCE(SUM(${financialLedgerEntries.amountPaise}), 0)` })
        .from(financialLedgerEntries)
        .where(eq(financialLedgerEntries.entryType, 'VERIFIED_CREDIT'));

      const [expectedReqs] = await db
        .select({
          totalDue: sql<string>`COALESCE(SUM(${paymentRequests.amountDuePaise}), 0)`,
          totalVerified: sql<string>`COALESCE(SUM(${paymentRequests.amountVerifiedPaise}), 0)`,
        })
        .from(paymentRequests)
        .where(inArray(paymentRequests.status, ['OPEN', 'PARTIALLY_VERIFIED', 'PAID']));

      const [reportedClaims] = await db
        .select({
          totalReported: sql<string>`COALESCE(SUM(${paymentAttempts.reportedAmountPaise}), 0)`,
          countPending: sql<string>`COUNT(*)`,
        })
        .from(paymentAttempts)
        .where(
          inArray(paymentAttempts.status, [
            'PAYMENT_REPORTED',
            'VERIFICATION_PENDING',
            'REVIEW_REQUIRED',
          ])
        );

      const [outstandingInv] = await db
        .select({ count: sql<string>`COUNT(*)` })
        .from(invoices)
        .where(inArray(invoices.status, ['ISSUED', 'PARTIALLY_PAID']));

      const [activeDisputes] = await db
        .select({ count: sql<string>`COUNT(*)` })
        .from(paymentDisputes)
        .where(
          inArray(paymentDisputes.status, [
            'OPEN',
            'ASSIGNED',
            'CLARIFICATION_REQUESTED',
            'UNDER_BANK_CHECK',
            'REOPENED',
          ])
        );

      const [reconExceptions] = await db
        .select({ count: sql<string>`COUNT(*)` })
        .from(reconciliationMatches)
        .where(
          inArray(reconciliationMatches.matchClassification, [
            'AMBIGUOUS',
            'UNMATCHED',
            'POTENTIAL_MATCH',
          ])
        );

      const [appsStats] = await db
        .select({ count: sql<string>`COUNT(*)` })
        .from(connectedApplications)
        .where(eq(connectedApplications.isActive, true));

      const [failedApi] = await db
        .select({
          failures: sql<string>`COALESCE(SUM(${applicationCredentials.failureCount}), 0)`,
          requests: sql<string>`COALESCE(SUM(${applicationCredentials.requestCount}), 0)`,
        })
        .from(applicationCredentials);

      const recentTx = await db
        .select({
          attempt: paymentAttempts,
          customer: customers,
          invoice: invoices,
          request: paymentRequests,
        })
        .from(paymentAttempts)
        .innerJoin(customers, eq(paymentAttempts.customerId, customers.id))
        .innerJoin(invoices, eq(paymentAttempts.invoiceId, invoices.id))
        .innerJoin(paymentRequests, eq(paymentAttempts.paymentRequestId, paymentRequests.id))
        .orderBy(desc(paymentAttempts.createdAt))
        .limit(10);

      const [activeAcc] = await db
        .select({
          accountCode: receivingAccounts.accountCode,
          bankName: receivingAccounts.bankName,
          accountNumberMasked: receivingAccounts.accountNumberMasked,
          upiId: receivingAccounts.upiId,
          manualCheckAttested: receivingAccounts.manualCheckAttested,
        })
        .from(receivingAccounts)
        .where(eq(receivingAccounts.isActive, true))
        .limit(1);

      const totalExpectedPaise = Number(expectedReqs?.totalDue || 0);
      const totalVerifiedPaise = Number(verifiedLedger?.total || 0);

      res.json({
        metrics: {
          totalVerifiedCollectionsPaise: totalVerifiedPaise,
          totalExpectedPaise,
          totalReportedUnverifiedPaise: Number(reportedClaims?.totalReported || 0),
          outstandingBalancePaise: Math.max(0, totalExpectedPaise - totalVerifiedPaise),
          outstandingInvoicesCount: Number(outstandingInv?.count || 0),
          paymentsAwaitingVerificationCount: Number(reportedClaims?.countPending || 0),
          activeDisputesCount: Number(activeDisputes?.count || 0),
          reconciliationExceptionsCount: Number(reconExceptions?.count || 0),
          connectedApplicationsCount: Number(appsStats?.count || 0),
          apiTotalRequests: Number(failedApi?.requests || 0),
          apiFailedRequests: Number(failedApi?.failures || 0),
        },
        activeReceivingAccount: activeAcc || null,
        recentTransactions: recentTx.map((t) => ({
          id: t.attempt.id,
          paymentRef: t.attempt.paymentRef,
          customerRef: t.customer.customerRef,
          customerName: t.customer.name,
          invoiceRef: t.invoice.invoiceRef,
          category: t.request.category,
          expectedAmountPaise: t.attempt.expectedAmountPaise,
          verifiedAmountPaise: t.attempt.verifiedAmountPaise,
          status: t.attempt.status,
          verifiedUtr: t.attempt.verifiedUtr,
          customerReportedUtr: t.attempt.customerReportedUtr,
          createdAt: t.attempt.createdAt,
        })),
      });
    } catch (err) {
      console.error('GET /overview failed:', err);
      res.status(500).json({ error: 'Failed to load dashboard overview.' });
    }
  }
);

apiRouter.get(
  '/transactions',
  requireAuthOrApiKey({
    allowedRoles: ['SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ'],
    requiredScopes: ['transactions:read'],
  }),
  async (req: AuthRequest, res: Response) => {
    try {
      const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim() : '';
      const rows = await db
        .select({
          attempt: paymentAttempts,
          customer: customers,
          invoice: invoices,
          project: projects,
          request: paymentRequests,
        })
        .from(paymentAttempts)
        .innerJoin(customers, eq(paymentAttempts.customerId, customers.id))
        .innerJoin(invoices, eq(paymentAttempts.invoiceId, invoices.id))
        .innerJoin(paymentRequests, eq(paymentAttempts.paymentRequestId, paymentRequests.id))
        .innerJoin(projects, eq(paymentRequests.projectId, projects.id))
        .where(statusFilter && statusFilter !== 'ALL' ? eq(paymentAttempts.status, statusFilter) : undefined)
        .orderBy(desc(paymentAttempts.createdAt))
        .limit(200);

      res.json({
        transactions: rows.map((r) => ({
          ...r.attempt,
          customerRef: r.customer.customerRef,
          customerName: r.customer.name,
          invoiceRef: r.invoice.invoiceRef,
          projectRef: r.project.projectRef,
          projectName: r.project.name,
          requestRef: r.request.requestRef,
          category: r.request.category,
        })),
      });
    } catch (err) {
      console.error('GET /transactions failed:', err);
      res.status(500).json({ error: 'Failed to load transactions.' });
    }
  }
);

apiRouter.get(
  '/receipts',
  requireAuthOrApiKey({
    allowedRoles: ['SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ'],
    requiredScopes: ['receipts:read'],
  }),
  async (req: AuthRequest, res: Response) => {
    try {
      const rows = await db
        .select({
          receipt: receipts,
          attempt: paymentAttempts,
          customer: customers,
          project: projects,
          invoice: invoices,
        })
        .from(receipts)
        .innerJoin(paymentAttempts, eq(receipts.paymentAttemptId, paymentAttempts.id))
        .innerJoin(customers, eq(receipts.customerId, customers.id))
        .innerJoin(projects, eq(receipts.projectId, projects.id))
        .innerJoin(invoices, eq(receipts.invoiceId, invoices.id))
        .orderBy(desc(receipts.issuedAt));

      const userId = req.authUser?.id || req.authApp?.applicationId || 'api';

      res.json({
        receipts: rows.map((r) => {
          const token = createDocumentDownloadToken('receipt', r.receipt.id, userId, 300);
          return {
            ...r.receipt,
            paymentRef: r.attempt.paymentRef,
            customerRef: r.customer.customerRef,
            customerName: r.customer.name,
            projectRef: r.project.projectRef,
            projectName: r.project.name,
            invoiceRef: r.invoice.invoiceRef,
            pdfDownloadUrl: `/api/v1/documents/receipt/${token}`,
          };
        }),
      });
    } catch (err) {
      console.error('GET /receipts failed:', err);
      res.status(500).json({ error: 'Failed to load receipts.' });
    }
  }
);

apiRouter.get(
  '/payments/:paymentId/receipt',
  requireAuthOrApiKey({
    allowedRoles: ['SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ', 'CLIENT'],
    requiredScopes: ['receipts:read'],
  }),
  async (req: AuthRequest, res: Response) => {
    try {
      const pid = String(req.params.paymentId);
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pid);

      const [attempt] = await db
        .select()
        .from(paymentAttempts)
        .where(isUuid ? eq(paymentAttempts.id, pid) : eq(paymentAttempts.paymentRef, pid))
        .limit(1);
      if (!attempt) return res.status(404).json({ error: 'Payment attempt not found.' });
      if (attempt.status !== 'VERIFIED') {
        return res.status(403).json({
          error: 'Receipts are strictly issued only after Finance verifies the incoming bank credit.',
          code: 'RECEIPT_REQUIRES_VERIFICATION',
        });
      }

      const [customer] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, attempt.customerId))
        .limit(1);

      if (
        req.authUser &&
        req.authUser.roles.every((r) => r === 'CLIENT') &&
        customer.linkedUserId !== req.authUser.id &&
        customer.email.toLowerCase() !== req.authUser.email.toLowerCase()
      ) {
        return res.status(403).json({ error: 'Access denied.' });
      }

      const [receipt] = await db
        .select()
        .from(receipts)
        .where(eq(receipts.paymentAttemptId, attempt.id))
        .limit(1);
      if (!receipt) return res.status(404).json({ error: 'Receipt not found.' });

      const token = createDocumentDownloadToken(
        'receipt',
        receipt.id,
        req.authUser?.id || req.authApp?.applicationId || 'api',
        300
      );

      res.json({
        receipt,
        pdfDownloadUrl: `/api/v1/documents/receipt/${token}`,
        expiresInSeconds: 300,
      });
    } catch (err) {
      console.error('GET payment receipt failed:', err);
      res.status(500).json({ error: 'Failed to retrieve receipt.' });
    }
  }
);

apiRouter.get('/documents/receipt/:token', async (req, res: Response) => {
  try {
    const verified = verifyDocumentDownloadToken(String(req.params.token), 'receipt');
    if (!verified) {
      return res.status(403).json({ error: 'Receipt download link is invalid or expired.' });
    }

    const rows = await db
      .select({
        receipt: receipts,
        attempt: paymentAttempts,
        customer: customers,
        project: projects,
        invoice: invoices,
      })
      .from(receipts)
      .innerJoin(paymentAttempts, eq(receipts.paymentAttemptId, paymentAttempts.id))
      .innerJoin(customers, eq(receipts.customerId, customers.id))
      .innerJoin(projects, eq(receipts.projectId, projects.id))
      .innerJoin(invoices, eq(receipts.invoiceId, invoices.id))
      .where(eq(receipts.id, verified.resourceId))
      .limit(1);

    if (rows.length === 0) return res.status(404).json({ error: 'Receipt not found.' });
    const r = rows[0];

    const pdf = await renderReceiptPdfBuffer({
      receiptNumber: r.receipt.receiptNumber,
      issuedAt: r.receipt.issuedAt,
      category: r.receipt.category,
      paymentRef: r.attempt.paymentRef,
      invoiceRef: r.invoice.invoiceRef,
      projectRef: r.project.projectRef,
      projectName: r.project.name,
      customerRef: r.customer.customerRef,
      customerName: r.customer.name,
      customerEmail: r.customer.email,
      paidAmountPaise: r.receipt.paidAmountPaise,
      currency: r.receipt.currency,
      verifiedUtr: r.receipt.verifiedUtr,
      paymentMethod: r.receipt.paymentMethod,
      businessIdentity: r.receipt.businessIdentitySnapshotJson,
      taxDetails: r.receipt.taxDetailsSnapshotJson,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${r.receipt.receiptNumber}.pdf"`
    );
    res.send(pdf);
  } catch (err) {
    console.error('Receipt PDF generation failed:', err);
    res.status(500).json({ error: 'Failed to generate receipt PDF.' });
  }
});

// =============================================================================
// 9. MISSING PAYMENT & DISPUTE SYSTEM
// =============================================================================

apiRouter.post(
  '/disputes',
  rateLimit(60_000, 10),
  requireAuthOrApiKey({
    allowedRoles: ['SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ', 'CLIENT'],
    requiredScopes: ['disputes:write'],
  }),
  async (req: AuthRequest, res: Response) => {
    try {
      const schema = z.object({
        paymentAttemptId: z.string().min(4),
        claimedUtr: z.string().min(6).max(35),
        claimedAmountPaise: z.number().int().positive(),
        approximateTime: z.string().min(2).max(120),
        explanation: z.string().max(600).optional().default(''),
        supportingEvidenceNote: z.string().max(400).optional().default(''),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid dispute details.' });
      }
      const d = parsed.data;
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        d.paymentAttemptId
      );

      const [attempt] = await db
        .select()
        .from(paymentAttempts)
        .where(
          isUuid
            ? eq(paymentAttempts.id, d.paymentAttemptId)
            : eq(paymentAttempts.paymentRef, d.paymentAttemptId)
        )
        .limit(1);
      if (!attempt) return res.status(404).json({ error: 'Associated payment attempt not found.' });
      if (attempt.status === 'VERIFIED') {
        return res.status(409).json({ error: 'This payment is already verified and receipted.' });
      }

      const [customer] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, attempt.customerId))
        .limit(1);

      if (
        req.authUser &&
        req.authUser.roles.every((r) => r === 'CLIENT') &&
        customer.linkedUserId !== req.authUser.id &&
        customer.email.toLowerCase() !== req.authUser.email.toLowerCase()
      ) {
        return res.status(403).json({ error: 'Access denied.' });
      }

      // Limit duplicate dispute submissions per attempt
      const existingDisputes = await db
        .select()
        .from(paymentDisputes)
        .where(eq(paymentDisputes.paymentAttemptId, attempt.id));
      if (existingDisputes.length >= 2) {
        return res.status(429).json({
          error: 'Maximum dispute submission limit reached for this payment attempt. Finance HQ is reviewing your existing ticket.',
        });
      }

      const [created] = await db.transaction(async (tx) => {
        const [ticket] = await tx
          .insert(paymentDisputes)
          .values({
            ticketRef: generateDisputeRef(),
            paymentAttemptId: attempt.id,
            paymentRequestId: attempt.paymentRequestId,
            customerId: attempt.customerId,
            claimedUtr: d.claimedUtr.trim().toUpperCase(),
            claimedAmountPaise: d.claimedAmountPaise,
            approximateTime: d.approximateTime.trim(),
            explanation: d.explanation.trim(),
            supportingEvidenceNote: d.supportingEvidenceNote.trim(),
            status: 'OPEN',
            createdByUserId: req.authUser?.id ?? null,
          })
          .returning();

        await tx
          .update(paymentAttempts)
          .set({
            status: 'DISPUTED',
            customerReportedUtr: d.claimedUtr.trim().toUpperCase(),
            updatedAt: new Date(),
          })
          .where(eq(paymentAttempts.id, attempt.id));

        return [ticket];
      });

      await recordAuditLog({
        ...actorMeta(req),
        action: 'DISPUTE_CREATED',
        resourceType: 'PAYMENT_DISPUTE',
        resourceId: created.ticketRef,
        newState: { paymentRef: attempt.paymentRef, claimedUtr: created.claimedUtr },
      });

      await emitNotification({
        recipientRole: 'FINANCE_ADMIN',
        eventType: 'DISPUTE_CREATED',
        title: `Missing Payment Ticket ${created.ticketRef}`,
        message: `${customer.name} raised a missing payment claim for ${attempt.paymentRef} (UTR: ${created.claimedUtr}, ${formatInrFromPaise(created.claimedAmountPaise)}). Supporting info is non-conclusive until bank credit is confirmed.`,
        entityType: 'PAYMENT_DISPUTE',
        entityId: created.ticketRef,
      });

      res.status(201).json({ dispute: created });
    } catch (err) {
      console.error('POST /disputes failed:', err);
      res.status(500).json({ error: 'Failed to submit missing payment dispute.' });
    }
  }
);

apiRouter.get(
  '/disputes',
  requireAuthOrApiKey({
    allowedRoles: ['SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ'],
    requiredScopes: ['disputes:read'],
  }),
  async (_req: AuthRequest, res: Response) => {
    try {
      const rows = await db
        .select({
          dispute: paymentDisputes,
          attempt: paymentAttempts,
          customer: customers,
          invoice: invoices,
        })
        .from(paymentDisputes)
        .innerJoin(paymentAttempts, eq(paymentDisputes.paymentAttemptId, paymentAttempts.id))
        .innerJoin(customers, eq(paymentDisputes.customerId, customers.id))
        .innerJoin(invoices, eq(paymentAttempts.invoiceId, invoices.id))
        .orderBy(desc(paymentDisputes.createdAt));

      res.json({
        disputes: rows.map((r) => ({
          ...r.dispute,
          paymentRef: r.attempt.paymentRef,
          attemptStatus: r.attempt.status,
          expectedAmountPaise: r.attempt.expectedAmountPaise,
          customerRef: r.customer.customerRef,
          customerName: r.customer.name,
          customerEmail: r.customer.email,
          invoiceRef: r.invoice.invoiceRef,
        })),
      });
    } catch (err) {
      console.error('GET /disputes failed:', err);
      res.status(500).json({ error: 'Failed to load disputes.' });
    }
  }
);

apiRouter.patch(
  '/disputes/:id',
  requireAuthOrApiKey({
    allowedRoles: ['SUPER_ADMIN', 'FINANCE_ADMIN'],
    requiredScopes: ['disputes:write'],
  }),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = String(req.params.id);
      const schema = z.object({
        status: z.enum([
          'ASSIGNED',
          'CLARIFICATION_REQUESTED',
          'UNDER_BANK_CHECK',
          'APPROVED_VERIFIED',
          'REJECTED',
          'REOPENED',
        ]),
        resolutionNote: z.string().max(400).optional().default(''),
        matchedBankUtr: z.string().max(35).optional(),
        creditedAmountPaise: z.number().int().positive().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid dispute status update.' });
      }
      const d = parsed.data;

      const [existing] = await db
        .select()
        .from(paymentDisputes)
        .where(eq(paymentDisputes.id, id))
        .limit(1);
      if (!existing) return res.status(404).json({ error: 'Dispute ticket not found.' });

      let verificationResult = null;
      if (d.status === 'APPROVED_VERIFIED') {
        const utr = (d.matchedBankUtr || existing.claimedUtr).trim().toUpperCase();
        verificationResult = await confirmPaymentVerification({
          paymentAttemptIdOrRef: existing.paymentAttemptId,
          verifiedUtr: utr,
          creditedAmountPaise: d.creditedAmountPaise || existing.claimedAmountPaise,
          bankTransactionDate: new Date(),
          notes: d.resolutionNote || `Approved via missing payment ticket ${existing.ticketRef}.`,
          source: 'MANUAL',
          actorUserId: req.authUser!.id,
          actorEmail: req.authUser!.email,
          actorRole: req.authUser!.roles.join(','),
          ipAddress: req.ip,
        });
      }

      const [updated] = await db
        .update(paymentDisputes)
        .set({
          status: d.status,
          assignedToUserId: req.authUser?.id ?? existing.assignedToUserId,
          resolutionNote: d.resolutionNote || existing.resolutionNote,
          matchedBankUtr: d.matchedBankUtr?.trim().toUpperCase() || existing.matchedBankUtr,
          updatedAt: new Date(),
        })
        .where(eq(paymentDisputes.id, id))
        .returning();

      const [customer] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, existing.customerId))
        .limit(1);

      await recordAuditLog({
        ...actorMeta(req),
        action: 'DISPUTE_STATUS_UPDATED',
        resourceType: 'PAYMENT_DISPUTE',
        resourceId: existing.ticketRef,
        previousState: { status: existing.status },
        newState: { status: d.status, resolutionNote: d.resolutionNote },
      });

      if (customer?.linkedUserId) {
        await emitNotification({
          recipientUserId: customer.linkedUserId,
          eventType: 'DISPUTE_UPDATED',
          title: `Ticket ${existing.ticketRef} Updated: ${d.status.replace(/_/g, ' ')}`,
          message: d.resolutionNote || `Your missing payment ticket status changed to ${d.status}.`,
          entityType: 'PAYMENT_DISPUTE',
          entityId: existing.ticketRef,
        });
      }

      res.json({ dispute: updated, verificationResult });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update dispute.' });
    }
  }
);

// =============================================================================
// 10. CONNECTED APPLICATIONS & SCOPED API CREDENTIALS (SUPER ADMIN ONLY)
// =============================================================================

apiRouter.get(
  '/admin/applications',
  requireUserAuth,
  requireRoles('SUPER_ADMIN'),
  async (_req: AuthRequest, res: Response) => {
    try {
      await ensureSystemBootstrapped();
      const apps = await db
        .select()
        .from(connectedApplications)
        .orderBy(connectedApplications.createdAt);
      const creds = await db
        .select()
        .from(applicationCredentials)
        .orderBy(desc(applicationCredentials.createdAt));

      res.json({
        applications: apps.map((a) => {
          const appCreds = creds.filter((c) => c.applicationId === a.id);
          return {
            ...a,
            activeCredentialCount: appCreds.filter((c) => !c.isRevoked).length,
            totalRequests: appCreds.reduce((acc, c) => acc + c.requestCount, 0),
            totalFailures: appCreds.reduce((acc, c) => acc + c.failureCount, 0),
            credentials: appCreds.map((c) => ({
              id: c.id,
              applicationId: c.applicationId,
              label: c.label,
              keyPrefix: c.keyPrefix,
              scopes: c.scopesJson,
              isRevoked: c.isRevoked,
              revokedAt: c.revokedAt,
              lastUsedAt: c.lastUsedAt,
              requestCount: c.requestCount,
              failureCount: c.failureCount,
              expiresAt: c.expiresAt,
              createdAt: c.createdAt,
            })),
          };
        }),
      });
    } catch (err) {
      console.error('GET /admin/applications failed:', err);
      res.status(500).json({ error: 'Failed to load connected applications.' });
    }
  }
);

apiRouter.post(
  '/admin/applications',
  requireUserAuth,
  requireRoles('SUPER_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const schema = z.object({
        name: z.string().min(2).max(120),
        category: z.enum(['ADMIN_HQ', 'FINANCE_HQ', 'EMPLOYEE_HQ', 'CLIENT_APP', 'CUSTOM']),
        description: z.string().max(300).optional().default(''),
        webhookUrl: z.string().url().optional().or(z.literal('')),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid application payload.' });
      }
      const d = parsed.data;
      const appCode = `FXAPP-${d.name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 18)}-${Math.floor(100 + Math.random() * 900)}`;

      const [created] = await db
        .insert(connectedApplications)
        .values({
          appCode,
          name: d.name.trim(),
          category: d.category,
          description: d.description.trim(),
          webhookUrl: d.webhookUrl || null,
          isActive: true,
          createdByUserId: req.authUser!.id,
        })
        .returning();

      await recordAuditLog({
        ...actorMeta(req),
        action: 'CONNECTED_APP_REGISTERED',
        resourceType: 'CONNECTED_APPLICATION',
        resourceId: created.appCode,
        newState: { name: created.name, category: created.category },
      });

      res.status(201).json({ application: created });
    } catch (err) {
      console.error('POST /admin/applications failed:', err);
      res.status(500).json({ error: 'Failed to register application.' });
    }
  }
);

apiRouter.patch(
  '/admin/applications/:id',
  requireUserAuth,
  requireRoles('SUPER_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = String(req.params.id);
      const isActive = Boolean(req.body?.isActive);
      const [updated] = await db
        .update(connectedApplications)
        .set({ isActive, updatedAt: new Date() })
        .where(eq(connectedApplications.id, id))
        .returning();
      if (!updated) return res.status(404).json({ error: 'Application not found.' });

      await recordAuditLog({
        ...actorMeta(req),
        action: isActive ? 'CONNECTED_APP_ENABLED' : 'CONNECTED_APP_DISABLED',
        resourceType: 'CONNECTED_APPLICATION',
        resourceId: updated.appCode,
      });

      res.json({ application: updated });
    } catch (err) {
      console.error('PATCH /admin/applications/:id failed:', err);
      res.status(500).json({ error: 'Failed to update application.' });
    }
  }
);

apiRouter.post(
  '/admin/applications/:id/credentials',
  requireUserAuth,
  requireRoles('SUPER_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const applicationId = String(req.params.id);
      const schema = z.object({
        label: z.string().min(2).max(100),
        scopes: z.array(z.string().min(2)).min(1),
        expiresInDays: z.number().int().min(1).max(365).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Label and at least one API scope are required.' });
      }
      const d = parsed.data;
      const { rawKey, keyPrefix, keyHash } = generateApiKey();
      const expiresAt = d.expiresInDays
        ? new Date(Date.now() + d.expiresInDays * 86400 * 1000)
        : null;

      const [cred] = await db
        .insert(applicationCredentials)
        .values({
          applicationId,
          label: d.label.trim(),
          keyPrefix,
          keyHash,
          scopesJson: d.scopes,
          isRevoked: false,
          expiresAt,
          createdByUserId: req.authUser!.id,
        })
        .returning();

      await recordAuditLog({
        ...actorMeta(req),
        action: 'API_CREDENTIAL_ISSUED',
        resourceType: 'APPLICATION_CREDENTIAL',
        resourceId: cred.keyPrefix,
        newState: { label: cred.label, scopes: cred.scopesJson },
      });

      // Plaintext secret is shown ONCE and never retrievable again!
      res.status(201).json({
        credential: {
          id: cred.id,
          label: cred.label,
          keyPrefix: cred.keyPrefix,
          scopes: cred.scopesJson,
          expiresAt: cred.expiresAt,
          createdAt: cred.createdAt,
        },
        secretKeyShownOnce: rawKey,
      });
    } catch (err) {
      console.error('POST credentials failed:', err);
      res.status(500).json({ error: 'Failed to generate API credential.' });
    }
  }
);

apiRouter.post(
  '/admin/credentials/:id/revoke',
  requireUserAuth,
  requireRoles('SUPER_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = String(req.params.id);
      const [cred] = await db
        .update(applicationCredentials)
        .set({ isRevoked: true, revokedAt: new Date() })
        .where(eq(applicationCredentials.id, id))
        .returning();
      if (!cred) return res.status(404).json({ error: 'Credential not found.' });

      await recordAuditLog({
        ...actorMeta(req),
        action: 'API_CREDENTIAL_REVOKED',
        resourceType: 'APPLICATION_CREDENTIAL',
        resourceId: cred.keyPrefix,
      });

      res.json({ revoked: true, keyPrefix: cred.keyPrefix });
    } catch (err) {
      console.error('Revoke credential failed:', err);
      res.status(500).json({ error: 'Failed to revoke credential.' });
    }
  }
);

apiRouter.post(
  '/admin/credentials/:id/rotate',
  requireUserAuth,
  requireRoles('SUPER_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = String(req.params.id);
      const [oldCred] = await db
        .select()
        .from(applicationCredentials)
        .where(eq(applicationCredentials.id, id))
        .limit(1);
      if (!oldCred) return res.status(404).json({ error: 'Credential not found.' });

      const { rawKey, keyPrefix, keyHash } = generateApiKey();

      const newCred = await db.transaction(async (tx) => {
        await tx
          .update(applicationCredentials)
          .set({ isRevoked: true, revokedAt: new Date() })
          .where(eq(applicationCredentials.id, oldCred.id));

        const [created] = await tx
          .insert(applicationCredentials)
          .values({
            applicationId: oldCred.applicationId,
            label: `${oldCred.label} (Rotated)`,
            keyPrefix,
            keyHash,
            scopesJson: oldCred.scopesJson,
            isRevoked: false,
            expiresAt: oldCred.expiresAt,
            createdByUserId: req.authUser!.id,
          })
          .returning();
        return created;
      });

      await recordAuditLog({
        ...actorMeta(req),
        action: 'API_CREDENTIAL_ROTATED',
        resourceType: 'APPLICATION_CREDENTIAL',
        resourceId: newCred.keyPrefix,
        previousState: { revokedPrefix: oldCred.keyPrefix },
        newState: { newPrefix: newCred.keyPrefix },
      });

      res.status(201).json({
        credential: {
          id: newCred.id,
          label: newCred.label,
          keyPrefix: newCred.keyPrefix,
          scopes: newCred.scopesJson,
        },
        secretKeyShownOnce: rawKey,
      });
    } catch (err) {
      console.error('Rotate credential failed:', err);
      res.status(500).json({ error: 'Failed to rotate credential.' });
    }
  }
);

// =============================================================================
// 11. AUDIT LOGS & NOTIFICATIONS
// =============================================================================

apiRouter.get(
  '/audit-logs',
  requireUserAuth,
  requireRoles('SUPER_ADMIN', 'FINANCE_ADMIN'),
  async (_req: AuthRequest, res: Response) => {
    try {
      const rows = await db
        .select()
        .from(auditLogs)
        .orderBy(desc(auditLogs.createdAt))
        .limit(150);
      res.json({ logs: rows });
    } catch (err) {
      console.error('GET /audit-logs failed:', err);
      res.status(500).json({ error: 'Failed to load audit logs.' });
    }
  }
);

apiRouter.get('/notifications', requireUserAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.authUser!;
    const rows = await db
      .select()
      .from(notifications)
      .where(
        or(
          eq(notifications.recipientUserId, user.id),
          user.roles.length > 0 ? inArray(notifications.recipientRole, user.roles) : sql`false`
        )
      )
      .orderBy(desc(notifications.createdAt))
      .limit(50);
    res.json({ notifications: rows });
  } catch (err) {
    console.error('GET /notifications failed:', err);
    res.status(500).json({ error: 'Failed to load notifications.' });
  }
});

apiRouter.post('/notifications/:id/read', requireUserAuth, async (req: AuthRequest, res: Response) => {
  try {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.id, String(req.params.id)));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark notification read.' });
  }
});

apiRouter.post('/notifications/read-all', requireUserAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.authUser!;
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(
        or(
          eq(notifications.recipientUserId, user.id),
          user.roles.length > 0 ? inArray(notifications.recipientRole, user.roles) : sql`false`
        )
      );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark notifications read.' });
  }
});

// =============================================================================
// 12. EMPLOYEE HQ SCOPED VIEW (STRICT SERVER-ENFORCED FIELD ISOLATION)
// =============================================================================

apiRouter.get(
  '/employee/projects',
  requireAuthOrApiKey({
    allowedRoles: ['SUPER_ADMIN', 'ADMIN_HQ', 'EMPLOYEE'],
    requiredScopes: ['employee_projects:read'],
  }),
  async (req: AuthRequest, res: Response) => {
    try {
      const isOrdinaryEmployee =
        req.authUser &&
        !req.authUser.roles.includes('SUPER_ADMIN') &&
        !req.authUser.roles.includes('ADMIN_HQ');

      const projRows = await db
        .select({
          id: projects.id,
          projectRef: projects.projectRef,
          name: projects.name,
          status: projects.status,
          progressPercent: projects.progressPercent,
          totalContractPaise: projects.totalContractPaise,
          assignedEmployeeUserId: projects.assignedEmployeeUserId,
        })
        .from(projects)
        .where(
          isOrdinaryEmployee
            ? eq(projects.assignedEmployeeUserId, req.authUser!.id)
            : undefined
        )
        .orderBy(desc(projects.createdAt));

      const projectIds = projRows.map((p) => p.id);
      const reqRows =
        projectIds.length > 0
          ? await db
              .select({
                projectId: paymentRequests.projectId,
                requestRef: paymentRequests.requestRef,
                category: paymentRequests.category,
                title: paymentRequests.title,
                status: paymentRequests.status,
                dueDate: paymentRequests.dueDate,
              })
              .from(paymentRequests)
              .where(inArray(paymentRequests.projectId, projectIds))
          : [];

      // Explicitly omit bank details, UPI secrets, UTRs, and other clients' private transaction records!
      res.json({
        projects: projRows.map((p) => {
          const milestones = reqRows.filter((r) => r.projectId === p.id);
          const advanceReq = milestones.find((m) => m.category === 'ADVANCE');
          return {
            projectRef: p.projectRef,
            name: p.name,
            status: p.status,
            progressPercent: p.progressPercent,
            advanceVerified: advanceReq ? advanceReq.status === 'PAID' : false,
            milestones: milestones.map((m) => ({
              requestRef: m.requestRef,
              category: m.category,
              title: m.title,
              status: m.status,
              dueDate: m.dueDate,
            })),
          };
        }),
      });
    } catch (err) {
      console.error('GET /employee/projects failed:', err);
      res.status(500).json({ error: 'Failed to load assigned project statuses.' });
    }
  }
);

// =============================================================================
// 13. CLIENT APPLICATION PORTAL (SCOPED TO CUSTOMER)
// =============================================================================

apiRouter.get(
  '/client/portal',
  requireAuthOrApiKey({
    allowedRoles: ['SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN_HQ', 'CLIENT'],
    requiredScopes: ['client_portal:read'],
  }),
  async (req: AuthRequest, res: Response) => {
    try {
      const user = req.authUser;
      const isPrivilegedPreview =
        user &&
        (user.roles.includes('SUPER_ADMIN') ||
          user.roles.includes('FINANCE_ADMIN') ||
          user.roles.includes('ADMIN_HQ'));

      const requestedCustomerId =
        typeof req.query.customerId === 'string' && isPrivilegedPreview
          ? req.query.customerId
          : null;

      let targetCustomers: Array<typeof customers.$inferSelect> = [];
      if (requestedCustomerId) {
        targetCustomers = await db
          .select()
          .from(customers)
          .where(eq(customers.id, requestedCustomerId))
          .limit(1);
      } else if (user) {
        targetCustomers = await db
          .select()
          .from(customers)
          .where(
            or(
              eq(customers.linkedUserId, user.id),
              eq(customers.email, user.email.toLowerCase())
            )
          );
        // For Super Admin previewing Client Portal if not personally linked yet, show first customer if any
        if (targetCustomers.length === 0 && isPrivilegedPreview) {
          targetCustomers = await db
            .select()
            .from(customers)
            .orderBy(desc(customers.createdAt))
            .limit(1);
        }
      }

      if (targetCustomers.length === 0) {
        return res.json({
          customer: null,
          projects: [],
          paymentRequests: [],
          attempts: [],
          receipts: [],
          disputes: [],
        });
      }

      const customer = targetCustomers[0];
      const custProjects = await db
        .select()
        .from(projects)
        .where(eq(projects.customerId, customer.id))
        .orderBy(desc(projects.createdAt));

      const custReqs = await db
        .select()
        .from(paymentRequests)
        .where(eq(paymentRequests.customerId, customer.id))
        .orderBy(paymentRequests.createdAt);

      const custAttempts = await db
        .select()
        .from(paymentAttempts)
        .where(eq(paymentAttempts.customerId, customer.id))
        .orderBy(desc(paymentAttempts.createdAt));

      const custReceipts = await db
        .select()
        .from(receipts)
        .where(eq(receipts.customerId, customer.id))
        .orderBy(desc(receipts.issuedAt));

      const custDisputes = await db
        .select()
        .from(paymentDisputes)
        .where(eq(paymentDisputes.customerId, customer.id))
        .orderBy(desc(paymentDisputes.createdAt));

      const verifiedByProject = await db
        .select({
          projectId: financialLedgerEntries.projectId,
          total: sql<string>`COALESCE(SUM(${financialLedgerEntries.amountPaise}), 0)`,
        })
        .from(financialLedgerEntries)
        .where(
          and(
            eq(financialLedgerEntries.customerId, customer.id),
            eq(financialLedgerEntries.entryType, 'VERIFIED_CREDIT')
          )
        )
        .groupBy(financialLedgerEntries.projectId);

      const verifiedMap = new Map(verifiedByProject.map((v) => [v.projectId, Number(v.total)]));
      const tokenActor = user?.id || 'client';

      res.json({
        customer: {
          id: customer.id,
          customerRef: customer.customerRef,
          name: customer.name,
          email: customer.email,
          companyName: customer.companyName,
        },
        projects: custProjects.map((p) => {
          const verifiedPaise = verifiedMap.get(p.id) || 0;
          return {
            ...p,
            verifiedPaidPaise: verifiedPaise,
            outstandingPaise: Math.max(0, p.totalContractPaise - verifiedPaise),
          };
        }),
        paymentRequests: custReqs.map((r) => ({
          ...r,
          remainingDuePaise: Math.max(0, r.amountDuePaise - r.amountVerifiedPaise),
        })),
        attempts: custAttempts.map((a) => ({
          id: a.id,
          paymentRef: a.paymentRef,
          paymentRequestId: a.paymentRequestId,
          expectedAmountPaise: a.expectedAmountPaise,
          reportedAmountPaise: a.reportedAmountPaise,
          verifiedAmountPaise: a.verifiedAmountPaise,
          currency: a.currency,
          status: a.status,
          receivingUpiId: a.receivingUpiSnapshot,
          payeeName: a.receivingPayeeSnapshot,
          upiUri: a.upiUri,
          customerReportedUtr: a.customerReportedUtr,
          verifiedUtr: a.verifiedUtr,
          verifiedAt: a.verifiedAt,
          expiresAt: a.expiresAt,
          createdAt: a.createdAt,
        })),
        receipts: custReceipts.map((rc) => ({
          ...rc,
          pdfDownloadUrl: `/api/v1/documents/receipt/${createDocumentDownloadToken('receipt', rc.id, tokenActor, 300)}`,
        })),
        disputes: custDisputes,
      });
    } catch (err) {
      console.error('GET /client/portal failed:', err);
      res.status(500).json({ error: 'Failed to load client portal.' });
    }
  }
);
