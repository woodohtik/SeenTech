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

  for (const item of items) {
    const { data: inventoryItem, error: invError } = await supabase
      .from('inventory_items')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('name', item.fabric)
      .maybeSingle();
    
    if (invError || !inventoryItem) {
      missingItems.push(item.fabric);
      continue;
    }

    const { data: branchInv, error: branchInvError } = await supabase
      .from('branch_inventory')
      .select('quantity')
      .eq('branch_id', targetBranchId)
      .eq('item_id', inventoryItem.id)
      .maybeSingle();

    const deductionAmount = item.consumedMeters || convertToMeters(item.quantity, item.selectedUnit || 'meter');

    if (branchInvError || !branchInv || branchInv.quantity < deductionAmount) {
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

  for (const item of order.items) {
    const { data: inventoryItem, error: invError } = await supabase
      .from('inventory_items')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('name', item.fabric)
      .maybeSingle();
    
    if (invError || !inventoryItem) continue;

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
      p_operation_id: `order:${order.id}:item:${inventoryItem.id}`,
      p_branch_id: targetBranchId,
      p_item_id: inventoryItem.id,
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
}: {
  branchId: string;
  itemId: string;
  quantity: number;
  reason: string;
  type: string;
  staffId: string | null;
  tenantId: string;
  /** Deterministic key so a retry cannot apply the same adjustment twice. */
  operationId?: string;
  referenceId?: string | null;
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

  const opId =
    operationId ||
    (globalThis.crypto?.randomUUID?.() as string | undefined) ||
    `adjust:${branchId}:${itemId}:${Date.now()}`;

  const { error } = await supabase.rpc('apply_stock_movement', {
    p_operation_id: opId,
    p_branch_id: branchId,
    p_item_id: itemId,
    p_delta: quantity,
    p_type: movementType,
    p_reference_id: referenceId ?? null,
    p_reference_type: reason || null,
  });

  if (error) throw error;
  return { error: null };
}


