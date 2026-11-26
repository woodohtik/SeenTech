// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { isAutoPrintOn } from './autoPrint';

// seen-merchant-trial-test-2026-11-26.md, phase 3 item 7: the page waited on
// a print window with auto-print turned off -- the POS read the setting once,
// when it opened, and missed a change made in Settings afterwards.
afterEach(() => localStorage.clear());

test('on unless turned off, read at the moment of the sale', () => {
  expect(isAutoPrintOn()).toBe(true);
  localStorage.setItem('pos_auto_print', 'false');
  expect(isAutoPrintOn()).toBe(false);
  localStorage.setItem('pos_auto_print', 'true');
  expect(isAutoPrintOn()).toBe(true);
});
