import { describe, expect, it } from 'vitest';
import { inferLineTaxType } from './lineTaxType';

// seen-readiness-fixes-task.md P6 (MONEY-21). The figures are real shapes
// from stored orders: a line carries its price and no tax type.
describe('inferLineTaxType', () => {
  it('a sale priced before VAT: 100 under a total of 115 is exclusive', () => {
    expect(inferLineTaxType([{ unitPrice: 100, quantity: 1 }], { grandTotal: 115, vatAmount: 15 }, 0.15)).toBe('exclusive');
    expect(inferLineTaxType([{ unitPrice: 200, quantity: 2 }], { grandTotal: 460, vatAmount: 60 }, 0.15)).toBe('exclusive');
    expect(inferLineTaxType([{ unitPrice: 250, quantity: 1 }], { grandTotal: 287.5, vatAmount: 37.5 }, 0.15)).toBe('exclusive');
  });

  it('a sale priced with VAT inside: 115 under a total of 115 is inclusive', () => {
    expect(inferLineTaxType([{ unitPrice: 115, quantity: 1 }], { grandTotal: 115, vatAmount: 15 }, 0.15)).toBe('inclusive');
  });

  it('an order with no VAT at all: nothing is carved out of its lines', () => {
    expect(inferLineTaxType([{ unitPrice: 300, quantity: 1 }], { grandTotal: 300, vatAmount: 0 }, 0.15)).toBe('exempt');
  });

  it('with a discount, either way round', () => {
    // 200 before VAT, 20 off, then 15%: 207
    expect(inferLineTaxType([{ unitPrice: 200, quantity: 1 }], { grandTotal: 207, vatAmount: 27, discount: 20 }, 0.15)).toBe('exclusive');
    // 230 with VAT inside, 23 off: 207
    expect(inferLineTaxType([{ unitPrice: 230, quantity: 1 }], { grandTotal: 207, vatAmount: 27, discount: 23 }, 0.15)).toBe('inclusive');
  });

  it('lines that say their own type are taken as said, and the rest inferred around them', () => {
    const items = [{ unitPrice: 115, quantity: 1, taxType: 'inclusive' as const }, { unitPrice: 100, quantity: 1 }];
    expect(inferLineTaxType(items, { grandTotal: 230, vatAmount: 30 }, 0.15)).toBe('exclusive');
  });

  it('nothing to compare with: what the server assumes', () => {
    expect(inferLineTaxType([{ unitPrice: 100, quantity: 1 }], undefined, 0.15)).toBe('exclusive');
    expect(inferLineTaxType([{ unitPrice: 100, quantity: 1 }], { grandTotal: 100 }, 0)).toBe('exclusive');
  });
});
