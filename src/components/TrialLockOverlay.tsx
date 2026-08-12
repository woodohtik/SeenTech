/**
 * TrialLockOverlay — شاشة القفل بعد انتهاء التجربة المجانية
 * ---------------------------------------------------------
 * تظهر فوق التطبيق عندما subscription_status === 'locked'.
 * تمنع الاستخدام وتعرض زر الاشتراك + طمأنة بأن البيانات محفوظة X أيام قبل الحذف.
 *
 * التوصيل (مثال في Layout/App بعد المصادقة):
 *   {tenant.subscription_status === 'locked' && (
 *     <TrialLockOverlay purgeAt={tenant.purge_at} onSubscribe={() => navigate('/subscribe')} />
 *   )}
 */

import { useTranslation } from 'react-i18next';
import { useDirection } from '../lib/direction';

interface Props {
  purgeAt?: string | null;       // ISO — موعد حذف البيانات
  onSubscribe: () => void;
  onContactSales?: () => void;
}

function daysLeft(iso?: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return ms <= 0 ? 0 : Math.ceil(ms / 86400000);
}

export default function TrialLockOverlay({ purgeAt, onSubscribe, onContactSales }: Props) {
  const { t } = useTranslation();
  const { dir } = useDirection();
  const d = daysLeft(purgeAt);
  return (
    <div dir={dir} role="dialog" aria-modal="true" style={{
      position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(15,23,42,0.72)',
      backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: 20, fontFamily: 'inherit',
    }}>
      <div style={{
        maxWidth: 460, width: '100%', background: '#fff', borderRadius: 20,
        padding: 32, textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        <div style={{
          width: 72, height: 72, borderRadius: 20, margin: '0 auto 18px',
          background: '#FCF3E6', color: '#B9770E', display: 'flex',
          alignItems: 'center', justifyContent: 'center', fontSize: 34,
        }} aria-hidden>🔒</div>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0E2A42', margin: '0 0 8px' }}>
          {t('subscription.trial_ended_title')}
        </h2>
        <p style={{ color: '#555', fontSize: 15, lineHeight: 1.7, margin: '0 0 6px' }}>
          {t('subscription.trial_ended_desc')}
        </p>
        {d !== null && (
          <p style={{
            color: d <= 2 ? '#C0392B' : '#B9770E', fontWeight: 700, fontSize: 14,
            background: '#FCF3E6', borderRadius: 10, padding: '8px 12px', margin: '14px 0 18px',
          }}>
            {d > 0
              ? t('subscription.data_retained', { count: d })
              : t('subscription.data_purge_imminent')}
          </p>
        )}
        <button onClick={onSubscribe} style={{
          width: '100%', background: '#0BA06B', color: '#fff', border: 'none',
          borderRadius: 999, padding: '13px 0', fontWeight: 800, fontSize: 16,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>{t('subscription.subscribe_now')}</button>
        <button onClick={onContactSales} style={{
          width: '100%', background: 'transparent', color: '#0E2A42', border: 'none',
          marginTop: 10, fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
        }}>{t('subscription.have_question_contact_sales')}</button>
      </div>
    </div>
  );
}
