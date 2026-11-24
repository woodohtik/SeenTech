/**
 * The shop's approved measurement list (founder decision, 24 Nov 2026, last version,
 * seen-measurements-basic-advanced-task.md): sixteen measurements, the nine
 * basic ones first in the founder's order, then the seven advanced ones. This
 * is the one place the list lives; the type, both validators, the selector,
 * the voice wizard, printing, the order and customer views, and the export
 * all derive from it.
 *
 * Adding a key here is enough for it to be accepted and kept everywhere. That
 * matters: customerSchema strips keys it does not know, and the public form's
 * server validator rejects them, so a hand-kept copy that falls behind either
 * erases saved measurements or blocks the customer link.
 */
export type MeasurementKey =
  | 'length'
  | 'shoulder'
  | 'sleeve'
  | 'chest'
  | 'neck'
  | 'handWidth'
  | 'midSleeveWidth'
  | 'cuffLength'
  | 'bottomWidth'
  | 'sleeveCuff'
  | 'sleeveTopWidth'
  | 'sleeveHem'
  | 'cuffWidth'
  | 'waist'
  | 'bottomHem'
  | 'neckFold';

/** Kept so stored values survive and still show, but no longer entered. */
export type LegacyMeasurementKey = 'hips';

/** The area of the thobe drawing a field lights up; two fields may share one. */
export type MeasurementZone =
  | 'length'
  | 'shoulder'
  | 'sleeve'
  | 'sleeveTop'
  | 'midSleeve'
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
  /** Side of the figure: body on the right, sleeve and cuff on the left (from 768px up; on a phone, the two columns under it). */
  side: 'right' | 'left';
  zone: MeasurementZone;
  /** Upper bound in cm accepted by the form schema. */
  maxCm: number;
  /**
   * basic: always on screen. advanced: behind the "advanced measurements"
   * button. Display only: all sixteen are accepted, kept and shown wherever
   * a value is stored.
   */
  tier: 'basic' | 'advanced';
  /**
   * How far down the thobe (on the 800-high drawing) the field's part is.
   * Each side lists its fields by it, so a field sits beside what it measures
   * (task file question 5): neck and shoulder at the top, length below.
   */
  figureY: number;
}

/** In the founder's order. The voice wizard follows it; the screen places each side by figureY. */
export const MEASUREMENT_FIELDS: readonly MeasurementField[] = [
  // The nine basic ones.
  { key: 'length', side: 'right', zone: 'length', maxCm: 300, tier: 'basic', figureY: 560 },
  { key: 'shoulder', side: 'right', zone: 'shoulder', maxCm: 100, tier: 'basic', figureY: 140 },
  { key: 'sleeve', side: 'left', zone: 'sleeve', maxCm: 150, tier: 'basic', figureY: 360 },
  { key: 'chest', side: 'right', zone: 'chest', maxCm: 200, tier: 'basic', figureY: 250 },
  { key: 'neck', side: 'right', zone: 'neck', maxCm: 100, tier: 'basic', figureY: 85 },
  { key: 'handWidth', side: 'left', zone: 'wrist', maxCm: 100, tier: 'basic', figureY: 430 },
  { key: 'midSleeveWidth', side: 'left', zone: 'midSleeve', maxCm: 100, tier: 'basic', figureY: 340 },
  { key: 'cuffLength', side: 'left', zone: 'cuff', maxCm: 100, tier: 'basic', figureY: 470 },
  { key: 'bottomWidth', side: 'right', zone: 'bottomWidth', maxCm: 200, tier: 'basic', figureY: 700 },
  // The seven advanced ones.
  { key: 'sleeveCuff', side: 'left', zone: 'sleeve', maxCm: 150, tier: 'advanced', figureY: 365 },
  { key: 'sleeveTopWidth', side: 'left', zone: 'sleeveTop', maxCm: 100, tier: 'advanced', figureY: 240 },
  { key: 'sleeveHem', side: 'left', zone: 'cuff', maxCm: 50, tier: 'advanced', figureY: 445 },
  { key: 'cuffWidth', side: 'left', zone: 'cuffWidth', maxCm: 50, tier: 'advanced', figureY: 500 },
  { key: 'waist', side: 'right', zone: 'waist', maxCm: 200, tier: 'advanced', figureY: 380 },
  { key: 'bottomHem', side: 'right', zone: 'bottomHem', maxCm: 50, tier: 'advanced', figureY: 752 },
  { key: 'neckFold', side: 'right', zone: 'neck', maxCm: 100, tier: 'advanced', figureY: 92 },
];

export const MEASUREMENT_KEYS: readonly MeasurementKey[] = MEASUREMENT_FIELDS.map((f) => f.key);

/** The nine always on screen, in list order. */
export const BASIC_MEASUREMENT_KEYS: readonly MeasurementKey[] = MEASUREMENT_FIELDS.filter((f) => f.tier === 'basic').map((f) => f.key);
/** The seven behind the "advanced measurements" button, in list order. */
export const ADVANCED_MEASUREMENT_KEYS: readonly MeasurementKey[] = MEASUREMENT_FIELDS.filter((f) => f.tier === 'advanced').map((f) => f.key);

/** One side's fields on screen, top of the thobe first (the order beside the drawing, and Tab's). */
export function fieldsDownTheFigure(side: 'right' | 'left', showAdvanced: boolean): MeasurementKey[] {
  return MEASUREMENT_FIELDS
    .filter((f) => f.side === side && (showAdvanced || f.tier === 'basic'))
    .slice()
    .sort((a, b) => a.figureY - b.figureY)
    .map((f) => f.key);
}

/** How many advanced measurements carry a value. */
export function countAdvancedValues(measurements: unknown): number {
  const source = (measurements && typeof measurements === 'object' ? measurements : {}) as Record<string, unknown>;
  return ADVANCED_MEASUREMENT_KEYS.filter((key) => {
    const value = Number(source[key]);
    return Number.isFinite(value) && value > 0;
  }).length;
}

/**
 * Whether any advanced measurement carries a value or a note: then the
 * section opens on its own, so stored data is never out of sight.
 */
export const hasAdvancedValues = (measurements: unknown): boolean => {
  if (countAdvancedValues(measurements) > 0) return true;
  const notes = (measurements as { fieldNotes?: Record<string, unknown> } | null)?.fieldNotes;
  return !!notes && ADVANCED_MEASUREMENT_KEYS.some((key) => typeof notes[key] === 'string' && notes[key] !== '');
};

/**
 * Measurement sets by activity (seen-verticals-readiness-task.md Phase 4):
 * verticals.capabilities.body_measurements names the set a shop uses.
 * `thobe` is the 16 fields above. `womens` stays empty until the
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
  /** The tailor's note on this measurement ('' when none). Staff only. */
  note: string;
}

/**
 * A stored measurements object as rows in list order, for display, printing
 * and export. `includeEmpty` keeps the sixteen approved ones even when unset
 * (value 0); legacy values come last and only when present.
 */
export function measurementRows(measurements: unknown, includeEmpty = false): MeasurementRow[] {
  const source = (measurements && typeof measurements === 'object' ? measurements : {}) as Record<string, unknown>;
  const rows: MeasurementRow[] = [];
  for (const key of ALL_NUMERIC_MEASUREMENT_KEYS) {
    const raw = Number(source[key]);
    const value = Number.isFinite(raw) && raw > 0 ? raw : 0;
    const isLegacy = (LEGACY_MEASUREMENT_KEYS as readonly string[]).includes(key);
    const note = fieldNoteOf(source, key);
    if (value > 0 || note || (includeEmpty && !isLegacy)) {
      rows.push({ key, labelKey: measurementLabelKey(key), value, note });
    }
  }
  return rows;
}

/**
 * A note per measurement (seen-measurements-basic-advanced-task.md, section 2):
 * `measurements.fieldNotes`, a one-line text per key, staff only. Stored in
 * the same JSON as the values; no table change.
 */
export const FIELD_NOTE_MAX = 80;
export type FieldNotes = Partial<Record<MeasurementKey | LegacyMeasurementKey, string>>;

/**
 * The one check for fieldNotes, used by the form schema and the server: keys
 * from the measurement list only, text values, trimmed, at most 80
 * characters; empty notes are dropped (undefined when none are left).
 */
export function validateFieldNotes(input: unknown):
  | { ok: true; value: FieldNotes | undefined }
  | { ok: false; error: 'not_an_object' | 'unknown_key' | 'not_text' | 'too_long'; key?: string } {
  if (input === undefined || input === null) return { ok: true, value: undefined };
  if (typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'not_an_object' };
  const allowed = new Set<string>(ALL_NUMERIC_MEASUREMENT_KEYS);
  const value: FieldNotes = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!allowed.has(key)) return { ok: false, error: 'unknown_key', key };
    if (typeof raw !== 'string') return { ok: false, error: 'not_text', key };
    const text = raw.trim();
    if (text.length > FIELD_NOTE_MAX) return { ok: false, error: 'too_long', key };
    if (text) value[key as MeasurementKey] = text;
  }
  return { ok: true, value: Object.keys(value).length ? value : undefined };
}

/** The note of one measurement, or '' when none. */
export function fieldNoteOf(measurements: unknown, key: MeasurementKey | LegacyMeasurementKey): string {
  const notes = (measurements as { fieldNotes?: Record<string, unknown> } | null | undefined)?.fieldNotes;
  const note = notes?.[key];
  return typeof note === 'string' ? note : '';
}
