import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// 1. Users (linked to Firebase Auth UID)
export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    uid: text('uid').notNull().unique(),
    email: text('email').notNull().unique(),
    displayName: text('display_name').notNull(),
    photoUrl: text('photo_url'),
    mfaEnabled: boolean('mfa_enabled').default(false).notNull(),
    mfaSecretEnc: text('mfa_secret_enc'),
    lastReauthAt: timestamp('last_reauth_at', { withTimezone: true }),
    status: text('status').default('ACTIVE').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_users_email').on(t.email)]
);

// 2. Roles
export const roles = pgTable('roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: text('code').notNull().unique(), // SUPER_ADMIN, FINANCE_ADMIN, ADMIN_HQ, EMPLOYEE, CLIENT
  name: text('name').notNull(),
  description: text('description').notNull(),
  permissionsJson: jsonb('permissions_json').$type<string[]>().default([]).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 3. User Role Assignments
export const userRoleAssignments = pgTable(
  'user_role_assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    assignedByUserId: uuid('assigned_by_user_id'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('uq_user_role').on(t.userId, t.roleId)]
);

// 4. Connected Applications (Admin HQ, Finance HQ, Employee HQ, Client App, future ForgeX apps)
export const connectedApplications = pgTable('connected_applications', {
  id: uuid('id').defaultRandom().primaryKey(),
  appCode: text('app_code').notNull().unique(),
  name: text('name').notNull(),
  category: text('category').notNull(), // ADMIN_HQ, FINANCE_HQ, EMPLOYEE_HQ, CLIENT_APP, CUSTOM
  description: text('description').default('').notNull(),
  webhookUrl: text('webhook_url'),
  isActive: boolean('is_active').default(true).notNull(),
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// 5. Application Credentials (SHA-256 hashed API keys, scoped, revocable)
export const applicationCredentials = pgTable(
  'application_credentials',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => connectedApplications.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    scopesJson: jsonb('scopes_json').$type<string[]>().default([]).notNull(),
    isRevoked: boolean('is_revoked').default(false).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    requestCount: integer('request_count').default(0).notNull(),
    failureCount: integer('failure_count').default(0).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_app_creds_app').on(t.applicationId)]
);

// 6. Receiving Accounts (AES-256-GCM encrypted account number, empty initial state)
export const receivingAccounts = pgTable(
  'receiving_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    accountCode: text('account_code').notNull().unique(),
    accountHolderName: text('account_holder_name').notNull(),
    bankName: text('bank_name').notNull(),
    accountNumberEncrypted: text('account_number_encrypted').notNull(),
    accountNumberMasked: text('account_number_masked').notNull(),
    ifsc: text('ifsc').notNull(),
    accountType: text('account_type').notNull(), // SAVINGS, CURRENT
    upiId: text('upi_id').notNull(),
    displayPayeeName: text('display_payee_name').notNull(),
    internalLabel: text('internal_label').default('').notNull(),
    isActive: boolean('is_active').default(false).notNull(),
    manualCheckAttested: boolean('manual_check_attested').default(false).notNull(),
    manualCheckAttestedAt: timestamp('manual_check_attested_at', { withTimezone: true }),
    manualCheckAttestedBy: uuid('manual_check_attested_by').references(() => users.id),
    manualCheckNote: text('manual_check_note'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_receiving_accounts_active').on(t.isActive)]
);

// 7. Customers
export const customers = pgTable(
  'customers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    customerRef: text('customer_ref').notNull().unique(), // FXC-0045
    name: text('name').notNull(),
    email: text('email').notNull(),
    phone: text('phone').default('').notNull(),
    companyName: text('company_name').default('').notNull(),
    linkedUserId: uuid('linked_user_id').references(() => users.id),
    externalSourceApp: text('external_source_app').default('ADMIN_HQ').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_customers_email').on(t.email)]
);

// 8. Projects
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectRef: text('project_ref').notNull().unique(), // FXPR-0023
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description').default('').notNull(),
    totalContractPaise: bigint('total_contract_paise', { mode: 'number' }).notNull(),
    currency: text('currency').default('INR').notNull(),
    progressPercent: integer('progress_percent').default(0).notNull(),
    status: text('status').default('ACTIVE').notNull(), // ACTIVE, COMPLETED, ON_HOLD, CANCELLED
    assignedEmployeeUserId: uuid('assigned_employee_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_projects_customer').on(t.customerId)]
);

// 9. Invoices
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    invoiceRef: text('invoice_ref').notNull().unique(), // FXINV-0102
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    subtotalPaise: bigint('subtotal_paise', { mode: 'number' }).notNull(),
    taxPaise: bigint('tax_paise', { mode: 'number' }).default(0).notNull(),
    totalPaise: bigint('total_paise', { mode: 'number' }).notNull(),
    currency: text('currency').default('INR').notNull(),
    taxRegime: text('tax_regime').default('UNCONFIGURED').notNull(), // UNCONFIGURED, NON_GST, GST
    businessGstin: text('business_gstin').default('').notNull(),
    status: text('status').default('ISSUED').notNull(), // DRAFT, ISSUED, PARTIALLY_PAID, PAID, CANCELLED, VOID
    dueDate: timestamp('due_date', { withTimezone: true }),
    notes: text('notes').default('').notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_invoices_customer').on(t.customerId),
    index('idx_invoices_project').on(t.projectId),
  ]
);

// 10. Invoice Items
export const invoiceItems = pgTable(
  'invoice_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    category: text('category').default('MILESTONE').notNull(), // ADVANCE, MILESTONE, FINAL, ADJUSTMENT
    quantity: integer('quantity').default(1).notNull(),
    unitPricePaise: bigint('unit_price_paise', { mode: 'number' }).notNull(),
    totalPaise: bigint('total_paise', { mode: 'number' }).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_invoice_items_invoice').on(t.invoiceId)]
);

// 11. Payment Requests (amount due against an invoice / instalment)
export const paymentRequests = pgTable(
  'payment_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    requestRef: text('request_ref').notNull().unique(), // FXREQ-2026-0042
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    category: text('category').notNull(), // ADVANCE, MILESTONE, FINAL
    title: text('title').notNull(),
    amountDuePaise: bigint('amount_due_paise', { mode: 'number' }).notNull(),
    amountVerifiedPaise: bigint('amount_verified_paise', { mode: 'number' }).default(0).notNull(),
    currency: text('currency').default('INR').notNull(),
    status: text('status').default('OPEN').notNull(), // OPEN, PARTIALLY_VERIFIED, PAID, CANCELLED, EXPIRED
    dueDate: timestamp('due_date', { withTimezone: true }),
    revisionNumber: integer('revision_number').default(1).notNull(),
    cancelReason: text('cancel_reason'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_payment_requests_invoice').on(t.invoiceId),
    index('idx_payment_requests_customer').on(t.customerId),
    index('idx_payment_requests_status').on(t.status),
  ]
);

// 12. Payment Attempts (unique FXPAY-* per deliberate payment attempt)
export const paymentAttempts = pgTable(
  'payment_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    paymentRef: text('payment_ref').notNull().unique(), // FXPAY-2026-A81F
    paymentRequestId: uuid('payment_request_id')
      .notNull()
      .references(() => paymentRequests.id, { onDelete: 'restrict' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    receivingAccountId: uuid('receiving_account_id')
      .notNull()
      .references(() => receivingAccounts.id, { onDelete: 'restrict' }),
    receivingUpiSnapshot: text('receiving_upi_snapshot').notNull(),
    receivingPayeeSnapshot: text('receiving_payee_snapshot').notNull(),
    expectedAmountPaise: bigint('expected_amount_paise', { mode: 'number' }).notNull(),
    reportedAmountPaise: bigint('reported_amount_paise', { mode: 'number' }),
    verifiedAmountPaise: bigint('verified_amount_paise', { mode: 'number' }),
    currency: text('currency').default('INR').notNull(),
    status: text('status').default('CREATED').notNull(),
    // CREATED, AWAITING_PAYMENT, PAYMENT_REPORTED, VERIFICATION_PENDING, REVIEW_REQUIRED,
    // VERIFIED, FAILED_REPORTED, EXPIRED, CANCELLED, DISPUTED
    idempotencyKey: text('idempotency_key').notNull(),
    upiUri: text('upi_uri').notNull(),
    customerReportedUtr: text('customer_reported_utr'),
    customerReportedAt: timestamp('customer_reported_at', { withTimezone: true }),
    customerReportNote: text('customer_report_note'),
    verifiedUtr: text('verified_utr').unique(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedByUserId: uuid('verified_by_user_id').references(() => users.id),
    requiresDualApproval: boolean('requires_dual_approval').default(false).notNull(),
    firstApproverUserId: uuid('first_approver_user_id').references(() => users.id),
    firstApprovedAt: timestamp('first_approved_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('uq_attempt_request_idempotency').on(t.paymentRequestId, t.idempotencyKey),
    index('idx_attempts_request').on(t.paymentRequestId),
    index('idx_attempts_status').on(t.status),
    index('idx_attempts_customer').on(t.customerId),
  ]
);

// 13. Reconciliation Imports (CSV bank statement batches)
export const reconciliationImports = pgTable(
  'reconciliation_imports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    importRef: text('import_ref').notNull().unique(),
    receivingAccountId: uuid('receiving_account_id')
      .notNull()
      .references(() => receivingAccounts.id, { onDelete: 'restrict' }),
    sourceFilename: text('source_filename').notNull(),
    fileHash: text('file_hash').notNull(),
    columnMappingJson: jsonb('column_mapping_json').$type<Record<string, string>>().notNull(),
    totalRows: integer('total_rows').default(0).notNull(),
    creditRows: integer('credit_rows').default(0).notNull(),
    matchedCount: integer('matched_count').default(0).notNull(),
    ambiguousCount: integer('ambiguous_count').default(0).notNull(),
    unmatchedCount: integer('unmatched_count').default(0).notNull(),
    duplicateQuarantinedCount: integer('duplicate_quarantined_count').default(0).notNull(),
    importedByUserId: uuid('imported_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_recon_imports_account').on(t.receivingAccountId)]
);

// 14. Bank Transactions (normalized imported statement entries)
export const bankTransactions = pgTable(
  'bank_transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    reconciliationImportId: uuid('reconciliation_import_id')
      .notNull()
      .references(() => reconciliationImports.id, { onDelete: 'cascade' }),
    receivingAccountId: uuid('receiving_account_id')
      .notNull()
      .references(() => receivingAccounts.id, { onDelete: 'restrict' }),
    direction: text('direction').notNull(), // CREDIT, DEBIT
    amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
    currency: text('currency').default('INR').notNull(),
    bankReferenceUtr: text('bank_reference_utr'),
    transactionDate: timestamp('transaction_date', { withTimezone: true }).notNull(),
    description: text('description').default('').notNull(),
    dedupFingerprint: text('dedup_fingerprint').notNull(),
    isDuplicateQuarantined: boolean('is_duplicate_quarantined').default(false).notNull(),
    settlementStatus: text('settlement_status').default('UNALLOCATED').notNull(),
    // UNALLOCATED, MATCHED, CONFIRMED, REJECTED, IGNORED_DEBIT
    rawRowJson: jsonb('raw_row_json').$type<Record<string, string>>().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_bank_tx_account').on(t.receivingAccountId),
    index('idx_bank_tx_utr').on(t.bankReferenceUtr),
    index('idx_bank_tx_fingerprint').on(t.dedupFingerprint),
  ]
);

// 15. Reconciliation Matches
export const reconciliationMatches = pgTable(
  'reconciliation_matches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    bankTransactionId: uuid('bank_transaction_id')
      .notNull()
      .references(() => bankTransactions.id, { onDelete: 'cascade' }),
    paymentAttemptId: uuid('payment_attempt_id').references(() => paymentAttempts.id),
    paymentRequestId: uuid('payment_request_id').references(() => paymentRequests.id),
    matchClassification: text('match_classification').notNull(),
    // MATCHED, POTENTIAL_MATCH, AMBIGUOUS, UNMATCHED, CONFIRMED, REJECTED
    confidenceScore: integer('confidence_score').default(0).notNull(),
    matchReasonsJson: jsonb('match_reasons_json').$type<string[]>().default([]).notNull(),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNote: text('review_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_recon_matches_bank_tx').on(t.bankTransactionId),
    index('idx_recon_matches_attempt').on(t.paymentAttemptId),
  ]
);

// 16. Verification Actions (immutable history of verification checks & approvals)
export const verificationActions = pgTable(
  'verification_actions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    paymentAttemptId: uuid('payment_attempt_id')
      .notNull()
      .references(() => paymentAttempts.id, { onDelete: 'restrict' }),
    bankTransactionId: uuid('bank_transaction_id').references(() => bankTransactions.id),
    actionType: text('action_type').notNull(),
    // REPORTED_BY_CUSTOMER, FIRST_APPROVAL, CONFIRMED_MANUAL, CONFIRMED_RECONCILED, REJECTED, FLAGGED_REVIEW, REOPENED
    recordedUtr: text('recorded_utr'),
    recordedAmountPaise: bigint('recorded_amount_paise', { mode: 'number' }),
    recordedBankDate: timestamp('recorded_bank_date', { withTimezone: true }),
    notes: text('notes').default('').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_verification_actions_attempt').on(t.paymentAttemptId)]
);

// 17. Financial Ledger Entries (exactly-once verified credit accounting)
export const financialLedgerEntries = pgTable(
  'financial_ledger_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ledgerRef: text('ledger_ref').notNull().unique(),
    entryType: text('entry_type').notNull(), // VERIFIED_CREDIT, REVERSAL, ADJUSTMENT
    paymentAttemptId: uuid('payment_attempt_id')
      .notNull()
      .references(() => paymentAttempts.id, { onDelete: 'restrict' }),
    paymentRequestId: uuid('payment_request_id')
      .notNull()
      .references(() => paymentRequests.id, { onDelete: 'restrict' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    receivingAccountId: uuid('receiving_account_id')
      .notNull()
      .references(() => receivingAccounts.id, { onDelete: 'restrict' }),
    amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
    currency: text('currency').default('INR').notNull(),
    verifiedUtr: text('verified_utr').notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('uq_ledger_attempt_entry_type').on(t.paymentAttemptId, t.entryType),
    index('idx_ledger_project').on(t.projectId),
    index('idx_ledger_customer').on(t.customerId),
  ]
);

// 18. Receipts (issued strictly after payment VERIFIED)
export const receipts = pgTable(
  'receipts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    receiptNumber: text('receipt_number').notNull().unique(), // FXRCPT-2026-0001
    paymentAttemptId: uuid('payment_attempt_id')
      .notNull()
      .unique()
      .references(() => paymentAttempts.id, { onDelete: 'restrict' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    category: text('category').notNull(),
    paidAmountPaise: bigint('paid_amount_paise', { mode: 'number' }).notNull(),
    currency: text('currency').default('INR').notNull(),
    verifiedUtr: text('verified_utr').notNull(),
    paymentMethod: text('payment_method').default('UPI').notNull(),
    businessIdentitySnapshotJson: jsonb('business_identity_snapshot_json')
      .$type<{ legalName: string; address: string; email: string }>()
      .notNull(),
    taxDetailsSnapshotJson: jsonb('tax_details_snapshot_json')
      .$type<{ taxRegime: string; gstin: string; note: string }>()
      .notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow().notNull(),
    issuedByUserId: uuid('issued_by_user_id').references(() => users.id),
  },
  (t) => [index('idx_receipts_customer').on(t.customerId)]
);

// 19. Payment Disputes / Missing Payment Tickets
export const paymentDisputes = pgTable(
  'payment_disputes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ticketRef: text('ticket_ref').notNull().unique(), // FXDSP-2026-0001
    paymentAttemptId: uuid('payment_attempt_id')
      .notNull()
      .references(() => paymentAttempts.id, { onDelete: 'restrict' }),
    paymentRequestId: uuid('payment_request_id')
      .notNull()
      .references(() => paymentRequests.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    claimedUtr: text('claimed_utr').notNull(),
    claimedAmountPaise: bigint('claimed_amount_paise', { mode: 'number' }).notNull(),
    approximateTime: text('approximate_time').notNull(),
    explanation: text('explanation').default('').notNull(),
    supportingEvidenceNote: text('supporting_evidence_note').default('').notNull(),
    status: text('status').default('OPEN').notNull(),
    // OPEN, ASSIGNED, CLARIFICATION_REQUESTED, UNDER_BANK_CHECK, APPROVED_VERIFIED, REJECTED, REOPENED
    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id),
    resolutionNote: text('resolution_note').default('').notNull(),
    matchedBankUtr: text('matched_bank_utr'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_disputes_attempt').on(t.paymentAttemptId),
    index('idx_disputes_status').on(t.status),
  ]
);

// 20. Notifications (internal event-driven notifications)
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    recipientUserId: uuid('recipient_user_id').references(() => users.id),
    recipientRole: text('recipient_role'),
    eventType: text('event_type').notNull(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    isRead: boolean('is_read').default(false).notNull(),
    deliveryChannel: text('delivery_channel').default('IN_APP').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_notifications_user').on(t.recipientUserId),
    index('idx_notifications_role').on(t.recipientRole),
  ]
);

// 21. Audit Logs (immutable-style trail for all sensitive & financial actions)
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    actorEmail: text('actor_email').default('system').notNull(),
    actorRole: text('actor_role').default('SYSTEM').notNull(),
    sourceAppId: uuid('source_app_id').references(() => connectedApplications.id),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    previousStateJson: jsonb('previous_state_json'),
    newStateJson: jsonb('new_state_json'),
    ipAddress: text('ip_address').default('').notNull(),
    userAgent: text('user_agent').default('').notNull(),
    status: text('status').default('SUCCESS').notNull(), // SUCCESS, DENIED, FAILED
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_audit_logs_created').on(t.createdAt),
    index('idx_audit_logs_resource').on(t.resourceType, t.resourceId),
  ]
);

// 22. System & Business Tax Configuration (never fabricate GSTIN)
export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  valueJson: jsonb('value_json').notNull(),
  updatedByUserId: uuid('updated_by_user_id').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
