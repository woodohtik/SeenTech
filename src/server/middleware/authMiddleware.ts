import type { Request, Response, NextFunction } from 'express';
import express from 'express';
import { adminAuth } from '../firebase-admin.ts';
import { supabaseAdmin } from '../supabase-admin.ts';

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
 * Middleware to verify Firebase ID Token
 * (Token verification stays on Firebase in Stage 1; role/tenant lookups now read Supabase.)
 */
export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    const decodedToken = await adminAuth.verifyIdToken(idToken);
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

    // 3. Check if it's the hardcoded super admin
    if (decodedToken.email === "nomansa2566512@gmail.com") {
      req.user.role = 'super_admin';
      req.user.tenantId = 'saas_management';
      return next();
    }

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
