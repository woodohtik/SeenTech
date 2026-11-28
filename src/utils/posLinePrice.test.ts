import { describe, expect, it } from 'vitest';
import { posLinePrice } from './posLinePrice';

// seen-open-verticals-task.md, wave 1 (fabric stores item 4): what the cart
// shows is what create_pos_sale charges -- a wholesale customer pays a
// product's wholesale price where it has one.
const linen = { pricePerUnit: 30, wholesale_price: 22 };
const scissors = { pricePerUnit: 40, wholesale_price: null };

describe('posLinePrice', () => {
  it('a retail customer or a walk-in: the usual price', () => {
    expect(posLinePrice(linen, null, { price_level: 'retail' })).toBe(30);
    expect(posLinePrice(linen, null, null)).toBe(30);
  });
  it('a wholesale customer: the wholesale price', () => {
    expect(posLinePrice(linen, null, { price_level: 'wholesale' })).toBe(22);
  });
  it('a product without one: the usual price, even for him', () => {
    expect(posLinePrice(scissors, null, { price_level: 'wholesale' })).toBe(40);
  });
  it("a variant's own price for a retail customer, as before", () => {
    expect(posLinePrice(linen, { priceOverride: 35, priceAdjustment: 0 }, null)).toBe(35);
  });
});
