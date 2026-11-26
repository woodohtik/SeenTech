/**
 * An item's stock as the inventory page counts it
 * (seen-merchant-trial-test-2026-11-26.md, phase 3 items 2-3): branch_inventory
 * across branches -- its variants' rows when it has variants, its own rows
 * otherwise (inventory_items.quantity is not kept current).
 */
export interface StockRow { item_id: string; variant_id: string | null; quantity: number | string | null }

export function totalStockByItem(rows: ReadonlyArray<StockRow>): Map<string, number> {
  const base = new Map<string, number>();
  const variants = new Map<string, number>();
  for (const r of rows) {
    const q = Number(r.quantity) || 0;
    const target = r.variant_id ? variants : base;
    target.set(r.item_id, (target.get(r.item_id) || 0) + q);
  }
  const out = new Map(base);
  for (const [id, q] of variants) out.set(id, q);
  return out;
}

/** A stock figure for the screen: at most two decimals, none when whole. */
export function formatStockQty(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(Math.round((Number(n) || 0) * 100) / 100);
}
