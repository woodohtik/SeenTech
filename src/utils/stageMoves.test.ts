import { expect, test } from 'vitest';
import { isBackwardMove } from './stageMoves';

// seen-merchant-trial-test-2026-11-26.md, phase 3 item 6: after cutting, the
// order could be sent back to "measurements" with no question asked.
test("men's tailoring: back from cutting to measurements is backward; on is not", () => {
  expect(isBackwardMove('cutting', 'measurements_taken', [])).toBe(true);
  expect(isBackwardMove('ready', 'sewing', [])).toBe(true);
  expect(isBackwardMove('cutting', 'sewing', [])).toBe(false);
  expect(isBackwardMove('sewing', 'sewing', [])).toBe(false);
});

test("another vertical: by the order of its own stages", () => {
  const stages = [{ stage_key: 'order_received' }, { stage_key: 'upholstery' }, { stage_key: 'ready' }] as any;
  expect(isBackwardMove('ready', 'upholstery', stages)).toBe(true);
  expect(isBackwardMove('order_received', 'ready', stages)).toBe(false);
});

test('cancelling is not "backward" (it has its own confirmation)', () => {
  expect(isBackwardMove('sewing', 'cancelled', [])).toBe(false);
});
