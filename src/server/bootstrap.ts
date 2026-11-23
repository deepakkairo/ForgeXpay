import { db } from '../db/index.ts';
import { roles, systemSettings } from '../db/schema.ts';

const SYSTEM_ROLES = [
  {
    code: 'SUPER_ADMIN',
    name: 'Super Administrator',
    description:
      'Full access to receiving bank accounts, API credentials, RBAC security settings, verification, and audit trails.',
    permissionsJson: ['*'],
  },
  {
    code: 'FINANCE_ADMIN',
    name: 'Finance HQ Administrator',
    description:
      'Manages payment verification queue, CSV bank statement reconciliation, disputes, ledger reports, and receipts.',
    permissionsJson: [
      'verification:read',
      'verification:confirm',
      'reconciliation:manage',
      'disputes:manage',
      'transactions:read',
      'receipts:read',
      'invoices:read',
    ],
  },
  {
    code: 'ADMIN_HQ',
    name: 'Admin HQ Operator',
    description:
      'Creates customers, projects, invoices, and payment requests. Cannot verify bank credits or view bank secrets.',
    permissionsJson: [
      'customers:manage',
      'projects:manage',
      'invoices:manage',
      'payment_requests:manage',
      'transactions:read',
    ],
  },
  {
    code: 'EMPLOYEE',
    name: 'Employee HQ Member',
    description:
      'Restricted read-only visibility into assigned project payment milestones and advance verification status.',
    permissionsJson: ['employee_projects:read'],
  },
  {
    code: 'CLIENT',
    name: 'ForgeX Client',
    description:
      'Client payment portal access strictly scoped to own projects, UPI payment initiation, receipts, and disputes.',
    permissionsJson: ['client_portal:read', 'payments:initiate', 'payments:report', 'disputes:create'],
  },
];

let bootstrapPromise: Promise<void> | null = null;

/**
 * Lazily ensures immutable system roles and default business settings (tax UNCONFIGURED) exist.
 * NEVER seeds fictional bank accounts, fake payments, connected apps, or fabricated tax IDs.
 */
export function ensureSystemBootstrapped(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      for (const role of SYSTEM_ROLES) {
        await db.insert(roles).values(role).onConflictDoNothing({ target: roles.code });
      }

      await db
        .insert(systemSettings)
        .values({
          key: 'business_profile',
          valueJson: {
            legalName: process.env.FORGEX_LEGAL_NAME || 'ForgeX',
            address: process.env.FORGEX_ADDRESS || '',
            email: '',
            taxRegime: process.env.FORGEX_TAX_REGIME || 'UNCONFIGURED',
            gstin: process.env.FORGEX_GSTIN || '',
            taxNote:
              'Configure verified legal entity and GST registration details before issuing tax-specific invoices.',
          },
        })
        .onConflictDoNothing({ target: systemSettings.key });

      await db
        .insert(systemSettings)
        .values({
          key: 'payment_policy',
          valueJson: {
            dualApprovalThresholdPaise: Number(process.env.DUAL_APPROVAL_THRESHOLD_PAISE || 5000000),
            qrExpiryMinutes: 30,
            maxDisputesPerAttempt: 2,
          },
        })
        .onConflictDoNothing({ target: systemSettings.key });
    })().catch((err) => {
      bootstrapPromise = null;
      throw err;
    });
  }
  return bootstrapPromise;
}
