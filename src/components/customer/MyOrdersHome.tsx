/**
 * MyOrdersHome — "طلباتي" home screen for the customer Android app
 * (seen-companion-app-android-task.md, Track B, Phase ب2).
 *
 * The customer has no account, so this reads the on-device list of
 * tracking_tokens the customer has previously opened (trackedOrders.ts)
 * and re-fetches each one's live status from the same public endpoint
 * OrderTracking.tsx already uses. No new server route, no new table.
 *
 * التصميم (seen-customer-app-design-upgrade-task.md): كل الألوان/الخط عبر
 * customerAppTheme.ts. منطق trackedOrders.ts/lookupOrderByInvoiceAndPhone/
 * pushNotificationsCapacitorCustomer.ts لم يتغيّر إطلاقاً هنا -- إضافة
 * سحب-للتحديث الوحيدة الجديدة سلوكيًا، وهي تستدعي loadOrders() الموجودة
 * فعلاً، لا منطقًا جديدًا.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Inbox, PackageSearch, Plus, RefreshCw } from 'lucide-react';
import { useDirection } from '../../lib/direction';
import { getSavedTrackingTokens, addTrackingToken } from '../../lib/trackedOrders';
import { reRegisterPushForTrackedOrders } from '../../lib/pushNotificationsCapacitorCustomer';
import { apiUrl } from '../../lib/apiBase';
import { lookupOrderByInvoiceAndPhone } from '../../lib/orderLookup';
import { customerColors, customerFont, customerRadius } from '../../lib/customerAppTheme';

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

/** Status-bar accent per card -- in progress (blue), ready/done (green), cancelled (red). */
function statusAccent(status: PublicStatus): string {
  if (status === 'cancelled') return customerColors.dangerText;
  if (status === 'ready' || status === 'partial_delivered' || status === 'delivered') return customerColors.successText;
  return customerColors.blue;
}

const PULL_THRESHOLD = 64;

function OrderCardSkeleton() {
  return (
    <div style={styles.card}>
      <div className="seen-skeleton" style={{ width: 44, height: 44, borderRadius: customerRadius.sm, flexShrink: 0 }} />
      <div style={styles.cardBody}>
        <div className="seen-skeleton" style={{ width: '70%', height: 15, borderRadius: 4, marginBottom: 6 }} />
        <div className="seen-skeleton" style={{ width: '40%', height: 12, borderRadius: 4 }} />
      </div>
    </div>
  );
}

export default function MyOrdersHome() {
  const { t } = useTranslation();
  const { dir } = useDirection();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<TrackedOrder[] | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [manualOrderNumber, setManualOrderNumber] = useState('');
  const [manualPhoneLast4, setManualPhoneLast4] = useState('');
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const touchStartY = useRef<number | null>(null);

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

  // Lightweight pull-to-refresh -- no library, since this is the only
  // gesture the screen needs. Only arms when the page itself is already
  // scrolled to the very top (window.scrollY, not a div's scrollTop --
  // this screen scrolls at the document level, no inner scroll container).
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = window.scrollY <= 0 ? e.touches[0].clientY : null;
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current === null || refreshing) return;
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta > 0) setPullDistance(Math.min(delta * 0.5, PULL_THRESHOLD * 1.5));
  };
  const handleTouchEnd = async () => {
    if (touchStartY.current === null) return;
    touchStartY.current = null;
    if (pullDistance >= PULL_THRESHOLD && !refreshing) {
      setRefreshing(true);
      await loadOrders();
      setRefreshing(false);
    }
    setPullDistance(0);
  };

  const handleAddManual = async () => {
    const orderNumber = manualOrderNumber.trim();
    const phoneLast4 = manualPhoneLast4.trim();
    if (!orderNumber || phoneLast4.length !== 4) return;
    setManualBusy(true);
    setManualError(null);
    try {
      const token = await lookupOrderByInvoiceAndPhone(orderNumber, phoneLast4);
      if (!token) {
        setManualError(t('my_orders.manual_not_found'));
        return;
      }
      const added = await addTrackingToken(token);
      if (added) void reRegisterPushForTrackedOrders();
      setManualOrderNumber('');
      setManualPhoneLast4('');
      setShowAddForm(false);
      await loadOrders();
    } catch {
      setManualError(t('my_orders.manual_not_found'));
    } finally {
      setManualBusy(false);
    }
  };

  const pullActive = pullDistance > 0 || refreshing;

  return (
    <div
      dir={dir}
      style={styles.page}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {pullActive && (
        <div style={{ ...styles.pullIndicator, height: refreshing ? 48 : Math.min(pullDistance, 48) }}>
          <RefreshCw
            size={20}
            color={customerColors.blue}
            className={refreshing || pullDistance >= PULL_THRESHOLD ? 'seen-spin' : undefined}
            style={{ opacity: refreshing ? 1 : Math.min(pullDistance / PULL_THRESHOLD, 1) }}
          />
        </div>
      )}

      <div style={styles.header}>
        <span style={styles.brandMark}>{t('public_tracking.brand_mark')}</span>
        <h1 style={styles.title}>{t('my_orders.title')}</h1>
      </div>

      <div style={styles.list}>
        {orders === null && [0, 1, 2].map((i) => <OrderCardSkeleton key={i} />)}

        {orders !== null && orders.length === 0 && (
          <div style={styles.emptyState}>
            <div style={styles.emptyIconWrap}><Inbox size={36} color={customerColors.blue} /></div>
            <p style={styles.emptyTitle}>{t('my_orders.empty_title')}</p>
            <p style={styles.muted}>{t('my_orders.empty_hint')}</p>
          </div>
        )}

        {orders?.map((order) => (
          <button
            key={order.token}
            style={{ ...styles.card, borderInlineStart: `4px solid ${statusAccent(order.status)}` }}
            onClick={() => navigate(`/track/${order.token}`)}
          >
            {order.shop_logo_url ? (
              <img src={order.shop_logo_url} alt={order.shop_name} style={styles.logo} />
            ) : (
              <div style={styles.logoPlaceholder}>
                <PackageSearch size={20} />
              </div>
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
                ...(order.status === 'ready' || order.status === 'partial_delivered' || order.status === 'delivered'
                  ? styles.statusPillSuccess : {}),
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
            value={manualOrderNumber}
            onChange={(e) => setManualOrderNumber(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder={t('my_orders.manual_order_number_placeholder')}
            inputMode="numeric"
            disabled={manualBusy}
          />
          <input
            style={{ ...styles.input, marginTop: 10 }}
            value={manualPhoneLast4}
            onChange={(e) => setManualPhoneLast4(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
            placeholder={t('my_orders.manual_phone_last4_placeholder')}
            inputMode="numeric"
            maxLength={4}
            disabled={manualBusy}
          />
          {manualError && <p style={styles.error}>{manualError}</p>}
          <div style={styles.addFormActions}>
            <button style={styles.secondaryButton} onClick={() => { setShowAddForm(false); setManualError(null); }} disabled={manualBusy}>
              {t('my_orders.manual_cancel')}
            </button>
            <button
              style={styles.primaryButton}
              onClick={handleAddManual}
              disabled={manualBusy || !manualOrderNumber.trim() || manualPhoneLast4.length !== 4}
            >
              {t('my_orders.manual_add')}
            </button>
          </div>
        </div>
      ) : (
        <button style={styles.addButton} onClick={() => setShowAddForm(true)}>
          <Plus size={16} />
          {t('my_orders.add_manual_button')}
        </button>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: customerColors.bg, fontFamily: customerFont.body, padding: 16, paddingBottom: 32 },
  pullIndicator: { display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', transition: 'height 150ms ease' },
  header: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 0 16px' },
  brandMark: { fontFamily: customerFont.display, fontSize: 28, fontWeight: 700, color: customerColors.navy, lineHeight: 1 },
  title: { fontSize: 16, fontWeight: 600, color: customerColors.accentText, margin: '6px 0 0' },
  list: { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 480, margin: '0 auto' },
  muted: { color: customerColors.textMuted, fontSize: 14, textAlign: 'center', margin: '4px 0' },
  error: { color: customerColors.dangerText, fontSize: 13, margin: '8px 0 0' },
  emptyState: {
    textAlign: 'center', padding: '36px 20px', background: customerColors.surface, borderRadius: customerRadius.card,
    boxShadow: customerColors.shadow, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
  },
  emptyIconWrap: {
    width: 64, height: 64, borderRadius: '50%', background: customerColors.surfaceMuted,
    display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  emptyTitle: { fontSize: 16, fontWeight: 700, color: customerColors.navy, margin: '0 0 2px' },
  card: {
    display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'start',
    background: customerColors.surface, border: 'none', borderRadius: customerRadius.card, padding: 14,
    boxShadow: customerColors.shadow, cursor: 'pointer',
  },
  logo: { width: 44, height: 44, objectFit: 'contain', borderRadius: customerRadius.sm, flexShrink: 0 },
  logoPlaceholder: {
    width: 44, height: 44, borderRadius: customerRadius.sm, background: customerColors.blue, color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  cardBody: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 },
  shopName: { fontSize: 15, fontWeight: 700, color: customerColors.navy, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  orderNumber: { fontSize: 13, color: customerColors.textMuted, marginTop: 2 },
  statusPill: {
    fontSize: 12, fontWeight: 600, color: customerColors.blue, background: customerColors.surfaceMuted,
    padding: '5px 10px', borderRadius: customerRadius.pill, whiteSpace: 'nowrap', flexShrink: 0,
  },
  statusPillSuccess: { color: customerColors.successText, background: customerColors.successBg },
  statusPillCancelled: { color: customerColors.dangerText, background: customerColors.dangerBg },
  addButton: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    maxWidth: 480, width: '100%', margin: '20px auto 0',
    padding: '14px 16px', borderRadius: customerRadius.sm, border: `1px dashed ${customerColors.blue}`,
    background: 'transparent', color: customerColors.blue, fontSize: 14, fontWeight: 700, cursor: 'pointer',
  },
  addForm: {
    maxWidth: 480, margin: '20px auto 0', background: customerColors.surface, borderRadius: customerRadius.card,
    padding: 16, boxShadow: customerColors.shadow,
  },
  input: {
    width: '100%', padding: '12px 14px', borderRadius: customerRadius.sm, border: `1px solid ${customerColors.border}`,
    fontSize: 14, boxSizing: 'border-box', background: customerColors.surface, color: customerColors.text,
  },
  addFormActions: { display: 'flex', gap: 8, marginTop: 12 },
  primaryButton: {
    flex: 1, padding: '12px 16px', borderRadius: customerRadius.sm, border: 'none',
    background: customerColors.blue, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
  },
  secondaryButton: {
    flex: 1, padding: '12px 16px', borderRadius: customerRadius.sm, border: `1px solid ${customerColors.border}`,
    background: customerColors.surface, color: customerColors.textMuted, fontSize: 14, fontWeight: 600, cursor: 'pointer',
  },
};
