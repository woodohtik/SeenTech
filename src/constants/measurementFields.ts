/**
 * ORDER ON SCREEN -- founder decision, 24 Nov 2026 (seen-measurements-layout-fix-task.md):
 * `slot` numbers the fields 1-16 and `column` puts each in a column: the
 * reading start (the right in Arabic) takes 1-5, the other side 6-9; the
 * advanced ones follow the same rule, 10-13 then 14-16. Enter and Tab go
 * 1 -> 16. This is the founder's own order and changes only by his
 * decision -- not to follow the drawing (figureY and zone only light the
 * drawing and place a value on it).
 *
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
   * How far down the thobe (on the 800-high drawing) the field's part is:
   * where its number sits on the drawing. Not the order of the fields.
   */
  figureY: number;
  /** Its number on screen, 1-16, in the founder's order: Enter and Tab follow it. */
  slot: number;
  /** start: the column the reader begins with (the right in Arabic, the left in English); end: the other. */
  column: 'start' | 'end';
}

/** In the founder's order. The voice wizard follows it; the screen places each side by figureY. */
export const MEASUREMENT_FIELDS: readonly MeasurementField[] = [
  // The nine basic ones.
  { key: 'length', side: 'right', zone: 'length', maxCm: 300, tier: 'basic', figureY: 560, slot: 1, column: 'start' },
  { key: 'shoulder', side: 'right', zone: 'shoulder', maxCm: 100, tier: 'basic', figureY: 140, slot: 2, column: 'start' },
  { key: 'sleeve', side: 'left', zone: 'sleeve', maxCm: 150, tier: 'basic', figureY: 360, slot: 3, column: 'start' },
  { key: 'chest', side: 'right', zone: 'chest', maxCm: 200, tier: 'basic', figureY: 250, slot: 4, column: 'start' },
  { key: 'neck', side: 'right', zone: 'neck', maxCm: 100, tier: 'basic', figureY: 85, slot: 5, column: 'start' },
  { key: 'handWidth', side: 'left', zone: 'wrist', maxCm: 100, tier: 'basic', figureY: 430, slot: 6, column: 'end' },
  { key: 'midSleeveWidth', side: 'left', zone: 'midSleeve', maxCm: 100, tier: 'basic', figureY: 340, slot: 7, column: 'end' },
  { key: 'cuffLength', side: 'left', zone: 'cuff', maxCm: 100, tier: 'basic', figureY: 470, slot: 8, column: 'end' },
  { key: 'bottomWidth', side: 'right', zone: 'bottomWidth', maxCm: 200, tier: 'basic', figureY: 700, slot: 9, column: 'end' },
  // The seven advanced ones.
  { key: 'sleeveCuff', side: 'left', zone: 'sleeve', maxCm: 150, tier: 'advanced', figureY: 365, slot: 10, column: 'start' },
  { key: 'sleeveTopWidth', side: 'left', zone: 'sleeveTop', maxCm: 100, tier: 'advanced', figureY: 240, slot: 11, column: 'start' },
  { key: 'sleeveHem', side: 'left', zone: 'cuff', maxCm: 50, tier: 'advanced', figureY: 445, slot: 12, column: 'start' },
  { key: 'cuffWidth', side: 'left', zone: 'cuffWidth', maxCm: 50, tier: 'advanced', figureY: 500, slot: 13, column: 'start' },
  { key: 'waist', side: 'right', zone: 'waist', maxCm: 200, tier: 'advanced', figureY: 380, slot: 14, column: 'end' },
  { key: 'bottomHem', side: 'right', zone: 'bottomHem', maxCm: 50, tier: 'advanced', figureY: 752, slot: 15, column: 'end' },
  { key: 'neckFold', side: 'right', zone: 'neck', maxCm: 100, tier: 'advanced', figureY: 92, slot: 16, column: 'end' },
];

export const MEASUREMENT_KEYS: readonly MeasurementKey[] = MEASUREMENT_FIELDS.map((f) => f.key);

/** The nine always on screen, in list order. */
export const BASIC_MEASUREMENT_KEYS: readonly MeasurementKey[] = MEASUREMENT_FIELDS.filter((f) => f.tier === 'basic').map((f) => f.key);
/** The seven behind the "advanced measurements" button, in list order. */
export const ADVANCED_MEASUREMENT_KEYS: readonly MeasurementKey[] = MEASUREMENT_FIELDS.filter((f) => f.tier === 'advanced').map((f) => f.key);

/**
 * One column's fields of one tier, in slot order (the founder's order):
 * start basic 1-5, end basic 6-9, start advanced 10-13, end advanced 14-16.
 */
export function fieldsInColumn(column: 'start' | 'end', tier: 'basic' | 'advanced'): MeasurementKey[] {
  return MEASUREMENT_FIELDS
    .filter((f) => f.column === column && f.tier === tier)
    .slice()
    .sort((a, b) => a.slot - b.slot)
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

/**
 * Women's tailoring (seen-open-verticals-task.md, wave 1, question 2's
 * default): ten basic measurements, six behind "advanced", each with a note
 * and Enter to the next -- like the thobe. Keys a thobe also has keep its
 * stored name (one customer's `chest` is one value), with women's labels
 * (measurements.part_label_womens.*); six are women's only.
 */
export type WomensOnlyMeasurementKey = 'underBust' | 'backLength' | 'backWidth' | 'bustPointLength' | 'sideLength' | 'frontWaistLength';
export type WomensMeasurementKey =
  | 'length' | 'shoulder' | 'chest' | 'waist' | 'hips' | 'sleeve' | 'sleeveTopWidth' | 'handWidth' | 'neck' | 'bottomWidth'
  | WomensOnlyMeasurementKey;

/** What every measurement set has (the thobe's fields add their drawing's place). */
export interface SetField {
  key: string;
  tier: 'basic' | 'advanced';
  slot: number;
  column: 'start' | 'end';
  maxCm: number;
}

export interface WomensMeasurementField extends SetField {
  key: WomensMeasurementKey;
  /** Where its number sits on the dress drawing (0-100 of its width / height). */
  at: { x: number; y: number };
}

export const WOMENS_MEASUREMENT_FIELDS: readonly WomensMeasurementField[] = [
  // The ten basic ones: 1-5 in the reading start column, 6-10 in the other.
  { key: 'length', tier: 'basic', slot: 1, column: 'start', maxCm: 300, at: { x: 50, y: 92 } },
  { key: 'shoulder', tier: 'basic', slot: 2, column: 'start', maxCm: 80, at: { x: 50, y: 14 } },
  { key: 'chest', tier: 'basic', slot: 3, column: 'start', maxCm: 200, at: { x: 50, y: 27 } },
  { key: 'waist', tier: 'basic', slot: 4, column: 'start', maxCm: 200, at: { x: 50, y: 40 } },
  { key: 'hips', tier: 'basic', slot: 5, column: 'start', maxCm: 200, at: { x: 50, y: 52 } },
  { key: 'sleeve', tier: 'basic', slot: 6, column: 'end', maxCm: 100, at: { x: 15, y: 40 } },
  { key: 'sleeveTopWidth', tier: 'basic', slot: 7, column: 'end', maxCm: 80, at: { x: 22, y: 22 } },
  { key: 'handWidth', tier: 'basic', slot: 8, column: 'end', maxCm: 60, at: { x: 9, y: 58 } },
  { key: 'neck', tier: 'basic', slot: 9, column: 'end', maxCm: 70, at: { x: 50, y: 6 } },
  { key: 'bottomWidth', tier: 'basic', slot: 10, column: 'end', maxCm: 200, at: { x: 50, y: 98 } },
  // The six advanced ones: 11-13, then 14-16.
  { key: 'underBust', tier: 'advanced', slot: 11, column: 'start', maxCm: 200, at: { x: 50, y: 33 } },
  { key: 'backLength', tier: 'advanced', slot: 12, column: 'start', maxCm: 100, at: { x: 64, y: 26 } },
  { key: 'backWidth', tier: 'advanced', slot: 13, column: 'start', maxCm: 80, at: { x: 64, y: 18 } },
  { key: 'bustPointLength', tier: 'advanced', slot: 14, column: 'end', maxCm: 60, at: { x: 38, y: 24 } },
  { key: 'sideLength', tier: 'advanced', slot: 15, column: 'end', maxCm: 150, at: { x: 72, y: 60 } },
  { key: 'frontWaistLength', tier: 'advanced', slot: 16, column: 'end', maxCm: 100, at: { x: 38, y: 36 } },
];

export const WOMENS_ONLY_MEASUREMENT_KEYS: readonly WomensOnlyMeasurementKey[] =
  ['underBust', 'backLength', 'backWidth', 'bustPointLength', 'sideLength', 'frontWaistLength'];

/** One column's women's fields of one tier, in slot order. */
export function womensFieldsInColumn(column: 'start' | 'end', tier: 'basic' | 'advanced'): WomensMeasurementKey[] {
  return WOMENS_MEASUREMENT_FIELDS.filter((f) => f.column === column && f.tier === tier).slice().sort((a, b) => a.slot - b.slot).map((f) => f.key);
}

export const MEASUREMENT_SETS: Readonly<Record<MeasurementSetKey, readonly SetField[]>> = {
  thobe: MEASUREMENT_FIELDS,
  womens: WOMENS_MEASUREMENT_FIELDS,
};

/** The measurement fields of a shop's activity; empty when it takes none. */
export function measurementSetFor(bodyMeasurements: string | null | undefined): readonly SetField[] {
  if (!bodyMeasurements) return [];
  return MEASUREMENT_SETS[bodyMeasurements as MeasurementSetKey] ?? [];
}

export const LEGACY_MEASUREMENT_FIELDS: readonly { key: LegacyMeasurementKey; maxCm: number }[] = [
  { key: 'hips', maxCm: 200 },
];

export const LEGACY_MEASUREMENT_KEYS: readonly LegacyMeasurementKey[] = LEGACY_MEASUREMENT_FIELDS.map((f) => f.key);

/** Every numeric key a stored measurements object may carry (any set). */
export const ALL_NUMERIC_MEASUREMENT_KEYS: readonly (MeasurementKey | LegacyMeasurementKey | WomensOnlyMeasurementKey)[] = [
  ...MEASUREMENT_KEYS,
  ...LEGACY_MEASUREMENT_KEYS,
  ...WOMENS_ONLY_MEASUREMENT_KEYS,
];

/** The thobe's rows: its sixteen, then the legacy ones -- exactly as before the women's set. */
const THOBE_ROW_KEYS: readonly (MeasurementKey | LegacyMeasurementKey)[] = [...MEASUREMENT_KEYS, ...LEGACY_MEASUREMENT_KEYS];

export const measurementLabelKey = (key: string, set: MeasurementSetKey = 'thobe'): string =>
  set === 'womens' ? `measurements.part_label_womens.${key}` : `measurements.part_label.${key}`;

export const measurementHintKey = (key: MeasurementKey): string => `measurements.part_hint.${key}`;

export interface MeasurementRow {
  key: MeasurementKey | LegacyMeasurementKey | WomensOnlyMeasurementKey;
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
export function measurementRows(measurements: unknown, includeEmpty = false, set: MeasurementSetKey = 'thobe'): MeasurementRow[] {
  const source = (measurements && typeof measurements === 'object' ? measurements : {}) as Record<string, unknown>;
  const rows: MeasurementRow[] = [];
  // A women's shop: its sixteen in slot order, with its labels. Otherwise the thobe's rows, unchanged.
  const keys: readonly string[] = set === 'womens' ? WOMENS_MEASUREMENT_FIELDS.map((f) => f.key) : THOBE_ROW_KEYS;
  for (const key of keys) {
    const raw = Number(source[key]);
    const value = Number.isFinite(raw) && raw > 0 ? raw : 0;
    const isLegacy = set !== 'womens' && (LEGACY_MEASUREMENT_KEYS as readonly string[]).includes(key);
    const note = fieldNoteOf(source, key as MeasurementKey);
    if (value > 0 || note || (includeEmpty && !isLegacy)) {
      rows.push({ key: key as MeasurementRow['key'], labelKey: measurementLabelKey(key, set), value, note });
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
