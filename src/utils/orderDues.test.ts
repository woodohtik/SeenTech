import { expect, test } from 'vitest';
import { orderBadgeDue, customerTotalDue } from './orderDues';

// seen-merchant-trial-test-2026-11-26.md, phase 3 item 9: the red badge on an
// order of 115 said 920 -- the customer's whole debt, not this order's.
const unpaid = [{ id: 'a', remainingAmount: 65 }, { id: 'b', remainingAmount: 855 }];

test("the badge is this order's own remainder", () => {
  expect(orderBadgeDue({ id: 'a', remainingAmount: 65 })).toBe(65);
  expect(orderBadgeDue({ id: 'c', remainingAmount: 0 })).toBe(0);
  expect(orderBadgeDue({ id: 'd', remainingAmount: null })).toBe(0);
});

test("the customer's whole debt stays available, for the dues window", () => {
  expect(customerTotalDue(unpaid)).toBe(920);
});
