/**
 * A purchase order line's price from the product's purchase price, and
 * back (seen-product-variants-barcode-po-price-task.md, phase 4, question 3).
 * The product keeps its cost per base unit (a metre, a piece); a line is
 * priced per its own unit -- `rate` base units each (a roll of 10 m = 10).
 * confirm_purchase_order makes the same division when it updates the cost.
 */
const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

export function linePriceFromCost(costPerBaseUnit: number, rate: number): number {
  if (!(rate > 0) || !(costPerBaseUnit > 0)) return 0;
  return round(costPerBaseUnit * rate, 2);
}

export function costFromLinePrice(linePrice: number, rate: number): number {
  if (!(rate > 0) || !(linePrice >= 0)) return 0;
  return round(linePrice / rate, 4);
}

export function linePriceChanged(suggested: number, entered: number): boolean {
  return Math.abs(Number(entered) - Number(suggested)) >= 0.005;
}
