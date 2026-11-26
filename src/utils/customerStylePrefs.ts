/**
 * A customer's style preferences (seen-merchant-trial-test-2026-11-26.md,
 * phase 2 item 3, question 4's default): one place -- the style fields of
 * customers.measurements, the very fields an order line carries and the
 * shared VisualMeasurements picker edits (collar, cuff, pocket, chest,
 * shoulder, cutting, padding, closure). A new order is filled from them, and
 * each order writes its choices back. The old `customers.styles`
 * (neckShape, sleeveStyle) is no longer read.
 */
export const STYLE_PREF_KEYS = [
  'collarType', 'cuffType', 'pocketType', 'chestStyle', 'shoulderStyle',
  'cuttingType', 'collarPadding', 'closureType', 'closureVisibility',
] as const;

export type StylePrefKey = typeof STYLE_PREF_KEYS[number];
export type StylePrefs = Partial<Record<StylePrefKey, string>>;

const present = (v: unknown) => typeof v === 'string' && v.trim() !== '';

/** The style fields a customer has saved (empty ones left out). */
export function stylePrefsOf(measurements: Record<string, unknown> | null | undefined): StylePrefs {
  const out: StylePrefs = {};
  for (const key of STYLE_PREF_KEYS) {
    const v = measurements?.[key];
    if (present(v)) out[key] = String(v);
  }
  return out;
}

/** An order line with the customer's preferences over its defaults. */
export function applyStylePrefs<T extends Record<string, unknown>>(line: T, prefs: StylePrefs): T {
  return { ...line, ...prefs };
}

/** The customer's measurements with an order line's style choices as their new preferences. */
export function mergeStylePrefs(measurements: Record<string, unknown> | null | undefined, line: Record<string, unknown>): Record<string, unknown> {
  return { ...(measurements || {}), ...stylePrefsOf(line) };
}
