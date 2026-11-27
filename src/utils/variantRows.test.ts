import { describe, expect, it } from 'vitest';
import { applyImageToSameValue, colorAttributeName, effectiveVariantPrice, followProductPrice, priceOverrideFor } from './variantRows';

// seen-product-variants-barcode-po-price-task.md, phase 2.

const row = (key: string, options: Record<string, string>, price = '100', priceTouched = false, imageUrl = '') =>
  ({ key, options, price, priceTouched, imageUrl });

describe('a variant price', () => {
  it('follows the product unless it has its own', () => {
    expect(effectiveVariantPrice(200, { priceOverride: null, priceAdjustment: 0 })).toBe(200);
    expect(effectiveVariantPrice(200, { priceOverride: null, priceAdjustment: 15 })).toBe(215);
    expect(effectiveVariantPrice(200, { priceOverride: 260, priceAdjustment: 15 })).toBe(260);
  });

  it('rows not changed by hand follow the product price; a special price stays', () => {
    const rows = [row('w', { اللون: 'أبيض' }), row('b', { اللون: 'أسود' }, '260', true)];
    const next = followProductPrice(rows, 220);
    expect(next.map((r) => r.price)).toEqual(['220', '260']);
  });

  it('only a price changed by hand AND different from the product is saved as its own', () => {
    expect(priceOverrideFor(row('a', {}, '200', false), 200)).toBeNull();
    expect(priceOverrideFor(row('a', {}, '200', true), 200)).toBeNull();
    expect(priceOverrideFor(row('a', {}, '260', true), 200)).toBe(260);
    expect(priceOverrideFor(row('a', {}, '', true), 200)).toBeNull();
  });
});

describe('one photo per colour', () => {
  it('finds the colour attribute (or the first one)', () => {
    expect(colorAttributeName([{ name: 'المقاس' }, { name: 'اللون' }])).toBe('اللون');
    expect(colorAttributeName([{ name: 'Color' }])).toBe('Color');
    expect(colorAttributeName([{ name: 'المقاس' }])).toBe('المقاس');
    expect(colorAttributeName([])).toBeNull();
  });

  it("white's photo goes on every white size, and nothing else", () => {
    const rows = [
      row('w56', { اللون: 'أبيض', المقاس: '56' }, '100', false, 'https://x/white.webp'),
      row('w58', { اللون: 'أبيض', المقاس: '58' }),
      row('b56', { اللون: 'أسود', المقاس: '56' }, '100', false, 'https://x/black.webp'),
    ];
    const next = applyImageToSameValue(rows, 'w56', 'اللون');
    expect(next.map((r) => r.imageUrl)).toEqual(['https://x/white.webp', 'https://x/white.webp', 'https://x/black.webp']);
  });
});
