import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { toLatinDigits } from './intlSetup';

export { toLatinDigits };

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

let globalCurrencySymbol = '﷼';

export function setGlobalCurrencySymbol(symbol: string) {
  globalCurrencySymbol = symbol;
}

export function getCurrencySymbol() {
  return globalCurrencySymbol;
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount || 0);
}

// Monotonic per-tab counter (mod 1000): guarantees two calls in the *same*
// browser tab never collide even if Date.now() hasn't ticked over between
// them (a real gap the first version of this fix missed -- caught by
// src/lib/utils.test.ts finding a ~14% duplicate rate across 500 calls in a
// tight loop).
//
// Randomized starting offset (not a fixed 0): two different tabs/devices
// that happen to load at the same millisecond used to *also* both start
// this counter at 0, so a same-millisecond cross-device collision was
// still possible on each device's first call after a fresh load despite
// the counter fixing the same-tab case. A random start means two fresh
// tabs essentially never begin at the same offset, while a single tab's
// own sequence stays strictly incrementing (the same-tab guarantee above
// is unaffected). Still not a hard guarantee -- true cross-device
// atomicity would need a server-assigned number, which conflicts with
// this being callable while fully offline -- but cuts the realistic
// collision window substantially for the same code size.
let orderNumberCounter = Math.floor(Math.random() * 1000);

export function generateOrderNumber() {
  // Client-side, non-atomic, no retry-on-collision at any call site
  // (seen-master-backlog-and-structure.md P2 item 11, further tightened per
  // seen-deep-technical-audit.md Medium #2) -- the previous seconds-
  // resolution timestamp + 2-digit suffix gave two orders created within
  // the same second a real 1-in-90 chance of colliding.
  //
  // Full Date.now() now, not `% 10000000` -- that truncation discarded the
  // timestamp's higher-order digits, so two calls genuinely ~2.78 hours
  // apart (any multiple of 10,000,000ms) could land on the same reduced
  // value despite being nowhere near each other in real time. The full
  // value plus the 3-digit suffix stays well under
  // Number.MAX_SAFE_INTEGER (16 digits vs. its 16-digit ceiling starting
  // with 9), so this doesn't introduce a precision gap either.
  const now = Date.now();
  orderNumberCounter = (orderNumberCounter + 1) % 1000;
  return Number(`${now}${String(orderNumberCounter).padStart(3, '0')}`);
}
