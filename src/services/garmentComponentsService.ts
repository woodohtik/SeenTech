import { supabase } from '../lib/supabase/client';
import type { CuttingComponent, GarmentComponentDefault } from '../utils/garmentComponents';

/**
 * The shop's garment components (seen-merchant-trial-test-2026-11-26.md,
 * phase 2 item 2): its defaults per garment type, and the stock items that
 * can be a component (anything but cloth).
 */

export async function loadGarmentComponentDefaults(tenantId: string): Promise<GarmentComponentDefault[]> {
  const { data, error } = await supabase
    .from('garment_components')
    .select('garment_type, item_id, quantity, inventory_items(name)')
    .eq('tenant_id', tenantId);
  if (error) return [];
  return (data || []).map((r: any) => ({
    garment_type: r.garment_type,
    item_id: r.item_id,
    quantity: Number(r.quantity) || 0,
    item_name: r.inventory_items?.name ?? null,
  }));
}

export async function loadComponentOptions(tenantId: string): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from('inventory_items')
    .select('id, name, category')
    .eq('tenant_id', tenantId)
    .neq('category', 'fabric')
    .order('name');
  if (error) return [];
  return (data || []).map((r: any) => ({ id: r.id, name: r.name }));
}

/**
 * Keeps this order's components as the garment's defaults, per piece
 * (the dialog shows them times the pieces).
 */
export async function saveGarmentComponentDefaults(tenantId: string, garmentType: string, components: CuttingComponent[], pieces: number): Promise<void> {
  const type = garmentType.trim();
  const per = Math.max(1, pieces || 1);
  const { error: delError } = await supabase.from('garment_components').delete().eq('tenant_id', tenantId).eq('garment_type', type);
  if (delError) throw delError;
  const rows = components
    .filter((c) => c.quantity > 0)
    .map((c) => ({ tenant_id: tenantId, garment_type: type, item_id: c.itemId, quantity: Math.round((c.quantity / per) * 100) / 100 }));
  if (rows.length === 0) return;
  const { error } = await supabase.from('garment_components').insert(rows);
  if (error) throw error;
}
