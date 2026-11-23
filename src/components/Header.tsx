import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase/client';
import { resolveTaxSettings } from '../utils/taxSettings';
import { Tenant } from '../types';
import { useTranslation } from 'react-i18next';
import { Calendar } from 'lucide-react';
import { cn } from '../lib/utils';
import { PageHeader } from './ui/PageHeader';

interface HeaderProps {
  tenantId: string;
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}

export default function Header({ tenantId, title, subtitle, children }: HeaderProps) {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const { t } = useTranslation();
  const [trialDays, setTrialDays] = useState<number | null>(null);
  const [isTrialPlan, setIsTrialPlan] = useState<boolean>(true);

  useEffect(() => {
    if (tenant) {
      const now = new Date();
      const isTrial = tenant.planId === 'free' || (!tenant.planId && tenant.planId !== 'basic') || (typeof tenant.planId === 'string' && tenant.planId.includes('trial'));
      setIsTrialPlan(isTrial);

      if (tenant.subscription_end_date) {
        const subEndDate = new Date(tenant.subscription_end_date);
        const msLeft = subEndDate.getTime() - now.getTime();
        setTrialDays(Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24))));
      } else if (tenant.trial_ends_at) {
        const trialEndDate = new Date(tenant.trial_ends_at);
        const msLeft = trialEndDate.getTime() - now.getTime();
        setTrialDays(Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24))));
      } else if (tenant.createdAt) {
        const createdDate = new Date(tenant.createdAt);
        const diffTime = now.getTime() - createdDate.getTime();
        const diffDays = diffTime / (1000 * 60 * 60 * 24);
        const durationDays = isTrial ? 14 : 365;
        setTrialDays(Math.max(0, durationDays - Math.floor(diffDays)));
      }
    }
  }, [tenant]);

  useEffect(() => {
    if (!tenantId || tenantId === 'saas_management') return;
    const fetchTenantData = async () => {
      try {
        const { data, error } = await supabase
          .from('tenants')
          .select('*')
          .eq('id', tenantId)
          .maybeSingle();
        
        if (data && !error) {
          // One reading of the shop's tax settings (utils/taxSettings.ts).
          const resolvedTax = resolveTaxSettings(data);

          setTenant({
            ...data,
            vatNumber: data.vat_number || resolvedTax.trn,
            taxSettings: resolvedTax,
            logoUrl: data.logo_url,
            commercialRegister: data.commercial_register,
            legalName: data.legal_name,
            planId: data.plan_id,
            createdAt: data.created_at,
            updatedAt: data.updated_at
          } as Tenant);
        }
      } catch (error) {
        console.error('Error fetching tenant details:', error);
      }
    };
    fetchTenantData();
    window.addEventListener('tenant_settings_updated', fetchTenantData);
    return () => {
      window.removeEventListener('tenant_settings_updated', fetchTenantData);
    };
  }, [tenantId]);

  const badge = trialDays !== null ? (
    <span className={cn(
      "inline-flex shrink-0 select-none items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-sm font-bold",
      trialDays <= 3
        ? "border-danger/20 bg-[var(--seen-danger-bg)] text-danger motion-safe:animate-pulse"
        : "border-info/30 bg-surface text-info"
    )}>
      <Calendar size={14} strokeWidth={2.5} aria-hidden="true" />
      {trialDays === 0
        ? (isTrialPlan ? t('subscription.trial_ended') : t('subscription.subscription_ended'))
        : (isTrialPlan
            ? t('subscription.trial_days_left', { days: trialDays })
            : t('subscription.subscription_days_left', { days: trialDays }))}
    </span>
  ) : null;

  // The layout is PageHeader's (by the content's width); this file only reads the shop.
  return (
    <PageHeader
      title={title}
      subtitle={subtitle}
      badge={badge}
      logo={tenant?.logoUrl ? (
        <img
          src={tenant.logoUrl}
          alt={t('common.shop_logo')}
          className="h-14 w-14 shrink-0 rounded-[12px] border border-border object-cover main-720:h-16 main-720:w-16"
        />
      ) : null}
    >
      {children}
    </PageHeader>
  );
}

