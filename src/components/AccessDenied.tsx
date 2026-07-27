import React from 'react';
import { ShieldAlert, ArrowRight, Home, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';

interface AccessDeniedProps {
  userRole?: string | null;
  requiredRoles?: string[];
  redirectPath?: string;
}

export default function AccessDenied({ userRole, requiredRoles, redirectPath }: AccessDeniedProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();

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
    <div className="min-h-[75vh] flex flex-col items-center justify-center p-6 text-center select-none" dir="rtl">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 15 }}
        className="relative mb-6"
      >
        <div className="w-28 h-28 md:w-32 md:h-32 bg-danger/10 text-danger rounded-3xl flex items-center justify-center shadow-xl shadow-danger/10 border border-danger/20">
          <ShieldAlert size={56} className="animate-pulse" />
        </div>
        <div className="absolute -bottom-2 -right-2 bg-surface p-2 rounded-2xl shadow-md border border-border text-danger">
          <Lock size={20} />
        </div>
      </motion.div>

      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="max-w-md mx-auto space-y-3"
      >
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-danger/10 text-danger text-xs font-black tracking-wide border border-danger/20">
          <span>خطأ 403 - محظور الوصول</span>
        </div>

        <h1 className="text-2xl md:text-3xl font-black text-content tracking-tight">
          عفواً، لا تملك الصلاحية للوصول
        </h1>

        <p className="text-sm md:text-base text-content-muted leading-relaxed font-medium">
          تم تقييد الوصول لهذه الصفحة بناءً على صلاحيات دورك الحالي ({userRole || 'غير محدد'}). يرجى التواصل مع مالك المحل إذا كنت تعتقد أن هذا خطأ.
        </p>

        {requiredRoles && requiredRoles.length > 0 && (
          <div className="mt-4 p-3 bg-surface-muted rounded-xl border border-border text-xs text-content-muted font-mono">
            الصلاحيات المطلوبة: <span className="font-bold text-brand">{requiredRoles.join(' | ')}</span>
          </div>
        )}

        <div className="pt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={handleReturnHome}
            className="w-full sm:w-auto px-6 py-3 bg-brand text-white font-bold rounded-xl shadow-lg shadow-brand/20 hover:bg-brand/90 active:scale-95 transition-all flex items-center justify-center gap-2 text-sm cursor-pointer"
          >
            <Home size={18} />
            <span>العودة للواجهة المتاحة</span>
          </button>

          <button
            onClick={() => navigate(-1)}
            className="w-full sm:w-auto px-5 py-3 bg-surface text-content border border-border font-bold rounded-xl hover:bg-surface-muted active:scale-95 transition-all flex items-center justify-center gap-2 text-sm cursor-pointer"
          >
            <ArrowRight size={18} />
            <span>الصفحة السابقة</span>
          </button>
        </div>
      </motion.div>

      {/* Backend Security Assurance Notice */}
      <div className="mt-12 text-[11px] text-content-muted/60 max-w-sm border-t border-border/50 pt-4">
        🔒 حماية مشددة: يتم التحقق من الصلاحيات على مستوى الخادم (Server-Side Enforcement) وقواعد الوصول لقواعد البيانات (Supabase RLS Policy).
      </div>
    </div>
  );
}
