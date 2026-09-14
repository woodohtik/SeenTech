import { supabase } from '../supabase/client';

/**
 * Reads order_items rows flagged by create_pos_sale's stock-conflict
 * handling (seen-offline-sync-architecture-task.md Phase 4) -- a sale that
 * succeeded but whose stock deduction lost a race against another device.
 * Lives server-side (unlike the outbox/ZATCA check), since a conflict can
 * only exist once a sale has actually reached the database.
 */
export interface StockConflictItem {
  id: string;
  orderId: string;
  name: string | null;
  stockConflictReason: string | null;
}

export async function getStockConflictCount(tenantId: string): Promise<number> {
  const { count } = await supabase
    .from('order_items')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('stock_conflict', true);
  return count || 0;
}

export async function getStockConflictItems(tenantId: string): Promise<StockConflictItem[]> {
  const { data } = await supabase
    .from('order_items')
    .select('id, order_id, name, stock_conflict_reason')
    .eq('tenant_id', tenantId)
    .eq('stock_conflict', true)
    .order('id', { ascending: false })
    .limit(50);
  return (data || []).map((row: any) => ({
    id: row.id,
    orderId: row.order_id,
    name: row.name,
    stockConflictReason: row.stock_conflict_reason,
  }));
}
