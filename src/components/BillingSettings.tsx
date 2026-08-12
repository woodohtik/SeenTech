import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import { 
  CreditCard, 
  Zap, 
  CheckCircle2, 
  Sparkles, 
  AlertCircle, 
  RefreshCw, 
  ShieldCheck, 
  Plus, 
  Upload, 
  FileImage, 
  X, 
  Clock, 
  Copy, 
  Check, 
  HelpCircle, 
  FileText, 
  ArrowLeft, 
  Building2, 
  ChevronDown,
  ChevronUp,
  Download,
  Lock,
  Star
} from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { PriceDisplay } from './PriceDisplay';
import { createSubscriptionRequest, fetchSubscriptionRequests, SubscriptionRequest } from '../services/subscriptionRequestService';

import { isRtlLang } from '../lib/direction';

interface BillingSettingsProps {
  tenantId: string;
}

export default function BillingSettings({ tenantId }: BillingSettingsProps) {
  const { t, i18n } = useTranslation();
  const isRtl = isRtlLang(i18n.language);

  const [loading, setLoading] = useState(true);
  const [tenant, setTenant] = useState<any>(null);
  const [currentPlan, setCurrentPlan] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [userRequests, setUserRequests] = useState<SubscriptionRequest[]>([]);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [copiedIban, setCopiedIban] = useState(false);
  const [showFaq, setShowFaq] = useState(false);

  // Selected plan in upgrade modal
  const [selectedPlanId, setSelectedPlanId] = useState<'basic' | 'free'>('basic');
  const [paymentMethod, setPaymentMethod] = useState<'bank_transfer' | 'card' | 'network' | 'cash'>('bank_transfer');
  const [referenceNo, setReferenceNo] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const PLANS = [
    {
      id: 'basic' as const,
      name: t('billing.plans.basic.name'),
      tagline: t('billing.plans.basic.tagline'),
      price: 599,
      period: t('billing.plans.basic.period'),
      badge: t('billing.plans.basic.badge'),
      isPopular: true,
      desc: t('billing.plans.basic.desc'),
      features: [
        t('billing.plans.basic.f1'),
        t('billing.plans.basic.f2'),
        t('billing.plans.basic.f3'),
        t('billing.plans.basic.f4'),
        t('billing.plans.basic.f5'),
        t('billing.plans.basic.f6'),
        t('billing.plans.basic.f7'),
        t('billing.plans.basic.f8')
      ]
    },
    {
      id: 'free' as const,
      name: t('billing.plans.free.name'),
      tagline: t('billing.plans.free.tagline'),
      price: 0,
      period: t('billing.plans.free.period'),
      badge: t('billing.plans.free.badge'),
      isPopular: false,
      desc: t('billing.plans.free.desc'),
      features: [
        t('billing.plans.free.f1'),
        t('billing.plans.free.f2'),
        t('billing.plans.free.f3'),
        t('billing.plans.free.f4')
      ]
    }
  ];

  const COMPARISON_FEATURES = [
    { name: t('billing.compare.f1'), free: true, basic: true },
    { name: t('billing.compare.f2'), free: true, basic: true },
    { name: t('billing.compare.f3'), free: true, basic: true },
    { name: t('billing.compare.f4'), free: true, basic: true },
    { name: t('billing.compare.f5'), free: t('billing.compare.limited'), basic: t('billing.compare.unlimited') },
    { name: t('billing.compare.f6'), free: t('billing.compare.by_email'), basic: t('billing.compare.live_support') },
    { name: t('billing.compare.f7'), free: true, basic: true },
    { name: t('billing.compare.f8'), free: t('billing.compare.basic'), basic: t('billing.compare.advanced') },
  ];

  const fetchRealBillingData = async () => {
    if (!tenantId || tenantId === 'saas_management') {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // 1. جلب بيانات المشترك من قاعدة البيانات
      const { data: tenantData } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', tenantId)
        .maybeSingle();

      if (tenantData) {
        setTenant(tenantData);
        if (tenantData.plan_id === 'basic') {
          setCurrentPlan(PLANS[0]);
        } else {
          setCurrentPlan(PLANS[1]);
        }
      }

      // 2. جلب سجل المدفوعات الحقيقية
      const { data: paymentsData } = await supabase
        .from('payments')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('received_at', { ascending: false });

      if (paymentsData) {
        setPayments(paymentsData);
      }

      // 3. جلب طلبات الاشتراك الخاصة بهذا المشترك
      const allReqs = await fetchSubscriptionRequests();
      const myReqs = allReqs.filter(r => r.tenant_id === tenantId);
      setUserRequests(myReqs);
    } catch (err) {
      console.error('فشل جلب بيانات الاشتراك:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRealBillingData();

    const handleReqUpdate = () => {
      fetchRealBillingData();
    };
    window.addEventListener('subscription_request_updated', handleReqUpdate);
    return () => {
      window.removeEventListener('subscription_request_updated', handleReqUpdate);
    };
  }, [tenantId]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const copyIbanToClipboard = () => {
    navigator.clipboard.writeText('SA1280000456123456789012');
    setCopiedIban(true);
    setTimeout(() => setCopiedIban(false), 2500);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        alert(t('billing.file_too_large'));
        return;
      }
      setProofFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setProofPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmitSubscriptionRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;

    const targetPlan = PLANS.find(p => p.id === selectedPlanId) || PLANS[0];

    if (targetPlan.price > 0 && !proofPreview && !referenceNo.trim()) {
      alert(t('billing.proof_required_alert'));
      return;
    }

    setSubmitting(true);

    try {
      await createSubscriptionRequest({
        tenant_id: tenantId,
        tenant_name: tenant?.name || 'محل تفصيل سين',
        tenant_email: tenant?.owner_email || '',
        plan_id: targetPlan.id,
        plan_name: targetPlan.name,
        amount: targetPlan.price,
        payment_method: paymentMethod,
        proof_url: proofPreview || null,
        reference_no: referenceNo.trim() || null,
        notes: notes.trim() || null,
      });

      showToast(t('billing.request_sent_success'));
      setShowUpgradeModal(false);
      setProofFile(null);
      setProofPreview(null);
      setReferenceNo('');
      setNotes('');
      await fetchRealBillingData();
    } catch (err: any) {
      alert(t('billing.request_submit_error', { error: err.message || err }));
    } finally {
      setSubmitting(false);
    }
  };

  const getPlanDisplayName = () => {
    if (tenant?.plan_id === 'basic') return t('billing.plans.basic.name');
    if (tenant?.plan_id === 'free') return t('billing.plans.free.name');
    return currentPlan?.name || t('billing.plans.free.name_trial');
  };

  const getPlanStatusLabel = () => {
    const status = tenant?.status || 'active';
    switch (status) {
      case 'active':
        return { label: t('billing.status.active'), bg: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' };
      case 'trial':
      case 'onboarding':
        return { label: t('billing.status.trial'), bg: 'bg-amber-500/10 text-amber-600 border-amber-500/20' };
      case 'suspended':
      case 'locked':
        return { label: t('billing.status.suspended'), bg: 'bg-rose-500/10 text-rose-600 border-rose-500/20' };
      default:
        return { label: t('billing.status.active'), bg: 'bg-brand/10 text-brand border-brand/20' };
    }
  };

  const getNextBillingDate = () => {
    const locale = isRtl ? 'ar-SA-u-nu-latn' : 'en-US';
    if (tenant?.subscription_end_date) {
      return new Date(tenant.subscription_end_date).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
    }
    if (tenant?.trial_ends_at) {
      return new Date(tenant.trial_ends_at).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
    }
    if (tenant?.created_at) {
      const created = new Date(tenant.created_at);
      created.setFullYear(created.getFullYear() + 1);
      return created.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
    }
    return new Date(Date.now() + 365 * 86400000).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
  };

  const statusBadge = getPlanStatusLabel();
  const pendingRequests = userRequests.filter(r => r.status === 'pending');

  if (loading) {
    return (
      <div className="bg-surface p-12 rounded-3xl border border-border flex flex-col items-center justify-center space-y-4">
        <RefreshCw size={32} className="text-brand animate-spin" />
        <p className="text-sm font-bold text-content-muted">{t('billing.loading_text')}</p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-8 max-w-6xl mx-auto w-full relative", isRtl ? "text-right" : "text-left")} dir={isRtl ? "rtl" : "ltr"}>
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 max-w-[92vw] bg-slate-900 text-white px-5 sm:px-6 py-3.5 rounded-2xl shadow-2xl text-xs sm:text-sm font-black flex items-center gap-3 border border-brand/30 animate-bounce">
          <Sparkles size={18} className="text-amber-400 shrink-0" />
          <span className="text-center">{toastMessage}</span>
        </div>
      )}

      {/* Pending Request Alert Banner */}
      {pendingRequests.length > 0 && (
        <div className="bg-amber-500/10 border-2 border-amber-500/30 p-5 rounded-3xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-amber-900 dark:text-amber-200 shadow-sm">
          <div className="flex items-center gap-3.5">
            <div className="p-3 bg-amber-500/20 text-amber-600 rounded-2xl shrink-0">
              <Clock size={24} className="animate-spin" />
            </div>
            <div>
              <h4 className="font-black text-sm sm:text-base">{t('billing.pending_request_title')}</h4>
              <p className="text-xs text-content-muted font-bold mt-0.5">
                {t('billing.pending_request_desc', {
                  planName: pendingRequests[0].plan_name,
                  date: new Date(pendingRequests[0].created_at).toLocaleDateString(isRtl ? 'ar-SA-u-nu-latn' : 'en-US')
                })}
              </p>
            </div>
          </div>
          <span className="px-4 py-1.5 bg-amber-500/20 border border-amber-500/40 rounded-full text-xs font-black text-amber-700 dark:text-amber-300 shrink-0">
            {t('billing.pending_request_status')}
          </span>
        </div>
      )}

      {/* Hero Active Plan Overview Banner */}
      <div className="bg-surface border-2 border-brand/20 p-6 sm:p-10 rounded-3xl sm:rounded-[2.5rem] shadow-xl shadow-brand/5 relative overflow-hidden transition-all">
        <div className="absolute top-0 right-0 w-96 h-96 bg-brand/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-brand/5 rounded-full blur-2xl pointer-events-none -ml-20 -mb-20" />

        <div className="relative z-10 flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-8">
          <div className="space-y-4 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 bg-brand/10 border border-brand/20 px-3.5 py-1 rounded-full text-xs font-black text-brand">
                <Zap size={14} className="fill-brand" />
                <span>{t('billing.current_plan_badge')}</span>
              </span>
              <span className={`px-3 py-1 rounded-full text-xs font-black border ${statusBadge.bg}`}>
                {statusBadge.label}
              </span>
            </div>

            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-content">
                {getPlanDisplayName()}
              </h2>
              <span className="text-brand text-2xl sm:text-3xl font-black font-mono dir-ltr">
                {tenant?.plan_id === 'basic' ? '599 SAR / ' + t('billing.plans.basic.period') : t('billing.plans.free.badge')}
              </span>
            </div>

            <p className="text-content-muted font-bold text-xs sm:text-sm leading-relaxed max-w-2xl">
              {tenant?.plan_id === 'basic'
                ? t('billing.current_plan_basic_desc')
                : t('billing.current_plan_free_desc')}
            </p>

            <div className="flex flex-wrap items-center gap-4 text-xs font-bold text-content-muted pt-3 border-t border-border/60">
              <span className="flex items-center gap-1.5 text-content font-bold">
                <ShieldCheck size={16} className="text-emerald-500" />
                {t('billing.store_id')} <span className="font-mono text-brand font-black">{tenantId.slice(0, 8).toUpperCase()}</span>
              </span>
              <span>•</span>
              <span>{t('billing.next_billing_date')} <span className="text-content font-black">{getNextBillingDate()}</span></span>
            </div>
          </div>

          {/* min-width only from sm: at 320-360px a hard 280px floor overflowed. */}
          <div className="bg-surface-muted/90 backdrop-blur-md p-5 sm:p-8 rounded-2xl sm:rounded-[2rem] border border-border text-center sm:min-w-[280px] w-full lg:w-auto shrink-0 flex flex-col justify-between shadow-sm space-y-4">
            <div>
              <p className="text-content-muted font-black uppercase tracking-wider text-[11px] mb-1">{t('billing.billing_status_title')}</p>
              <p className="text-2xl sm:text-3xl font-black text-content">{getNextBillingDate()}</p>
              <p className="text-[11px] text-emerald-600 font-bold mt-1">✓ {t('billing.vat_included_hint')}</p>
            </div>

            <button
              type="button"
              onClick={() => {
                setSelectedPlanId('basic');
                setShowUpgradeModal(true);
              }}
              className="w-full bg-brand hover:bg-brand-dark text-white px-6 py-4 rounded-2xl font-black transition-all hover:scale-[1.02] active:scale-95 shadow-lg shadow-brand/20 flex items-center justify-center gap-2 cursor-pointer text-sm"
            >
              <Sparkles size={18} />
              <span>{t('billing.upgrade_btn_action')}</span>
            </button>
          </div>
        </div>
      </div>

      {/* World-Class Comparative Pricing Section (الباقات المتاحة) */}
      <div className="space-y-6">
        <div className="text-center space-y-2 max-w-xl mx-auto">
          <span className="text-xs font-black text-brand bg-brand/10 px-4 py-1.5 rounded-full border border-brand/20 uppercase tracking-wider inline-block">
            {t('billing.pricing_eyebrow')}
          </span>
          <h3 className="text-2xl sm:text-3xl font-black text-content">{t('billing.pricing_title')}</h3>
          <p className="text-xs sm:text-sm text-content-muted font-bold">
            {t('billing.pricing_desc')}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
          {PLANS.map((plan) => {
            const isCurrent = tenant?.plan_id === plan.id || (!tenant?.plan_id && plan.id === 'free');
            return (
              <div
                key={plan.id}
                className={`rounded-3xl sm:rounded-[2.5rem] p-6 sm:p-8 flex flex-col justify-between relative transition-all duration-300 border-2 ${
                  plan.isPopular
                    ? 'bg-surface border-brand shadow-xl shadow-brand/10 ring-4 ring-brand/10'
                    : 'bg-surface border-border hover:border-brand/40 shadow-sm'
                }`}
              >
                {/* Popular / Best Choice Badge */}
                {plan.badge && (
                  <div className={cn("absolute -top-3.5", isRtl ? "right-8" : "left-8")}>
                    <span className={`px-4 py-1 rounded-full text-xs font-black shadow-md flex items-center gap-1.5 ${
                      plan.isPopular ? 'bg-brand text-white' : 'bg-surface-muted text-content border border-border'
                    }`}>
                      <Star size={12} className={plan.isPopular ? 'fill-white' : ''} />
                      {plan.badge}
                    </span>
                  </div>
                )}

                <div className="space-y-6">
                  {/* Plan Name & Price Header */}
                  <div className="border-b border-border pb-6 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xl sm:text-2xl font-black text-content">{plan.name}</h4>
                      {isCurrent && (
                        <span className="px-3 py-1 bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 rounded-full text-xs font-black">
                          {t('billing.card_current_plan')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-content-muted font-bold leading-relaxed">{plan.tagline}</p>

                    <div className="flex items-baseline gap-2 pt-2">
                      <span className="text-3xl sm:text-4xl font-black text-content font-mono dir-ltr">
                        {plan.price > 0 ? `${plan.price} SAR` : t('billing.price_free')}
                      </span>
                      <span className="text-xs font-bold text-content-muted">/ {plan.period}</span>
                    </div>
                  </div>

                  {/* Plan Features Checklist */}
                  <div className="space-y-3">
                    <p className="text-xs font-black text-content uppercase tracking-wider">{t('billing.card_included_features')}</p>
                    <ul className="space-y-2.5">
                      {plan.features.map((feat, idx) => (
                        <li key={idx} className="flex items-start gap-2.5 text-xs font-bold text-content leading-relaxed">
                          <CheckCircle2 size={16} className="text-emerald-500 shrink-0 mt-0.5" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Card Action CTA */}
                <div className="pt-8">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPlanId(plan.id);
                      setShowUpgradeModal(true);
                    }}
                    className={`w-full py-4 rounded-2xl font-black text-xs transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md ${
                      plan.isPopular
                        ? 'bg-brand hover:bg-brand-dark text-white shadow-brand/20 hover:scale-[1.02]'
                        : 'bg-surface-muted hover:bg-border text-content hover:scale-[1.02]'
                    }`}
                  >
                    <Sparkles size={16} />
                    <span>{isCurrent ? t('billing.card_renew_or_confirm') : t('billing.card_switch_to', { planName: plan.name })}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detailed Feature Comparison Matrix */}
      <div className="bg-surface rounded-3xl sm:rounded-[2.5rem] border border-border p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-border pb-4">
          <div>
            <h4 className="text-lg sm:text-xl font-black text-content flex items-center gap-2">
              <FileText size={22} className="text-brand" />
              <span>{t('billing.compare_table_title')}</span>
            </h4>
            <p className="text-xs text-content-muted font-bold mt-1">
              {t('billing.compare_table_subtitle')}
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          {/* min-width so the wrapper's overflow-x-auto actually engages: with a
              plain w-100% table the three columns were squashed to ~95px each on
              a phone and every feature name broke to one word per line. */}
          <table className="w-full min-w-[600px] text-right text-xs">
            <thead>
              <tr className="border-b border-border bg-surface-muted/50 text-content-muted font-black">
                <th className="p-2.5 sm:p-4 rounded-r-2xl">{t('billing.compare_col_feature')}</th>
                <th className="p-2.5 sm:p-4 text-center">{t('billing.compare_col_free')}</th>
                <th className="p-2.5 sm:p-4 text-center rounded-l-2xl text-brand font-black">{t('billing.compare_col_basic')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {COMPARISON_FEATURES.map((item, i) => (
                <tr key={i} className="hover:bg-surface-muted/30 transition-colors">
                  <td className="p-2.5 sm:p-4 font-bold text-content">{item.name}</td>
                  <td className="p-2.5 sm:p-4 text-center">
                    {typeof item.free === 'boolean' ? (
                      item.free ? (
                        <CheckCircle2 size={18} className="text-emerald-500 mx-auto" />
                      ) : (
                        <X size={18} className="text-rose-400 mx-auto" />
                      )
                    ) : (
                      <span className="font-bold text-amber-600 bg-amber-500/10 px-2.5 py-1 rounded-md">{item.free}</span>
                    )}
                  </td>
                  <td className="p-2.5 sm:p-4 text-center">
                    {typeof item.basic === 'boolean' ? (
                      item.basic ? (
                        <CheckCircle2 size={18} className="text-emerald-500 mx-auto" />
                      ) : (
                        <X size={18} className="text-rose-400 mx-auto" />
                      )
                    ) : (
                      <span className="font-black text-brand bg-brand/10 px-2.5 py-1 rounded-md">{item.basic}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Real Invoices & Payments History */}
      <div className="bg-surface p-6 sm:p-8 rounded-3xl sm:rounded-[2.5rem] border border-border shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row items-center sm:items-start justify-between pb-4 border-b border-border gap-4">
          <div>
            <h4 className="text-lg sm:text-xl font-black text-content flex items-center gap-2.5">
              <CreditCard size={22} className="text-brand" />
              <span>{t('billing.history_title')}</span>
            </h4>
            <p className="text-xs text-content-muted font-bold mt-1">
              {t('billing.history_subtitle')}
            </p>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={fetchRealBillingData}
              className="p-2.5 bg-surface-muted hover:bg-border rounded-xl text-content-muted hover:text-content transition-all cursor-pointer"
              title={t('billing.history_refresh_tip')}
            >
              <RefreshCw size={16} />
            </button>

            <button
              type="button"
              onClick={() => setShowUpgradeModal(true)}
              className="text-xs font-black text-white bg-brand hover:bg-brand-dark px-4 py-2.5 rounded-xl transition-all flex items-center gap-1.5 w-full sm:w-auto justify-center shadow-md shadow-brand/20 cursor-pointer"
            >
              <Plus size={16} />
              <span>{t('billing.history_send_proof')}</span>
            </button>
          </div>
        </div>

        {payments.length > 0 ? (
          <div className="space-y-3 w-full">
            {payments.map((inv) => (
              <div
                key={inv.id}
                className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center p-4 sm:p-5 bg-surface-muted/40 hover:bg-surface border-2 border-transparent hover:border-brand/20 hover:shadow-lg rounded-2xl transition-all group gap-4"
              >
                <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 text-center sm:text-right">
                  <div className="w-12 h-12 bg-emerald-500/10 text-emerald-600 rounded-2xl flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                    <CheckCircle2 size={24} />
                  </div>
                  <div>
                    <p className="font-black text-content text-sm sm:text-base">
                      {inv.notes || t('billing.history_notes_fallback')}
                    </p>
                    <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 text-xs text-content-muted font-bold mt-1">
                      <span>{new Date(inv.received_at || inv.created_at).toLocaleDateString('ar-SA-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                      <span>•</span>
                      <span className="font-mono dir-ltr">
                        #{inv.reference || inv.id.slice(0, 8).toUpperCase()}
                      </span>
                      <span>•</span>
                      <span className="bg-brand/10 text-brand px-2 py-0.5 rounded-md text-[10px] font-black">
                        {inv.method === 'card' ? t('billing.payment_method_card') : inv.method === 'bank_transfer' ? t('billing.payment_method_bank') : inv.method === 'cash' ? t('billing.payment_method_cash') : t('billing.payment_method_pos')}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-start gap-6">
                  <span className="text-xl font-black text-content">
                    <PriceDisplay amount={Number(inv.amount)} />
                  </span>
                  <div className="p-2 bg-emerald-500/10 text-emerald-700 rounded-xl text-xs font-black flex items-center gap-1">
                    <span>{t('billing.status_completed')}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 sm:p-12 text-center bg-surface-muted/30 rounded-2xl border-2 border-dashed border-border space-y-4">
            <div className="w-16 h-16 bg-surface-muted text-content-muted rounded-full flex items-center justify-center mx-auto">
              <AlertCircle size={28} />
            </div>
            <div className="space-y-1">
              <p className="text-base font-black text-content">{t('billing.history_empty_title')}</p>
              <p className="text-xs text-content-muted font-bold max-w-md mx-auto leading-relaxed">
                {t('billing.history_empty_desc')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowUpgradeModal(true)}
              className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 bg-brand text-white rounded-xl text-xs font-black hover:bg-brand-dark transition-all cursor-pointer shadow-md shadow-brand/20"
            >
              <Plus size={16} />
              <span>{t('billing.history_empty_btn')}</span>
            </button>
          </div>
        )}
      </div>

      {/* Upgrade / Renewal Modal (إرفاق إثبات الدفع) */}
      {showUpgradeModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-surface rounded-3xl p-6 sm:p-8 max-w-xl w-full border border-border shadow-2xl space-y-6 animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <h4 className="text-xl font-black text-content flex items-center gap-2">
                <Sparkles size={22} className="text-amber-500" />
                <span>{t('billing.modal_title')}</span>
              </h4>
              <button
                type="button"
                onClick={() => setShowUpgradeModal(false)}
                className="p-1 text-content-muted hover:text-content hover:bg-surface-muted rounded-full transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmitSubscriptionRequest} className="space-y-5">
              {/* Plan Selection */}
              <div className="space-y-2">
                <label className="text-xs font-black text-content uppercase tracking-wider block">
                  {t('billing.modal_choose_plan')}
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {PLANS.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => setSelectedPlanId(p.id)}
                      className={`p-4 rounded-2xl border-2 cursor-pointer transition-all space-y-2 relative overflow-hidden ${
                        selectedPlanId === p.id
                          ? 'border-brand bg-brand/5 shadow-md ring-2 ring-brand/20'
                          : 'border-border hover:border-brand/40 bg-surface'
                      }`}
                    >
                      {selectedPlanId === p.id && (
                        <div className="absolute top-2 left-2 text-brand">
                          <CheckCircle2 size={18} />
                        </div>
                      )}
                      <div className="flex items-center justify-between pl-5">
                        <span className="font-black text-content text-sm">{p.name}</span>
                        <span className="text-xs font-black text-brand dir-ltr font-mono">
                          {p.price > 0 ? `${p.price} SAR` : t('billing.price_free')}
                        </span>
                      </div>
                      <p className="text-[11px] text-content-muted font-bold leading-relaxed">{p.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Payment Method */}
              <div className="space-y-2">
                <label className="text-xs font-black text-content uppercase tracking-wider block">{t('billing.modal_payment_method')}</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: 'bank_transfer', label: t('billing.modal_method_bank') },
                    { id: 'card', label: t('billing.modal_method_card') },
                    { id: 'network', label: t('billing.modal_method_pos') },
                    { id: 'cash', label: t('billing.modal_method_cash') },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setPaymentMethod(m.id as any)}
                      className={`p-3 rounded-xl border text-xs font-black transition-all cursor-pointer ${
                        paymentMethod === m.id
                          ? 'border-brand bg-brand/10 text-brand shadow-sm'
                          : 'border-border text-content-muted bg-surface hover:bg-surface-muted'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Bank Transfer Details Box */}
              {paymentMethod === 'bank_transfer' && (
                <div className="p-4 bg-surface-muted rounded-2xl border border-border space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <p className="font-black text-content flex items-center gap-1.5">
                      <Building2 size={16} className="text-brand" />
                      <span>{t('billing.modal_bank_approved')}</span>
                    </p>
                    <button
                      type="button"
                      onClick={copyIbanToClipboard}
                      className="px-3 py-1 bg-brand/10 hover:bg-brand/20 text-brand rounded-lg text-[11px] font-black flex items-center gap-1 transition-all cursor-pointer"
                    >
                      {copiedIban ? <Check size={12} /> : <Copy size={12} />}
                      <span>{copiedIban ? t('billing.modal_iban_copied') : t('billing.modal_copy_iban')}</span>
                    </button>
                  </div>

                  <div className="space-y-1 text-content-muted font-bold text-[11px]">
                    <p>{t('billing.modal_bank_name_label')} <span className="text-content font-mono font-bold">{t('billing.modal_bank_name_val')}</span></p>
                    <p>{t('billing.modal_bank_holder_label')} <span className="text-content font-bold">{t('billing.modal_bank_holder_val')}</span></p>
                    <p>{t('billing.modal_iban_label')} <span className="text-brand font-mono dir-ltr select-all font-black">SA1280000456123456789012</span></p>
                  </div>
                </div>
              )}

              {/* Attach Proof File (إرفاق إثبات الدفع) */}
              <div className="space-y-2">
                <label className="text-xs font-black text-content uppercase tracking-wider block flex items-center justify-between">
                  <span>{t('billing.modal_proof_label')} <span className="text-rose-500">{t('billing.modal_proof_req')}</span></span>
                  <span className="text-[10px] text-content-muted font-bold">{t('billing.modal_proof_hint')}</span>
                </label>

                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/*,application/pdf"
                  onChange={handleFileChange}
                  className="hidden"
                />

                {!proofPreview ? (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full p-6 border-2 border-dashed border-brand/40 hover:border-brand bg-brand/5 rounded-2xl flex flex-col items-center justify-center space-y-2 transition-all cursor-pointer group"
                  >
                    <div className="w-12 h-12 bg-brand/10 text-brand rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                      <Upload size={24} />
                    </div>
                    <div className="text-center">
                      <p className="text-xs font-black text-content">{t('billing.modal_proof_btn')}</p>
                      <p className="text-[10px] text-content-muted font-bold mt-1">{t('billing.modal_proof_formats')}</p>
                    </div>
                  </button>
                ) : (
                  <div className="relative p-4 bg-surface-muted border-2 border-brand/30 rounded-2xl flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="w-12 h-12 rounded-xl border border-border overflow-hidden shrink-0 bg-surface flex items-center justify-center">
                        {proofFile?.type.includes('image') ? (
                          <img src={proofPreview} alt="Proof" className="w-full h-full object-cover" />
                        ) : (
                          <FileImage size={24} className="text-brand" />
                        )}
                      </div>
                      <div className="truncate">
                        <p className="text-xs font-black text-content truncate">{proofFile?.name || t('billing.modal_proof_fallback_filename')}</p>
                        <p className="text-[10px] text-emerald-600 font-bold mt-0.5">{t('billing.modal_proof_success')}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setProofFile(null);
                        setProofPreview(null);
                      }}
                      className="p-2 bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 rounded-xl transition-all cursor-pointer shrink-0"
                      title={t('billing.modal_proof_delete')}
                    >
                      <X size={18} />
                    </button>
                  </div>
                )}
              </div>

              {/* Reference No */}
              <div className="space-y-1.5">
                <label className="text-xs font-black text-content uppercase tracking-wider block">
                  {t('billing.modal_ref_label')}
                </label>
                <input
                  type="text"
                  value={referenceNo}
                  onChange={(e) => setReferenceNo(e.target.value)}
                  placeholder={t('billing.modal_ref_placeholder')}
                  className="w-full p-3.5 bg-surface-muted border border-border rounded-xl text-xs font-bold text-content focus:border-brand focus:outline-none"
                />
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <label className="text-xs font-black text-content uppercase tracking-wider block">
                  {t('billing.modal_notes_label')}
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('billing.modal_notes_placeholder')}
                  className="w-full p-3.5 bg-surface-muted border border-border rounded-xl text-xs font-bold text-content focus:border-brand focus:outline-none resize-none"
                />
              </div>

              <div className="p-4 bg-brand/10 border border-brand/20 rounded-2xl text-xs font-bold text-brand leading-relaxed">
                {t('billing.modal_submit_tip')}
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowUpgradeModal(false)}
                  className="flex-1 py-3.5 bg-surface-muted hover:bg-border text-content font-bold rounded-xl text-xs transition-all cursor-pointer"
                >
                  {t('billing.modal_cancel')}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-3.5 bg-brand hover:bg-brand-dark disabled:opacity-50 text-white font-black rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-brand/20 transition-all cursor-pointer"
                >
                  {submitting ? (
                    <RefreshCw size={16} className="animate-spin" />
                  ) : (
                    <>
                      <CheckCircle2 size={16} />
                      <span>{t('billing.modal_submit')}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
