import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CreditCard, LogOut, Mail, ArrowRight } from 'lucide-react';
import { localeOf } from '../lib/direction';
import { SUPPORT_EMAIL } from '../constants/support';
import PageSkeleton from './PageSkeleton';

const BillingSettings = React.lazy(() => import('./BillingSettings'));

type LockedTenant = {
  id: string;
  name?: string | null;
  owner_uid?: string | null;
  is_trial?: boolean | null;
  purge_at?: string | null;
};

/**
 * seen-readiness-fixes-task.md P5 (PLATFORM-02, PLATFORM-03): the screen a
 * shop sees once its trial or subscription has ended. The owner can renew
 * right here (the billing page, with the bank transfer and the proof) -- it
 * used to offer only an email to a personal address. A trial shop is told
 * when its data will be deleted, and that a payment proof under review
 * stops the deletion.
 */
export default function SubscriptionLockScreen({
  tenant, userId, userEmail, kind, dir, onLogout,
}: {
  tenant: LockedTenant | null;
  userId: string;
  userEmail?: string | null;
  kind: 'trial' | 'subscription';
  dir: 'rtl' | 'ltr';
  onLogout: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [renewing, setRenewing] = useState(false);
  const isOwner = !!tenant?.id && !!tenant.owner_uid && tenant.owner_uid === userId;
  const purgeAt = tenant?.is_trial && tenant.purge_at ? new Date(tenant.purge_at) : null;
  const day = (d: Date) => d.toLocaleDateString(localeOf(i18n.language), { dateStyle: 'long' });

  if (renewing && isOwner && tenant) {
    return (
      <div className="min-h-screen bg-surface-muted p-4 sm:p-8" dir={dir}>
        <div className="max-w-5xl mx-auto space-y-4">
          <button
            type="button"
            onClick={() => setRenewing(false)}
            className="flex items-center gap-2 text-sm font-black text-content hover:text-brand cursor-pointer"
          >
            <ArrowRight size={16} className="ltr:rotate-180" />
            {t('subscription.lock_back')}
          </button>
          <React.Suspense fallback={<PageSkeleton />}>
            <BillingSettings tenantId={tenant.id} />
          </React.Suspense>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 p-6 font-sans" dir={dir}>
      <div className="seen-enter-zoom max-w-xl w-full bg-slate-900 rounded-3xl shadow-2xl p-8 md:p-12 border border-red-500/15">
        <div className="w-20 h-20 bg-red-950/30 text-red-400 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-red-500/10">
          <AlertCircle size={40} aria-hidden="true" />
        </div>

        <h2 className="text-2xl md:text-3xl font-black text-white text-center mb-3 leading-tight">
          {kind === 'subscription' ? t('subscription.expired_account_title') : t('subscription.trial_expired_account_title')}
        </h2>
        <p className="text-slate-300 text-center leading-relaxed mb-6 text-sm md:text-base">
          {kind === 'subscription' ? t('subscription.expired_account_desc') : t('subscription.trial_expired_account_desc')}
        </p>

        {purgeAt && (
          <p role="alert" className="mb-6 rounded-2xl border border-amber-400/40 bg-amber-950/40 p-4 text-sm font-bold text-amber-100 leading-relaxed">
            {t('subscription.lock_purge_warning', { date: day(purgeAt) })}
          </p>
        )}

        <dl className="bg-slate-950/50 rounded-2xl p-5 border border-slate-800/65 mb-8 text-sm space-y-2.5">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-400">{t('subscription.lock_shop_label')}</dt>
            <dd className="font-bold text-white">{tenant?.name || t('subscription.workspace_fallback_name')}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-400">{t('subscription.account_email_label')}</dt>
            <dd className="font-mono text-white text-[12px] dir-ltr">{userEmail}</dd>
          </div>
        </dl>

        <div className="space-y-3">
          {isOwner ? (
            <button
              type="button"
              onClick={() => setRenewing(true)}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-3 cursor-pointer"
            >
              <CreditCard size={18} aria-hidden="true" />
              {t('subscription.lock_renew_now')}
            </button>
          ) : (
            <p className="text-center text-sm text-slate-300 font-bold">{t('subscription.lock_ask_owner')}</p>
          )}
          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(t('subscription.activation_email_subject'))}`}
            className="w-full border border-slate-700 hover:bg-slate-800 text-slate-100 py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2"
          >
            <Mail size={18} aria-hidden="true" />
            {t('subscription.lock_contact_support')}
          </a>
          <button
            type="button"
            onClick={onLogout}
            className="w-full text-slate-300 hover:text-white py-3 rounded-2xl font-bold flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogOut size={18} aria-hidden="true" />
            {t('common.logout_from_account')}
          </button>
        </div>
      </div>
    </div>
  );
}
