import { describe, expect, it } from 'vitest';
import { allocateOpening } from './variantOpening';

// seen-product-variants-barcode-po-price-task.md, phase 3 + question 5.

describe('opening balance over variants', () => {
  it('(a) the same for each variant: 10 on 3 = 10 each, 30 in all', () => {
    expect(allocateOpening({ total: 10, count: 3, mode: 'same', wholeUnits: true })).toEqual([10, 10, 10]);
  });

  it('(b) split: 10 pieces on 3 = 4, 3, 3 (the rest to the first, in order)', () => {
    expect(allocateOpening({ total: 10, count: 3, mode: 'split', wholeUnits: true })).toEqual([4, 3, 3]);
  });

  it('(b) split: 25.5 m on 4 = two decimals, the difference on the last, the sum exact', () => {
    const out = allocateOpening({ total: 25.5, count: 4, mode: 'split', wholeUnits: false });
    expect(out).toEqual([6.37, 6.37, 6.37, 6.39]);
    expect(Math.round(out.reduce((a, b) => a + b, 0) * 100) / 100).toBe(25.5);
  });

  it('(b) a variant set by hand stays; the rest is shared by the others', () => {
    expect(allocateOpening({ total: 10, count: 3, mode: 'split', wholeUnits: true, pinned: { 0: 6 } })).toEqual([6, 2, 2]);
  });

  it('(a) a variant set by hand changes only that one', () => {
    expect(allocateOpening({ total: 10, count: 3, mode: 'same', wholeUnits: true, pinned: { 1: 4 } })).toEqual([10, 4, 10]);
  });

  it('pinned more than the total: the others get nothing, never below zero', () => {
    expect(allocateOpening({ total: 10, count: 3, mode: 'split', wholeUnits: true, pinned: { 0: 12 } })).toEqual([12, 0, 0]);
  });
});
