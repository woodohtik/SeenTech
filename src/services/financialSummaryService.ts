import { supabase } from '../lib/supabase/client';
import { decodeOrderRow } from '../utils/orderHistoryHelper';

export interface FinancialSummary {
  revenue: number;
  tax: number;
  orderCount: number;
  cogs: number;
  operatingExpenses: number;
  /** revenue - tax */
  netSalesExclVat: number;
  /** netSalesExclVat - cogs - operatingExpenses. The one net-profit figure every screen should show -- see the sprint 2 reports-engine task file for the divergent formulas this replaces (Reports.tsx had two of its own on the same screen). */
  netProfit: number;
}

/**
 * Riyadh (UTC+3, no DST) midnight for a calendar date, as a UTC ISO
 * instant -- for comparing against a timestamptz column with a real
 * timestamp comparison (not string prefix matching, which silently
 * drops rows whenever the stored value has a time component).
 */
function riyadhMidnightIso(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00+03:00`).toISOString();
}

/**
 * The one shared cost-of-goods-sold estimate this system has: a
 * weighted average of received purchase-order cost (all-time, not
 * date-filtered -- a stable baseline rather than one that swings with
 * whatever happened to be bought in the selected range), applied to
 * what was actually sold within [dateFrom, dateTo]. Same formula
 * Reports.tsx's own profitLossStats already used -- extracted here so
 * every caller gets the identical number instead of reimplementing it.
 */
async function computeCogs(
  tenantId: string,
  startIso: string,
  endIso: string,
  opts?: { branchId?: string; staffId?: string }
): Promise<number> {
  const [{ data: poItems, error: poError }, ordersQuery] = await Promise.all([
    supabase
      .from('purchase_order_items')
      .select('item_id, total, base_quantity, quantity, purchase_orders!inner(status, po_number)')
      .eq('tenant_id', tenantId)
      .eq('purchase_orders.status', 'received'),
    (() => {
      let q = supabase
        .from('orders')
        .select('id, status, order_date, branch_id, created_by')
        .eq('tenant_id', tenantId)
        .neq('status', 'cancelled')
        .gte('order_date', startIso)
        .lt('order_date', endIso);
      if (opts?.branchId) q = q.eq('branch_id', opts.branchId);
      if (opts?.staffId) q = q.eq('created_by', opts.staffId);
      return q;
    })(),
  ]);
  if (poError) throw poError;
  const { data: rangeOrders, error: ordersError } = await ordersQuery;
  if (ordersError) throw ordersError;

  const avgCostByItemId = new Map<string, number>();
  const totals = new Map<string, { cost: number; qty: number }>();
  (poItems || []).forEach((item: any) => {
    // RET-prefixed po_number marks a purchase return, not a purchase --
    // same convention Reports.tsx's own orderType derivation uses.
    if (item.purchase_orders?.po_number?.startsWith('RET')) return;
    if (!item.item_id) return;
    const entry = totals.get(item.item_id) || { cost: 0, qty: 0 };
    entry.cost += Number(item.total || 0);
    entry.qty += Number(item.base_quantity || item.quantity || 0);
    totals.set(item.item_id, entry);
  });
  totals.forEach((v, itemId) => { if (v.qty > 0) avgCostByItemId.set(itemId, v.cost / v.qty); });

  const orderIds = (rangeOrders || []).map((o: any) => o.id);
  if (orderIds.length === 0) return 0;

  const [{ data: orderItemsRows, error: oiError }, { data: notesRows, error: notesError }] = await Promise.all([
    supabase.from('order_items').select('order_id, type, item_id, fabric_id, quantity, consumed_meters').in('order_id', orderIds),
    supabase.from('orders').select('id, notes').in('id', orderIds),
  ]);
  if (oiError) throw oiError;
  if (notesError) throw notesError;

  const ordersWithItems = new Set((orderItemsRows || []).map((r: any) => r.order_id));
  let cogs = 0;

  (orderItemsRows || []).forEach((item: any) => {
    if (item.type === 'ready_made' && item.item_id) {
      cogs += (avgCostByItemId.get(item.item_id) || 0) * Number(item.quantity || 0);
    } else if (item.type === 'custom' && item.fabric_id) {
      cogs += (avgCostByItemId.get(item.fabric_id) || 0) * Number(item.consumed_meters || item.quantity || 0);
    }
  });

  // تفصيل orders created directly in "الطلبات" have no order_items row at
  // all -- their items live only in orders.notes (see taxInvoiceService.ts
  // / Reports.tsx's own commit for the same dual-source read).
  (notesRows || []).forEach((row: any) => {
    if (ordersWithItems.has(row.id)) return;
    const items = decodeOrderRow(row).items || [];
    items.forEach((item: any) => {
      if (item.fabricId) {
        cogs += (avgCostByItemId.get(item.fabricId) || 0) * Number(item.consumedMeters || item.quantity || 0);
      }
    });
  });

  return cogs;
}

export async function getFinancialSummary(
  tenantId: string,
  dateFrom: string,
  dateTo: string,
  opts?: { branchId?: string; staffId?: string }
): Promise<FinancialSummary> {
  const { data: rpcResult, error: rpcError } = await supabase.rpc('get_tenant_financial_summary', {
    p_tenant_id: tenantId,
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_branch_id: opts?.branchId ?? null,
    p_staff_id: opts?.staffId ?? null,
  });
  if (rpcError) throw rpcError;

  const revenue = Number(rpcResult.revenue) || 0;
  const tax = Number(rpcResult.tax) || 0;
  const orderCount = Number(rpcResult.order_count) || 0;
  const operatingExpenses = Number(rpcResult.operating_expenses) || 0;

  const startIso = riyadhMidnightIso(dateFrom);
  const dayAfter = new Date(riyadhMidnightIso(dateTo));
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
  const endIso = dayAfter.toISOString();

  const cogs = await computeCogs(tenantId, startIso, endIso, opts);
  const netSalesExclVat = revenue - tax;
  const netProfit = netSalesExclVat - cogs - operatingExpenses;

  return { revenue, tax, orderCount, cogs, operatingExpenses, netSalesExclVat, netProfit };
}

/** "Today" as a Riyadh calendar date (YYYY-MM-DD), not the browser's local date or UTC's. */
export function todayInRiyadh(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
}
