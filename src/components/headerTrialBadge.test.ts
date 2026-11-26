import { expect, test } from 'vitest';
import { showHeaderTrialBadge } from './headerTrialBadge';

// seen-merchant-trial-test-2026-11-26.md, phase 4: "تجربة: متبقي 6 يوم" beside
// the title repeated the banner above it ("تنتهي الفترة التجريبية خلال 6 يوم").
test('a trial: the badge until the banner takes over (7 days left)', () => {
  expect(showHeaderTrialBadge(10, true)).toBe(true);
  expect(showHeaderTrialBadge(7, true)).toBe(false);
  expect(showHeaderTrialBadge(6, true)).toBe(false);
});

test('a subscription: the banner takes over at 14 days', () => {
  expect(showHeaderTrialBadge(20, false)).toBe(true);
  expect(showHeaderTrialBadge(14, false)).toBe(false);
});

test('ended (0): the badge says so, the banner does not cover an ended trial', () => {
  expect(showHeaderTrialBadge(0, true)).toBe(true);
});

test('no days known: no badge', () => {
  expect(showHeaderTrialBadge(null, true)).toBe(false);
});
