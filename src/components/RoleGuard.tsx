import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { SaasUserRole } from '../types/supabase';
import { ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface RoleGuardProps {
  children: React.ReactNode;
  allowedRoles: SaasUserRole[];
}

export default function RoleGuard({ children, allowedRoles }: RoleGuardProps) {
  const { t } = useTranslation();
  const { dbUser, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
      </div>
    );
  }

  const userRole = dbUser?.role;
  const isOwnerEquivalent = userRole === 'owner' || userRole === 'super_admin';

  const hasAllowedRole = allowedRoles.includes(userRole as SaasUserRole) || 
                         (isOwnerEquivalent && allowedRoles.includes('super_admin'));

  if (!userRole || !hasAllowedRole) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6">
        {/* CSS pop: no motion library on the startup path (Phase 2.4). */}
        <div className="seen-enter-grow w-32 h-32 bg-[var(--seen-danger-bg)] text-danger rounded-full flex items-center justify-center mb-8">
          <ShieldAlert size={64} />
        </div>
        <h2 className="text-4xl font-black text-content mb-4">{t('permissions.role_guard_title')}</h2>
        <p className="text-xl text-content-muted max-w-md mx-auto leading-relaxed">
          {t('permissions.role_guard_desc')}
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
