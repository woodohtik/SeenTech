/** Dates as the assistant's cards show them: a word when it is near, a short date otherwise. */

const DAY_MS = 86_400_000;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** A value from a tool result (ISO date or date-time) as a Date, or null. */
export function toDate(value: unknown): Date | null {
  if (!value) return null;
  // A bare YYYY-MM-DD is a calendar day, not midnight UTC.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

export type RelativeDay =
  | { kind: 'today' | 'yesterday' | 'tomorrow' }
  | { kind: 'weekday'; text: string }
  | { kind: 'date'; text: string };

/**
 * Today / yesterday / tomorrow, the weekday's name within the coming or past
 * six days, and a short date beyond that.
 */
export function relativeDay(value: unknown, locale: string, now: Date = new Date()): RelativeDay | null {
  const date = toDate(value);
  if (!date) return null;
  const diff = Math.round((startOfDay(date) - startOfDay(now)) / DAY_MS);
  if (diff === 0) return { kind: 'today' };
  if (diff === -1) return { kind: 'yesterday' };
  if (diff === 1) return { kind: 'tomorrow' };
  if (Math.abs(diff) <= 6) {
    return { kind: 'weekday', text: new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date) };
  }
  return { kind: 'date', text: shortDate(date, locale, now) };
}

/** "19 نوفمبر", with the year only when it is not this year. */
export function shortDate(value: unknown, locale: string, now: Date = new Date()): string {
  const date = toDate(value);
  if (!date) return '';
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
}

export type RangeScope =
  | { kind: 'day'; day: RelativeDay; date: string }
  | { kind: 'range'; from: string; to: string };

/** The scope tag of a card: one day ("today · 19 November") or a range. */
export function rangeScope(start: unknown, end: unknown, locale: string, now: Date = new Date()): RangeScope | null {
  const from = toDate(start);
  const to = toDate(end) ?? from;
  if (!from || !to) return null;
  if (startOfDay(from) === startOfDay(to)) {
    return { kind: 'day', day: relativeDay(from, locale, now)!, date: shortDate(from, locale, now) };
  }
  return { kind: 'range', from: shortDate(from, locale, now), to: shortDate(to, locale, now) };
}

/** The time a reply arrived, as "3:42 م". */
export function clockTime(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(new Date(timestamp));
}
