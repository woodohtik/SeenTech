import { expect, test } from 'vitest';
import { inputVatOf } from './inputVat';

// seen-merchant-trial-test-2026-11-26.md, phase 3 item 4: a purchase order
// did not break out its input VAT (15%), which the accountant needs.
test('a 660 order at 15%, prices including VAT: 573.91 before VAT, 86.09 VAT', () => {
  expect(inputVatOf(660, 15)).toEqual({ net: 573.91, vat: 86.09, total: 660 });
});

test('no VAT: nothing broken out', () => {
  expect(inputVatOf(660, 0)).toEqual({ net: 660, vat: 0, total: 660 });
});
