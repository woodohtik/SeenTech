import React from 'react';
import { Navigate } from 'react-router-dom';
import { usePermissions } from '../hooks/usePermissions';
import { Staff } from '../types';

interface PermissionGuardProps {
  permission?: any;
  roles?: string[];
  userRole: string | null;
  staff: Staff | null;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Frontend guard to protect components based on roles or permissions
 */
export const PermissionGuard: React.FC<PermissionGuardProps> = ({ 
  permission, 
  roles, 
  userRole, 
  staff,
  children, 
  fallback = <Navigate to="/" replace /> 
}) => {
  const { hasPermission } = usePermissions(staff);

  // Check roles if provided
  if (roles && userRole && !roles.includes(userRole) && userRole !== 'super_admin') {
    return <>{fallback}</>;
  }

  // Check specific permission if provided
  if (permission && !hasPermission(permission)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};
