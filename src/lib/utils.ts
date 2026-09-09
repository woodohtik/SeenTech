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
// tight loop). Cross-tab/cross-device collisions still rely on millisecond
// timing, which real, human-triggered order creation essentially never hits.
let orderNumberCounter = 0;

export function generateOrderNumber() {
  // Client-side, non-atomic, no retry-on-collision at any call site
  // (seen-master-backlog-and-structure.md P2 item 11) -- the previous
  // seconds-resolution timestamp + 2-digit suffix gave two orders created
  // within the same second (plausible with multiple cashiers/branches
  // active at once) a real 1-in-90 chance of landing on the same number.
  const now = Date.now() % 10000000;
  orderNumberCounter = (orderNumberCounter + 1) % 1000;
  return Number(`${now}${String(orderNumberCounter).padStart(3, '0')}`);
}
