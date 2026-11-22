import { computeTaxDocument } from '../shared/taxEngine';
import { ProductTaxType } from '../types';

export interface CartTotalsItem {
  price: number;
  quantity: number;
  taxType?: ProductTaxType;
}

export interface CartTaxSettings {
  enabled?: boolean;
  trn?: string;
  vatRate?: number;
}

export type DiscountType = 'percent' | 'fixed';

export interface CartTotals {
  isTaxEnabled: boolean;
  /** Percentage (e.g. 15), not a 0-1 ratio -- matches taxSettings.vatRate's own unit. */
  vatRate: number;
  subTotalAmount: number;
  calculatedDiscountAmount: number;
  discountedSubtotal: number;
  taxAmount: number;
  totalAmount: number;
}

/**
 * The cart's figures, by the one tax engine (src/shared/taxEngine.ts -- the
 * same rules the server's create_pos_sale applies through app_tax_document),
 * so what the cashier sees is what the sale records, to the halala
 * (seen-readiness-fixes-task.md P1.1: MONEY-01, MONEY-04).
 *
 * subTotalAmount: before the discount and before tax; calculatedDiscountAmount:
 * the discount as it shows before tax (the cashier's discount comes off what
 * the customer pays, and this is its pre-tax share); discountedSubtotal + taxAmount
 * = totalAmount.
 */
export function computeCartTotals(
  cart: CartTotalsItem[],
  taxSettings: CartTaxSettings | null | undefined,
  discountType: DiscountType,
  discountValue: number,
  maxDiscountPercent?: number | null
): CartTotals {
  const isTaxEnabled = taxSettings?.enabled ?? Boolean(taxSettings?.trn);
  const vatRate = isTaxEnabled ? Number(taxSettings?.vatRate ?? 15) : 0;
  const doc = computeTaxDocument({
    lines: cart.map((item) => ({ price: item.price, quantity: item.quantity, taxType: item.taxType })),
    rate: vatRate / 100,
    discountType,
    discountValue,
    maxDiscountPercent,
  });
  return {
    isTaxEnabled,
    vatRate,
    subTotalAmount: doc.netBefore,
    calculatedDiscountAmount: doc.discountNet,
    discountedSubtotal: doc.subtotal,
    taxAmount: doc.tax,
    totalAmount: doc.total,
  };
}

export interface PaidRemaining {
  paidAmount: number;
  remainingAmount: number;
}

/**
 * This fallback logic (assume fully paid when paidAmount isn't given,
 * derive remainingAmount from grandTotal - paidAmount when it isn't)
 * used to be copy-pasted independently across every invoice-printing call
 * site (POS.tsx's receipt, SimplifiedTaxInvoice.tsx, InvoiceReceipt.tsx,
 * SalesRecord.tsx, TaxInvoices.tsx) -- some of those copies never got
 * `Math.max(0, ...)` added, so an overpayment or float drift could print
 * a negative "remaining" on a real invoice. One function, used everywhere.
 */
export function computePaidRemaining(
  grandTotal: number,
  paidAmount?: number,
  remainingAmount?: number
): PaidRemaining {
  const resolvedPaid = paidAmount !== undefined ? Number(paidAmount) : grandTotal;
  const resolvedRemaining = remainingAmount !== undefined
    ? Math.max(0, Number(remainingAmount))
    : Math.max(0, grandTotal - resolvedPaid);
  return { paidAmount: resolvedPaid, remainingAmount: resolvedRemaining };
}
