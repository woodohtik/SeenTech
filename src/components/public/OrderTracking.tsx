/**
 * OrderTracking — صفحة تتبّع الطلب للعميل النهائي (عامة، مبرندة بعلامة «سين»)
 * --------------------------------------------------------------------------
 * growth loop: المحل يرسل رابطاً (واتساب) فيه رمز تتبّع، فيشوف عميل المحل حالة
 * طلبه بعلامة «سين» — وعي مجاني بالعلامة + التقاط بيانات.
 *
 * الأمان: لا تستعلم عن جدول orders مباشرة. تستدعي دالة Supabase آمنة
 * `get_public_order_tracking(p_token)` التي تُرجع الحقول المسموحة فقط
 * (رقم الطلب، الحالة، اسم المحل، تاريخ التسليم) عبر رمز عشوائي غير قابل للتخمين.
 * SQL هذه الدالة والـ RLS في PUBLIC_TRACKING_SPEC.md.
 *
 * التوصيل: أضِف مساراً عاماً (بلا مصادقة) مثل /track/:token يعرض هذا المكوّن.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase/client';
import { useDirection } from '../../lib/direction';

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

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error } = await supabase.rpc('get_public_order_tracking', { p_token: token });
        if (!alive) return;
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) setError(t('public_tracking.order_not_found'));
        else setOrder(row as PublicOrder);
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
  footer: { marginTop: 20, paddingTop: 14, borderTop: '1px solid #eee', color: '#aaa', fontSize: 12 },
};
