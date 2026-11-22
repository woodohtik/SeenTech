/**
 * seen-readiness-fixes-task.md P1.1 -- the one tax engine.
 *
 * The same rules, to the halala, in three places:
 *   - here (the cart, the tailoring order form, printing);
 *   - the database: public.app_tax_document() (create_pos_sale and
 *     create_tailoring_order call it, so the server's figures are the truth);
 *   - the ZATCA XML, built from the per-line figures the server stored.
 * src/shared/taxEngineCases.json is the truth table all three are tested on.
 *
 * Rules:
 *  1. Each line by its own tax type (r = the shop's rate as a fraction, 0
 *     when tax is off):
 *       exclusive: net = R(price x qty), tax = R(net x r), gross = net + tax
 *       inclusive: gross = R(price x qty), net = R(gross / (1 + r)), tax = gross - net
 *       exempt:    net = gross = R(price x qty), tax = 0
 *     A line with no type is exclusive.
 *  2. The discount comes off what the customer pays (the gross): a percentage
 *     of the gross total, or a fixed amount (never more than the total), then
 *     capped by the role's maximum discount percentage when there is one.
 *  3. The discount is shared over the lines in proportion to their gross
 *     (each share rounded; the rounding remainder goes to the largest line),
 *     and each line's net and tax are taken again from its discounted gross
 *     with rule 1's split.
 *  4. The document is the sum of its lines: total = sum of gross after
 *     discount, subtotal = sum of net, tax = sum of tax. So the header, the
 *     lines and what the customer paid always agree.
 * R() rounds half away from zero to the halala, like PostgreSQL's round().
 */

export type TaxType = 'inclusive' | 'exclusive' | 'exempt';
export type DiscountType = 'percent' | 'fixed';

export interface TaxLineInput {
  price: number;
  quantity: number;
  taxType?: TaxType | null;
}

export interface TaxDocumentInput {
  lines: TaxLineInput[];
  /** The shop's VAT rate as a fraction (0.15); 0 when tax is off. */
  rate: number;
  discountType?: DiscountType;
  discountValue?: number;
  /** The role's discount cap in percent, or null/undefined for none. */
  maxDiscountPercent?: number | null;
}

export interface TaxLineResult {
  taxType: TaxType;
  /** Before the discount. */
  net: number;
  tax: number;
  gross: number;
  /** This line's share of the discount (gross). */
  discount: number;
  /** After the discount -- what goes on the invoice line. */
  netAfter: number;
  taxAfter: number;
  grossAfter: number;
}

export interface TaxDocumentResult {
  lines: TaxLineResult[];
  /** Sums before the discount. */
  netBefore: number;
  grossBefore: number;
  /** The discount taken off the gross. */
  discountGross: number;
  /** The discount as it shows before tax (netBefore - subtotal). */
  discountNet: number;
  /** Sums after the discount: subtotal + tax = total. */
  subtotal: number;
  tax: number;
  total: number;
}

/** Round half away from zero to 2 decimals, immune to binary float noise. */
export function round2(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const scaled = Number((Math.abs(x) * 100).toPrecision(12));
  return (Math.sign(x) * Math.round(scaled)) / 100;
}

const add = (a: number, b: number) => round2(a + b);
const sub = (a: number, b: number) => round2(a - b);

export function normalizeTaxType(t: unknown): TaxType {
  return t === 'inclusive' || t === 'exempt' ? t : 'exclusive';
}

function splitLine(gross: number, type: TaxType, rate: number): { net: number; tax: number } {
  if (type === 'exempt' || rate <= 0) return { net: gross, tax: 0 };
  const net = round2(gross / (1 + rate));
  return { net, tax: sub(gross, net) };
}

export function computeTaxDocument(input: TaxDocumentInput): TaxDocumentResult {
  const rate = Math.max(Number(input.rate) || 0, 0);

  const before = input.lines.map((l) => {
    const type = normalizeTaxType(l.taxType);
    const amount = round2((Number(l.price) || 0) * (Number(l.quantity) || 0));
    if (type === 'exclusive' && rate > 0) {
      const tax = round2(amount * rate);
      return { type, net: amount, tax, gross: add(amount, tax) };
    }
    if (type === 'inclusive' && rate > 0) {
      const { net, tax } = splitLine(amount, type, rate);
      return { type, net, tax, gross: amount };
    }
    return { type, net: amount, tax: 0, gross: amount };
  });

  const grossBefore = before.reduce((s, l) => add(s, l.gross), 0);
  const netBefore = before.reduce((s, l) => add(s, l.net), 0);

  const value = Math.max(Number(input.discountValue) || 0, 0);
  let discount = input.discountType === 'fixed'
    ? Math.min(round2(value), grossBefore)
    : round2((grossBefore * Math.min(value, 100)) / 100);
  if (input.maxDiscountPercent !== null && input.maxDiscountPercent !== undefined) {
    discount = Math.min(discount, round2((grossBefore * Math.max(input.maxDiscountPercent, 0)) / 100));
  }

  // Share the discount by gross; the remainder of rounding goes to the largest line.
  const shares = before.map((l) => (grossBefore > 0 ? round2((discount * l.gross) / grossBefore) : 0));
  if (before.length > 0) {
    const remainder = sub(discount, shares.reduce((s, x) => add(s, x), 0));
    let largest = 0;
    before.forEach((l, i) => { if (l.gross > before[largest].gross) largest = i; });
    shares[largest] = add(shares[largest], remainder);
  }

  const lines: TaxLineResult[] = before.map((l, i) => {
    const grossAfter = sub(l.gross, shares[i]);
    const { net: netAfter, tax: taxAfter } = splitLine(grossAfter, l.type, rate);
    return { taxType: l.type, net: l.net, tax: l.tax, gross: l.gross, discount: shares[i], netAfter, taxAfter, grossAfter };
  });

  const subtotal = lines.reduce((s, l) => add(s, l.netAfter), 0);
  const tax = lines.reduce((s, l) => add(s, l.taxAfter), 0);
  const total = lines.reduce((s, l) => add(s, l.grossAfter), 0);
  return {
    lines, netBefore, grossBefore, discountGross: discount,
    discountNet: sub(netBefore, subtotal), subtotal, tax, total,
  };
}
