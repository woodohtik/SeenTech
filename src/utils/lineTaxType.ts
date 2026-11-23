import { calculateItemTax } from './b2bHelper';

export type LineTaxType = 'inclusive' | 'exclusive' | 'exempt';

type Line = { unitPrice: number; quantity: number; taxType?: LineTaxType | null };
type Totals = { grandTotal: number; vatAmount?: number; discount?: number };

/**
 * seen-readiness-fixes-task.md P6 (MONEY-21): how to read the price of an
 * invoice line that carries no tax type of its own.
 *
 * Stored lines never carry one (order_items.tax_type is not read back), so
 * the printed invoice used to assume "inclusive" -- and for a sale priced
 * before VAT (100 -> total 115) the lines printed 100 under a total of 115.
 * Instead of assuming, this picks the reading under which the lines add up
 * to the total the server recorded:
 *  - no VAT on the order at all: 'exempt' (no VAT is carved out of a line);
 *  - otherwise whichever of inclusive / exclusive lands closer to the total,
 *    with or without the order's discount;
 *  - no totals to compare with: 'exclusive', what create_pos_sale assumes
 *    for a line without a tax type.
 */
export function inferLineTaxType(items: ReadonlyArray<Line>, totals: Totals | undefined | null, vatRate: number): LineTaxType {
  if (!totals || !(vatRate > 0)) return 'exclusive';
  const unlabelled = items.filter((i) => !i.taxType);
  if (unlabelled.length === 0) return 'exclusive';
  if (totals.vatAmount !== undefined && Math.abs(Number(totals.vatAmount)) < 0.005) return 'exempt';

  const labelledFinal = items
    .filter((i) => i.taxType)
    .reduce((sum, i) => sum + calculateItemTax(i.unitPrice, i.taxType as LineTaxType, vatRate, i.quantity).finalPrice, 0);
  const raw = unlabelled.reduce((sum, i) => sum + Number(i.unitPrice || 0) * Number(i.quantity || 0), 0);
  const target = Number(totals.grandTotal || 0) - labelledFinal;
  const discount = Math.max(Number(totals.discount || 0), 0);

  const distance = (candidates: number[]) => Math.min(...candidates.map((c) => Math.abs(target - c)));
  const asInclusive = distance([raw, raw - discount]);
  const asExclusive = distance([raw * (1 + vatRate), (raw - discount) * (1 + vatRate), raw * (1 + vatRate) - discount]);
  return asInclusive < asExclusive ? 'inclusive' : 'exclusive';
}
