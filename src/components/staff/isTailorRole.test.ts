import { test, expect } from 'vitest';
import { isTailorRole } from './isTailorRole';

// seen-merchant-trial-test-2026-11-26.md, phase 2 item 1: a tailor -- the
// built-in role, or a custom role saved as one -- may be PIN-only.
const roles = [
  { roleKey: 'tailor', baseRole: null },
  { roleKey: 'custom_master_tailor_1', baseRole: 'tailor' },
  { roleKey: 'custom_front_desk_1', baseRole: 'cashier' },
] as any;

test('the built-in tailor and a custom role based on it count as a tailor', () => {
  expect(isTailorRole('tailor', roles)).toBe(true);
  expect(isTailorRole('custom_master_tailor_1', roles)).toBe(true);
});

test('other roles, and no role yet, do not', () => {
  expect(isTailorRole('cashier', roles)).toBe(false);
  expect(isTailorRole('manager', roles)).toBe(false);
  expect(isTailorRole('custom_front_desk_1', roles)).toBe(false);
  expect(isTailorRole('', roles)).toBe(false);
});
