import { describe, it, expect } from 'vitest';
import { computeCartTotals, CartTotalsItem } from './cartTotals';

describe('computeCartTotals', () => {
  it('returns all zeros for an empty cart', () => {
    const totals = computeCartTotals([], { enabled: true, vatRate: 15 }, 'fixed', 0);
    expect(totals).toEqual({
      isTaxEnabled: true,
      vatRate: 15,
      subTotalAmount: 0,
      calculatedDiscountAmount: 0,
      discountedSubtotal: 0,
      taxAmount: 0,
      totalAmount: 0,
    });
  });

  it('skips tax entirely when tax is disabled', () => {
    const cart: CartTotalsItem[] = [{ price: 100, quantity: 2, taxType: 'exclusive' }];
    const totals = computeCartTotals(cart, { enabled: false, vatRate: 15 }, 'fixed', 0);
    expect(totals.isTaxEnabled).toBe(false);
    expect(totals.subTotalAmount).toBe(200);
    expect(totals.taxAmount).toBe(0);
    expect(totals.totalAmount).toBe(200);
  });

  it('falls back to tax-enabled when taxSettings.trn is set but enabled is undefined', () => {
    const cart: CartTotalsItem[] = [{ price: 100, quantity: 1, taxType: 'exclusive' }];
    const totals = computeCartTotals(cart, { trn: '300000000000003', vatRate: 15 }, 'fixed', 0);
    expect(totals.isTaxEnabled).toBe(true);
    expect(totals.taxAmount).toBe(15);
  });

  it('treats missing/null taxSettings as tax disabled', () => {
    const cart: CartTotalsItem[] = [{ price: 100, quantity: 1, taxType: 'exclusive' }];
    expect(computeCartTotals(cart, null, 'fixed', 0).isTaxEnabled).toBe(false);
    expect(computeCartTotals(cart, undefined, 'fixed', 0).isTaxEnabled).toBe(false);
  });

  it('computes exclusive tax on top of the price', () => {
    const cart: CartTotalsItem[] = [{ price: 100, quantity: 2, taxType: 'exclusive' }];
    const totals = computeCartTotals(cart, { enabled: true, vatRate: 15 }, 'fixed', 0);
    expect(totals.subTotalAmount).toBe(200);
    expect(totals.taxAmount).toBe(30);
    expect(totals.totalAmount).toBe(230);
  });

  it('extracts tax from an inclusive price instead of adding it', () => {
    const cart: CartTotalsItem[] = [{ price: 115, quantity: 1, taxType: 'inclusive' }];
    const totals = computeCartTotals(cart, { enabled: true, vatRate: 15 }, 'fixed', 0);
    expect(totals.subTotalAmount).toBeCloseTo(100, 2);
    expect(totals.taxAmount).toBeCloseTo(15, 2);
    expect(totals.totalAmount).toBeCloseTo(115, 2);
  });

  it('charges no tax on an exempt item even when tax is enabled', () => {
    const cart: CartTotalsItem[] = [{ price: 100, quantity: 1, taxType: 'exempt' }];
    const totals = computeCartTotals(cart, { enabled: true, vatRate: 15 }, 'fixed', 0);
    expect(totals.subTotalAmount).toBe(100);
    expect(totals.taxAmount).toBe(0);
    expect(totals.totalAmount).toBe(100);
  });

  it('defaults an item with no taxType to exclusive', () => {
    const cart: CartTotalsItem[] = [{ price: 100, quantity: 1 }];
    const totals = computeCartTotals(cart, { enabled: true, vatRate: 15 }, 'fixed', 0);
    expect(totals.taxAmount).toBe(15);
  });

  it('sums a mixed cart of exclusive, inclusive, and exempt items correctly', () => {
    const cart: CartTotalsItem[] = [
      { price: 100, quantity: 1, taxType: 'exclusive' }, // base 100, tax 15
      { price: 115, quantity: 1, taxType: 'inclusive' }, // base 100, tax 15
      { price: 50, quantity: 1, taxType: 'exempt' },     // base 50, tax 0
    ];
    const totals = computeCartTotals(cart, { enabled: true, vatRate: 15 }, 'fixed', 0);
    expect(totals.subTotalAmount).toBeCloseTo(250, 2);
    expect(totals.taxAmount).toBeCloseTo(30, 2);
    expect(totals.totalAmount).toBeCloseTo(280, 2);
  });

  it('applies a percent discount to the subtotal and reduces tax by the same ratio', () => {
    const cart: CartTotalsItem[] = [{ price: 100, quantity: 2, taxType: 'exclusive' }]; // subtotal 200, tax 30
    const totals = computeCartTotals(cart, { enabled: true, vatRate: 15 }, 'percent', 10);
    expect(totals.calculatedDiscountAmount).toBe(20);
    expect(totals.discountedSubtotal).toBe(180);
    // discount ratio 0.9 applied to the original tax amount
    expect(totals.taxAmount).toBeCloseTo(27, 2);
    expect(totals.totalAmount).toBeCloseTo(207, 2);
  });

  it('applies a fixed discount', () => {
    const cart: CartTotalsItem[] = [{ price: 100, quantity: 2, taxType: 'exclusive' }]; // subtotal 200, tax 30
    const totals = computeCartTotals(cart, { enabled: true, vatRate: 15 }, 'fixed', 50);
    expect(totals.calculatedDiscountAmount).toBe(50);
    expect(totals.discountedSubtotal).toBe(150);
    expect(totals.taxAmount).toBeCloseTo(22.5, 2);
    expect(totals.totalAmount).toBeCloseTo(172.5, 2);
  });

  it('clamps a discount larger than the subtotal to the subtotal (never a negative total)', () => {
    const cart: CartTotalsItem[] = [{ price: 100, quantity: 1, taxType: 'exclusive' }];
    const totals = computeCartTotals(cart, { enabled: true, vatRate: 15 }, 'fixed', 999);
    expect(totals.calculatedDiscountAmount).toBe(100);
    expect(totals.discountedSubtotal).toBe(0);
    expect(totals.taxAmount).toBe(0);
    expect(totals.totalAmount).toBe(0);
  });

  it('clamps a percent discount above 100% the same way', () => {
    const cart: CartTotalsItem[] = [{ price: 100, quantity: 1, taxType: 'exclusive' }];
    const totals = computeCartTotals(cart, { enabled: true, vatRate: 15 }, 'percent', 150);
    expect(totals.calculatedDiscountAmount).toBe(100);
    expect(totals.totalAmount).toBe(0);
  });

  it('ignores discountValue when it is zero or negative', () => {
    const cart: CartTotalsItem[] = [{ price: 100, quantity: 1, taxType: 'exclusive' }];
    expect(computeCartTotals(cart, { enabled: true, vatRate: 15 }, 'fixed', 0).calculatedDiscountAmount).toBe(0);
    expect(computeCartTotals(cart, { enabled: true, vatRate: 15 }, 'fixed', -10).calculatedDiscountAmount).toBe(0);
  });

  it('uses a default 15% vatRate when taxSettings.vatRate is missing', () => {
    const cart: CartTotalsItem[] = [{ price: 100, quantity: 1, taxType: 'exclusive' }];
    const totals = computeCartTotals(cart, { enabled: true }, 'fixed', 0);
    expect(totals.vatRate).toBe(15);
    expect(totals.taxAmount).toBe(15);
  });

  it('reports vatRate as 0 when tax is disabled, regardless of taxSettings.vatRate', () => {
    const cart: CartTotalsItem[] = [{ price: 100, quantity: 1, taxType: 'exclusive' }];
    const totals = computeCartTotals(cart, { enabled: false, vatRate: 15 }, 'fixed', 0);
    expect(totals.vatRate).toBe(0);
  });
});
