import React from 'react';
import { ShoppingBag } from 'lucide-react';
import { useDirection } from '../../lib/direction';
import { cn } from '../../lib/utils';
import { useVerticalConfig } from '../../hooks/useVerticalConfig';
import { getOrderStatusDisplay } from '../orderStatusConfig';
import { PriceDisplay } from '../PriceDisplay';
import DateTimeDisplay from '../DateTimeDisplay';

/**
 * The customer profile's order history (seen-merchant-trial-test-2026-11-26.md,
 * phase 2 item 4): the order's own number (#7, as on the order list and the
 * receipt -- not a slice of its id, "#C09E18") and its real stage ("ready for
 * pickup", not "in progress" for everything not delivered).
 */
export interface CustomerOrderRow {
  id: string;
  orderNumber?: number | string | null;
  status?: string | null;
  status_key?: string | null;
  orderDate?: string | null;
  totalAmount?: number | null;
}

export function orderLabel(order: Pick<CustomerOrderRow, 'id' | 'orderNumber'>): string {
  return order.orderNumber !== null && order.orderNumber !== undefined && String(order.orderNumber) !== ''
    ? `#${order.orderNumber}`
    : `#${order.id.slice(-6).toUpperCase()}`;
}

export function CustomerOrderHistory({ orders }: { orders: CustomerOrderRow[] }) {
  const { t, isRtl } = useDirection();
  const { workflowStages } = useVerticalConfig();
  if (orders.length === 0) {
    return (
      <div className="text-center py-8 bg-surface-muted rounded-xl main-640:rounded-2xl border-2 border-dashed border-border text-content-muted">
        <p className="text-sm font-bold">{t('customers.no_previous_orders')}</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {orders.map((order) => {
        const stage = getOrderStatusDisplay(String(order.status_key || order.status || ''), workflowStages);
        return (
          <div key={order.id} className="bg-surface p-4 rounded-xl main-640:rounded-2xl border border-border shadow-sm flex items-center justify-between hover:border-brand/20 transition-colors">
            <div className="flex items-center gap-2.5 main-640:gap-3">
              <div className="p-2 bg-surface-muted rounded-xl text-content-muted">
                <ShoppingBag size={16} aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-bold text-content"><bdi dir="ltr">{orderLabel(order)}</bdi></p>
                {order.orderDate && <DateTimeDisplay date={order.orderDate} showTime={true} size="xs" />}
              </div>
            </div>
            <div className={cn(isRtl ? 'text-left' : 'text-right')}>
              <p className="text-sm font-black text-brand"><PriceDisplay amount={Number(order.totalAmount || 0)} /></p>
              <span className={cn('text-sm font-bold px-2 py-0.5 rounded-full', stage.bgColor, stage.color)}>{t(stage.labelKey)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
