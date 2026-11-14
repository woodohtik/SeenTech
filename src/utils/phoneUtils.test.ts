import { describe, test, expect } from 'vitest';
import { formatSaudiPhone, validateSaudiPhone } from './phoneUtils';

describe('formatSaudiPhone', () => {
  test('strips internal spaces from a number typed/imported with separators', () => {
    expect(formatSaudiPhone('050 123 4567')).toBe('+966501234567');
  });

  test('strips internal dashes from a number typed/imported with separators', () => {
    expect(formatSaudiPhone('050-123-4567')).toBe('+966501234567');
  });

  test('strips internal spaces even when the number is already +966-prefixed', () => {
    expect(formatSaudiPhone('+966 50 123 4567')).toBe('+966501234567');
  });

  test('still formats a plain 05-prefixed number with no separators', () => {
    expect(formatSaudiPhone('0501234567')).toBe('+966501234567');
  });
});

describe('validateSaudiPhone', () => {
  test('accepts a number stored with internal spaces (legacy/imported data)', () => {
    expect(validateSaudiPhone('050 123 4567')).toBe(true);
  });

  test('accepts a number stored with internal dashes', () => {
    expect(validateSaudiPhone('050-123-4567')).toBe(true);
  });
});
