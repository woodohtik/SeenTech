import { expect, test } from 'vitest';
import { openingBaseQuantity } from './openingBalance';

// seen-merchant-trial-test-2026-11-26.md, phase 3 item 1: the opening
// quantity is typed in the item's own unit and kept in stock's base unit.
test('two rolls of 30 yards are 54.864 m', () => {
  expect(openingBaseQuantity(2, { category: 'fabric', unit: 'roll', rollContent: 30, contentUnit: 'yard', conversionRate: 0 } as any)).toBeCloseTo(54.864, 3);
});

test('metres stay metres; pieces stay pieces', () => {
  expect(openingBaseQuantity(38.72, { category: 'fabric', unit: 'meter' } as any)).toBe(38.72);
  expect(openingBaseQuantity(200, { category: 'accessories', unit: 'piece' } as any)).toBe(200);
});

test('nothing typed is nothing to record', () => {
  expect(openingBaseQuantity(0, { category: 'fabric', unit: 'meter' } as any)).toBe(0);
  expect(openingBaseQuantity(Number.NaN, { category: 'fabric', unit: 'meter' } as any)).toBe(0);
});
