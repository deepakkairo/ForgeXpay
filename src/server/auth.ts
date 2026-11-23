import { Request, Response, NextFunction } from 'express';
import { eq, sql, and } from 'drizzle-orm';
import { adminAuth } from '../lib/firebase-admin.ts';
import { db } from '../db/index.ts';
import {
  users,
  roles,
  userRoleAssignments,
  applicationCredentials,
  connectedApplications,
} from '../db/schema.ts';
import { ensureSystemBootstrapped } from './bootstrap.ts';
import { hashApiKey, decryptSensitive, verifyTotpCode } from './crypto.ts';
import { recordAuditLog } from './audit.ts';

export type RoleCode = 'SUPER_ADMIN' | 'FINANCE_ADMIN' | 'ADMIN_HQ' | 'EMPLOYEE' | 'CLIENT';

export interface AuthenticatedUser {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  photoUrl: string | null;
  roles: RoleCode[];
  mfaEnabled: boolean;
  lastReauthAt: Date | null;
}

export interface AuthenticatedApp {
  applicationId: string;
  appCode: string;
  appName: string;
  category: string;
  credentialId: string;
  scopes: string[];
}

export interface AuthRequest extends Request {
  authUser?: AuthenticatedUser;
  authApp?: AuthenticatedApp;
}

// Lightweight sliding-window rate limiter
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(windowMs: number, maxRequests: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip || 'unknown'}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > maxRequests) {
      return res.status(429).json({
        error: 'Too many requests. Please wait before retrying.',
        code: 'RATE_LIMIT_EXCEEDED',
      });
    }
    return next();
  };
}

async function syncUserAndRoles(
  uid: string,
  email: string,
  displayName: string,
  photoUrl: string | null
): Promise<AuthenticatedUser> {
  await ensureSystemBootstrapped();

  const upserted = await db
    .insert(users)
    .values({
      uid,
      email: email.toLowerCase(),
      displayName: displayName || email.split('@')[0],
      photoUrl,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: users.uid,
      set: {
        email: email.toLowerCase(),
        displayName: displayName || email.split('@')[0],
        photoUrl,
        updatedAt: new Date(),
      },
    })
    .returning();

  const dbUser = upserted[0];

  let assigned = await db
    .select({ code: roles.code })
    .from(userRoleAssignments)
    .innerJoin(roles, eq(userRoleAssignments.roleId, roles.id))
    .where(eq(userRoleAssignments.userId, dbUser.id));

  // If this user has no roles yet: assign SUPER_ADMIN if no SUPER_ADMIN exists yet, else CLIENT
  if (assigned.length === 0) {
    const existingSuperAdmins = await db
      .select({ id: userRoleAssignments.id })
      .from(userRoleAssignments)
      .innerJoin(roles, eq(userRoleAssignments.roleId, roles.id))
      .where(eq(roles.code, 'SUPER_ADMIN'))
      .limit(1);

    const targetRoleCode: RoleCode = existingSuperAdmins.length === 0 ? 'SUPER_ADMIN' : 'CLIENT';
    const [targetRole] = await db
      .select()
      .from(roles)
      .where(eq(roles.code, targetRoleCode))
      .limit(1);

    if (targetRole) {
      await db
        .insert(userRoleAssignments)
        .values({
          userId: dbUser.id,
          roleId: targetRole.id,
        })
        .onConflictDoNothing();
      assigned = [{ code: targetRoleCode }];
    }
  }

  return {
    id: dbUser.id,
    uid: dbUser.uid,
    email: dbUser.email,
    displayName: dbUser.displayName,
    photoUrl: dbUser.photoUrl,
    roles: assigned.map((r) => r.code as RoleCode),
    mfaEnabled: dbUser.mfaEnabled,
    lastReauthAt: dbUser.lastReauthAt,
  };
}

export async function requireUserAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required.', code: 'AUTH_MISSING' });
  }
  const token = authHeader.slice('Bearer '.length).trim();
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    if (!decoded.email) {
      return res.status(401).json({ error: 'Authenticated account must include an email address.' });
    }
    req.authUser = await syncUserAndRoles(
      decoded.uid,
      decoded.email,
      decoded.name || decoded.email.split('@')[0],
      decoded.picture || null
    );
    return next();
  } catch (err) {
    console.error('Firebase token verification error:', err);
    return res.status(401).json({ error: 'Invalid or expired authentication token.', code: 'AUTH_INVALID' });
  }
}

/**
 * Supports either Firebase User Auth (checked against allowedRoles)
 * OR Server-to-Server Connected Application API Key via `X-4XPay-API-Key` (checked against requiredScopes).
 */
export function requireAuthOrApiKey(options: {
  allowedRoles?: RoleCode[];
  requiredScopes?: string[];
}) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const apiKey = req.headers['x-4xpay-api-key'];
    if (typeof apiKey === 'string' && apiKey.trim().length > 0) {
      try {
        await ensureSystemBootstrapped();
        const keyHash = hashApiKey(apiKey.trim());
        const found = await db
          .select({
            cred: applicationCredentials,
            app: connectedApplications,
          })
          .from(applicationCredentials)
          .innerJoin(
            connectedApplications,
            eq(applicationCredentials.applicationId, connectedApplications.id)
          )
          .where(eq(applicationCredentials.keyHash, keyHash))
          .limit(1);

        if (found.length === 0) {
          await recordAuditLog({
            actorEmail: 'api-key-unknown',
            actorRole: 'API_CLIENT',
            action: 'API_KEY_AUTH',
            resourceType: 'API_ENDPOINT',
            resourceId: req.path,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            status: 'DENIED',
          });
          return res.status(401).json({ error: 'Invalid API key.', code: 'API_KEY_INVALID' });
        }

        const { cred, app } = found[0];
        if (cred.isRevoked || !app.isActive || (cred.expiresAt && cred.expiresAt < new Date())) {
          await db
            .update(applicationCredentials)
            .set({ failureCount: sql`${applicationCredentials.failureCount} + 1` })
            .where(eq(applicationCredentials.id, cred.id));
          return res.status(403).json({
            error: 'API credential is revoked, expired, or application is disabled.',
            code: 'API_KEY_DISABLED',
          });
        }

        const requiredScopes = options.requiredScopes || [];
        const hasScopes = requiredScopes.every(
          (s) => cred.scopesJson.includes('*') || cred.scopesJson.includes(s)
        );
        if (!hasScopes) {
          await db
            .update(applicationCredentials)
            .set({ failureCount: sql`${applicationCredentials.failureCount} + 1` })
            .where(eq(applicationCredentials.id, cred.id));
          await recordAuditLog({
            actorEmail: app.appCode,
            actorRole: 'API_CLIENT',
            sourceAppId: app.id,
            action: 'API_SCOPE_DENIED',
            resourceType: 'API_ENDPOINT',
            resourceId: req.path,
            newState: { requiredScopes, grantedScopes: cred.scopesJson },
            ipAddress: req.ip,
            status: 'DENIED',
          });
          return res.status(403).json({
            error: 'Insufficient API key scope for this operation.',
            code: 'API_SCOPE_FORBIDDEN',
          });
        }

        await db
          .update(applicationCredentials)
          .set({
            requestCount: sql`${applicationCredentials.requestCount} + 1`,
            lastUsedAt: new Date(),
          })
          .where(eq(applicationCredentials.id, cred.id));

        req.authApp = {
          applicationId: app.id,
          appCode: app.appCode,
          appName: app.name,
          category: app.category,
          credentialId: cred.id,
          scopes: cred.scopesJson,
        };
        return next();
      } catch (err) {
        console.error('API key auth failure:', err);
        return res.status(500).json({ error: 'Authentication verification failed.' });
      }
    }

    // Fallback to User Firebase Auth
    return requireUserAuth(req, res, async () => {
      if (options.allowedRoles && options.allowedRoles.length > 0) {
        const userRoles = req.authUser?.roles || [];
        const permitted = userRoles.some((r) => options.allowedRoles!.includes(r));
        if (!permitted) {
          await recordAuditLog({
            actorUserId: req.authUser?.id,
            actorEmail: req.authUser?.email,
            actorRole: userRoles.join(','),
            action: 'RBAC_DENIED',
            resourceType: 'API_ENDPOINT',
            resourceId: `${req.method} ${req.path}`,
            newState: { allowedRoles: options.allowedRoles },
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            status: 'DENIED',
          });
          return res.status(403).json({
            error: 'You do not have permission to perform this action.',
            code: 'FORBIDDEN_ROLE',
          });
        }
      }
      return next();
    });
  };
}

export function requireRoles(...allowed: RoleCode[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    const permitted = req.authUser.roles.some((r) => allowed.includes(r));
    if (!permitted) {
      await recordAuditLog({
        actorUserId: req.authUser.id,
        actorEmail: req.authUser.email,
        actorRole: req.authUser.roles.join(','),
        action: 'RBAC_DENIED',
        resourceType: 'API_ENDPOINT',
        resourceId: `${req.method} ${req.path}`,
        newState: { requiredRoles: allowed },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        status: 'DENIED',
      });
      return res.status(403).json({
        error: 'Insufficient role permissions.',
        code: 'FORBIDDEN_ROLE',
      });
    }
    return next();
  };
}

/**
 * Enforces explicit security reauthentication (within 15 minutes) OR valid TOTP MFA code
 * before sensitive receiving bank account mutations.
 */
export async function requireSecurityConfirmation(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.authUser) {
    return res.status(401).json({ error: 'User authentication required for sensitive actions.' });
  }
  const [dbUser] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, req.authUser.id)))
    .limit(1);

  if (!dbUser) {
    return res.status(401).json({ error: 'User record not found.' });
  }

  const mfaCode = String(req.headers['x-mfa-code'] || req.body?.mfaCode || '').trim();
  if (dbUser.mfaEnabled && dbUser.mfaSecretEnc) {
    const secret = decryptSensitive(dbUser.mfaSecretEnc);
    if (!mfaCode || !verifyTotpCode(secret, mfaCode)) {
      return res.status(403).json({
        error: 'Valid 6-digit MFA authenticator code is required for this security-sensitive change.',
        code: 'MFA_REQUIRED',
      });
    }
    return next();
  }

  // If MFA is not yet enabled, require explicit confirmation phrase or recent reauth (<= 15 mins)
  const confirmHeader = String(req.headers['x-security-confirm'] || req.body?.securityConfirmation || '').trim();
  const isFreshReauth =
    dbUser.lastReauthAt && Date.now() - dbUser.lastReauthAt.getTime() <= 15 * 60 * 1000;

  if (!isFreshReauth && confirmHeader !== 'CONFIRM_BANK_CHANGE') {
    return res.status(403).json({
      error: 'Security reauthentication confirmation is required before modifying receiving bank accounts.',
      code: 'REAUTH_REQUIRED',
    });
  }

  return next();
}
