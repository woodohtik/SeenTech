import { describe, expect, it } from 'vitest';
import { cn, formatCurrency, generateOrderNumber } from './utils';

describe('generateOrderNumber', () => {
  it('returns a positive integer', () => {
    const n = generateOrderNumber();
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThan(0);
  });

  it('has a very low collision rate across many rapid calls', () => {
    // Regression check for the P2 #11 fix (seen-master-backlog-and-
    // structure.md): the old seconds-resolution timestamp + 2-digit suffix
    // gave two calls within the same second a real 1-in-90 chance of
    // colliding. 500 calls in a tight loop is the worst case for this --
    // millisecond resolution + a wider suffix should keep duplicates rare.
    const numbers = new Set<number>();
    for (let i = 0; i < 500; i++) {
      numbers.add(generateOrderNumber());
    }
    expect(numbers.size).toBeGreaterThan(495);
  });
});

describe('formatCurrency', () => {
  it('formats a number with two decimal places', () => {
    expect(formatCurrency(1234.5)).toBe('1,234.50');
  });

  it('treats a falsy amount as zero instead of throwing', () => {
    expect(formatCurrency(0)).toBe('0.00');
    expect(formatCurrency(undefined as unknown as number)).toBe('0.00');
  });
});

describe('cn', () => {
  it('merges class names and resolves Tailwind conflicts (last one wins)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('drops falsy values', () => {
    expect(cn('a', false, undefined, null, 'b')).toBe('a b');
  });
});
