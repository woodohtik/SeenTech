import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import AccessDenied from './AccessDenied';
import { normalizeRole } from '../config/navigation';
import { Staff, PermissionKey } from '../types';
import { usePermissions } from '../hooks/usePermissions';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: string[];
  userRole?: string | null;
  staff?: Staff | null;
  permission?: string;
  isImpersonating?: boolean;
  redirectTo?: string;
}

/**
 * Senior RBAC Route Protection Wrapper (Protected Route)
 * Checks user role and specific permissions before rendering children.
 * Intercepts unauthorized URL typing (e.g., cashier attempting to access /reports manually)
 * and renders a secure 403 Access Denied view or redirects to allowed default screen.
 */
export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  allowedRoles,
  userRole,
  staff,
  permission,
  isImpersonating = false,
  redirectTo
}) => {
  const location = useLocation();
  const { hasPermission } = usePermissions(staff);

  // Super Admin or Impersonating Super Admin has unrestricted access
  if (userRole === 'super_admin' || isImpersonating) {
    return <>{children}</>;
  }

  const effectiveRole = staff?.role || userRole || 'cashier';
  const normRole = normalizeRole(effectiveRole);
  const isOwner = effectiveRole === 'owner' || normRole === 'tenant_admin' || userRole === 'owner' || effectiveRole === 'super_admin';

  // Owners have absolute full system access
  if (isOwner) {
    return <>{children}</>;
  }

  // 1. Specific Fine-Grained Permission Check (if provided)
  if (permission) {
    if (hasPermission(permission as PermissionKey)) {
      return <>{children}</>;
    } else {
      return (
        <AccessDenied 
          userRole={effectiveRole} 
          redirectPath={redirectTo} 
        />
      );
    }
  }

  // 2. Fallback Role Check (if no permission prop is defined)
  if (allowedRoles && allowedRoles.length > 0) {
    const isOwnerOrAdmin = (normRole as string) === 'tenant_admin' || effectiveRole === 'owner' || effectiveRole === 'admin';
    
    const roleMatch = allowedRoles.some(allowed => {
      if ((allowed as string) === 'tenant_admin' && isOwnerOrAdmin) return true;
      if (allowed === effectiveRole) return true;
      if (allowed === (normRole as string)) return true;
      return false;
    });

    if (!roleMatch) {
      return (
        <AccessDenied 
          userRole={effectiveRole} 
          requiredRoles={allowedRoles} 
          redirectPath={redirectTo} 
        />
      );
    }
  }

  return <>{children}</>;
};

export default ProtectedRoute;

/* ==========================================================================
 * BACKEND SECURITY CONSIDERATIONS (SECURITY & COMPLIANCE ARCHITECTURE):
 * 
 * 1. Client-Side Spoofing Prevention:
 *    Frontend route guards (like ProtectedRoute) enhance UX by preventing 
 *    accidental navigation to restricted screens. However, security MUST be
 *    enforced at the backend API & database layer.
 * 
 * 2. Supabase / PostgreSQL Row Level Security (RLS):
 *    All Supabase tables (e.g., tenant_settings, staff_users, financial_reports)
 *    must apply RLS policies validating the user's JWT claim (`auth.jwt() -> role`):
 * 
 *    Example RLS Policy for Financial Reports:
 *    CREATE POLICY "Only tenant admins and accountants can read reports"
 *    ON financial_reports FOR SELECT
 *    USING (
 *      auth.jwt() ->> 'tenant_id' = tenant_id AND
 *      auth.jwt() ->> 'role' IN ('owner', 'admin', 'tenant_admin', 'accountant')
 *    );
 * 
 * 3. JWT Token Custom Claims / Metadata:
 *    When a staff member logs in via PIN or Email, Supabase Auth updates app_metadata
 *    or issues custom JWT claims containing { tenant_id, role, staff_id }.
 *    The API verifies this JWT on every request, ensuring modified localStorage or 
 *    React state on the browser cannot bypass data access controls.
 * ========================================================================== */
