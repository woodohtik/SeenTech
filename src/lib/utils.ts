import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

let globalCurrencySymbol = 'ر.س';

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
  // Use a hybrid approach: Timestamp (seconds) + 2 random digits for pseudo-sequential uniqueness
  const now = Math.floor(Date.now() / 1000);
  const suffix = Math.floor(10 + Math.random() * 90);
  return Number(`${now % 1000000}${suffix}`);
}
