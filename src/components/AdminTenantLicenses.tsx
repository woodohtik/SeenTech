import React, { useState, useEffect } from 'react';
import { Crown, Clock, Search } from 'lucide-react';
import { motion } from 'motion/react';
import { supabase } from '../lib/supabase/client';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { useToast } from '../contexts/ToastContext';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import { IconInput } from './ui/IconInput';
import { SmartSelect } from './ui/SmartSelect';
import type { Tenant, Plan } from '../types';
import { getPlanName, getSubscriptionInfo } from '../utils/tenantSubscription';

/**
 * كانت هذه الشاشة تبويباً داخلياً بصفحة /admin/tailors (AdminTailors.tsx)
 * باسم "إدارة الاشتراكات" -- فُصلت لرابط مستقل بالقائمة الجانبية لأن اسمها
 * كان يتشابه لدرجة مربكة مع صفحة "طلبات الاشتراك" المنفصلة أصلاً
 * (/admin/subscriptions، SubscriptionRequestsAdminManager)، رغم أنها شيء
 * مختلف فعلياً (تراخيص/خطط كل تاجر الحالية، لا طلبات ترقية معلّقة).
 */
export default function AdminTenantLicenses() {
  const { t } = useTranslation();
  const { dbUser } = useAuth();
  const { confirm, promptText } = useConfirm();
  const { success: showSuccess, error: showError } = useToast();

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTenants = async () => {
      const { data } = await supabase.from('tenants').select('*');
      if (data) {
        setTenants(
          data.map(
            (d) =>
              ({
                ...d,
                customerId: d.customer_id,
                ownerEmail: d.owner_email,
                planId: d.plan_id,
                createdAt: d.created_at,
                trashedAt: d.trashed_at,
              }) as unknown as Tenant
          )
        );
      }
      setLoading(false);
    };
    const fetchPlans = async () => {
      const { data } = await supabase.from('plans').select('*');
      if (data) setPlans(data);
    };

    fetchTenants();
    fetchPlans();

    const tenantChannel = supabase
      .channel('tenants_changes_licenses')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tenants' }, () => fetchTenants())
      .subscribe();

    return () => {
      supabase.removeChannel(tenantChannel);
    };
  }, []);

  const visibleTenants = tenants.filter((tenant) => !tenant.trashedAt);

  const handleUpdateTenantPlan = async (tenantId: string, newPlanId: string) => {
    if (dbUser?.role !== 'super_admin') {
      showError(t('saas.unauthorized_action'));
      return;
    }
    // P6 (PLATFORM-10): the server activates the plan, with the reason and
    // the amount actually paid (0 for a gift) -- recorded in Seen's ledger
    // and the admin log. It used to be a direct update from this screen,
    // with no record, and it credited referral rewards for free grants.
    const newPlan = plans.find((p) => p.id === newPlanId);
    const isPaidPlan = Number(newPlan?.price || 0) > 0;
    const reason = await promptText({
      title: t('saas.tenants.activate_reason_title'),
      description: t('saas.tenants.activate_reason_desc'),
      placeholder: t('saas.tenants.activate_reason_placeholder'),
    });
    if (reason === null) return;
    if (!reason.trim()) {
      showError(t('saas.tenants.activate_reason_required'));
      return;
    }
    let amount = 0;
    if (isPaidPlan) {
      const typed = await promptText({
        title: t('saas.tenants.activate_amount_title'),
        description: t('saas.tenants.activate_amount_desc'),
        defaultValue: String(newPlan?.price ?? 0),
      });
      if (typed === null) return;
      amount = Number(typed);
      if (!Number.isFinite(amount) || amount < 0) {
        showError(t('saas.tenants.activate_amount_invalid'));
        return;
      }
    }

    try {
      const { data, error } = await supabase.rpc('admin_activate_plan', {
        p_tenant_id: tenantId,
        p_plan_id: newPlanId,
        p_amount: amount,
        p_reason: reason.trim(),
      });
      if (error) throw error;
      const endDate = (data as { subscription_end_date?: string | null } | null)?.subscription_end_date ?? null;
      setTenants((prev) =>
        prev.map((tenant) =>
          tenant.id === tenantId
            ? ({
                ...tenant,
                planId: newPlanId,
                ...(endDate ? { subscription_end_date: endDate, subscription_status: 'active', is_trial: false, locked_at: null, purge_at: null } : {}),
              } as unknown as Tenant)
            : tenant
        )
      );
      showSuccess(t('saas.tenants.plan_updated'));
    } catch (err) {
      console.warn('Error updating tenant plan:', err);
      showError(t('saas.tenants.plan_update_failed'));
    }
  };

  const handleExtendTrial = async (tenantId: string) => {
    if (dbUser?.role !== 'super_admin') {
      showError(t('saas.unauthorized_action'));
      return;
    }
    const ok = await confirm({ description: t('saas.tenants.confirm_extend_trial') });
    if (!ok) return;

    try {
      // P5 (PLATFORM-07): the server moves trial_ends_at, unlocks the shop and
      // logs it (this used to rewrite created_at, which extended nothing).
      const { data, error } = await supabase.rpc('admin_extend_trial', { p_tenant_id: tenantId, p_days: 14 });
      if (error) throw error;
      const trialEndsAt = (data as { trial_ends_at?: string } | null)?.trial_ends_at ?? null;
      setTenants((prev) => prev.map((tenant) => (tenant.id === tenantId
        ? ({ ...tenant, trial_ends_at: trialEndsAt, subscription_status: 'trial', is_trial: true, locked_at: null, purge_at: null } as unknown as Tenant)
        : tenant)));
      showSuccess(t('saas.tenants.trial_extended'));
    } catch (err) {
      console.warn('Error extending trial:', err);
      showError(t('saas.tenants.trial_extend_failed'));
    }
  };

  const filteredTenants = visibleTenants.filter(
    (tenant) =>
      tenant.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tenant.ownerEmail.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-10">
      <header>
        <h2 className="text-3xl font-black text-content flex items-center gap-3">
          <Crown className="text-brand" size={32} />
          {t('saas.tenants.licenses_title')}
        </h2>
        <p className="text-content-muted font-bold text-sm mt-1">{t('saas.tenants.licenses_subtitle')}</p>
      </header>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="p-8 border-b border-border bg-brand/5 flex flex-col main-640:flex-row justify-between items-start main-640:items-center gap-4">
          <div className="w-full main-640:w-80">
            <IconInput
              type="text"
              placeholder={t('saas.tenants.quick_search_placeholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              startIcon={Search}
              className="rounded-xl bg-surface-muted/60"
            />
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-content-muted font-bold">{t('blog_admin.loading', 'جاري التحميل...')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right min-w-[900px]">
              <thead>
                <tr className="bg-surface-muted/30 border-b border-border">
                  <th className="px-8 py-5 text-sm font-black text-content-muted uppercase text-center">{t('saas.tenants.col_subscriber')}</th>
                  <th className="px-8 py-5 text-sm font-black text-content-muted uppercase text-center">{t('saas.tenants.col_current_plan')}</th>
                  <th className="px-8 py-5 text-sm font-black text-content-muted uppercase text-center">{t('saas.tenants.col_remaining_period')}</th>
                  <th className="px-8 py-5 text-sm font-black text-content-muted uppercase text-center">{t('saas.tenants.col_change_plan')}</th>
                  <th className="px-8 py-5 text-sm font-black text-content-muted uppercase text-left">{t('shift_history.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredTenants.map((tenant) => {
                  const sub = getSubscriptionInfo(plans, tenant, {
                    trialBadge: t('billing.plans.free.badge'),
                    paidSubscription: t('saas.tenants.paid_subscription'),
                  });
                  return (
                    <tr key={tenant.id} className="hover:bg-surface-muted/20 transition-all">
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-brand/5 border border-brand/10 text-brand rounded-2xl flex items-center justify-center shrink-0">
                            <Crown size={18} />
                          </div>
                          <div>
                            <div className="font-black text-sm text-content">{tenant.name}</div>
                            <div className="text-sm font-bold text-content-muted">{tenant.ownerEmail}</div>
                          </div>
                        </div>
                      </td>

                      <td className="px-8 py-6 text-center">
                        <span
                          className={cn(
                            'px-3 py-1 rounded-full text-sm font-black uppercase',
                            tenant.planId === 'basic'
                              ? 'bg-info/10 text-info border border-info/20'
                              : tenant.planId === 'free'
                                ? 'bg-[var(--seen-success-bg)] text-success border border-success/20'
                                : 'bg-surface-muted text-content-muted shadow-sm'
                          )}
                        >
                          {getPlanName(plans, tenant.planId, t('saas.tenants.custom_plan'))}
                        </span>
                      </td>

                      <td className="px-8 py-6">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 bg-surface-muted h-2.5 rounded-full overflow-hidden border border-border max-w-[120px]">
                            <div
                              className={cn(
                                'h-full rounded-full transition-all duration-700',
                                sub.daysLeft < 7 ? 'bg-danger shadow-[0_0_8px_rgba(206,5,0,0.4)]' : 'bg-brand shadow-[0_0_8px_rgba(var(--brand-rgb),0.4)]'
                              )}
                              style={{ width: `${sub.progress}%` }}
                            />
                          </div>
                          <span className={cn('text-sm font-black min-w-[60px]', sub.daysLeft < 7 ? 'text-danger animate-pulse' : 'text-brand')}>
                            {t('saas.tenants.days_left', { days: sub.daysLeft })}
                          </span>
                        </div>
                      </td>

                      <td className="px-8 py-6 text-center">
                        <div className="w-48 mx-auto">
                          <SmartSelect
                            startIcon={Crown}
                            value={tenant.planId || 'free'}
                            onChange={(v) => handleUpdateTenantPlan(tenant.id, v)}
                            className="w-full rounded-xl text-sm"
                            options={[
                              { value: 'free', label: t('saas.tenants.plan_option_free') },
                              { value: 'basic', label: t('saas.tenants.plan_option_basic') },
                            ]}
                          />
                        </div>
                      </td>

                      <td className="px-8 py-6 text-left">
                        <button
                          onClick={() => handleExtendTrial(tenant.id)}
                          className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-brand text-white hover:bg-brand/90 rounded-2xl text-sm font-black shadow-lg shadow-brand/20 transition-all active:scale-95 group"
                        >
                          <Clock size={16} className="group-hover:rotate-12 transition-transform" />
                          {t('saas.tenants.extend_period')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
    </div>
  );
}
