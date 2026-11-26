import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { localeOf } from '../lib/direction';

/** Days of grace after a paid subscription's end before the lock (as trial_lock_sweep). */
export const GRACE_DAYS = 3;
const DAY = 86_400_000;

export type ExpiryNotice =
  | { kind: 'subscription'; days: number }
  | { kind: 'trial'; days: number }
  | { kind: 'grace'; lockAt: Date };

type Lifecycle = {
  subscription_status?: string | null;
  subscription_end_date?: string | null;
  trial_ends_at?: string | null;
  is_trial?: boolean | null;
};

/**
 * seen-readiness-fixes-task.md P5 (PLATFORM-02): what to warn about. A paid
 * subscription: from 14 days before its end, then during the grace days. A
 * trial: from 7 days before its end. Nothing for a locked shop (the lock
 * screen speaks for itself) or one far from its end.
 */
export function expiryNotice(t: Lifecycle | null, now: Date = new Date()): ExpiryNotice | null {
  if (!t) return null;
  if (t.subscription_status === 'active' && !t.is_trial && t.subscription_end_date) {
    const end = new Date(t.subscription_end_date).getTime();
    if (end <= now.getTime()) {
      const lockAt = new Date(end + GRACE_DAYS * DAY);
      return lockAt.getTime() > now.getTime() ? { kind: 'grace', lockAt } : null;
    }
    const days = Math.ceil((end - now.getTime()) / DAY);
    return days <= 14 ? { kind: 'subscription', days } : null;
  }
  if (t.subscription_status === 'trial' && t.trial_ends_at) {
    const end = new Date(t.trial_ends_at).getTime();
    if (end <= now.getTime()) return null;
    const days = Math.ceil((end - now.getTime()) / DAY);
    return days <= 7 ? { kind: 'trial', days } : null;
  }
  return null;
}

export default function SubscriptionExpiryBanner({ tenantId }: { tenantId: string | null | undefined }) {
  const { t, i18n } = useTranslation();
  const [notice, setNotice] = useState<ExpiryNotice | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    let alive = true;
    supabase
      .from('tenants')
      .select('subscription_status, subscription_end_date, trial_ends_at, is_trial')
      .eq('id', tenantId)
      .maybeSingle()
      .then(({ data }) => { if (alive) setNotice(expiryNotice(data as Lifecycle | null)); });
    return () => { alive = false; };
  }, [tenantId]);

  if (!notice) return null;
  const text = notice.kind === 'grace'
    ? t('subscription.expiry_banner_grace', { date: notice.lockAt.toLocaleDateString(localeOf(i18n.language), { dateStyle: 'long' }) })
    : notice.kind === 'trial'
      ? t('subscription.expiry_banner_trial_days', { count: notice.days })
      : t('subscription.expiry_banner_days', { count: notice.days });
  const urgent = notice.kind === 'grace' || notice.days <= 1;

  return (
    <div
      role="status"
      // Slimmer, and in the page's flow (it scrolls away): it took ~60px above
      // every screen (seen-merchant-trial-test-2026-11-26.md, phase 4).
      className={`mx-4 md:mx-8 mt-3 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-1.5 text-sm font-bold ${urgent ? 'border-danger/50 bg-danger/10 text-danger' : 'border-warning/50 bg-warning/10 text-content'}`}
    >
      <AlertTriangle size={18} aria-hidden="true" className="shrink-0" />
      <span className="flex-1 min-w-0">{text}</span>
      <Link to="/settings?tab=billing" className="rounded-lg bg-brand px-3 py-1 text-sm font-black text-white">
        {t('subscription.expiry_banner_action')}
      </Link>
    </div>
  );
}
