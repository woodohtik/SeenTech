import { supabase } from '../supabase/client';
import { offlineDb, type CachedInventoryItem, type CachedBranchStock, type CachedCustomer, type CachedOrder } from './db';
import type { InventoryItem, Customer, Order } from '../../types';

/**
 * Pulls fresh reads into the local cache while online, so POS.tsx has
 * something to fall back on once Phase 3 wires up actual offline detection.
 * Call these periodically (e.g. alongside POS.tsx's existing live fetch +
 * realtime subscriptions) -- they're plain overwrite-by-tenant refreshes,
 * not incremental syncs, since the datasets involved (one tenant's catalog
 * and customer list) are small enough that a full replace is simpler and
 * cheaper to reason about than diffing.
 */

export async function refreshInventoryCache(
  tenantId: string,
  mapInventoryItem: (row: any) => InventoryItem
): Promise<void> {
  const { data, error } = await supabase
    .from('inventory_items')
    .select('*')
    .eq('tenant_id', tenantId);
  if (error || !data) return;

  const now = Date.now();
  const rows: CachedInventoryItem[] = data.map(row => ({ ...mapInventoryItem(row), cachedAt: now }));

  await offlineDb.transaction('rw', offlineDb.cachedInventoryItems, async () => {
    await offlineDb.cachedInventoryItems.where('tenantId').equals(tenantId).delete();
    await offlineDb.cachedInventoryItems.bulkPut(rows);
  });
}

export async function refreshBranchStockCache(tenantId: string): Promise<void> {
  const { data, error } = await supabase
    .from('branch_inventory')
    .select('*')
    .eq('tenant_id', tenantId);
  if (error || !data) return;

  const now = Date.now();
  const rows: CachedBranchStock[] = data.map((row: any) => ({
    key: `${row.branch_id}:${row.item_id}`,
    branchId: row.branch_id,
    itemId: row.item_id,
    tenantId,
    quantity: Number(row.quantity || 0),
    cachedAt: now,
  }));

  await offlineDb.transaction('rw', offlineDb.cachedBranchStock, async () => {
    await offlineDb.cachedBranchStock.where('tenantId').equals(tenantId).delete();
    await offlineDb.cachedBranchStock.bulkPut(rows);
  });
}

export async function refreshCustomersCache(
  tenantId: string,
  mapCustomer: (row: any) => Customer
): Promise<void> {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('tenant_id', tenantId);
  if (error || !data) return;

  const now = Date.now();
  const rows: CachedCustomer[] = data.map(row => ({ ...mapCustomer(row), cachedAt: now }));

  await offlineDb.transaction('rw', offlineDb.cachedCustomers, async () => {
    await offlineDb.cachedCustomers.where('tenantId').equals(tenantId).delete();
    await offlineDb.cachedCustomers.bulkPut(rows);
  });
}

export async function getCachedInventory(tenantId: string): Promise<CachedInventoryItem[]> {
  return offlineDb.cachedInventoryItems.where('tenantId').equals(tenantId).toArray();
}

export async function getCachedBranchStock(tenantId: string, branchId: string): Promise<Record<string, number>> {
  const rows = await offlineDb.cachedBranchStock
    .where('tenantId').equals(tenantId)
    .and(row => row.branchId === branchId)
    .toArray();
  const map: Record<string, number> = {};
  for (const row of rows) map[row.itemId] = row.quantity;
  return map;
}

export async function getCachedCustomers(tenantId: string): Promise<CachedCustomer[]> {
  return offlineDb.cachedCustomers.where('tenantId').equals(tenantId).toArray();
}

/**
 * Unlike refreshInventoryCache/refreshCustomersCache/refreshBranchStockCache
 * above, this takes the already-fetched-and-mapped Order[] directly instead
 * of querying Supabase itself: Orders.tsx's own mapping (decodeOrderRow)
 * handles JSON-encoded items/history and is non-trivial enough that
 * re-implementing it here risked drifting out of sync with the real one.
 */
export async function refreshOrdersCache(tenantId: string, orders: Order[]): Promise<void> {
  const now = Date.now();
  const rows: CachedOrder[] = orders.map(order => ({ ...order, cachedAt: now }));

  await offlineDb.transaction('rw', offlineDb.cachedOrders, async () => {
    await offlineDb.cachedOrders.where('tenantId').equals(tenantId).delete();
    await offlineDb.cachedOrders.bulkPut(rows);
  });
}

export async function getCachedOrders(tenantId: string): Promise<CachedOrder[]> {
  return offlineDb.cachedOrders.where('tenantId').equals(tenantId).toArray();
}
