import type { Request, Response, NextFunction } from 'express';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { adminAuth } from '../firebase-admin.ts';
import { supabaseAdmin } from '../supabase-admin.ts';

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
      console.warn('[security_logs] insert skipped/failed:', error.message);
    }
  } catch (err) {
    console.warn('[security_logs] insert skipped/failed:', err);
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
    let decodedToken: { uid: string; email?: string } | null = null;

    if (supabaseJwks) {
      try {
        const { payload } = await jwtVerify(idToken, supabaseJwks, { audience: 'authenticated' });
        decodedToken = { uid: payload.sub as string, email: payload.email as string | undefined };
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
        }) as { sub: string; email?: string };
        decodedToken = { uid: payload.sub, email: payload.email };
      } catch {
        // Not a valid legacy token either; fall through to the Firebase path.
      }
    }

    // TRANSITION-WINDOW FALLBACK ONLY — remove once cutover stabilizes.
    if (!decodedToken && adminAuth) {
      try {
        decodedToken = await adminAuth.verifyIdToken(idToken);
      } catch (verifyError: any) {
        console.warn('[authMiddleware] verifyIdToken failed:', verifyError.message);
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
      .select('role')
      .eq('uid', decodedToken.uid)
      .maybeSingle();
    if (saasError) {
      console.error('[authMiddleware] saas_users lookup failed:', saasError.message);
    }
    if (saasUser) {
      req.user.role = saasUser.role;
      req.user.tenantId = 'saas_management';
      return next();
    }

    // 2. Check staff table
    const { data: staffRow, error: staffError } = await supabaseAdmin
      .from('staff')
      .select('role, tenant_id')
      .eq('uid', decodedToken.uid)
      .maybeSingle();
    if (staffError) {
      console.error('[authMiddleware] staff lookup failed:', staffError.message);
    }
    if (staffRow) {
      req.user.role = staffRow.role;
      req.user.tenantId = staffRow.tenant_id;
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
    console.error('Auth Middleware Error:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

/**
 * Middleware to check if user has one of the required roles
 */
export const authorize = (roles: string[]) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
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
  };
};
