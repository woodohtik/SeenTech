import { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase/client';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';

/**
 * seen-admin-reengineering-task.md بند 7 -- SaaSLayout.tsx:264 كان فيه تعليق
 * صريح "2FA Verification Check (Removed per user request)"، بلا أي TOTP/MFA
 * حقيقي في أي مكان آخر بالمشروع (AuthContext.tsx/Login.tsx). هذا المكوّن
 * يتيح لموظف SaaS تفعيل/تعطيل TOTP حقيقي عبر Supabase Auth MFA الأصلي --
 * لا تشفير أو تخزين سر يدوي، Supabase يحفظ السر ويتحقق من الكود بنفسه.
 * بوابة الدخول الفعلية في SaaSLayout.tsx (TwoFactorChallenge) + هذا الملف.
 */
export default function TwoFactorSetup() {
  const { t } = useTranslation();
  const { user: currentAuthUser } = useAuth();
  const { success: toastSuccess, error: toastError } = useToast();
  const { confirm } = useConfirm();

  const [loading, setLoading] = useState(true);
  const [verifiedFactorId, setVerifiedFactorId] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState<{ id: string; qrCode: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const refreshFactors = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      const verified = data.all.find(f => f.factor_type === 'totp' && f.status === 'verified');
      setVerifiedFactorId(verified?.id || null);
    } catch (e) {
      console.error('[2FA] Failed to list factors:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refreshFactors(); }, []);

  const syncMfaFlag = async (enabled: boolean) => {
    if (!currentAuthUser?.id) return;
    await supabase.from('saas_users').update({ mfa_enabled: enabled }).eq('uid', currentAuthUser.id);
  };

  const startEnroll = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Seen Admin' });
      if (error) throw error;
      setEnrolling({ id: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
    } catch (e: any) {
      toastError(e?.message || t('saas.mfa_enroll_failed', 'تعذّر بدء تفعيل التحقق الثنائي'));
    } finally {
      setBusy(false);
    }
  };

  const verifyEnroll = async () => {
    if (!enrolling) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrolling.id, code: code.trim() });
      if (error) throw error;
      await syncMfaFlag(true);
      setEnrolling(null);
      setCode('');
      toastSuccess(t('saas.mfa_enabled_success', 'تم تفعيل التحقق الثنائي بنجاح'));
      await refreshFactors();
    } catch (e: any) {
      toastError(e?.message || t('saas.mfa_verify_failed', 'الرمز غير صحيح أو منتهي -- حاول مجدداً'));
    } finally {
      setBusy(false);
    }
  };

  const cancelEnroll = async () => {
    if (!enrolling) return;
    try {
      await supabase.auth.mfa.unenroll({ factorId: enrolling.id });
    } catch (e) {
      console.warn('[2FA] Failed to clean up abandoned enrollment:', e);
    }
    setEnrolling(null);
    setCode('');
  };

  const disableMfa = async () => {
    if (!verifiedFactorId) return;
    const ok = await confirm({
      description: t('saas.mfa_disable_confirm', 'سيصبح حسابك محمياً بكلمة المرور فقط بعد التعطيل. متأكد؟'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: verifiedFactorId });
      if (error) throw error;
      await syncMfaFlag(false);
      toastSuccess(t('saas.mfa_disabled_success', 'تم تعطيل التحقق الثنائي'));
      await refreshFactors();
    } catch (e: any) {
      toastError(e?.message || t('saas.mfa_disable_failed', 'تعذّر تعطيل التحقق الثنائي'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-surface p-6 rounded-2xl border border-border shadow-sm flex items-center gap-3">
        <Loader2 className="animate-spin text-content-muted" size={18} />
        <span className="text-sm font-bold text-content-muted">{t('saas.loading')}</span>
      </div>
    );
  }

  return (
    <div className="bg-surface p-6 rounded-2xl border border-border shadow-sm space-y-4">
      <div className="flex items-center gap-3">
        <div className={verifiedFactorId ? 'w-12 h-12 bg-success/10 text-success rounded-xl flex items-center justify-center shrink-0' : 'w-12 h-12 bg-warning/10 text-warning rounded-xl flex items-center justify-center shrink-0'}>
          {verifiedFactorId ? <ShieldCheck size={22} /> : <ShieldAlert size={22} />}
        </div>
        <div>
          <h3 className="text-lg font-black text-content">{t('saas.mfa_title', 'التحقق الثنائي (2FA)')}</h3>
          <p className="text-content-muted font-bold text-xs mt-1">
            {verifiedFactorId
              ? t('saas.mfa_status_enabled', 'مفعَّل على حسابك')
              : t('saas.mfa_status_disabled', 'غير مفعَّل -- حسابك محمي بكلمة المرور فقط')}
          </p>
        </div>
      </div>

      {!enrolling && (
        verifiedFactorId ? (
          <button
            onClick={disableMfa}
            disabled={busy}
            className="px-4 py-2.5 bg-danger/5 text-danger border border-danger/20 rounded-xl text-xs font-black hover:bg-danger/10 transition-all cursor-pointer disabled:opacity-50"
          >
            {t('saas.mfa_disable_button', 'تعطيل التحقق الثنائي')}
          </button>
        ) : (
          <button
            onClick={startEnroll}
            disabled={busy}
            className="px-4 py-2.5 bg-brand text-white rounded-xl text-xs font-black hover:bg-brand/90 transition-all cursor-pointer disabled:opacity-50"
          >
            {t('saas.mfa_enable_button', 'تفعيل التحقق الثنائي')}
          </button>
        )
      )}

      {enrolling && (
        <div className="space-y-4 p-4 bg-surface-muted rounded-2xl border border-border">
          <p className="text-xs font-bold text-content-muted">
            {t('saas.mfa_scan_instruction', 'امسح رمز QR بتطبيق مصادقة (Google Authenticator أو ما شابه)، ثم أدخل الرمز المكوّن من 6 أرقام.')}
          </p>
          <img src={enrolling.qrCode} alt="TOTP QR" className="w-40 h-40 mx-auto bg-white p-2 rounded-xl border border-border" />
          <div className="text-center">
            <span className="text-[10px] font-black text-content-muted uppercase tracking-wider block mb-1">
              {t('saas.mfa_manual_secret', 'أو أدخل هذا الرمز يدوياً')}
            </span>
            <span className="font-mono text-xs text-content dir-ltr select-all">{enrolling.secret}</span>
          </div>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            className="w-full p-3 bg-surface border border-border rounded-xl text-center text-lg font-black tracking-[0.3em] dir-ltr outline-none focus:border-brand"
          />
          <div className="flex gap-2">
            <button
              onClick={cancelEnroll}
              disabled={busy}
              className="flex-1 py-2.5 bg-surface border border-border text-content font-bold rounded-xl text-xs transition-all cursor-pointer disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={verifyEnroll}
              disabled={busy || code.length !== 6}
              className="flex-1 py-2.5 bg-brand text-white font-black rounded-xl text-xs transition-all cursor-pointer disabled:opacity-50"
            >
              {t('saas.mfa_verify_button', 'تأكيد التفعيل')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
