/**
 * variantService -- seen-ux-fixes-batch-task.md item 10. CRUD for
 * `inventory_variants` (a sub-SKU of an inventory item -- e.g. a fabric in a
 * specific color/size, each with its own SKU/barcode/stock per branch).
 *
 * The table + variant_id columns on branch_inventory/stock_ledger/
 * order_items have existed since supabase/migrations/20240601000000_track_base_schema.sql
 * but were never read or written by any app code until this file -- the
 * plan's own research confirmed this is a "wire it up", not "build the
 * schema" task. apply_stock_movement (supabase/migrations/20261013000000_wire_inventory_variants.sql)
 * now accepts an optional p_variant_id, used by this service's stock paths.
 */

import { supabase } from '../lib/supabase/client';
import { ProductVariant, Branch } from '../types';

function mapVariantRow(row: any): ProductVariant {
  return {
    id: row.id,
    itemId: row.item_id,
    name: row.name,
    options: row.options || {},
    sku: row.sku,
    barcode: row.barcode || undefined,
    priceAdjustment: Number(row.price_adjustment) || 0,
    updatedAt: row.updated_at,
  };
}

/** All variants of an item, each with its stock per branch merged in from branch_inventory. */
export async function listVariants(itemId: string): Promise<ProductVariant[]> {
  const [{ data: variantRows, error: variantError }, { data: stockRows, error: stockError }] = await Promise.all([
    supabase.from('inventory_variants').select('*').eq('item_id', itemId).order('created_at'),
    supabase.from('branch_inventory').select('variant_id, branch_id, quantity').eq('item_id', itemId).not('variant_id', 'is', null),
  ]);
  if (variantError) throw variantError;
  if (stockError) throw stockError;

  const stockByVariant = new Map<string, Record<string, number>>();
  (stockRows || []).forEach((row: any) => {
    if (!row.variant_id) return;
    const byBranch = stockByVariant.get(row.variant_id) || {};
    byBranch[row.branch_id] = Number(row.quantity) || 0;
    stockByVariant.set(row.variant_id, byBranch);
  });

  return (variantRows || []).map((row: any) => ({
    ...mapVariantRow(row),
    stockByBranch: stockByVariant.get(row.id) || {},
  }));
}

/** True if this item has any variants defined -- used to decide whether POS/adjustment need the variant picker at all. */
export async function itemHasVariants(itemId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('inventory_variants')
    .select('id', { count: 'exact', head: true })
    .eq('item_id', itemId);
  if (error) throw error;
  return (count || 0) > 0;
}

/** For POS: every item that has at least one variant, with its variants and their per-branch stock. */
export async function listVariantsForTenant(tenantId: string): Promise<Record<string, ProductVariant[]>> {
  const [{ data: variantRows, error: variantError }, { data: stockRows, error: stockError }] = await Promise.all([
    supabase.from('inventory_variants').select('*').eq('tenant_id', tenantId).order('created_at'),
    supabase.from('branch_inventory').select('variant_id, branch_id, quantity').eq('tenant_id', tenantId).not('variant_id', 'is', null),
  ]);
  if (variantError) throw variantError;
  if (stockError) throw stockError;

  const stockByVariant = new Map<string, Record<string, number>>();
  (stockRows || []).forEach((row: any) => {
    if (!row.variant_id) return;
    const byBranch = stockByVariant.get(row.variant_id) || {};
    byBranch[row.branch_id] = Number(row.quantity) || 0;
    stockByVariant.set(row.variant_id, byBranch);
  });

  const byItem: Record<string, ProductVariant[]> = {};
  (variantRows || []).forEach((row: any) => {
    const variant: ProductVariant = { ...mapVariantRow(row), stockByBranch: stockByVariant.get(row.id) || {} };
    (byItem[row.item_id] ||= []).push(variant);
  });
  return byItem;
}

export interface CreateVariantInput {
  tenantId: string;
  itemId: string;
  name: string;
  options: Record<string, string>;
  sku: string;
  barcode?: string;
  priceAdjustment: number;
  branches: Branch[];
}

/**
 * Always creates at zero stock across every branch -- real quantity comes
 * only through a Purchase Order's receipt (confirm_purchase_order), same
 * rule as a brand-new base item (InventoryManager.tsx's AddItemModal). An
 * opening-stock field here used to let a merchant set a real number at
 * creation time via a raw, non-idempotent branch_inventory/stock_ledger
 * insert, bypassing the apply_stock_movement path every other stock
 * mutation in the app goes through -- removed entirely, not just hidden.
 */
export async function createVariant(input: CreateVariantInput): Promise<ProductVariant> {
  const { data: variantRow, error: variantError } = await supabase
    .from('inventory_variants')
    .insert({
      tenant_id: input.tenantId,
      item_id: input.itemId,
      name: input.name,
      options: input.options,
      sku: input.sku,
      barcode: input.barcode || null,
      price_adjustment: input.priceAdjustment || 0,
    })
    .select()
    .single();
  if (variantError) throw variantError;

  const branchInventoryInserts = input.branches.map((branch) => ({
    tenant_id: input.tenantId,
    branch_id: branch.id,
    item_id: input.itemId,
    variant_id: variantRow.id,
    quantity: 0,
    updated_at: new Date().toISOString(),
  }));
  const { error: stockError } = await supabase.from('branch_inventory').insert(branchInventoryInserts);
  if (stockError) throw stockError;

  return { ...mapVariantRow(variantRow), stockByBranch: Object.fromEntries(branchInventoryInserts.map((r) => [r.branch_id, r.quantity])) };
}

export async function updateVariant(
  variantId: string,
  patch: Partial<Pick<CreateVariantInput, 'name' | 'options' | 'sku' | 'barcode' | 'priceAdjustment'>>
): Promise<void> {
  const update: Record<string, any> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.options !== undefined) update.options = patch.options;
  if (patch.sku !== undefined) update.sku = patch.sku;
  if (patch.barcode !== undefined) update.barcode = patch.barcode || null;
  if (patch.priceAdjustment !== undefined) update.price_adjustment = patch.priceAdjustment;
  update.updated_at = new Date().toISOString();

  const { error } = await supabase.from('inventory_variants').update(update).eq('id', variantId);
  if (error) throw error;
}

/**
 * Deleting a variant cascades to its branch_inventory rows (ON DELETE CASCADE)
 * -- its stock record is gone permanently, though stock_ledger history for it
 * is kept (variant_id goes NULL there, ON DELETE SET NULL). Callers must
 * confirm with the merchant before calling this (useConfirm), same as every
 * other destructive action in the app.
 */
export async function deleteVariant(variantId: string): Promise<void> {
  const { error } = await supabase.from('inventory_variants').delete().eq('id', variantId);
  if (error) throw error;
}
