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
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import { useDirection } from '../../lib/direction';
import { subscribeToOrderNotifications, type SubscribeResult } from '../../lib/pushNotifications';
import { addTrackingToken } from '../../lib/trackedOrders';
import { reRegisterPushForTrackedOrders } from '../../lib/pushNotificationsCapacitorCustomer';
import { apiUrl } from '../../lib/apiBase';

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

// مراحل العرض للعميل (نطوي الحالات الداخلية في خطوات بسيطة)
const STEPS: { key: PublicStatus[]; labelKey: string }[] = [
  { key: ['measurements_taken'], labelKey: 'public_tracking.step_received' },
  { key: ['cutting'], labelKey: 'public_tracking.step_cutting' },
  { key: ['sewing', 'embroidery'], labelKey: 'public_tracking.step_sewing' },
  { key: ['ironing_packaging'], labelKey: 'public_tracking.step_preparing' },
  { key: ['ready', 'partial_delivered', 'delivered'], labelKey: 'common.status_ready' },
];

function activeStepIndex(status: PublicStatus): number {
  const i = STEPS.findIndex((s) => s.key.includes(status));
  return i === -1 ? 0 : i;
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

  return (
    <div dir={dir} style={styles.page}>
      <div style={styles.card}>
        <div style={styles.brand}>
          <span style={styles.brandMark}>{t('public_tracking.brand_mark')}</span>
          <span style={styles.brandSub}>{t('public_tracking.title')}</span>
        </div>

        {loading && <p style={styles.muted}>{t('public_tracking.loading')}</p>}
        {error && !loading && <p style={styles.error}>{error}</p>}

        {order && !loading && (
          <>
            {order.shop_logo_url && (
              <img src={order.shop_logo_url} alt={order.shop_name} style={styles.logo} />
            )}
            <h2 style={styles.shop}>{order.shop_name}</h2>
            <p style={styles.muted}>{t('public_tracking.order_number', { number: order.order_number })}</p>

            {order.status === 'cancelled' ? (
              <p style={styles.error}>{t('public_tracking.order_cancelled')}</p>
            ) : (
              <ol style={{ ...styles.steps, textAlign: isRtl ? 'right' : 'left' }}>
                {STEPS.map((s, idx) => {
                  const active = idx <= activeStepIndex(order.status);
                  return (
                    <li key={s.labelKey} style={{ ...styles.step, ...(active ? styles.stepActive : {}) }}>
                      <span style={{ ...styles.dot, ...(active ? styles.dotActive : {}) }}>{active ? '✓' : idx + 1}</span>
                      <span>{t(s.labelKey)}</span>
                    </li>
                  );
                })}
              </ol>
            )}

            {order.delivery_date && order.status !== 'cancelled' && (
              <p style={styles.delivery}>{t('public_tracking.expected_delivery', { date: order.delivery_date })}</p>
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
                  <p style={styles.notifySuccess}>{t('public_tracking.notify_native_auto')}</p>
                ) : notifyState === 'idle' && (
                  <button style={styles.notifyButton} onClick={handleEnableNotifications}>
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

const NAVY = '#1F3A5F', BLUE = '#2E75B6';
const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F4F6F9', fontFamily: 'Arial, sans-serif', padding: 16 },
  card: { width: '100%', maxWidth: 420, background: '#fff', borderRadius: 16, boxShadow: '0 8px 30px rgba(0,0,0,0.08)', padding: 24, textAlign: 'center' },
  brand: { display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 16 },
  brandMark: { fontSize: 34, fontWeight: 700, color: NAVY, lineHeight: 1 },
  brandSub: { fontSize: 13, color: BLUE, marginTop: 4 },
  logo: { width: 64, height: 64, objectFit: 'contain', borderRadius: 12, margin: '0 auto 8px' },
  shop: { fontSize: 18, fontWeight: 700, color: NAVY, margin: '4px 0' },
  muted: { color: '#888', fontSize: 14, margin: '4px 0' },
  error: { color: '#C0392B', fontSize: 15, margin: '12px 0' },
  steps: { listStyle: 'none', padding: 0, margin: '20px 0', textAlign: 'right' },
  step: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', color: '#9aa', fontSize: 15 },
  stepActive: { color: NAVY, fontWeight: 600 },
  dot: { width: 28, height: 28, borderRadius: '50%', background: '#e6e9ef', color: '#9aa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 },
  dotActive: { background: BLUE, color: '#fff' },
  delivery: { marginTop: 12, color: NAVY, fontSize: 15, fontWeight: 600 },
  notifyBox: { marginTop: 20 },
  notifyButton: {
    width: '100%', padding: '12px 16px', borderRadius: 12, border: 'none',
    background: BLUE, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
  },
  notifySuccess: { color: '#1E8E5A', fontSize: 14, fontWeight: 600, margin: 0 },
  footer: { marginTop: 20, paddingTop: 14, borderTop: '1px solid #eee', color: '#aaa', fontSize: 12 },
};
