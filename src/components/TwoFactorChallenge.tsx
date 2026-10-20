import { useEffect, useState } from 'react';
import { ShieldCheck, LogOut, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase/client';

interface TwoFactorChallengeProps {
  onVerified: () => void;
}

/**
 * seen-admin-reengineering-task.md بند 7 -- بوابة الدخول الفعلية: تُعرَض بدل
 * كل محتوى لوحة السوبر أدمن (انظر SaaSLayout.tsx) طالما الجلسة عند aal1 بينما
 * الحساب يملك عامل TOTP موثَّق (nextLevel === 'aal2') -- هذا هو الفرق بين
 * "2FA موجود كخيار" و"2FA يفرض فعلياً"، وهو بالضبط ما طلبه هذا البند.
 */
export default function TwoFactorChallenge({ onVerified }: TwoFactorChallengeProps) {
  const { t } = useTranslation();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error: listError } = await supabase.auth.mfa.listFactors();
      if (!listError) {
        const verified = data.all.find(f => f.factor_type === 'totp' && f.status === 'verified');
        setFactorId(verified?.id || null);
      }
      setLoading(false);
    })();
  }, []);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId || code.length !== 6) return;
    setVerifying(true);
    setError(null);
    try {
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      if (verifyError) throw verifyError;
      onVerified();
    } catch (e: any) {
      setError(e?.message || t('saas.mfa_verify_failed', 'الرمز غير صحيح أو منتهي -- حاول مجدداً'));
    } finally {
      setVerifying(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <div className="fixed inset-0 z-[300] bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-surface border border-border rounded-3xl shadow-2xl p-8 space-y-6 text-center">
        <div className="w-16 h-16 bg-brand/10 text-brand rounded-2xl flex items-center justify-center mx-auto">
          <ShieldCheck size={32} />
        </div>
        <div>
          <h2 className="text-lg font-black text-content">{t('saas.mfa_challenge_title', 'التحقق الثنائي مطلوب')}</h2>
          <p className="text-content-muted font-bold text-xs mt-1">
            {t('saas.mfa_challenge_desc', 'أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة')}
          </p>
        </div>

        {loading ? (
          <Loader2 className="animate-spin text-content-muted mx-auto" size={24} />
        ) : !factorId ? (
          <p className="text-xs font-bold text-danger">{t('saas.mfa_no_factor_error', 'لا يوجد عامل تحقق موثَّق على هذا الحساب -- تواصل مع مدير آخر')}</p>
        ) : (
          <form onSubmit={handleVerify} className="space-y-4">
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              autoFocus
              value={code}
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setError(null); }}
              placeholder="000000"
              className="w-full p-3 bg-surface-muted border border-border rounded-xl text-center text-lg font-black tracking-[0.3em] dir-ltr outline-none focus:border-brand"
            />
            {error && <p className="text-xs font-bold text-danger">{error}</p>}
            <button
              type="submit"
              disabled={verifying || code.length !== 6}
              className="w-full py-3 bg-brand text-white font-black rounded-xl text-sm transition-all cursor-pointer disabled:opacity-50"
            >
              {verifying ? <Loader2 className="animate-spin mx-auto" size={18} /> : t('saas.mfa_challenge_submit', 'تحقّق ومتابعة')}
            </button>
          </form>
        )}

        <button
          onClick={handleLogout}
          className="flex items-center justify-center gap-2 w-full text-xs font-bold text-content-muted hover:text-content transition-all cursor-pointer"
        >
          <LogOut size={14} />
          <span>{t('saas.logout', 'تسجيل الخروج')}</span>
        </button>
      </div>
    </div>
  );
}
