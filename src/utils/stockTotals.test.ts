import { expect, test } from 'vitest';
import { formatStockQty, totalStockByItem } from './stockTotals';

// seen-merchant-trial-test-2026-11-26.md, phase 3 items 2-3: the purchase
// order's item list said "available: 0" for cloth holding 38.72 m (it read a
// column that is not kept current), in English units, with three decimals.
test('the total across branches, as the inventory page counts it', () => {
  const totals = totalStockByItem([
    { item_id: 'cloth', variant_id: null, quantity: 38.72 },
    { item_id: 'cloth', variant_id: null, quantity: 16.144 },
    { item_id: 'shirt', variant_id: null, quantity: 0 },
    { item_id: 'shirt', variant_id: 'v1', quantity: 3 },
    { item_id: 'shirt', variant_id: 'v2', quantity: 2 },
  ]);
  expect(totals.get('cloth')).toBeCloseTo(54.864, 3);
  expect(totals.get('shirt')).toBe(5);
});

test('at most two decimals, none when whole', () => {
  expect(formatStockQty(54.864, 'en')).toBe('54.86');
  expect(formatStockQty(200, 'en')).toBe('200');
  expect(formatStockQty(0.5, 'en')).toBe('0.5');
});
