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
      return { available: false, missingItems: ['المستودع المركزي غير موجود'] };
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

    if (branchError || !branches) throw new Error('المستودع المركزي غير موجود');
    targetBranchId = branches.id;
  }

  if (!targetBranchId) throw new Error('لم يتم تحديد الفرع للخصم');

  for (const item of order.items) {
    const { data: inventoryItem, error: invError } = await supabase
      .from('inventory_items')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('name', item.fabric)
      .maybeSingle();
    
    if (invError || !inventoryItem) continue;

    const { data: branchInv, error: branchInvError } = await supabase
      .from('branch_inventory')
      .select('quantity')
      .eq('branch_id', targetBranchId)
      .eq('item_id', inventoryItem.id)
      .maybeSingle();

    const deductionAmount = item.consumedMeters || convertToMeters(item.quantity, item.selectedUnit || 'meter');
    const currentQty = branchInv?.quantity || 0;
    const newQty = currentQty - deductionAmount;

    await supabase
      .from('branch_inventory')
      .update({
        quantity: newQty,
        updated_at: new Date().toISOString()
      })
      .eq('branch_id', targetBranchId)
      .eq('item_id', inventoryItem.id);

    // Add to ledger
    await supabase.from('stock_ledger').insert({
      item_id: inventoryItem.id,
      branch_id: targetBranchId,
      type: 'deduction',
      previous_quantity: currentQty,
      new_quantity: newQty,
      change: -deductionAmount,
      reference_id: order.id,
      staff_id: staff.id,
      staff_name: staff.name,
      tenant_id: tenantId,
      created_at: new Date().toISOString()
    });
  }
}
