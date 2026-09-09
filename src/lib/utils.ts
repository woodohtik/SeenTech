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

export function generateOrderNumber() {
  // Client-side, non-atomic, no retry-on-collision at any call site
  // (seen-master-backlog-and-structure.md P2 item 11) -- the previous
  // seconds-resolution timestamp + 2-digit suffix gave two orders created
  // within the same second (plausible with multiple cashiers/branches
  // active at once) a real 1-in-90 chance of landing on the same number.
  // Millisecond resolution + a wider random suffix shrinks that window from
  // "same second" to "same millisecond", which two independent user actions
  // essentially cannot hit, without changing the return shape (still a
  // Number) or touching any of the four call sites.
  const now = Date.now() % 10000000;
  const suffix = Math.floor(100 + Math.random() * 900);
  return Number(`${now}${suffix}`);
}
