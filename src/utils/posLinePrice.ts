import { effectiveVariantPrice, type VariantPriceFields } from './variantRows';

/**
 * A POS cart line's price, as create_pos_sale computes it
 * (seen-open-verticals-task.md, wave 1, fabric stores item 4): a wholesale
 * customer of the shop pays a product's wholesale price where it has one;
 * otherwise a variant's own price or the product's.
 */
export interface PricedItem { pricePerUnit: number; wholesale_price?: number | string | null }
export interface PricedCustomer { price_level?: string | null; priceLevel?: string | null }

export function posLinePrice(item: PricedItem, variant: VariantPriceFields | null | undefined, customer: PricedCustomer | null | undefined): number {
  const level = customer?.priceLevel ?? customer?.price_level;
  const wholesale = item.wholesale_price == null || item.wholesale_price === '' ? null : Number(item.wholesale_price);
  if (level === 'wholesale' && wholesale != null && Number.isFinite(wholesale)) return wholesale;
  return variant ? effectiveVariantPrice(item.pricePerUnit, variant) : Number(item.pricePerUnit) || 0;
}
