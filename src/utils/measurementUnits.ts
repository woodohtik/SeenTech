export type MeasurementUnit = 'cm' | 'inch';

const CM_PER_INCH = 2.54;

export function isValidMeasurementUnit(value: unknown): value is MeasurementUnit {
  return value === 'cm' || value === 'inch';
}

// 2 decimals (not 1) so quarter-inch fractions (.25/.5/.75) -- the ones
// FractionPicker actually offers -- survive a cm round-trip exactly instead
// of collapsing onto the nearest 0.1 (e.g. .25 -> .2, .75 -> .7).
const round2 = (value: number): number => Math.round(value * 100) / 100;
// What is stored: precise enough that a chosen quarter inch comes back as the
// same quarter (20.75 in = 52.705 cm), without float noise (52.70500000000001).
const round4 = (value: number): number => Math.round(value * 10000) / 10000;

export function cmToDisplayUnit(cm: number, unit: MeasurementUnit): number {
  return unit === 'inch' ? round2(cm / CM_PER_INCH) : cm;
}

export function displayUnitToCm(value: number, unit: MeasurementUnit): number {
  return unit === 'inch' ? round4(value * CM_PER_INCH) : value;
}

export function unitLabelKey(unit: MeasurementUnit): string {
  return unit === 'inch' ? 'measurements.unit_inch' : 'measurements.unit_cm';
}

/** The nearest quarter: tailors measure and speak in quarters, in inches and in cm alike. */
export const roundToQuarter = (value: number): number => Math.round(value * 4) / 4;

const QUARTER_GLYPH: Record<number, string> = { 0.25: '¼', 0.5: '½', 0.75: '¾' };

/** A value in display units as a whole number and its quarter: 20, 20 ¼, 20 ½, 20 ¾. */
function splitQuarter(cm: number, unit: MeasurementUnit): { whole: number; quarter: number } | null {
  if (!Number.isFinite(cm) || cm <= 0) return null;
  const inUnit = unit === 'inch' ? cm / CM_PER_INCH : cm;
  const q = roundToQuarter(inUnit);
  const whole = Math.floor(q);
  return { whole, quarter: q - whole };
}

/**
 * A stored measurement (cm) as the shop reads it, in its unit, to the nearest
 * quarter (seen-measurements-basic-advanced-task.md 2.1): 59.06 in shows "59",
 * 20.74 in shows "20 ¾". Western digits. Empty for nothing stored.
 *
 * The figure is left-to-right; in right-to-left text put it in a
 * `<bdi dir="ltr">` (or use measurementText) so ¾ stays after the 20.
 */
export function formatMeasurement(cm: number, unit: MeasurementUnit): string {
  const parts = splitQuarter(cm, unit);
  if (!parts) return '';
  const glyph = QUARTER_GLYPH[parts.quarter];
  if (!glyph) return String(parts.whole);
  return parts.whole > 0 ? `${parts.whole} ${glyph}` : glyph;
}

/**
 * The figure and its unit as plain text, for print and export: the figure is
 * isolated left-to-right (U+2066 ... U+2069) so "20 ¾ سم" keeps its order
 * inside Arabic text. '-' for nothing stored.
 */
export function measurementText(cm: number, unit: MeasurementUnit, unitLabel: string): string {
  const shown = formatMeasurement(cm, unit);
  if (!shown) return '-';
  return shown.includes(' ') || /[¼½¾]/.test(shown) ? `\u2066${shown}\u2069 ${unitLabel}` : `${shown} ${unitLabel}`;
}

/** The quarter as words, for screen readers and the voice wizard: "20 وثلاثة أرباع". */
export function spokenMeasurement(
  cm: number,
  unit: MeasurementUnit,
  words: { quarter: string; half: string; threeQuarters: string },
): string {
  const parts = splitQuarter(cm, unit);
  if (!parts) return '';
  const word = parts.quarter === 0.25 ? words.quarter : parts.quarter === 0.5 ? words.half : parts.quarter === 0.75 ? words.threeQuarters : '';
  return word ? `${parts.whole} ${word}` : String(parts.whole);
}

const GLYPH_VALUE: Record<string, number> = { '¼': 0.25, '½': 0.5, '¾': 0.75 };

/**
 * What a person types into a measurement field, in display units
 * (seen-measurements-basic-advanced-task.md 2.2): "20.75", "20 3/4", "20¾",
 * "٢٠٫٧٥", "20,5". 0 for an empty field (it clears it); null for anything
 * that is not a measurement, so the field keeps its value rather than guess.
 */
export function parseMeasurementInput(text: string): number | null {
  const s = text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫,]/g, '.')
    .replace(/⁄/g, '/')
    .trim()
    .replace(/\s+/g, ' ');
  if (s === '') return 0;
  // whole (optional), then a quarter glyph or a/b (optional); one of the two.
  const m = /^(\d+(?:\.\d+)?)?\s*(?:([¼½¾])|(\d+)\s*\/\s*(\d+))?$/.exec(s);
  if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) return null;
  const whole = m[1] !== undefined ? Number(m[1]) : 0;
  let fraction = 0;
  if (m[2]) fraction = GLYPH_VALUE[m[2]];
  if (m[3] !== undefined) {
    const num = Number(m[3]);
    const den = Number(m[4]);
    if (!(den > 0) || num >= den) return null;
    // "20 3" without a slash never gets here; a decimal whole with a fraction ("20.5 1/2") is not a measurement.
    if (m[1]?.includes('.')) return null;
    fraction = num / den;
  }
  if (m[2] && m[1]?.includes('.')) return null;
  const value = whole + fraction;
  return Number.isFinite(value) ? value : null;
}
