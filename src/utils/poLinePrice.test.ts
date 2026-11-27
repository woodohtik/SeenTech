import { describe, expect, it } from 'vitest';
import { costFromLinePrice, linePriceFromCost, linePriceChanged } from './poLinePrice';

// seen-product-variants-barcode-po-price-task.md, phase 4 (question 3): the
// purchase line starts at the product's purchase price; fabric bought by the
// roll is "price a metre x metres in the roll", and back again.
describe('purchase order line price', () => {
  it('a piece: its cost', () => {
    expect(linePriceFromCost(12, 1)).toBe(12);
  });
  it('a roll of 10 m at 12 a metre: 120', () => {
    expect(linePriceFromCost(12, 10)).toBe(120);
  });
  it('130 for that roll is 13 a metre for the product', () => {
    expect(costFromLinePrice(130, 10)).toBe(13);
  });
  it('a roll of 45.72 m (50 yards) keeps the metre price exact', () => {
    expect(costFromLinePrice(linePriceFromCost(12.5, 45.72), 45.72)).toBe(12.5);
  });
  it('changed only when it differs by a halala or more', () => {
    expect(linePriceChanged(120, 120.001)).toBe(false);
    expect(linePriceChanged(120, 130)).toBe(true);
  });
  it('no rate (roll content not typed yet): no price, no division by zero', () => {
    expect(linePriceFromCost(12, 0)).toBe(0);
    expect(costFromLinePrice(130, 0)).toBe(0);
  });
});
