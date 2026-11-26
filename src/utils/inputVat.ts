/**
 * Input VAT on a purchase order (seen-merchant-trial-test-2026-11-26.md,
 * phase 3 item 4): the order's total is the supplier's price including VAT;
 * the VAT inside it is total x rate / (100 + rate).
 */
export function inputVatOf(total: number, ratePercent: number): { net: number; vat: number; total: number } {
  const t = Math.round((Number(total) || 0) * 100) / 100;
  const r = Number(ratePercent) || 0;
  if (r <= 0) return { net: t, vat: 0, total: t };
  const vat = Math.round((t * r / (100 + r)) * 100) / 100;
  return { net: Math.round((t - vat) * 100) / 100, vat, total: t };
}
