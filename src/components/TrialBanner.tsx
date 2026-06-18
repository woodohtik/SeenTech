/**
 * TrialBanner — شريط العدّاد التنازلي للتجربة المجانية (أعلى الداشبورد)
 * --------------------------------------------------------------------
 * مكوّن معزول. يعرض الأيام/الساعات المتبقية في التجربة + زر «اشترك الآن».
 * يتحوّل للون التحذير عند اقتراب الانتهاء. لا يظهر للحسابات المدفوعة.
 *
 * التوصيل (مثال أعلى Dashboard أو داخل Layout):
 *   <TrialBanner
 *     subscriptionStatus={tenant.subscription_status}   // 'trial' | 'active' | ...
 *     trialEndsAt={tenant.trial_ends_at}                 // ISO string
 *     onSubscribe={() => navigate('/subscribe')}
 *   />
 */

import { useEffect, useState } from 'react';

interface Props {
  subscriptionStatus?: string | null;
  trialEndsAt?: string | null;
  onSubscribe: () => void;
}

function remaining(endIso: string) {
  const ms = new Date(endIso).getTime() - Date.now();
  if (ms <= 0) return { ended: true, days: 0, hours: 0 };
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  return { ended: false, days, hours };
}

export default function TrialBanner({ subscriptionStatus, trialEndsAt, onSubscribe }: Props) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 60000); // تحديث كل دقيقة
    return () => clearInterval(t);
  }, []);

  if (subscriptionStatus !== 'trial' || !trialEndsAt) return null;
  const r = remaining(trialEndsAt);
  if (r.ended) return null; // القفل يتكفّل به TrialLockOverlay

  const urgent = r.days <= 2;
  const bg = urgent ? '#C0392B' : '#1F3A5F';
  const label =
    r.days >= 1 ? `باقي ${r.days} ${r.days === 1 ? 'يوم' : 'أيام'}${r.hours ? ` و${r.hours} ساعة` : ''} على انتهاء تجربتك`
                : `باقي ${r.hours} ساعة على انتهاء تجربتك`;

  return (
    <div dir="rtl" role="status" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14,
      flexWrap: 'wrap', background: bg, color: '#fff', padding: '9px 16px',
      fontFamily: 'inherit', fontSize: 14, fontWeight: 600,
    }}>
      <span aria-hidden>{urgent ? '⏳' : '✦'}</span>
      <span>{label}</span>
      <button onClick={onSubscribe} style={{
        background: '#fff', color: bg, border: 'none', borderRadius: 999,
        padding: '6px 18px', fontWeight: 800, fontSize: 13, cursor: 'pointer',
        fontFamily: 'inherit',
      }}>اشترك الآن</button>
    </div>
  );
}
