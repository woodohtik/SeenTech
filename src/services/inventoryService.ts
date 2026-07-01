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

export async function adjustStock({
  branchId,
  itemId,
  quantity,
  reason,
  type,
  staffId,
  tenantId
}: {
  branchId: string;
  itemId: string;
  quantity: number;
  reason: string;
  type: string;
  staffId: string | null;
  tenantId: string;
}) {
  // 1. Get current inventory
  const { data: currentInv, error: invError } = await supabase
    .from('branch_inventory')
    .select('id, quantity, tenant_id')
    .eq('branch_id', branchId)
    .eq('item_id', itemId)
    .maybeSingle();

  if (invError) throw invError;

  let currentQty = 0;
  let finalTenantId = tenantId;

  if (currentInv) {
    currentQty = Number(currentInv.quantity);
    finalTenantId = currentInv.tenant_id;
    // Update existing
    const { error: updateError } = await supabase
      .from('branch_inventory')
      .update({ 
        quantity: currentQty + quantity,
        updated_at: new Date().toISOString()
      })
      .eq('id', currentInv.id);
    
    if (updateError) throw updateError;
  } else {
    // Insert new
    const { error: insertError } = await supabase
      .from('branch_inventory')
      .insert({
        tenant_id: finalTenantId,
        branch_id: branchId,
        item_id: itemId,
        quantity: quantity
      });
      
    if (insertError) throw insertError;
  }

  // 2. Log to stock_ledger
  let movementType = 'adjustment';
  if (type === 'out') movementType = 'sale';
  if (quantity < 0 && type !== 'out') movementType = 'deduction';
  if (quantity > 0 && type !== 'out') movementType = 'addition';

  const { error: ledgerError } = await supabase
    .from('stock_ledger')
    .insert({
      tenant_id: finalTenantId,
      branch_id: branchId,
      item_id: itemId,
      type: movementType,
      previous_quantity: currentQty,
      new_quantity: currentQty + quantity,
      change: quantity,
      reference_id: null,
      staff_id: staffId,
      staff_name: staffId ? 'Staff' : 'System',
      created_at: new Date().toISOString()
    });

  if (ledgerError) console.error('Ledger error:', ledgerError);
  
  return { error: null };
}

