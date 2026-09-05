/**
 * MyOrdersHome — "طلباتي" home screen for the customer Android app
 * (seen-companion-app-android-task.md, Track B, Phase ب2).
 *
 * The customer has no account, so this reads the on-device list of
 * tracking_tokens the customer has previously opened (trackedOrders.ts)
 * and re-fetches each one's live status from the same public endpoint
 * OrderTracking.tsx already uses. No new server route, no new table.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useDirection } from '../../lib/direction';
import { getSavedTrackingTokens, addTrackingToken } from '../../lib/trackedOrders';
import { reRegisterPushForTrackedOrders } from '../../lib/pushNotificationsCapacitorCustomer';
import { apiUrl } from '../../lib/apiBase';

type PublicStatus =
  | 'measurements_taken' | 'cutting' | 'sewing' | 'embroidery'
  | 'ironing_packaging' | 'ready' | 'partial_delivered' | 'delivered' | 'cancelled';

interface TrackedOrder {
  token: string;
  order_number: number;
  status: PublicStatus;
  shop_name: string;
  shop_logo_url?: string | null;
}

const STATUS_LABEL_KEY: Record<PublicStatus, string> = {
  measurements_taken: 'public_tracking.step_received',
  cutting: 'public_tracking.step_cutting',
  sewing: 'public_tracking.step_sewing',
  embroidery: 'public_tracking.step_sewing',
  ironing_packaging: 'public_tracking.step_preparing',
  ready: 'common.status_ready',
  partial_delivered: 'common.status_ready',
  delivered: 'common.status_ready',
  cancelled: 'public_tracking.order_cancelled',
};

export default function MyOrdersHome() {
  const { t } = useTranslation();
  const { dir } = useDirection();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<TrackedOrder[] | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    const tokens = await getSavedTrackingTokens();
    const results = await Promise.all(
      tokens.map(async (token): Promise<TrackedOrder | null> => {
        try {
          const res = await fetch(apiUrl(`/api/public/order-tracking/${token}`));
          if (!res.ok) return null;
          const row = await res.json();
          return { token, ...row };
        } catch {
          return null;
        }
      })
    );
    setOrders(results.filter((o): o is TrackedOrder => o !== null));
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const handleAddManual = async () => {
    const token = manualToken.trim();
    if (!token) return;
    setManualBusy(true);
    setManualError(null);
    try {
      const res = await fetch(apiUrl(`/api/public/order-tracking/${token}`));
      if (!res.ok) {
        setManualError(t('my_orders.manual_not_found'));
        return;
      }
      const added = await addTrackingToken(token);
      if (added) void reRegisterPushForTrackedOrders();
      setManualToken('');
      setShowAddForm(false);
      await loadOrders();
    } catch {
      setManualError(t('my_orders.manual_not_found'));
    } finally {
      setManualBusy(false);
    }
  };

  return (
    <div dir={dir} style={styles.page}>
      <div style={styles.header}>
        <span style={styles.brandMark}>{t('public_tracking.brand_mark')}</span>
        <h1 style={styles.title}>{t('my_orders.title')}</h1>
      </div>

      <div style={styles.list}>
        {orders === null && <p style={styles.muted}>{t('my_orders.loading')}</p>}

        {orders !== null && orders.length === 0 && !showAddForm && (
          <div style={styles.emptyState}>
            <p style={styles.emptyTitle}>{t('my_orders.empty_title')}</p>
            <p style={styles.muted}>{t('my_orders.empty_hint')}</p>
          </div>
        )}

        {orders?.map((order) => (
          <button
            key={order.token}
            style={styles.card}
            onClick={() => navigate(`/track/${order.token}`)}
          >
            {order.shop_logo_url ? (
              <img src={order.shop_logo_url} alt={order.shop_name} style={styles.logo} />
            ) : (
              <div style={styles.logoPlaceholder}>{order.shop_name.charAt(0)}</div>
            )}
            <div style={styles.cardBody}>
              <span style={styles.shopName}>{order.shop_name}</span>
              <span style={styles.orderNumber}>
                {t('public_tracking.order_number', { number: order.order_number })}
              </span>
            </div>
            <span
              style={{
                ...styles.statusPill,
                ...(order.status === 'cancelled' ? styles.statusPillCancelled : {}),
              }}
            >
              {t(STATUS_LABEL_KEY[order.status])}
            </span>
          </button>
        ))}
      </div>

      {showAddForm ? (
        <div style={styles.addForm}>
          <input
            style={styles.input}
            value={manualToken}
            onChange={(e) => setManualToken(e.target.value)}
            placeholder={t('my_orders.manual_placeholder')}
            disabled={manualBusy}
          />
          {manualError && <p style={styles.error}>{manualError}</p>}
          <div style={styles.addFormActions}>
            <button style={styles.secondaryButton} onClick={() => { setShowAddForm(false); setManualError(null); }} disabled={manualBusy}>
              {t('my_orders.manual_cancel')}
            </button>
            <button style={styles.primaryButton} onClick={handleAddManual} disabled={manualBusy || !manualToken.trim()}>
              {t('my_orders.manual_add')}
            </button>
          </div>
        </div>
      ) : (
        <button style={styles.addButton} onClick={() => setShowAddForm(true)}>
          {t('my_orders.add_manual_button')}
        </button>
      )}
    </div>
  );
}

const NAVY = '#1F3A5F', BLUE = '#2E75B6';
const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#F4F6F9', fontFamily: 'Arial, sans-serif', padding: 16, paddingBottom: 32 },
  header: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 0 16px' },
  brandMark: { fontSize: 28, fontWeight: 700, color: NAVY, lineHeight: 1 },
  title: { fontSize: 16, fontWeight: 600, color: BLUE, margin: '6px 0 0' },
  list: { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 480, margin: '0 auto' },
  muted: { color: '#888', fontSize: 14, textAlign: 'center', margin: '4px 0' },
  error: { color: '#C0392B', fontSize: 13, margin: '8px 0 0' },
  emptyState: { textAlign: 'center', padding: '32px 16px', background: '#fff', borderRadius: 16, boxShadow: '0 4px 16px rgba(0,0,0,0.05)' },
  emptyTitle: { fontSize: 16, fontWeight: 700, color: NAVY, margin: '0 0 6px' },
  card: {
    display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'start',
    background: '#fff', border: 'none', borderRadius: 16, padding: 14,
    boxShadow: '0 4px 16px rgba(0,0,0,0.05)', cursor: 'pointer',
  },
  logo: { width: 44, height: 44, objectFit: 'contain', borderRadius: 10, flexShrink: 0 },
  logoPlaceholder: {
    width: 44, height: 44, borderRadius: 10, background: BLUE, color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, flexShrink: 0,
  },
  cardBody: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 },
  shopName: { fontSize: 15, fontWeight: 700, color: NAVY, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  orderNumber: { fontSize: 13, color: '#888', marginTop: 2 },
  statusPill: {
    fontSize: 12, fontWeight: 600, color: BLUE, background: '#EAF1FA',
    padding: '5px 10px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0,
  },
  statusPillCancelled: { color: '#C0392B', background: '#FBEAE8' },
  addButton: {
    display: 'block', maxWidth: 480, width: 'calc(100% - 0px)', margin: '20px auto 0',
    padding: '14px 16px', borderRadius: 14, border: `1px dashed ${BLUE}`,
    background: 'transparent', color: BLUE, fontSize: 14, fontWeight: 700, cursor: 'pointer',
  },
  addForm: {
    maxWidth: 480, margin: '20px auto 0', background: '#fff', borderRadius: 16,
    padding: 16, boxShadow: '0 4px 16px rgba(0,0,0,0.05)',
  },
  input: {
    width: '100%', padding: '12px 14px', borderRadius: 12, border: '1px solid #E0E4EA',
    fontSize: 14, boxSizing: 'border-box',
  },
  addFormActions: { display: 'flex', gap: 8, marginTop: 12 },
  primaryButton: {
    flex: 1, padding: '12px 16px', borderRadius: 12, border: 'none',
    background: BLUE, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
  },
  secondaryButton: {
    flex: 1, padding: '12px 16px', borderRadius: 12, border: '1px solid #E0E4EA',
    background: '#fff', color: '#888', fontSize: 14, fontWeight: 600, cursor: 'pointer',
  },
};
