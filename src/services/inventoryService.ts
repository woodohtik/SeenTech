import i18n from 'i18next';
import { supabase } from '../lib/supabase/client';

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

  // Lines on the customer's own cloth take nothing from stock.
  const stockLines = items.filter(item => item.fabric && item.fabric !== 'custom' && item.fabricId !== 'custom');

  // Two queries for the whole order: resolve the fabrics (by id when the line
  // carries one, by name for older callers), then read their branch stock.
  const fabricIds = [...new Set(stockLines.map(item => item.fabricId).filter(Boolean))] as string[];
  const fabricNames = [...new Set(stockLines.filter(item => !item.fabricId).map(item => item.fabric))];
  const { data: inventoryItems } = fabricNames.length
    ? await supabase
        .from('inventory_items')
        .select('id, name')
        .eq('tenant_id', tenantId)
        .in('name', fabricNames)
    : { data: [] as { id: string; name: string }[] };

  const itemIdByName = new Map((inventoryItems ?? []).map(row => [row.name, row.id]));
  const itemIds = [...new Set([...fabricIds, ...itemIdByName.values()])];

  const { data: branchInventory } = itemIds.length
    ? await supabase
        .from('branch_inventory')
        .select('item_id, quantity')
        .eq('branch_id', targetBranchId)
        .in('item_id', itemIds)
    : { data: [] as { item_id: string; quantity: number }[] };

  const quantityByItemId = new Map((branchInventory ?? []).map(row => [row.item_id, Number(row.quantity) || 0]));

  // Meters needed per fabric: two lines on the same cloth add up.
  const neededByItemId = new Map<string, { meters: number; label: string }>();
  for (const item of stockLines) {
    const inventoryItemId = item.fabricId || itemIdByName.get(item.fabric);
    if (!inventoryItemId) {
      if (!missingItems.includes(item.fabric)) missingItems.push(item.fabric);
      continue;
    }
    // A line counts pieces; the fabric it needs is its own figure in meters.
    // Without one there is nothing to compare.
    const meters = Number(item.consumedMeters) || 0;
    const entry = neededByItemId.get(inventoryItemId) ?? { meters: 0, label: item.fabric };
    entry.meters += meters;
    neededByItemId.set(inventoryItemId, entry);
  }

  for (const [inventoryItemId, needed] of neededByItemId) {
    if (!needed.meters) continue;
    const availableQuantity = quantityByItemId.get(inventoryItemId);
    if (availableQuantity === undefined || availableQuantity < needed.meters) {
      missingItems.push(needed.label);
    }
  }

  return {
    available: missingItems.length === 0,
    missingItems
  };
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


