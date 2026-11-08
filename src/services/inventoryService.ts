import i18n from 'i18next';
import { supabase } from '../lib/supabase/client';
import { Order, Tenant, BranchInventory, InventoryItem, Staff } from '../types';

export const UNIT_CONVERSIONS: Record<string, number> = {
  'meter': 1,
  'yard': 0.9144,
  'roll': 22.86, // Average roll is 25 yards
  'bolt': 36.576, // Average bolt is 40 yards
  'piece': 1,
  'spool': 1,
  'box': 1
};

export function convertToMeters(quantity: number, unit: string): number {
  const rate = UNIT_CONVERSIONS[unit] || 1;
  return quantity * rate;
}

export interface AdjustmentLineResult {
  varianceQty: number;
  totalVarianceCost: number;
}

/** Physical-count reconciliation math (InventoryAdjustment.tsx) -- pulled
 * out so it's testable independent of the component. */
export function computeAdjustmentLine(
  bookQty: number,
  actualQty: number,
  unitCost: number
): AdjustmentLineResult {
  const varianceQty = actualQty - bookQty;
  return {
    varianceQty,
    totalVarianceCost: varianceQty * unitCost,
  };
}

export async function checkStockAvailability(
  items: any[],
  branchId: string,
  tenantId: string,
  strategy: 'centralized' | 'decentralized'
): Promise<{ available: boolean; missingItems: string[] }> {
  const missingItems: string[] = [];
  
  // If centralized, we look for the main warehouse
  let targetBranchId = branchId;
  if (strategy === 'centralized') {
    const { data: branches, error: branchError } = await supabase
      .from('branches')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('is_main', true)
      .maybeSingle();

    if (branchError || !branches) {
      return { available: false, missingItems: [i18n.t('inventory.main_warehouse_not_found')] };
    }
    targetBranchId = branches.id;
  }

  // Previously one round trip per item to resolve inventory_items.id by
  // name, plus one more per item to read its branch_inventory quantity --
  // an order with N lines meant 2N sequential queries. Batch both lookups
  // into two queries total and do the per-item comparison in JS.
  const fabricNames = [...new Set(items.map(item => item.fabric))];
  const { data: inventoryItems } = fabricNames.length
    ? await supabase
        .from('inventory_items')
        .select('id, name')
        .eq('tenant_id', tenantId)
        .in('name', fabricNames)
    : { data: [] as { id: string; name: string }[] };

  const itemIdByName = new Map((inventoryItems ?? []).map(row => [row.name, row.id]));
  const itemIds = [...new Set(itemIdByName.values())];

  const { data: branchInventory } = itemIds.length
    ? await supabase
        .from('branch_inventory')
        .select('item_id, quantity')
        .eq('branch_id', targetBranchId)
        .in('item_id', itemIds)
    : { data: [] as { item_id: string; quantity: number }[] };

  const quantityByItemId = new Map((branchInventory ?? []).map(row => [row.item_id, row.quantity]));

  for (const item of items) {
    const inventoryItemId = itemIdByName.get(item.fabric);
    if (!inventoryItemId) {
      missingItems.push(item.fabric);
      continue;
    }

    const deductionAmount = item.consumedMeters || convertToMeters(item.quantity, item.selectedUnit || 'meter');
    const availableQuantity = quantityByItemId.get(inventoryItemId);

    if (availableQuantity === undefined || availableQuantity < deductionAmount) {
      missingItems.push(item.fabric);
    }
  }

  return {
    available: missingItems.length === 0,
    missingItems
  };
}

export async function deductStock(
  order: Order,
  staff: Staff,
  strategy: 'centralized' | 'decentralized'
): Promise<void> {
  const tenantId = order.tenantId;

  // Determine target branch
  let targetBranchId = order.branchId || staff.branchId;
  if (strategy === 'centralized') {
    const { data: branches, error: branchError } = await supabase
      .from('branches')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('is_main', true)
      .maybeSingle();

    if (branchError || !branches) throw new Error(i18n.t('inventory.main_warehouse_not_found'));
    targetBranchId = branches.id;
  }

  if (!targetBranchId) throw new Error(i18n.t('inventory.branch_not_set_for_deduction'));

  // Previously one round trip per order line to resolve inventory_items.id
  // by fabric name -- batch that lookup into a single query. The
  // apply_stock_movement RPC below stays one call per item: each is a
  // discrete, idempotent ledger-write business event keyed on order+item,
  // not a read that can be batched away.
  const fabricNames = [...new Set(order.items.map(item => item.fabric))];
  const { data: inventoryItems } = fabricNames.length
    ? await supabase
        .from('inventory_items')
        .select('id, name')
        .eq('tenant_id', tenantId)
        .in('name', fabricNames)
    : { data: [] as { id: string; name: string }[] };
  const itemIdByName = new Map((inventoryItems ?? []).map(row => [row.name, row.id]));

  for (const item of order.items) {
    const inventoryItemId = itemIdByName.get(item.fabric);
    if (!inventoryItemId) continue;

    const deductionAmount = item.consumedMeters || convertToMeters(item.quantity, item.selectedUnit || 'meter');
    if (!deductionAmount) continue;

    /* --------------------------------------------------------------------
       Was: read quantity -> compute currentQty - deductionAmount -> write the
       absolute value, with no negative guard and no check that the update
       actually applied. Two concurrent sales of the same fabric each wrote
       their own absolute total, so one of them vanished; and the ledger row
       was inserted unconditionally, asserting a deduction that may never have
       happened.

       One transactional server call instead: relative delta, >= 0 enforced,
       ledger row derived from the real before/after values, idempotent on the
       order + item key so a retried checkout cannot double-deduct.
       -------------------------------------------------------------------- */
    const { error: moveError } = await supabase.rpc('apply_stock_movement', {
      p_operation_id: `order:${order.id}:item:${inventoryItemId}`,
      p_branch_id: targetBranchId,
      p_item_id: inventoryItemId,
      p_delta: -Math.abs(deductionAmount),
      p_type: 'deduction',
      p_reference_id: order.id,
      p_reference_type: 'order',
    });

    if (moveError) throw moveError;
  }
}

export async function adjustStock({
  branchId,
  itemId,
  quantity,
  reason,
  type,
  staffId,
  tenantId,
  operationId,
  referenceId,
  variantId,
}: {
  branchId: string;
  itemId: string;
  quantity: number;
  reason: string;
  type: string;
  staffId: string | null;
  tenantId: string;
  /**
   * Deterministic key so a retry cannot apply the same adjustment twice.
   * Required (security audit 2026-10-25, fingerprint
   * apply_stock_movement.caller_supplied_random_operation_id): an earlier
   * optional version silently fell back to crypto.randomUUID() when
   * omitted, generating a fresh id on every call -- including a retry of
   * the identical logical operation after a dropped response -- which
   * defeated apply_stock_movement's replay guard and let the stock delta
   * be silently re-applied. Callers must derive this from stable business
   * identifiers for the operation (e.g. `purchase-return:<returnId>:item:<itemId>`),
   * not generate a fresh value per call.
   */
  operationId: string;
  referenceId?: string | null;
  /** seen-ux-fixes-batch-task.md item 10 -- targets a specific product variant's stock row instead of the base item's. */
  variantId?: string | null;
}) {
  /* ----------------------------------------------------------------------
     Was: read -> `currentQty + quantity` -> absolute write, with no negative
     guard, no transaction, and a ledger failure that was merely
     `console.error`-ed while the caller was told the adjustment succeeded —
     stock moved, audit row lost.

     Now one transactional call: relative delta, >= 0 enforced in the
     database, ledger row derived from the actual before/after values, and
     `staff_id` resolved server-side from the verified token (the old code
     passed a raw string that broke the UUID foreign key).
     ---------------------------------------------------------------------- */
  let movementType = 'adjustment';
  if (type === 'out') movementType = 'sale';
  else if (quantity < 0) movementType = 'deduction';
  else if (quantity > 0) movementType = 'addition';

  const { error } = await supabase.rpc('apply_stock_movement', {
    p_operation_id: operationId,
    p_branch_id: branchId,
    p_item_id: itemId,
    p_delta: quantity,
    p_type: movementType,
    p_reference_id: referenceId ?? null,
    p_reference_type: reason || null,
    p_variant_id: variantId ?? null,
  });

  if (error) throw error;
  return { error: null };
}


