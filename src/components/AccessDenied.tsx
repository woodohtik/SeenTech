import React from 'react';
import { ShieldAlert, ArrowRight, Home, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDirection } from '../lib/direction';

interface AccessDeniedProps {
  userRole?: string | null;
  requiredRoles?: string[];
  redirectPath?: string;
}

export default function AccessDenied({ userRole, requiredRoles, redirectPath }: AccessDeniedProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { dir } = useDirection();

  // Determine standard default home based on role
  const getDefaultHome = () => {
    if (redirectPath) return redirectPath;
    if (userRole === 'cashier') return '/sales';
    if (userRole === 'tailor') return '/orders';
    if (userRole === 'super_admin') return '/admin/dashboard';
    return '/dashboard';
  };

  const handleReturnHome = () => {
    navigate(getDefaultHome());
  };

  return (
    <div className="min-h-[75vh] flex flex-col items-center justify-center p-6 text-center select-none" dir={dir}>
      {/* CSS enter animations: this screen can show before the motion library
          has loaded (seen-performance-first-open-login-task.md Phase 2.4). */}
      <div className="seen-enter-pop relative mb-6">
        <div className="w-28 h-28 main-720:w-32 main-720:h-32 bg-danger/10 text-danger rounded-3xl flex items-center justify-center shadow-xl shadow-danger/10 border border-danger/20">
          <ShieldAlert size={56} className="animate-pulse" />
        </div>
        <div className="absolute -bottom-2 -right-2 bg-surface p-2 rounded-2xl shadow-md border border-border text-danger">
          <Lock size={20} />
        </div>
      </div>

      <div
        className="seen-enter-rise max-w-md mx-auto space-y-3"
        style={{ ['--seen-rise' as string]: '20px', animationDelay: '0.1s' }}
      >
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-danger/10 text-danger text-sm font-black border border-danger/20">
          <span>{t('permissions.error_403_forbidden')}</span>
        </div>

        <h1 className="text-2xl main-720:text-3xl font-black text-content">
          {t('permissions.access_denied_title')}
        </h1>

        <p className="text-sm main-720:text-base text-content-muted leading-relaxed font-medium">
          {t('permissions.access_denied_desc', { role: userRole || t('orders.not_specified') })}
        </p>

        {requiredRoles && requiredRoles.length > 0 && (
          <div className="mt-4 p-3 bg-surface-muted rounded-xl border border-border text-sm text-content-muted font-mono">
            {t('permissions.required_roles')} <span className="font-bold text-brand">{requiredRoles.join(' | ')}</span>
          </div>
        )}

        <div className="pt-6 flex flex-col main-640:flex-row items-center justify-center gap-3">
          <button
            onClick={handleReturnHome}
            className="w-full main-640:w-auto px-6 py-3 bg-brand text-white font-bold rounded-xl shadow-lg shadow-brand/20 hover:bg-brand/90 active:scale-95 transition-all flex items-center justify-center gap-2 text-sm cursor-pointer"
          >
            <Home size={18} />
            <span>{t('permissions.back_to_allowed_area')}</span>
          </button>

          <button
            onClick={() => navigate(-1)}
            className="w-full main-640:w-auto px-5 py-3 bg-surface text-content border border-border font-bold rounded-xl hover:bg-surface-muted active:scale-95 transition-all flex items-center justify-center gap-2 text-sm cursor-pointer"
          >
            <ArrowRight size={18} />
            <span>{t('common.previous_page')}</span>
          </button>
        </div>
      </div>

      {/* Backend Security Assurance Notice */}
      <div className="mt-12 text-sm text-content-muted/80 max-w-sm border-t border-border/50 pt-4">
        🔒 {t('permissions.server_side_enforcement_notice')}
      </div>
    </div>
  );
}
