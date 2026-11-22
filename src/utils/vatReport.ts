import { taxRatePercent } from '../shared/taxRate';
import type { TailoringTax } from './tailoringOrder';

/**
 * The VAT summary on the reports page (team review 2026-11-19, item M-17).
 * It used to take 15% out of every refund and every purchase whatever the
 * shop's settings were. Now:
 *  - output VAT is the tax stored on the period's orders minus the VAT part
 *    of the period's refunds, each refund at its original order's stored
 *    rate (0 for an order sold without tax), or at the shop's rate when the
 *    refund is not linked to an order;
 *  - input VAT on purchases / purchase returns (stored VAT-inclusive, with no
 *    tax line of their own) uses the shop's rate;
 *  - a shop with tax off in its settings reclaims no input VAT.
 * A shop with tax on at 15% gets exactly what the report showed before.
 */
export interface VatSummaryInput {
  /** Sum of the stored tax_amount of the period's non-cancelled orders. */
  outputTaxOnSales: number;
  refunds: ReadonlyArray<{ refunded_amount: number | string | null; order_id?: string | null }>;
  /** orders.tax_rate by order id, as stored (15 or 0.15 both occur). */
  orderTaxRate: ReadonlyMap<string, number | string | null | undefined>;
  purchasesTotal: number;
  purchaseReturnsTotal: number;
  tax: TailoringTax;
}

export interface VatSummary {
  outputVat: number;
  inputVat: number;
  netVatDue: number;
}

/** A stored rate as a percentage -- the one reader, src/shared/taxRate.ts (P1.2). */
export const ratePercent = taxRatePercent;

/** The VAT inside a VAT-inclusive amount at `percent`. */
export function vatInside(amount: number, percent: number): number {
  if (!amount || percent <= 0) return 0;
  return amount - amount / (1 + percent / 100);
}

export function computeVatSummary(input: VatSummaryInput): VatSummary {
  const shopPercent = input.tax.enabled ? input.tax.vatRatePercentage : 0;

  const refundedVat = input.refunds.reduce((sum, r) => {
    const amount = Number(r.refunded_amount || 0);
    const stored = r.order_id ? ratePercent(input.orderTaxRate.get(r.order_id)) : null;
    return sum + vatInside(amount, stored ?? shopPercent);
  }, 0);

  const outputVat = input.outputTaxOnSales - refundedVat;
  const inputVat = vatInside(input.purchasesTotal, shopPercent) - vatInside(input.purchaseReturnsTotal, shopPercent);
  return { outputVat, inputVat, netVatDue: outputVat - inputVat };
}
