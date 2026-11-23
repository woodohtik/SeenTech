import type { Request, Response, NextFunction } from 'express';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { adminAuth } from '../firebase-admin.ts';
import { supabaseAdmin } from '../supabase-admin.ts';
import { logger } from '../logger.ts';
import { ACTING_HEADER, resolveActingSession } from '../actingSession.ts';
import { tenantAccessBlock } from '../tenantAccess.ts';

// This project's Supabase auth now signs access tokens with an asymmetric
// ES256 key (not the legacy shared HS256 secret) -- verify against its public
// JWKS instead. `createRemoteJWKSet` caches the key set and handles rotation.
let supabaseUrlForJwks = (process.env.VITE_SUPABASE_URL || '').trim();
if (supabaseUrlForJwks && supabaseUrlForJwks.endsWith('/')) {
  supabaseUrlForJwks = supabaseUrlForJwks.slice(0, -1);
}
const supabaseJwks = supabaseUrlForJwks
  ? createRemoteJWKSet(new URL(`${supabaseUrlForJwks}/auth/v1/.well-known/jwks.json`))
  : null;

export interface AuthRequest extends Request {
  user?: {
    uid: string;
    email?: string;
    role?: string;
    tenantId?: string;
    /** staff.id (not staff.uid) -- only set for the staff-table path below, undefined for saas_users. */
    staffId?: string;
    /** The device account's own staff.id when an employee switched in by PIN (staffId is then theirs). */
    deviceStaffId?: string;
  };
}

/**
 * Best-effort security log. Inserts into the Supabase `security_logs` table.
 * If the table does not exist (it is optional in Stage 1), this is a graceful no-op.
 */
async function logSecurityEvent(entry: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('security_logs').insert({
      ...entry,
      created_at: new Date().toISOString(),
    });
    if (error) {
      logger.warn({ err: error }, '[security_logs] insert skipped/failed');
    }
  } catch (err) {
    logger.warn({ err }, '[security_logs] insert skipped/failed');
  }
}

/**
 * Middleware to verify the caller's identity.
 *
 * Stage 2 cutover: Supabase-issued JWTs (verified locally against
 * SUPABASE_JWT_SECRET, mirroring what GoTrue itself does) are the primary
 * path. Firebase ID tokens are still accepted as a TRANSITION-WINDOW-ONLY
 * fallback for accounts/sessions not yet migrated — remove this branch
 * entirely once the cutover has stabilized (see Stage 2 rollout plan).
 */
export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    let decodedToken: { uid: string; email?: string; aal?: string } | null = null;

    if (supabaseJwks) {
      try {
        const { payload } = await jwtVerify(idToken, supabaseJwks, { audience: 'authenticated' });
        decodedToken = { uid: payload.sub as string, email: payload.email as string | undefined, aal: payload.aal as string | undefined };
      } catch {
        // Not a valid Supabase-issued token (or one signed before the
        // project's asymmetric-key migration); fall through.
      }
    }

    // Legacy fallback for tokens signed with the old shared HS256 secret,
    // in case any are still floating around from before the project moved
    // to asymmetric JWT signing keys.
    const supabaseJwtSecret = process.env.SUPABASE_JWT_SECRET;
    if (!decodedToken && supabaseJwtSecret) {
      try {
        const payload = jwt.verify(idToken, supabaseJwtSecret, {
          algorithms: ['HS256'],
          audience: 'authenticated',
        }) as { sub: string; email?: string; aal?: string };
        decodedToken = { uid: payload.sub, email: payload.email, aal: payload.aal };
      } catch {
        // Not a valid legacy token either; fall through to the Firebase path.
      }
    }

    // TRANSITION-WINDOW FALLBACK ONLY — remove once cutover stabilizes.
    if (!decodedToken && adminAuth) {
      try {
        decodedToken = await adminAuth.verifyIdToken(idToken);
      } catch (verifyError: any) {
        logger.warn({ err: verifyError }, '[authMiddleware] verifyIdToken failed');
      }
    }

    if (!decodedToken) {
      // SECURITY: no unverified-fallback decode path. A token that fails
      // signature verification against both Supabase and Firebase is
      // rejected outright — never trust a JWT payload without verifying
      // its signature first.
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
    };

    // Fetch user role and tenantId from Supabase
    // 1. Check saas_users (Super Admins)
    const { data: saasUser, error: saasError } = await supabaseAdmin
      .from('saas_users')
      .select('role, is_active, mfa_enabled')
      .eq('uid', decodedToken.uid)
      .maybeSingle();
    if (saasError) {
      logger.error({ err: saasError }, '[authMiddleware] saas_users lookup failed');
    }
    if (saasUser) {
      // seen-cto-code-review-2026-11-13.md SA-C4/AUTH-06: app_is_super_admin()
      // already requires is_active=true at the RLS layer, but every
      // /api/admin/* route runs through supabaseAdmin (service role,
      // bypasses RLS), so a deactivated admin's still-valid JWT kept full
      // access to every one of those routes -- this is the one place that
      // actually enforces it for them, mirroring the staff-deactivation
      // check below.
      if (saasUser.is_active === false) {
        await logSecurityEvent({
          type: 'inactive_saas_user_access_attempt',
          uid: decodedToken.uid,
          email: decodedToken.email,
          path: req.path,
          method: req.method,
        });
        return res.status(403).json({ error: 'Forbidden: Account deactivated' });
      }

      // seen-cto-code-review-2026-11-13.md AUTH-05: 2FA was a UI gate only
      // -- a super admin who enrolled TOTP could still be fully impersonated
      // by anyone holding just the password, since nothing server-side ever
      // checked the session's AAL. Enforcement is conditional on mfa_enabled
      // (set once the account actually completes TOTP enrollment, see
      // TwoFactorSetup.tsx/syncMfaFlag): an account that has never enrolled
      // is completely unaffected, so this cannot lock anyone out who hasn't
      // set up 2FA yet. One already did on this account (founder decision,
      // 2026-11-15) -- a stricter "MFA mandatory for every saas_users row"
      // cutover is a separate, later step, not done here.
      if (saasUser.mfa_enabled === true && decodedToken.aal !== 'aal2') {
        await logSecurityEvent({
          type: 'saas_user_aal2_required',
          uid: decodedToken.uid,
          email: decodedToken.email,
          path: req.path,
          method: req.method,
        });
        return res.status(403).json({ error: 'Forbidden: MFA verification required', code: 'mfa_required' });
      }

      req.user.role = saasUser.role;
      req.user.tenantId = 'saas_management';
      // seen-structured-logging-task.md: every log line downstream of this
      // point on this request now carries tenantId/staffId automatically --
      // req.log was set to a bare per-request child logger by server.ts's
      // top-level middleware (correlation id only) before auth resolved who
      // the caller actually is.
      if ((req as any).log) (req as any).log = (req as any).log.child({ tenantId: req.user.tenantId });
      return next();
    }

    // 2. Check staff table
    const { data: staffRow, error: staffError } = await supabaseAdmin
      .from('staff')
      .select('id, role, tenant_id, status')
      .eq('uid', decodedToken.uid)
      .maybeSingle();
    if (staffError) {
      logger.error({ err: staffError }, '[authMiddleware] staff lookup failed');
    }
    if (staffRow) {
      // SECURITY: a deactivated employee's existing JWT is otherwise still
      // valid (Supabase has no server-side session revocation on its own) --
      // this is the one place that re-checks status on every request, so a
      // deactivation actually cuts off access immediately rather than only
      // blocking a future login.
      if (staffRow.status === 'inactive') {
        await logSecurityEvent({
          type: 'inactive_staff_access_attempt',
          uid: decodedToken.uid,
          email: decodedToken.email,
          tenant_id: staffRow.tenant_id,
          staff_id: staffRow.id,
          path: req.path,
          method: req.method,
        });
        return res.status(403).json({ error: 'Forbidden: Account deactivated' });
      }

      // P6 (SECURITY-12, PLATFORM-04): routes here run as service_role, past
      // RLS -- refuse a shop the database itself would refuse (deactivated,
      // in the trash, subscription locked). Ending an acting session stays
      // open so a locked device can still sign its employee out.
      const reqPath = String(req.originalUrl || req.url || '').split('?')[0];
      if (reqPath !== '/api/staff/acting-session/end') {
        const { data: tenantRow, error: tenantError } = await supabaseAdmin
          .from('tenants')
          .select('status, trashed_at, subscription_status, subscription_end_date')
          .eq('id', staffRow.tenant_id)
          .maybeSingle();
        if (tenantError) {
          logger.error({ err: tenantError }, '[authMiddleware] tenant lookup failed');
          return res.status(503).json({ error: 'Service unavailable', code: 'tenant_lookup_failed' });
        }
        const block = tenantAccessBlock(tenantRow);
        if (block) {
          await logSecurityEvent({
            type: 'blocked_tenant_access_attempt',
            uid: decodedToken.uid,
            tenant_id: staffRow.tenant_id,
            staff_id: staffRow.id,
            reason: block.code,
            path: req.path,
            method: req.method,
          });
          return res.status(block.http).json({ error: 'Forbidden: shop access is closed', code: block.code });
        }
      }

      req.user.role = staffRow.role;
      req.user.tenantId = staffRow.tenant_id;
      req.user.staffId = staffRow.id;

      // seen-permissions-fix-task.md Phase 2: an employee switched in by PIN
      // on this device -- the request is theirs (role, staff id), the same
      // way the database's app_current_staff_id() resolves it. A token that
      // is no longer valid is refused, never treated as the device account.
      const actingToken = req.headers[ACTING_HEADER];
      const path = String(req.originalUrl || req.url || '').split('?')[0];
      const sessionFree = path === '/api/staff/verify-pin' || path === '/api/staff/acting-session/end';
      if (typeof actingToken === 'string' && actingToken && !sessionFree) {
        const acting = await resolveActingSession(supabaseAdmin, { authUid: decodedToken.uid, token: actingToken });
        if (!acting || acting.tenantId !== staffRow.tenant_id) {
          return res.status(401).json({ error: 'acting_session_invalid' });
        }
        req.user.deviceStaffId = staffRow.id;
        req.user.staffId = acting.staffId;
        req.user.role = acting.role;
      }
      if ((req as any).log) {
        (req as any).log = (req as any).log.child({ tenantId: staffRow.tenant_id, staffId: staffRow.id });
      }
      return next();
    }

    // SECURITY: super_admin must come exclusively from an active saas_users
    // row (tier 1 above). A hardcoded-email bypass used to live here —
    // removed because it granted full platform admin to anyone who could
    // register/authenticate with that literal email string, independent of
    // any database row (a real risk once "Confirm email" is disabled, as
    // this app's signup flow requires).

    // If no role found, they might be a new user or unauthorized
    await logSecurityEvent({
      type: 'unauthorized_access',
      uid: decodedToken.uid,
      email: decodedToken.email,
      path: req.path,
      method: req.method,
      reason: 'no_role_assigned'
    });
    return res.status(403).json({ error: 'Forbidden: No role assigned' });
  } catch (error) {
    logger.error({ err: error }, 'Auth Middleware Error');
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

/**
 * Middleware to check if user has one of the required roles
 */
export const authorize = (roles: string[]) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user || !req.user.role) {
        return res.status(403).json({ error: 'Forbidden: No role assigned' });
      }

      if (req.user.role === 'super_admin') {
        return next(); // Super admin can do anything
      }

      if (roles.includes(req.user.role)) {
        return next();
      }

      // Log unauthorized role attempt
      await logSecurityEvent({
        type: 'insufficient_permissions',
        uid: req.user.uid,
        email: req.user.email,
        role: req.user.role,
        required_roles: roles,
        path: req.path,
        method: req.method
      });

      return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
    } catch (error) {
      logger.error({ err: error }, 'Authorize Middleware Error');
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
    }
  };
};
