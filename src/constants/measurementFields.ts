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
}

/** In the founder's order, 1 to 15. Tab and the voice wizard follow it. */
export const MEASUREMENT_FIELDS: readonly MeasurementField[] = [
  { key: 'length', side: 'right', zone: 'length', maxCm: 300 },
  { key: 'shoulder', side: 'right', zone: 'shoulder', maxCm: 100 },
  { key: 'sleeveCuff', side: 'left', zone: 'sleeve', maxCm: 150 },
  { key: 'sleeve', side: 'left', zone: 'sleeve', maxCm: 150 },
  { key: 'sleeveTopWidth', side: 'left', zone: 'sleeveTop', maxCm: 100 },
  { key: 'handWidth', side: 'left', zone: 'wrist', maxCm: 100 },
  { key: 'sleeveHem', side: 'left', zone: 'cuff', maxCm: 50 },
  { key: 'cuffLength', side: 'left', zone: 'cuff', maxCm: 100 },
  { key: 'cuffWidth', side: 'left', zone: 'cuffWidth', maxCm: 50 },
  { key: 'waist', side: 'right', zone: 'waist', maxCm: 200 },
  { key: 'chest', side: 'right', zone: 'chest', maxCm: 200 },
  { key: 'bottomHem', side: 'right', zone: 'bottomHem', maxCm: 50 },
  { key: 'bottomWidth', side: 'right', zone: 'bottomWidth', maxCm: 200 },
  { key: 'neck', side: 'right', zone: 'neck', maxCm: 100 },
  { key: 'neckFold', side: 'right', zone: 'neck', maxCm: 100 },
];

export const MEASUREMENT_KEYS: readonly MeasurementKey[] = MEASUREMENT_FIELDS.map((f) => f.key);

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
