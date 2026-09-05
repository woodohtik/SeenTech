/**
 * OrderTracking — صفحة تتبّع الطلب للعميل النهائي (عامة، مبرندة بعلامة «سين»)
 * --------------------------------------------------------------------------
 * growth loop: المحل يرسل رابطاً (واتساب) فيه رمز تتبّع، فيشوف عميل المحل حالة
 * طلبه بعلامة «سين» — وعي مجاني بالعلامة + التقاط بيانات.
 *
 * الأمان: لا تستعلم عن جدول orders مباشرة، ولا تستدعي Supabase من المتصفح
 * إطلاقاً. تجلب البيانات عبر GET /api/public/order-tracking/:token في
 * server.ts (supabaseAdmin يختار الحقول المسموحة فقط: رقم الطلب، الحالة،
 * اسم المحل، تاريخ التسليم) عبر رمز عشوائي غير قابل للتخمين
 * (orders.tracking_token)، مع تحديد معدّل محاولات لكل IP. التفاصيل الكاملة
 * في PUBLIC_TRACKING_SPEC.md.
 *
 * التوصيل: مسار عام (بلا مصادقة) /track/:token في App.tsx يعرض هذا المكوّن.
 *
 * التصميم (seen-customer-app-design-upgrade-task.md): كل الألوان/الخط عبر
 * customerAppTheme.ts (توكِنز CSS واحدة، تدعم الوضع الداكن تلقائيًا بلا أي
 * JS هنا). لا تغيير على أي منطق وظيفي (جلب البيانات، حفظ التوكِن، تسجيل
 * push) في هذا الملف -- عرض فقط.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import {
  ClipboardCheck, Scissors, Shirt, PackageCheck, CheckCircle2, XCircle, Bell, CalendarClock,
} from 'lucide-react';
import { useDirection } from '../../lib/direction';
import { subscribeToOrderNotifications, type SubscribeResult } from '../../lib/pushNotifications';
import { addTrackingToken } from '../../lib/trackedOrders';
import { reRegisterPushForTrackedOrders } from '../../lib/pushNotificationsCapacitorCustomer';
import { apiUrl } from '../../lib/apiBase';
import { customerColors, customerFont, customerRadius } from '../../lib/customerAppTheme';

const NOTIFY_STORAGE_PREFIX = 'seen_tracking_notify_';

type PublicStatus =
  | 'measurements_taken' | 'cutting' | 'sewing' | 'embroidery'
  | 'ironing_packaging' | 'ready' | 'partial_delivered' | 'delivered' | 'cancelled';

interface PublicOrder {
  order_number: number;
  status: PublicStatus;
  shop_name: string;
  shop_logo_url?: string | null;
  delivery_date?: string | null;
}

// مراحل العرض للعميل (نطوي الحالات الداخلية في خطوات بسيطة)، مع أيقونة
// مميّزة لكل مرحلة بدل رقم مجرّد -- lucide-react (لا Phosphor، انظر تعليق
// customerAppTheme.ts لسبب هذا الاختيار).
const STEPS: { key: PublicStatus[]; labelKey: string; Icon: typeof ClipboardCheck }[] = [
  { key: ['measurements_taken'], labelKey: 'public_tracking.step_received', Icon: ClipboardCheck },
  { key: ['cutting'], labelKey: 'public_tracking.step_cutting', Icon: Scissors },
  { key: ['sewing', 'embroidery'], labelKey: 'public_tracking.step_sewing', Icon: Shirt },
  { key: ['ironing_packaging'], labelKey: 'public_tracking.step_preparing', Icon: PackageCheck },
  { key: ['ready', 'partial_delivered', 'delivered'], labelKey: 'common.status_ready', Icon: CheckCircle2 },
];

function activeStepIndex(status: PublicStatus): number {
  const i = STEPS.findIndex((s) => s.key.includes(status));
  return i === -1 ? 0 : i;
}

/** Calendar-day difference (not raw ms/86400) so a delivery later today never reads as "yesterday" due to time-of-day. */
function daysUntil(dateStr: string): number {
  const target = new Date(dateStr);
  const now = new Date();
  const targetMidnight = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((targetMidnight.getTime() - nowMidnight.getTime()) / 86400000);
}

function DeliverySkeleton() {
  return (
    <div style={styles.skeletonWrap}>
      <div className="seen-skeleton" style={{ ...styles.skeletonBlock, width: 64, height: 64, borderRadius: customerRadius.card, margin: '0 auto 12px' }} />
      <div className="seen-skeleton" style={{ ...styles.skeletonBlock, width: '60%', height: 20, margin: '0 auto 8px' }} />
      <div className="seen-skeleton" style={{ ...styles.skeletonBlock, width: '40%', height: 14, margin: '0 auto 24px' }} />
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
          <div className="seen-skeleton" style={{ ...styles.skeletonBlock, width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }} />
          <div className="seen-skeleton" style={{ ...styles.skeletonBlock, width: '50%', height: 14 }} />
        </div>
      ))}
    </div>
  );
}

export default function OrderTracking({ token }: { token: string }) {
  const { t } = useTranslation();
  const { dir, isRtl } = useDirection();
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notifyState, setNotifyState] = useState<SubscribeResult | 'idle' | 'loading'>(() => {
    try {
      return localStorage.getItem(NOTIFY_STORAGE_PREFIX + token) === 'granted' ? 'granted' : 'idle';
    } catch {
      return 'idle';
    }
  });

  // localStorage alone only remembers that the customer opted in once --
  // it can't know if they later revoked the browser permission. Re-check
  // the live permission on mount and fall back to the enable button rather
  // than keep showing a stale "you're subscribed" message the customer
  // can no longer act on from this page.
  useEffect(() => {
    if (notifyState !== 'granted') return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      setNotifyState('idle');
      try { localStorage.removeItem(NOTIFY_STORAGE_PREFIX + token); } catch { /* non-fatal */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleEnableNotifications = async () => {
    setNotifyState('loading');
    const result = await subscribeToOrderNotifications(token);
    setNotifyState(result);
    if (result === 'granted') {
      try { localStorage.setItem(NOTIFY_STORAGE_PREFIX + token, 'granted'); } catch { /* private mode etc -- non-fatal */ }
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(apiUrl(`/api/public/order-tracking/${token}`));
        if (!alive) return;
        if (response.status === 429) {
          setError(t('public_tracking.rate_limited'));
        } else if (!response.ok) {
          setError(t('public_tracking.order_not_found'));
        } else {
          const row = await response.json();
          setOrder(row as PublicOrder);
          // Inside the customer Capacitor app only (no-ops in a plain
          // browser tab) -- this is what makes an opened tracking link
          // show up in "My Orders" without any manual step.
          addTrackingToken(token).then((added) => {
            if (added) void reRegisterPushForTrackedOrders();
          });
        }
      } catch (e) {
        if (alive) setError(t('public_tracking.load_failed'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [token, t]);

  const activeIdx = order ? activeStepIndex(order.status) : -1;
  const isDelivered = order?.status === 'delivered';

  let deliveryLabel: string | null = null;
  if (order?.delivery_date && order.status !== 'cancelled') {
    const diff = daysUntil(order.delivery_date);
    deliveryLabel = diff <= 0
      ? t('public_tracking.delivery_today')
      : diff === 1
        ? t('public_tracking.delivery_tomorrow')
        : t('public_tracking.delivery_in_days', { count: diff });
  }

  return (
    <div dir={dir} style={styles.page}>
      <div style={styles.card}>
        <div style={styles.brand}>
          <span style={styles.brandMark}>{t('public_tracking.brand_mark')}</span>
          <span style={styles.brandSub}>{t('public_tracking.title')}</span>
        </div>

        {loading && <DeliverySkeleton />}
        {error && !loading && (
          <div style={styles.errorBox}>
            <XCircle size={32} color={customerColors.dangerText} />
            <p style={styles.error}>{error}</p>
          </div>
        )}

        {order && !loading && (
          <>
            {order.shop_logo_url ? (
              <img src={order.shop_logo_url} alt={order.shop_name} style={styles.logo} />
            ) : null}
            <h2 style={styles.shop}>{order.shop_name}</h2>
            <p style={styles.muted}>{t('public_tracking.order_number', { number: order.order_number })}</p>

            {order.status === 'cancelled' ? (
              <div style={styles.errorBox}>
                <XCircle size={32} color={customerColors.dangerText} />
                <p style={styles.error}>{t('public_tracking.order_cancelled')}</p>
              </div>
            ) : (
              <ol style={{ ...styles.steps, textAlign: isRtl ? 'right' : 'left' }}>
                {STEPS.map((s, idx) => {
                  const active = idx <= activeIdx;
                  const isCurrent = idx === activeIdx;
                  const celebrate = isCurrent && isDelivered && idx === STEPS.length - 1;
                  return (
                    <li key={s.labelKey} style={{ ...styles.step, ...(active ? styles.stepActive : {}) }}>
                      <span
                        className={celebrate ? 'seen-celebrate' : undefined}
                        style={{ ...styles.dot, ...(active ? styles.dotActive : {}) }}
                      >
                        <s.Icon size={18} strokeWidth={2.25} />
                      </span>
                      <span>{t(s.labelKey)}</span>
                    </li>
                  );
                })}
              </ol>
            )}

            {deliveryLabel && (
              <p style={styles.delivery}>
                <CalendarClock size={16} style={{ verticalAlign: 'text-bottom', marginInlineEnd: 6 }} />
                {deliveryLabel}
              </p>
            )}

            {order.status !== 'cancelled' && order.status !== 'delivered' && (
              <div style={styles.notifyBox}>
                {Capacitor.isNativePlatform() ? (
                  // Inside the customer Capacitor app, push is already
                  // registered automatically for every tracked order
                  // (pushNotificationsCapacitorCustomer.ts) -- the manual
                  // web-push button below is browser-only (it registers a
                  // service worker, which this native shell has no
                  // reliable use for) and would just be a confusing
                  // duplicate opt-in here.
                  <p style={styles.notifySuccess}><Bell size={14} style={{ verticalAlign: 'text-bottom', marginInlineEnd: 6 }} />{t('public_tracking.notify_native_auto')}</p>
                ) : notifyState === 'idle' && (
                  <button style={styles.notifyButton} onClick={handleEnableNotifications}>
                    <Bell size={16} />
                    {t('public_tracking.enable_notifications')}
                  </button>
                )}
                {notifyState === 'loading' && (
                  <p style={styles.muted}>{t('public_tracking.notify_loading')}</p>
                )}
                {notifyState === 'granted' && (
                  <p style={styles.notifySuccess}>{t('public_tracking.notify_granted')}</p>
                )}
                {notifyState === 'denied' && (
                  <p style={styles.muted}>{t('public_tracking.notify_denied')}</p>
                )}
                {(notifyState === 'unsupported' || notifyState === 'error') && (
                  <p style={styles.muted}>{t('public_tracking.notify_unavailable')}</p>
                )}
              </div>
            )}
          </>
        )}

        <div style={styles.footer}>{t('public_tracking.powered_by')}</div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: customerColors.bg, fontFamily: customerFont.body, padding: 16,
  },
  card: {
    width: '100%', maxWidth: 420, background: customerColors.surface, borderRadius: customerRadius.card,
    boxShadow: customerColors.shadow, padding: 24, textAlign: 'center',
  },
  brand: { display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 16 },
  brandMark: { fontFamily: customerFont.display, fontSize: 34, fontWeight: 700, color: customerColors.navy, lineHeight: 1 },
  brandSub: { fontSize: 13, color: customerColors.accentText, marginTop: 4 },
  logo: { width: 64, height: 64, objectFit: 'contain', borderRadius: customerRadius.sm, margin: '0 auto 8px' },
  shop: { fontFamily: customerFont.display, fontSize: 18, fontWeight: 700, color: customerColors.navy, margin: '4px 0' },
  muted: { color: customerColors.textMuted, fontSize: 14, margin: '4px 0' },
  errorBox: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, margin: '16px 0' },
  error: { color: customerColors.dangerText, fontSize: 15, margin: 0 },
  steps: { listStyle: 'none', padding: 0, margin: '20px 0', textAlign: 'right' },
  step: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', color: customerColors.textMuted, fontSize: 15 },
  stepActive: { color: customerColors.navy, fontWeight: 600 },
  dot: {
    width: 36, height: 36, borderRadius: '50%', background: customerColors.surfaceMuted, color: customerColors.textMuted,
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    transition: 'background-color 200ms ease, color 200ms ease',
  },
  dotActive: { background: customerColors.blue, color: '#fff' },
  delivery: { marginTop: 12, color: customerColors.navy, fontSize: 15, fontWeight: 600 },
  notifyBox: { marginTop: 20 },
  notifyButton: {
    width: '100%', padding: '12px 16px', borderRadius: customerRadius.sm, border: 'none',
    background: customerColors.blue, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  notifySuccess: { color: customerColors.successText, fontSize: 14, fontWeight: 600, margin: 0 },
  footer: { marginTop: 20, paddingTop: 14, borderTop: `1px solid ${customerColors.border}`, color: customerColors.textMuted, fontSize: 12 },
  skeletonWrap: { padding: '4px 0' },
  skeletonBlock: { borderRadius: 6 },
};
