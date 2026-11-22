import { describe, expect, it } from 'vitest';
import { localeOf } from './direction';

// seen-readiness-fixes-task.md P4 (UX-15): every language asks for the
// Gregorian calendar and Latin digits -- plain ar-SA is Hijri on older ICU.
describe('localeOf', () => {
  it.each(['ar', 'ur', 'en'])('%s is Gregorian', (lang) => {
    expect(localeOf(lang)).toContain('ca-gregory');
  });
  it('gives a Gregorian Arabic date with Latin digits, and ص/م for the time', () => {
    const d = new Date('2026-11-22T14:05:00Z');
    expect(d.toLocaleDateString(localeOf('ar'), { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' })).toMatch(/2026/);
    expect(d.toLocaleTimeString(localeOf('ar'), { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'UTC' })).toMatch(/02:05\s*م/);
  });
});

describe('withLatinDigits (the global Intl patch)', () => {
  it('never makes an invalid tag from a locale that already has an extension', async () => {
    const { withLatinDigits } = await import('./intlSetup');
    expect(withLatinDigits('ar-SA-u-ca-gregory-nu-latn')).toBe('ar-SA-u-ca-gregory-nu-latn');
    expect(withLatinDigits('en-US-u-ca-gregory')).toBe('en-US-u-ca-gregory-nu-latn');
    expect(withLatinDigits('ar-SA')).toBe('ar-SA-u-nu-latn');
    expect(withLatinDigits('ar-SA-u-nu-latn')).toBe('ar-SA-u-nu-latn');
    for (const l of ['ar', 'ur', 'en']) expect(() => new Intl.DateTimeFormat(withLatinDigits(localeOf(l)))).not.toThrow();
  });
});
