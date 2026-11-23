/**
 * The shop's approved measurement list (founder decision, 19 Nov 2026): fifteen
 * measurements, in this order. This is the one place the list lives; the type,
 * both validators, the selector, the voice wizard, printing, the order and
 * customer views, and the export all derive from it.
 *
 * Adding a key here is enough for it to be accepted and kept everywhere. That
 * matters: customerSchema strips keys it does not know, and the public form's
 * server validator rejects them, so a hand-kept copy that falls behind either
 * erases saved measurements or blocks the customer link.
 */
export type MeasurementKey =
  | 'length'
  | 'shoulder'
  | 'sleeveCuff'
  | 'sleeve'
  | 'sleeveTopWidth'
  | 'handWidth'
  | 'sleeveHem'
  | 'cuffLength'
  | 'cuffWidth'
  | 'waist'
  | 'chest'
  | 'bottomHem'
  | 'bottomWidth'
  | 'neck'
  | 'neckFold';

/** Kept so stored values survive and still show, but no longer entered. */
export type LegacyMeasurementKey = 'midSleeveWidth' | 'hips';

/** The area of the thobe drawing a field lights up; two fields may share one. */
export type MeasurementZone =
  | 'length'
  | 'shoulder'
  | 'sleeve'
  | 'sleeveTop'
  | 'wrist'
  | 'cuff'
  | 'cuffWidth'
  | 'waist'
  | 'chest'
  | 'bottomHem'
  | 'bottomWidth'
  | 'neck';

export interface MeasurementField {
  key: MeasurementKey;
  /** Side of the figure from 768px up: body on the right, sleeve and cuff on the left. */
  side: 'right' | 'left';
  zone: MeasurementZone;
  /** Upper bound in cm accepted by the form schema. */
  maxCm: number;
  /**
   * basic: always on screen. advanced: behind the "advanced measurements"
   * button (founder decision, 23 Nov 2026 -- the seven of before 19 Nov,
   * less the mid-sleeve width, are basic). Display only: all fifteen are
   * accepted, kept and shown wherever a value is stored.
   */
  tier: 'basic' | 'advanced';
}

/** In the founder's order, 1 to 15. Tab and the voice wizard follow it. */
export const MEASUREMENT_FIELDS: readonly MeasurementField[] = [
  { key: 'length', side: 'right', zone: 'length', maxCm: 300, tier: 'basic' },
  { key: 'shoulder', side: 'right', zone: 'shoulder', maxCm: 100, tier: 'basic' },
  { key: 'sleeveCuff', side: 'left', zone: 'sleeve', maxCm: 150, tier: 'advanced' },
  { key: 'sleeve', side: 'left', zone: 'sleeve', maxCm: 150, tier: 'basic' },
  { key: 'sleeveTopWidth', side: 'left', zone: 'sleeveTop', maxCm: 100, tier: 'advanced' },
  { key: 'handWidth', side: 'left', zone: 'wrist', maxCm: 100, tier: 'basic' },
  { key: 'sleeveHem', side: 'left', zone: 'cuff', maxCm: 50, tier: 'advanced' },
  { key: 'cuffLength', side: 'left', zone: 'cuff', maxCm: 100, tier: 'basic' },
  { key: 'cuffWidth', side: 'left', zone: 'cuffWidth', maxCm: 50, tier: 'advanced' },
  { key: 'waist', side: 'right', zone: 'waist', maxCm: 200, tier: 'advanced' },
  { key: 'chest', side: 'right', zone: 'chest', maxCm: 200, tier: 'basic' },
  { key: 'bottomHem', side: 'right', zone: 'bottomHem', maxCm: 50, tier: 'advanced' },
  { key: 'bottomWidth', side: 'right', zone: 'bottomWidth', maxCm: 200, tier: 'advanced' },
  { key: 'neck', side: 'right', zone: 'neck', maxCm: 100, tier: 'basic' },
  { key: 'neckFold', side: 'right', zone: 'neck', maxCm: 100, tier: 'advanced' },
];

export const MEASUREMENT_KEYS: readonly MeasurementKey[] = MEASUREMENT_FIELDS.map((f) => f.key);

/** The seven always on screen, in list order. */
export const BASIC_MEASUREMENT_KEYS: readonly MeasurementKey[] = MEASUREMENT_FIELDS.filter((f) => f.tier === 'basic').map((f) => f.key);
/** The eight behind the "advanced measurements" button, in list order. */
export const ADVANCED_MEASUREMENT_KEYS: readonly MeasurementKey[] = MEASUREMENT_FIELDS.filter((f) => f.tier === 'advanced').map((f) => f.key);

/** How many advanced measurements carry a value. */
export function countAdvancedValues(measurements: unknown): number {
  const source = (measurements && typeof measurements === 'object' ? measurements : {}) as Record<string, unknown>;
  return ADVANCED_MEASUREMENT_KEYS.filter((key) => {
    const value = Number(source[key]);
    return Number.isFinite(value) && value > 0;
  }).length;
}

/** Whether any advanced measurement carries a value: then the section opens on its own, so stored data is never out of sight. */
export const hasAdvancedValues = (measurements: unknown): boolean => countAdvancedValues(measurements) > 0;

/**
 * Measurement sets by activity (seen-verticals-readiness-task.md Phase 4):
 * verticals.capabilities.body_measurements names the set a shop uses.
 * `thobe` is the 15 fields above, unchanged. `womens` stays empty until the
 * founder approves its list (task file question 4) -- an empty set means the
 * measurements section is not shown at all, rather than thobe measurements
 * on a women's or furniture order.
 */
export type MeasurementSetKey = 'thobe' | 'womens';
export const MEASUREMENT_SETS: Readonly<Record<MeasurementSetKey, readonly MeasurementField[]>> = {
  thobe: MEASUREMENT_FIELDS,
  womens: [],
};

/** The measurement fields of a shop's activity; empty when it takes none (or its set is not approved yet). */
export function measurementSetFor(bodyMeasurements: string | null | undefined): readonly MeasurementField[] {
  if (!bodyMeasurements) return [];
  return MEASUREMENT_SETS[bodyMeasurements as MeasurementSetKey] ?? [];
}

export const LEGACY_MEASUREMENT_FIELDS: readonly { key: LegacyMeasurementKey; maxCm: number }[] = [
  { key: 'midSleeveWidth', maxCm: 100 },
  { key: 'hips', maxCm: 200 },
];

export const LEGACY_MEASUREMENT_KEYS: readonly LegacyMeasurementKey[] = LEGACY_MEASUREMENT_FIELDS.map((f) => f.key);

/** Every numeric key a stored measurements object may carry. */
export const ALL_NUMERIC_MEASUREMENT_KEYS: readonly (MeasurementKey | LegacyMeasurementKey)[] = [
  ...MEASUREMENT_KEYS,
  ...LEGACY_MEASUREMENT_KEYS,
];

export const measurementLabelKey = (key: MeasurementKey | LegacyMeasurementKey): string =>
  `measurements.part_label.${key}`;

export const measurementHintKey = (key: MeasurementKey): string => `measurements.part_hint.${key}`;

export interface MeasurementRow {
  key: MeasurementKey | LegacyMeasurementKey;
  labelKey: string;
  /** Stored value in cm. */
  value: number;
}

/**
 * A stored measurements object as rows in list order, for display, printing
 * and export. `includeEmpty` keeps the fifteen approved ones even when unset
 * (value 0); legacy values come last and only when present.
 */
export function measurementRows(measurements: unknown, includeEmpty = false): MeasurementRow[] {
  const source = (measurements && typeof measurements === 'object' ? measurements : {}) as Record<string, unknown>;
  const rows: MeasurementRow[] = [];
  for (const key of ALL_NUMERIC_MEASUREMENT_KEYS) {
    const raw = Number(source[key]);
    const value = Number.isFinite(raw) && raw > 0 ? raw : 0;
    const isLegacy = (LEGACY_MEASUREMENT_KEYS as readonly string[]).includes(key);
    if (value > 0 || (includeEmpty && !isLegacy)) {
      rows.push({ key, labelKey: measurementLabelKey(key), value });
    }
  }
  return rows;
}
