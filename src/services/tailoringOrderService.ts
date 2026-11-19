import i18n from 'i18next';
import { supabase } from '../lib/supabase/client';
import { isNetworkFailure, enqueueOrderCreate } from '../lib/offline/outbox';
import { checkConnectivityNow } from '../lib/offline/connectivity';
import { getOpenShiftId } from '../utils/shiftHelper';
import { generateOrderNumber } from '../lib/utils';
import { notifyNewOrderForStaff } from '../utils/orderNotify';
import { analytics, AnalyticsEvent } from './analyticsService';
import { checkStockAvailability } from './inventoryService';
import type { OrderHistory } from '../types';
import type { TailoringTotals } from '../utils/tailoringOrder';

/**
 * The one save path for a tailoring order. Every entry point (Orders, the
 * customer buttons, POS) goes through the shared form and ends here, so the
 * storage behind it can change in this function alone.
 */

const isUuid = (val: string | undefined | null) =>
  val ? /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val) : false;

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
  /** Generated once per form session, so a retried save cannot create a second order. */
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
  totals: TailoringTotals;
  paidAmount: number;
  paymentMethod: string;
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
  | { status: 'created' | 'queued'; order: Record<string, any> };

export async function createTailoringOrder(input: CreateTailoringOrderInput): Promise<CreateTailoringOrderResult> {
  const { tenantId, staff, customer, totals } = input;
  const staffId = staff?.id && isUuid(staff.id) ? staff.id : null;
  const paidAmount = Math.max(0, Number(input.paidAmount) || 0);

  const initialHistory: OrderHistory = {
    status: input.statusKey as OrderHistory['status'],
    updatedAt: new Date().toISOString(),
    updatedBy: staff?.name || i18n.t('common.owner'),
    updatedByUid: staff?.id || input.authUserId,
    notes: i18n.t('orders.order_created_note'),
  };

  const orderData: Record<string, any> = {
    id: input.orderId,
    tenant_id: tenantId,
    branch_id: staff?.branchId && isUuid(staff.branchId) ? staff.branchId : null,
    customer_id: isUuid(customer?.id) ? customer!.id : null,
    customer_name: customer?.name || i18n.t('orders.unknown_customer'),
    order_number: generateOrderNumber(),
    status: input.legacyStatus,
    status_key: input.statusKey,
    payment_method: input.paymentMethod || 'cash',
    total_amount: totals.total,
    paid_amount: paidAmount,
    tax_rate: totals.taxRate,
    tax_amount: totals.vat,
    discount_amount: totals.discount,
    order_date: new Date().toISOString(),
    delivery_date: input.deliveryDate ? new Date(input.deliveryDate).toISOString() : new Date().toISOString(),
    qr_code: `tailor-order-${Date.now()}`,
    images: input.images || [],
    notes: input.notes || '',
    created_by: staffId,
    is_test: !!input.isTest,
    assigned_tailor_id: isUuid(input.assignedTailorId) ? input.assignedTailorId : null,
    // items and history are not columns: the fetch interceptor's encodeOrderRow
    // packs them into `notes` on the way out.
    items: input.items,
    history: [initialHistory],
  };

  // The stock check is itself a network call, and it reports its own network
  // errors as "not found" instead of throwing. A fresh ping first keeps an
  // offline save from showing a misleading shortage prompt.
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

  let queuedOffline = false;
  let order: Record<string, any>;

  try {
    const { data, error } = await supabase.from('orders').insert(orderData).select().single();
    if (error) {
      // The id is ours: a unique violation means an earlier attempt of this
      // same save already landed. Return that order instead of failing.
      if ((error as any).code !== '23505') throw error;
      const { data: existing, error: readError } = await supabase
        .from('orders').select().eq('id', input.orderId).single();
      if (readError) throw readError;
      return { status: 'created', order: existing };
    }
    order = data;
  } catch (insertErr) {
    if (!isNetworkFailure(insertErr)) throw insertErr;
    await enqueueOrderCreate(input.orderId, orderData);
    queuedOffline = true;
    order = orderData;
  }

  if (!queuedOffline) {
    void notifyNewOrderForStaff(order.id);

    // A deposit taken at creation needs its own payments row, or the till
    // reconciliation never sees it (seen-status-fix-regressions-task.md item 5).
    if (paidAmount > 0) {
      try {
        const shiftId = await getOpenShiftId(tenantId, staff?.id);
        await supabase.from('payments').insert({
          tenant_id: tenantId,
          order_id: order.id,
          invoice_id: null,
          shift_id: shiftId,
          amount: paidAmount,
          method: orderData.payment_method,
          received_by: staffId,
          notes: i18n.t('orders.deposit_note', 'عربون عند إنشاء الطلب'),
        });
      } catch (depositErr) {
        console.warn('Failed to record order-creation deposit as a payments row:', depositErr);
      }
    }

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
    customer_id: orderData.customer_id,
    total_amount: orderData.total_amount,
    items_count: input.items.length,
    payment_method: orderData.payment_method,
  });
  if (customer?.measurements) {
    analytics.track(AnalyticsEvent.MEASUREMENTS_ADDED, {
      order_id: order.id,
      customer_id: orderData.customer_id,
      measurements: customer.measurements,
    });
  }

  return { status: queuedOffline ? 'queued' : 'created', order };
}
