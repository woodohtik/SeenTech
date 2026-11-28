/**
 * Variant rows in the product form (seen-product-variants-barcode-po-price-task.md,
 * phase 2, question 2's default): a variant's price starts as the product's
 * and follows it; one changed by hand is its own ("special price") and stays.
 * The server prices a sale the same way (create_pos_sale, 20270123000001):
 * COALESCE(price_override, product price + price_adjustment).
 */

export interface VariantPriceFields {
  priceOverride?: number | null;
  priceAdjustment?: number | null;
}

export function effectiveVariantPrice(productPrice: number, v: VariantPriceFields): number {
  if (v.priceOverride != null) return Number(v.priceOverride);
  return Number(productPrice || 0) + Number(v.priceAdjustment || 0);
}

interface PricedRow {
  price: string;
  priceTouched: boolean;
}

/** Rows the merchant did not change by hand take the product's (new) price. */
export function followProductPrice<R extends PricedRow>(rows: R[], productPrice: number): R[] {
  const p = String(Number(productPrice) || 0);
  return rows.map((r) => (r.priceTouched || r.price === p ? r : { ...r, price: p }));
}

/** What to save as the variant's own price -- null when it just follows the product. */
export function priceOverrideFor(row: PricedRow, productPrice: number): number | null {
  if (!row.priceTouched || row.price.trim() === '') return null;
  const n = Number(row.price);
  if (!Number.isFinite(n) || n < 0) return null;
  return n === Number(productPrice || 0) ? null : n;
}

const COLOR_NAME = /لون|colou?r|رنگ/i;

/** The attribute a photo belongs to: the colour one, else the first. */
export function colorAttributeName(attributes: { name: string }[]): string | null {
  const named = attributes.map((a) => a.name.trim()).filter(Boolean);
  return named.find((n) => COLOR_NAME.test(n)) ?? named[0] ?? null;
}

/** The photo of one row on every row with the same value of `attribute` (white's photo on every white size). */
export function applyImageToSameValue<R extends { key: string; options: Record<string, string>; imageUrl: string }>(
  rows: R[], sourceKey: string, attribute: string,
): R[] {
  const source = rows.find((r) => r.key === sourceKey);
  if (!source || !source.imageUrl) return rows;
  const value = source.options[attribute];
  if (value === undefined) return rows;
  return rows.map((r) => (r.options[attribute] === value ? { ...r, imageUrl: source.imageUrl } : r));
}
