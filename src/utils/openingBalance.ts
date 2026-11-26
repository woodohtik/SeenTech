import { resolveUnitColumns, type ItemUnitForm } from './itemUnits';

/**
 * A new item's opening quantity (seen-merchant-trial-test-2026-11-26.md,
 * phase 3 item 1), typed in the item's own unit (rolls, yards, metres,
 * pieces), as stock keeps it: in the base unit (metres or pieces).
 */
export function openingBaseQuantity(value: number, form: ItemUnitForm): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const { conversion_rate } = resolveUnitColumns(form);
  return Math.round(n * (Number(conversion_rate) || 1) * 10000) / 10000;
}
