import type { Request, Response, NextFunction } from 'express';
import express from 'express';
import admin from 'firebase-admin';
import { adminAuth, adminDb } from '../firebase-admin.ts';

export interface AuthRequest extends Request {
  user?: {
    uid: string;
    email?: string;
    role?: string;
    tenantId?: string;
  };
}

/**
 * Middleware to verify Firebase ID Token
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

    // Fetch user role and tenantId from Firestore
    // 1. Check saas_users (Super Admins)
    const saasUserDoc = await adminDb.collection('saas_users').doc(decodedToken.uid).get();
    if (saasUserDoc.exists) {
      const data = saasUserDoc.data();
      req.user.role = data?.role;
      req.user.tenantId = 'saas_management';
      return next();
    }

    // 2. Check staff collection
    const staffDoc = await adminDb.collection('staff').doc(decodedToken.uid).get();
    if (staffDoc.exists) {
      const data = staffDoc.data();
      req.user.role = data?.role;
      req.user.tenantId = data?.tenantId;
      return next();
    }

    // 3. Check if it's the hardcoded super admin
    if (decodedToken.email === "nomansa2566512@gmail.com") {
      req.user.role = 'super_admin';
      req.user.tenantId = 'saas_management';
      return next();
    }

    // If no role found, they might be a new user or unauthorized
    await adminDb.collection('security_logs').add({
      type: 'unauthorized_access',
      uid: decodedToken.uid,
      email: decodedToken.email,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
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
    await adminDb.collection('security_logs').add({
      type: 'insufficient_permissions',
      uid: req.user.uid,
      email: req.user.email,
      role: req.user.role,
      requiredRoles: roles,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      path: req.path,
      method: req.method
    });

    return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
  };
};
