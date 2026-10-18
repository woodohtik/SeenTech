import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  ShieldCheck,
  FileKey,
  KeyRound,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Copy,
  ExternalLink,
  RefreshCw,
  Pencil,
} from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { useDirection } from '../lib/direction';
import { useToast } from '../contexts/ToastContext';
import { cn } from '../lib/utils';

interface ZatcaOnboardingSettingsProps {
  tenantId: string;
}

interface OnboardingStatus {
  hasPendingCsr: boolean;
  hasComplianceCsid: boolean;
  hasProductionCsid: boolean;
}

interface TenantProfileSummary {
  name: string;
  vatNumber: string;
  commercialRegister: string;
  address: string;
  city: string;
}

async function getAuthHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

type ActivateSubStep = 'compliance' | 'tests' | 'production';
type SubStepState = 'idle' | 'running' | 'done' | 'error';

/**
 * سِين (seen-zatca-service-process.md) -- معالج ربط زاتكا الفعلي لكل تاجر.
 * قبل هذا المكوّن، كل أدوات الربط (CSR، Compliance CSID، اختبارات
 * الامتثال، Production CSID) كانت موجودة بالكامل في الكود الخلفي بلا أي
 * واجهة تُشغِّلها -- لا للتاجر ولا للإدارة (مؤكَّد: صفر استدعاء خارج ملفات
 * الاختبار). هذا هو السلك الذي يربطها فعلياً.
 *
 * قائمة تحقّق رأسية لا Stepper بخطوات محجوبة خلف "التالي" -- هذا تبويب
 * إعدادات دائم يعود إليه التاجر عبر جلسات متعددة (قد يغادر لبوابة فاتورة
 * للحصول على OTP ويعود لاحقاً)، فإظهار كل الخطوات دوماً مع حالتها الحالية
 * أوضح من إخفاء خطوات سابقة بعد اجتيازها.
 */
export default function ZatcaOnboardingSettings({ tenantId }: ZatcaOnboardingSettingsProps) {
  const { t } = useTranslation();
  const { dir } = useDirection();
  const navigate = useNavigate();
  const { success: toastSuccess, error: toastError } = useToast();

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [profile, setProfile] = useState<TenantProfileSummary | null>(null);

  const [csrBase64, setCsrBase64] = useState<string | null>(null);
  const [generatingCsr, setGeneratingCsr] = useState(false);

  const [otp, setOtp] = useState('');
  const [activating, setActivating] = useState(false);
  const [subSteps, setSubSteps] = useState<Record<ActivateSubStep, SubStepState>>({
    compliance: 'idle',
    tests: 'idle',
    production: 'idle',
  });
  const [activateError, setActivateError] = useState<string | null>(null);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const authHeader = await getAuthHeader();
      const [statusRes, settingsRes] = await Promise.all([
        fetch('/api/zatca/onboarding-status', { headers: authHeader }),
        fetch('/api/tenant/settings', { headers: authHeader }),
      ]);
      if (statusRes.ok) setStatus(await statusRes.json());
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setProfile({
          name: data.name || '',
          vatNumber: data.taxSettings?.trn || '',
          commercialRegister: data.commercialRegister || '',
          address: data.address || '',
          city: data.city || '',
        });
      }
    } catch (err) {
      console.error('[ZatcaOnboardingSettings] Failed to load status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tenantId && tenantId !== 'saas_management') void loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const profileComplete = Boolean(
    profile?.name && profile?.vatNumber && profile?.commercialRegister && profile?.address && profile?.city
  );

  const handleGenerateCsr = async () => {
    setGeneratingCsr(true);
    try {
      const authHeader = await getAuthHeader();
      const res = await fetch('/api/zatca/generate-csr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toastError(data.error || t('settings_page.zatca.csr_failed', 'تعذّر توليد CSR'));
        return;
      }
      setCsrBase64(data.csrBase64);
      setStatus(prev => prev ? { ...prev, hasPendingCsr: true } : prev);
      toastSuccess(t('settings_page.zatca.csr_success', 'تم توليد CSR بنجاح'));
    } catch (err) {
      toastError(t('settings_page.zatca.csr_failed', 'تعذّر توليد CSR'));
      console.error('[ZatcaOnboardingSettings] generate-csr:', err);
    } finally {
      setGeneratingCsr(false);
    }
  };

  const handleCopyCsr = async () => {
    if (!csrBase64) return;
    try {
      await navigator.clipboard.writeText(csrBase64);
      toastSuccess(t('common.copied', 'تم النسخ'));
    } catch {
      // clipboard API blocked (permissions/non-secure context) -- the text
      // is still visible and selectable in the textarea below, not a dead end.
    }
  };

  const handleActivate = async () => {
    if (!otp.trim()) {
      toastError(t('settings_page.zatca.otp_required', 'رمز OTP مطلوب'));
      return;
    }
    setActivating(true);
    setActivateError(null);
    setSubSteps({ compliance: 'running', tests: 'idle', production: 'idle' });
    const authHeader = await getAuthHeader();

    try {
      const complianceRes = await fetch('/api/zatca/request-compliance-csid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ otp: otp.trim() }),
      });
      const complianceData = await complianceRes.json().catch(() => ({}));
      if (!complianceRes.ok) {
        setSubSteps(prev => ({ ...prev, compliance: 'error' }));
        setActivateError(complianceData.error || t('settings_page.zatca.compliance_failed', 'فشل طلب Compliance CSID'));
        return;
      }
      setSubSteps(prev => ({ ...prev, compliance: 'done', tests: 'running' }));

      const testsRes = await fetch('/api/zatca/run-compliance-tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
      });
      const testsData = await testsRes.json().catch(() => ({}));
      if (!testsRes.ok || !testsData.ok) {
        setSubSteps(prev => ({ ...prev, tests: 'error' }));
        setActivateError(testsData.error || t('settings_page.zatca.tests_failed', 'فشلت اختبارات الامتثال'));
        return;
      }
      setSubSteps(prev => ({ ...prev, tests: 'done', production: 'running' }));

      const productionRes = await fetch('/api/zatca/request-production-csid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
      });
      const productionData = await productionRes.json().catch(() => ({}));
      if (!productionRes.ok) {
        setSubSteps(prev => ({ ...prev, production: 'error' }));
        setActivateError(productionData.error || t('settings_page.zatca.production_failed', 'فشل طلب Production CSID'));
        return;
      }
      setSubSteps(prev => ({ ...prev, production: 'done' }));

      setStatus({ hasPendingCsr: false, hasComplianceCsid: true, hasProductionCsid: true });
      setOtp('');
      toastSuccess(t('settings_page.zatca.activation_success', 'تم ربط المتجر بزاتكا بنجاح!'));
    } catch (err) {
      console.error('[ZatcaOnboardingSettings] activate:', err);
      setActivateError(t('settings_page.zatca.activation_failed', 'تعذّر إكمال التفعيل'));
    } finally {
      setActivating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-brand" size={28} />
      </div>
    );
  }

  const connected = status?.hasProductionCsid;

  return (
    <div className="space-y-6" dir={dir}>
      {/* Header */}
      <div className="bg-surface p-5 sm:p-8 rounded-2xl md:rounded-[2.5rem] border border-border shadow-xl shadow-brand/5">
        <div className="flex items-center gap-4">
          <div className={cn(
            "w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center shrink-0",
            connected ? "bg-success/10 text-success" : "bg-brand/10 text-brand"
          )}>
            <ShieldCheck size={28} />
          </div>
          <div>
            <h3 className="text-xl sm:text-2xl font-black text-content">{t('settings_page.zatca.title', 'ربط زاتكا (ZATCA)')}</h3>
            <p className="text-xs sm:text-sm text-content-muted font-medium mt-0.5">
              {connected
                ? t('settings_page.zatca.connected_subtitle', 'متجرك متصل بزاتكا -- كل فاتورة بيع تُخلَّص/تُبلَّغ تلقائياً.')
                : t('settings_page.zatca.subtitle', 'اربط متجرك فعلياً بمنظومة الفوترة الإلكترونية السعودية.')}
            </p>
          </div>
          {connected && (
            <span className="ms-auto shrink-0 hidden sm:flex items-center gap-1.5 bg-success/10 text-success px-3 py-1.5 rounded-full text-xs font-black">
              <CheckCircle2 size={14} /> {t('settings_page.zatca.connected_badge', 'متصل')}
            </span>
          )}
        </div>
      </div>

      {connected ? (
        <div className="bg-success/5 border border-success/20 rounded-2xl p-5 sm:p-8 flex items-start gap-4">
          <div className="p-3 bg-success text-white rounded-2xl shrink-0">
            <CheckCircle2 size={24} />
          </div>
          <div>
            <h4 className="font-black text-content text-base sm:text-lg">{t('settings_page.zatca.done_title', 'متجرك متصل بزاتكا فعلياً')}</h4>
            <p className="text-content-muted text-xs sm:text-sm font-medium mt-1 leading-relaxed">
              {t('settings_page.zatca.done_desc', 'كل عملية بيع حقيقية من الآن تُرسَل تلقائياً لزاتكا للتخليص (فواتير B2B) أو الإبلاغ (فواتير B2C) -- لا حاجة لأي إجراء إضافي.')}
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Legal prerequisite notice -- Phase 2: the one step Seen cannot do for the merchant */}
          <div className="bg-warning/5 border border-warning/20 rounded-2xl p-5 sm:p-6 flex items-start gap-3">
            <AlertTriangle className="text-warning shrink-0 mt-0.5" size={20} />
            <div className="text-xs sm:text-sm text-content font-medium leading-relaxed">
              <p className="font-black text-warning mb-1">{t('settings_page.zatca.prereq_title', 'شرط أساسي قبل البدء')}</p>
              <p>{t('settings_page.zatca.prereq_desc', 'يجب أن يكون متجرك مسجَّلاً فعلياً في ضريبة القيمة المضافة، وأن تملك حساباً خاصاً باسمك التجاري على بوابة فاتورة (fatoora.zatca.gov.sa). سِين لا يستطيع إنشاء هذا الحساب أو التسجيل الضريبي نيابةً عنك -- هذا شرط من زاتكا نفسها.')}</p>
              <a
                href="https://fatoora.zatca.gov.sa"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-warning font-black mt-2 hover:underline"
              >
                {t('settings_page.zatca.open_fatoora', 'فتح بوابة فاتورة')} <ExternalLink size={12} />
              </a>
            </div>
          </div>

          {/* Step أ: Confirm data */}
          <div className="bg-surface border border-border rounded-2xl p-5 sm:p-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-6 h-6 rounded-full bg-brand/10 text-brand text-xs font-black flex items-center justify-center shrink-0">1</span>
              <h4 className="font-black text-content text-sm sm:text-base">{t('settings_page.zatca.step_confirm_title', 'تأكيد بيانات المنشأة')}</h4>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs sm:text-sm">
              <div className="flex justify-between gap-2 bg-surface-muted/50 rounded-xl px-3 py-2">
                <span className="text-content-muted font-bold">{t('settings_page.profile.store_name', 'اسم المنشأة التجاري')}</span>
                <span className="font-black text-content truncate">{profile?.name || '—'}</span>
              </div>
              <div className="flex justify-between gap-2 bg-surface-muted/50 rounded-xl px-3 py-2">
                <span className="text-content-muted font-bold">{t('settings_page.tax.trn', 'الرقم الضريبي')}</span>
                <span className="font-black text-content" dir="ltr">{profile?.vatNumber || '—'}</span>
              </div>
              <div className="flex justify-between gap-2 bg-surface-muted/50 rounded-xl px-3 py-2">
                <span className="text-content-muted font-bold">{t('settings_page.profile.commercial_register', 'السجل التجاري')}</span>
                {profile?.commercialRegister ? (
                  <span className="font-black text-content" dir="ltr">{profile.commercialRegister}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => navigate('/settings?tab=profile')}
                    className="flex items-center gap-1.5 text-danger font-black text-xs hover:underline shrink-0"
                  >
                    <Pencil size={12} />
                    {t('settings_page.zatca.fill_in_profile', 'عدّل في الملف الشخصي')}
                  </button>
                )}
              </div>
              <div className="flex justify-between gap-2 bg-surface-muted/50 rounded-xl px-3 py-2">
                <span className="text-content-muted font-bold">{t('settings_page.profile.city', 'المدينة')}</span>
                <span className="font-black text-content truncate">{profile?.city || '—'}</span>
              </div>
              <div className="sm:col-span-2 flex justify-between gap-2 bg-surface-muted/50 rounded-xl px-3 py-2">
                <span className="text-content-muted font-bold">{t('settings_page.profile.address', 'العنوان')}</span>
                <span className="font-black text-content truncate">{profile?.address || '—'}</span>
              </div>
            </div>
            {!profileComplete && (
              <div className="mt-3 flex flex-wrap items-center gap-2.5">
                <p className="text-danger text-xs font-bold flex items-center gap-1.5">
                  <AlertTriangle size={14} />
                  {t('settings_page.zatca.profile_incomplete', 'أكمِل هذه البيانات من تبويبَي "الملف الشخصي" و"الإعدادات الضريبية" قبل المتابعة.')}
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/settings?tab=profile')}
                  className="flex items-center gap-1.5 bg-danger/10 text-danger font-black text-xs px-3 py-1.5 rounded-lg hover:bg-danger/15 transition-all shrink-0"
                >
                  <Pencil size={12} />
                  {t('settings_page.zatca.fill_in_profile', 'عدّل في الملف الشخصي')}
                </button>
              </div>
            )}
          </div>

          {/* Step ب: Generate CSR */}
          <div className={cn("bg-surface border border-border rounded-2xl p-5 sm:p-6", !profileComplete && "opacity-50 pointer-events-none")}>
            <div className="flex items-center gap-2 mb-4">
              <span className={cn(
                "w-6 h-6 rounded-full text-xs font-black flex items-center justify-center shrink-0",
                status?.hasPendingCsr || status?.hasComplianceCsid ? "bg-success text-white" : "bg-brand/10 text-brand"
              )}>
                {status?.hasPendingCsr || status?.hasComplianceCsid ? <CheckCircle2 size={14} /> : '2'}
              </span>
              <h4 className="font-black text-content text-sm sm:text-base">{t('settings_page.zatca.step_csr_title', 'توليد CSR')}</h4>
            </div>
            <p className="text-content-muted text-xs sm:text-sm font-medium leading-relaxed mb-4">
              {t('settings_page.zatca.step_csr_desc', 'يولِّد هذا الزر طلب شهادة (CSR) خاصاً بمتجرك. انسخه وألصقه في حسابك على بوابة فاتورة عند تسجيل "وحدة إصدار" جديدة، وستحصل من هناك على رمز OTP.')}
            </p>
            {!csrBase64 && !status?.hasPendingCsr ? (
              <button
                type="button"
                onClick={handleGenerateCsr}
                disabled={generatingCsr}
                className="flex items-center justify-center gap-2 bg-brand text-white px-5 py-3 rounded-xl font-black text-xs sm:text-sm hover:bg-brand/90 transition-all disabled:opacity-50 min-h-[44px]"
              >
                {generatingCsr ? <Loader2 size={16} className="animate-spin" /> : <FileKey size={16} />}
                {t('settings_page.zatca.generate_csr_button', 'توليد CSR')}
              </button>
            ) : (
              <div className="space-y-3">
                {csrBase64 ? (
                  <>
                    <textarea
                      readOnly
                      value={csrBase64}
                      rows={4}
                      dir="ltr"
                      className="w-full bg-surface-muted border border-border rounded-xl p-3 text-[10px] font-mono text-content-muted resize-none outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleCopyCsr}
                      className="flex items-center justify-center gap-2 bg-brand/10 text-brand px-4 py-2.5 rounded-xl font-black text-xs hover:bg-brand/15 transition-all min-h-[40px]"
                    >
                      <Copy size={14} /> {t('common.copy', 'نسخ')}
                    </button>
                  </>
                ) : (
                  <p className="text-xs font-bold text-success flex items-center gap-1.5">
                    <CheckCircle2 size={14} /> {t('settings_page.zatca.csr_already_generated', 'تم توليد CSR مسبقاً -- تابع لخطوة OTP أدناه.')}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Step ج+د: OTP + Activate */}
          <div className={cn(
            "bg-surface border border-border rounded-2xl p-5 sm:p-6",
            (!status?.hasPendingCsr && !status?.hasComplianceCsid) && "opacity-50 pointer-events-none"
          )}>
            <div className="flex items-center gap-2 mb-4">
              <span className={cn(
                "w-6 h-6 rounded-full text-xs font-black flex items-center justify-center shrink-0",
                status?.hasProductionCsid ? "bg-success text-white" : "bg-brand/10 text-brand"
              )}>
                {status?.hasProductionCsid ? <CheckCircle2 size={14} /> : '3'}
              </span>
              <h4 className="font-black text-content text-sm sm:text-base">{t('settings_page.zatca.step_activate_title', 'إدخال OTP والتفعيل')}</h4>
            </div>
            <p className="text-content-muted text-xs sm:text-sm font-medium leading-relaxed mb-4">
              {t('settings_page.zatca.step_activate_desc', 'أدخل رمز OTP الذي حصلت عليه من بوابة فاتورة بعد لصق CSR هناك. سيُشغِّل زر "تفعيل" تلقائياً: طلب Compliance CSID، ثم اختبارات الامتثال، ثم طلب Production CSID -- بلا أي خطوة يدوية إضافية.')}
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder={t('settings_page.zatca.otp_placeholder', 'رمز OTP')}
                dir="ltr"
                disabled={activating || status?.hasComplianceCsid}
                className="flex-1 bg-surface-muted border border-border rounded-xl px-4 py-3 text-sm font-bold text-content outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all disabled:opacity-60"
              />
              <button
                type="button"
                onClick={handleActivate}
                disabled={activating || !otp.trim() || status?.hasComplianceCsid}
                className="flex items-center justify-center gap-2 bg-brand text-white px-6 py-3 rounded-xl font-black text-xs sm:text-sm hover:bg-brand/90 transition-all disabled:opacity-50 min-h-[44px] shrink-0"
              >
                {activating ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
                {t('settings_page.zatca.activate_button', 'تفعيل')}
              </button>
            </div>

            {(activating || subSteps.compliance !== 'idle') && (
              <div className="mt-4 space-y-2">
                {([
                  ['compliance', t('settings_page.zatca.substep_compliance', 'طلب Compliance CSID')],
                  ['tests', t('settings_page.zatca.substep_tests', 'اختبارات الامتثال')],
                  ['production', t('settings_page.zatca.substep_production', 'طلب Production CSID')],
                ] as [ActivateSubStep, string][]).map(([key, label]) => (
                  <div key={key} className="flex items-center gap-2.5 text-xs font-bold">
                    {subSteps[key] === 'done' && <CheckCircle2 size={16} className="text-success shrink-0" />}
                    {subSteps[key] === 'running' && <Loader2 size={16} className="text-brand animate-spin shrink-0" />}
                    {subSteps[key] === 'error' && <AlertTriangle size={16} className="text-danger shrink-0" />}
                    {subSteps[key] === 'idle' && <span className="w-4 h-4 rounded-full border-2 border-border shrink-0" />}
                    <span className={cn(
                      subSteps[key] === 'done' ? "text-success" : subSteps[key] === 'error' ? "text-danger" : "text-content-muted"
                    )}>{label}</span>
                  </div>
                ))}
              </div>
            )}

            {activateError && (
              <div className="mt-4 bg-danger/5 border border-danger/20 rounded-xl p-3 flex items-start gap-2.5">
                <AlertTriangle size={16} className="text-danger shrink-0 mt-0.5" />
                <p className="text-xs font-bold text-danger leading-relaxed">{activateError}</p>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => void loadStatus()}
            className="flex items-center gap-2 text-content-muted hover:text-content text-xs font-bold transition-colors"
          >
            <RefreshCw size={14} /> {t('settings_page.zatca.refresh_status', 'تحديث الحالة')}
          </button>
        </>
      )}
    </div>
  );
}
