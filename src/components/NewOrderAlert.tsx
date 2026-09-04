/**
 * NewOrderAlert — in-app "a new order just came in" banner + chime.
 * seen-companion-app-task_1.md Phase 3, point 1: layered on top of the
 * existing useRealtimeSync('orders', tenantId, ...) subscription (does not
 * replace or alter Orders.tsx's own status-editing UI), gated to staff who
 * can actually see orders. Mounted once in Layout.tsx so it fires no
 * matter which page the staff is on while the app is open.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'motion/react';
import { PackagePlus, X } from 'lucide-react';
import { useRealtimeSync } from '../hooks/useRealtimeSync';
import { playNewOrderChime } from '../utils/notificationSound';
import { useDirection } from '../lib/direction';

interface NewOrderEvent {
  id: string;
  title: string;
  message: string;
}

export default function NewOrderAlert({
  tenantId,
  enabled,
}: {
  tenantId?: string | null;
  /** Staff must have orders.view (or be owner/super_admin) -- computed by the caller, which already holds usePermissions(). */
  enabled: boolean;
}) {
  const { t } = useTranslation();
  const { isRtl } = useDirection();
  const navigate = useNavigate();
  const [events, setEvents] = useState<NewOrderEvent[]>([]);
  const dismissTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const dismiss = useCallback((id: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
    clearTimeout(dismissTimers.current[id]);
    delete dismissTimers.current[id];
  }, []);

  useEffect(() => () => {
    Object.values(dismissTimers.current).forEach(clearTimeout);
  }, []);

  // Same title/message copy as the existing notifications-bell system
  // (DashboardOwner.tsx, fed by inserts in Orders.tsx/CartSidebar.tsx) for
  // consistency -- this component listens to the orders table directly
  // rather than the notifications table so it also covers order creation
  // paths that don't (yet) write a notifications row.
  useRealtimeSync('orders', enabled ? (tenantId ?? undefined) : undefined, (payload) => {
    if (payload.eventType !== 'INSERT' || !payload.new) return;
    const row = payload.new as any;
    const event: NewOrderEvent = {
      id: row.id,
      title: t('orders.notification_new_order_title'),
      message: t('orders.notification_new_order_message', {
        number: row.order_number || '',
        customer: row.customer_name || t('pos.walk_in_customer'),
        amount: Number(row.total_amount || 0).toFixed(2),
      }),
    };

    setEvents((prev) => [event, ...prev].slice(0, 3));
    playNewOrderChime();

    dismissTimers.current[event.id] = setTimeout(() => dismiss(event.id), 8000);
  });

  if (!enabled || events.length === 0) return null;

  return (
    <div
      className="fixed top-4 inset-x-0 z-[9998] flex flex-col items-center gap-2 pointer-events-none px-4"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <AnimatePresence>
        {events.map((event) => (
          <motion.div
            key={event.id}
            initial={{ opacity: 0, y: -24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.96, transition: { duration: 0.15 } }}
            layout
            className="pointer-events-auto flex items-center gap-3 w-full max-w-sm bg-content text-white rounded-2xl shadow-2xl shadow-black/20 border border-white/10 py-3 px-4"
          >
            <div className="relative shrink-0">
              <div className="w-10 h-10 rounded-xl bg-success/20 flex items-center justify-center">
                <PackagePlus size={20} className="text-success" />
              </div>
              <span className="absolute -top-0.5 -end-0.5 w-2.5 h-2.5 rounded-full bg-success animate-pulse ring-2 ring-content" />
            </div>

            <button
              onClick={() => { navigate(`/orders?highlight=${event.id}`); dismiss(event.id); }}
              className="flex-1 text-start min-w-0"
            >
              <p className="text-[11px] font-black uppercase tracking-wider text-success">
                {event.title}
              </p>
              <p className="text-sm font-bold truncate">
                {event.message}
              </p>
            </button>

            <button
              onClick={() => dismiss(event.id)}
              className="shrink-0 p-1 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
              aria-label={t('common.close', 'إغلاق')}
            >
              <X size={16} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
