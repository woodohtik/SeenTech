import { describe, expect, it } from 'vitest';
import { rangeScope, relativeDay, shortDate, toDate } from './formatters';

// Thursday 19 November 2026, mid-afternoon local time.
const now = new Date(2026, 10, 19, 15, 42);

describe('toDate', () => {
  it('reads a bare date as that calendar day', () => {
    const d = toDate('2026-11-19')!;
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 10, 19]);
  });

  it('returns null for nothing or nonsense', () => {
    expect(toDate(null)).toBeNull();
    expect(toDate('')).toBeNull();
    expect(toDate('not a date')).toBeNull();
  });
});

describe('relativeDay', () => {
  it('names today, yesterday and tomorrow', () => {
    expect(relativeDay('2026-11-19', 'en', now)).toEqual({ kind: 'today' });
    expect(relativeDay('2026-11-18', 'en', now)).toEqual({ kind: 'yesterday' });
    expect(relativeDay('2026-11-20', 'en', now)).toEqual({ kind: 'tomorrow' });
  });

  it('compares calendar days, not hours', () => {
    expect(relativeDay(new Date(2026, 10, 19, 0, 5).toISOString(), 'en', now)).toEqual({ kind: 'today' });
    expect(relativeDay(new Date(2026, 10, 18, 23, 55).toISOString(), 'en', now)).toEqual({ kind: 'yesterday' });
  });

  it('uses the weekday name within six days either way', () => {
    expect(relativeDay('2026-11-22', 'en', now)).toEqual({ kind: 'weekday', text: 'Sunday' });
    expect(relativeDay('2026-11-14', 'en', now)).toEqual({ kind: 'weekday', text: 'Saturday' });
  });

  it('falls back to a short date beyond that', () => {
    expect(relativeDay('2026-12-05', 'en', now)).toEqual({ kind: 'date', text: 'December 5' });
    expect(relativeDay(undefined, 'en', now)).toBeNull();
  });
});

describe('shortDate', () => {
  it('leaves the year out for this year and shows it otherwise', () => {
    expect(shortDate('2026-11-19', 'en', now)).toBe('November 19');
    expect(shortDate('2025-11-19', 'en', now)).toBe('November 19, 2025');
  });
});

describe('rangeScope', () => {
  it('a single day is a day', () => {
    expect(rangeScope('2026-11-19', '2026-11-19', 'en', now)).toEqual({
      kind: 'day', day: { kind: 'today' }, date: 'November 19',
    });
  });

  it('two different days are a range', () => {
    expect(rangeScope('2026-11-01', '2026-11-19', 'en', now)).toEqual({
      kind: 'range', from: 'November 1', to: 'November 19',
    });
  });

  it('is nothing without a start', () => {
    expect(rangeScope(undefined, undefined, 'en', now)).toBeNull();
  });
});
