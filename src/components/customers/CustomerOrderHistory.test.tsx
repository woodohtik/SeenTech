import { expect, test, vi } from 'vitest';
vi.mock('../../hooks/useVerticalConfig', () => ({ useVerticalConfig: () => ({ workflowStages: [] }) }));
import { orderLabel } from './CustomerOrderHistory';
import { getOrderStatusDisplay } from '../orderStatusConfig';

// seen-merchant-trial-test-2026-11-26.md, phase 2 item 4: order #7 showed as
// "#C09E18", and a ready order as "in progress".
test("the order's own number, the id only when it has none", () => {
  expect(orderLabel({ id: 'aaaaaaaa-0000-4000-8000-000000c09e18', orderNumber: 7 })).toBe('#7');
  expect(orderLabel({ id: 'aaaaaaaa-0000-4000-8000-000000c09e18', orderNumber: null })).toBe('#C09E18');
});

test('a ready order reads ready, not in progress', () => {
  expect(getOrderStatusDisplay('ready', []).labelKey).toBe('common.status_ready');
});
