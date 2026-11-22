import i18n from 'i18next';
import { supabase } from '../lib/supabase/client';
import { isNetworkFailure, enqueueTailoringOrder, SALE_TIMEOUT_MS } from '../lib/offline/outbox';
import { checkConnectivityNow } from '../lib/offline/connectivity';
import { notifyNewOrderForStaff } from '../utils/orderNotify';
import { analytics, AnalyticsEvent } from './analyticsService';
import { checkStockAvailability } from './inventoryService';
import type { OrderHistory } from '../types';
import { lineToServerItem, type TailoringTotals } from '../utils/tailoringOrder';

/**
 * The one save path for a tailoring order. Every entry point (Orders, the
 * customer buttons, POS) goes through the shared form and ends here, and from
 * here in one call to create_tailoring_order: the server writes the order, its
 * lines and its history together, computes the totals and tax itself, and
 * allocates the order number. Nothing here inserts into `orders` directly.
 */

/** Fired on window when a payment is recorded on the open shift. */
export const SHIFT_CASH_CHANGED_EVENT = 'shift_cash_changed';

export interface TailoringOrderLine {
  garmentType: string;
  /** Fabric name as shown on the order; 'custom' for the customer's own cloth. */
  fabric: string;
  fabricId?: string;
  /** Whole pieces. */
  quantity: number;
  /** Price of one piece. */
  price: number;
  /** Total fabric for the line in meters; 0 for external cloth or when unknown. */
  consumedMeters: number;
  [extra: string]: unknown;
}

export interface CreateTailoringOrderInput {
  /**
   * Generated once per form session. It is the order's id and the server's
   * idempotency key, so a second click or a retried save returns the same order.
   */
  orderId: string;
  tenantId: string;
  staff: { id?: string; name?: string; branchId?: string } | null;
  authUserId?: string;
  customer: { id: string; name: string; measurements?: unknown } | null;
  inventoryStrategy: 'centralized' | 'decentralized';
  /** First workflow stage of the shop's activity. */
  statusKey: string;
  /** The same stage in the fixed order_status enum. */
  legacyStatus: string;
  items: TailoringOrderLine[];
  /** The browser's own figures: shown while offline only. The server recomputes them. */
  totals: TailoringTotals;
  paidAmount: number;
  paymentMethod: string;
  discountAmount: number;
  deliveryDate: string;
  assignedTailorId?: string;
  notes?: string;
  images?: string[];
  isTest?: boolean;
  /** Asked when the shop is short of a fabric; false cancels the save. */
  confirmShortage: (missingFabrics: string[]) => Promise<boolean>;
}

export type CreateTailoringOrderResult =
  | { status: 'cancelled' }
  | {
      status: 'created' | 'queued';
      order: Record<string, any>;
      /** A deposit was entered but there was no open shift to take it; the order is saved without it. */
      depositSkipped: boolean;
    };

export async function createTailoringOrder(input: CreateTailoringOrderInput): Promise<CreateTailoringOrderResult> {
  const { tenantId, staff, customer } = input;
  const paidAmount = Math.max(0, Number(input.paidAmount) || 0);
  const createdNote = i18n.t('orders.order_created_note');

  // Availability is advisory: it warns and lets the staff member decide. It is
  // itself a network call that reports its own failures as "not found", so a
  // fresh ping first keeps an offline save from showing a false shortage.
  if (await checkConnectivityNow()) {
    const { available, missingItems } = await checkStockAvailability(
      input.items,
      staff?.branchId || '',
      tenantId,
      input.inventoryStrategy
    );
    if (!available && !(await input.confirmShortage(missingItems))) {
      return { status: 'cancelled' };
    }
  }

  const payload = {
    p_operation_id: input.orderId,
    p_order: {
      customer_id: customer?.id || '',
      delivery_date: input.deliveryDate ? new Date(input.deliveryDate).toISOString() : new Date().toISOString(),
      assigned_tailor_id: input.assignedTailorId || '',
      notes: input.notes || '',
      images: input.images || [],
      is_test: !!input.isTest,
      status: input.legacyStatus,
      status_key: input.statusKey,
      payment_method: input.paymentMethod || 'cash',
      paid_amount: paidAmount,
      discount_amount: Math.max(0, Number(input.discountAmount) || 0),
      history_note: createdNote,
      deposit_note: i18n.t('orders.deposit_note', 'عربون عند إنشاء الطلب'),
    },
    p_items: input.items.map(lineToServerItem),
  };

  // What the order screens read alongside the row itself.
  const initialHistory: OrderHistory = {
    status: input.statusKey as OrderHistory['status'],
    updatedAt: new Date().toISOString(),
    updatedBy: staff?.name || i18n.t('common.owner'),
    updatedByUid: staff?.id || input.authUserId,
    notes: createdNote,
  };
  const lines = input.items.map((item) => ({ type: 'custom', ...item }));

  let queuedOffline = false;
  let depositSkipped = false;
  let order: Record<string, any>;

  try {
    // P3.3 / RELIABILITY-10: 15 seconds, then it is offline (the operation id makes the replay safe).
    const { data, error, status } = await supabase.rpc('create_tailoring_order', payload).abortSignal(AbortSignal.timeout(SALE_TIMEOUT_MS));
    if (error) throw Object.assign(error, { status });
    depositSkipped = Boolean(data?.deposit_skipped);
    // A deposit just landed on the open shift. The till figure in the sales
    // header listens for this; it cannot rely on a realtime event for it.
    if (paidAmount > 0 && !depositSkipped && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(SHIFT_CASH_CHANGED_EVENT));
    }
    order = { ...(data?.order || {}), kind: 'tailoring', items: lines, history: [initialHistory] };
  } catch (rpcErr) {
    if (!isNetworkFailure(rpcErr)) throw rpcErr;
    await enqueueTailoringOrder(input.orderId, payload);
    queuedOffline = true;
    // A local stand-in until the queue syncs: no order number yet, and the
    // browser's totals in place of the server's.
    order = {
      id: input.orderId,
      tenant_id: tenantId,
      kind: 'tailoring',
      customer_id: customer?.id || null,
      customer_name: customer?.name || i18n.t('orders.unknown_customer'),
      status: input.legacyStatus,
      status_key: input.statusKey,
      payment_method: payload.p_order.payment_method,
      total_amount: input.totals.total,
      tax_amount: input.totals.vat,
      tax_rate: input.totals.taxRate,
      discount_amount: input.totals.discount,
      paid_amount: paidAmount,
      remaining_amount: Math.round((input.totals.total - paidAmount) * 100) / 100,
      order_date: new Date().toISOString(),
      delivery_date: payload.p_order.delivery_date,
      notes: payload.p_order.notes,
      images: payload.p_order.images,
      assigned_tailor_id: input.assignedTailorId || null,
      is_test: payload.p_order.is_test,
      items: lines,
      history: [initialHistory],
    };
  }

  if (!queuedOffline) {
    void notifyNewOrderForStaff(order.id);
    try {
      await supabase.from('notifications').insert({
        tenant_id: tenantId,
        title: i18n.t('orders.notification_new_order_title'),
        message: i18n.t('orders.notification_new_order_message', {
          number: order.order_number || '',
          customer: order.customer_name || i18n.t('pos.walk_in_customer'),
          amount: order.total_amount || 0,
        }),
        type: 'order',
        status: 'unread',
        created_at: new Date().toISOString(),
        metadata: { order_id: order.id },
      });
    } catch (notifErr) {
      console.warn('Failed to insert order notification:', notifErr);
    }
  }

  analytics.track(AnalyticsEvent.ORDER_CREATED, {
    order_id: order.id,
    customer_id: customer?.id,
    total_amount: order.total_amount,
    items_count: input.items.length,
    payment_method: payload.p_order.payment_method,
  });
  if (customer?.measurements) {
    analytics.track(AnalyticsEvent.MEASUREMENTS_ADDED, {
      order_id: order.id,
      customer_id: customer.id,
      measurements: customer.measurements,
    });
  }

  return { status: queuedOffline ? 'queued' : 'created', order, depositSkipped };
}
