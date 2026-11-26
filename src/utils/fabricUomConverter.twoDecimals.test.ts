import { expect, test } from 'vitest';
import { formatItemStock } from './fabricUomConverter';

// seen-merchant-trial-test-2026-11-26.md, phase 3 item 3: "54.864 م" on screen.
test('stock on screen has two decimals at most', () => {
  const label = formatItemStock({ unit: 'meter', base_unit: 'meter', conversion_rate: 1 }, 54.864, 'en');
  expect(label).toContain('54.86');
  expect(label).not.toContain('54.864');
});
