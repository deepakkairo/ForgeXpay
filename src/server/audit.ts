import { db } from '../db/index.ts';
import { auditLogs } from '../db/schema.ts';

const SENSITIVE_KEYS = new Set([
  'accountNumber',
  'accountNumberEncrypted',
  'rawKey',
  'apiKey',
  'password',
  'token',
  'mfaSecret',
  'mfaSecretEnc',
  'authorization',
]);

function sanitizeState(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sanitizeState);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = sanitizeState(v);
      }
    }
    return out;
  }
  return value;
}

export interface AuditInput {
  actorUserId?: string | null;
  actorEmail?: string;
  actorRole?: string;
  sourceAppId?: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  previousState?: unknown;
  newState?: unknown;
  ipAddress?: string;
  userAgent?: string;
  status?: 'SUCCESS' | 'DENIED' | 'FAILED';
}

export async function recordAuditLog(input: AuditInput): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      actorUserId: input.actorUserId ?? null,
      actorEmail: input.actorEmail || 'system',
      actorRole: input.actorRole || 'SYSTEM',
      sourceAppId: input.sourceAppId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      previousStateJson: input.previousState ? sanitizeState(input.previousState) : null,
      newStateJson: input.newState ? sanitizeState(input.newState) : null,
      ipAddress: input.ipAddress || '',
      userAgent: (input.userAgent || '').slice(0, 240),
      status: input.status || 'SUCCESS',
    });
  } catch (err) {
    // Log sanitized failure without breaking critical request paths
    console.error('Audit log write failed:', err);
  }
}
