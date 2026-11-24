import { describe, expect, it } from 'vitest';
import {
  ADVANCED_MEASUREMENT_KEYS,
  ALL_NUMERIC_MEASUREMENT_KEYS,
  BASIC_MEASUREMENT_KEYS,
  MEASUREMENT_FIELDS,
  MEASUREMENT_KEYS,
  LEGACY_MEASUREMENT_KEYS,
  countAdvancedValues,
  fieldsDownTheFigure,
  validateFieldNotes,
  hasAdvancedValues,
  measurementRows,
} from './measurementFields';
import { customerSchema } from '../lib/validations';
import { validateMeasurementsPayload } from '../server/validateMeasurementsPayload';

const allSixteen = Object.fromEntries(MEASUREMENT_KEYS.map((key, i) => [key, 10 + i]));

const BASIC = ['length', 'shoulder', 'sleeve', 'chest', 'neck', 'handWidth', 'midSleeveWidth', 'cuffLength', 'bottomWidth'];
const ADVANCED = ['sleeveCuff', 'sleeveTopWidth', 'sleeveHem', 'cuffWidth', 'waist', 'bottomHem', 'neckFold'];

// seen-measurements-basic-advanced-task.md (founder decision, 24 Nov 2026), acceptance 1.
describe('the approved measurement list', () => {
  it('has sixteen measurements: the nine basic in the founder order, then the seven advanced', () => {
    expect(MEASUREMENT_KEYS).toEqual([...BASIC, ...ADVANCED]);
    expect(BASIC_MEASUREMENT_KEYS).toEqual(BASIC);
    expect(ADVANCED_MEASUREMENT_KEYS).toEqual(ADVANCED);
    expect(new Set(MEASUREMENT_KEYS).size).toBe(16);
  });

  it('puts the body measurements on the right and the sleeve and cuff ones on the left', () => {
    expect(MEASUREMENT_FIELDS.filter((f) => f.side === 'right').map((f) => f.key).sort()).toEqual(
      ['bottomHem', 'bottomWidth', 'chest', 'length', 'neck', 'neckFold', 'shoulder', 'waist'],
    );
    expect(MEASUREMENT_FIELDS.filter((f) => f.side === 'left').map((f) => f.key).sort()).toEqual(
      ['cuffLength', 'cuffWidth', 'handWidth', 'midSleeveWidth', 'sleeve', 'sleeveCuff', 'sleeveHem', 'sleeveTopWidth'],
    );
  });

  it('the mid-sleeve width is entered again, on the sleeve side, up to 100 cm', () => {
    expect(MEASUREMENT_FIELDS.find((f) => f.key === 'midSleeveWidth')).toMatchObject({ side: 'left', zone: 'midSleeve', maxCm: 100, tier: 'basic' });
  });

  it('only the hips stay a retired key, still readable', () => {
    expect(LEGACY_MEASUREMENT_KEYS).toEqual(['hips']);
    expect(ALL_NUMERIC_MEASUREMENT_KEYS).toContain('hips');
    expect(MEASUREMENT_KEYS).not.toContain('hips');
  });

  it('orders each side down the thobe (task file question 5)', () => {
    // Five basic on the body side, four on the sleeve side.
    expect(fieldsDownTheFigure('right', false)).toEqual(['neck', 'shoulder', 'chest', 'length', 'bottomWidth']);
    expect(fieldsDownTheFigure('left', false)).toEqual(['midSleeveWidth', 'sleeve', 'handWidth', 'cuffLength']);
    expect(fieldsDownTheFigure('right', true)).toEqual(['neck', 'neckFold', 'shoulder', 'chest', 'waist', 'length', 'bottomWidth', 'bottomHem']);
    expect(fieldsDownTheFigure('left', true)).toEqual(['sleeveTopWidth', 'midSleeveWidth', 'sleeve', 'sleeveCuff', 'handWidth', 'sleeveHem', 'cuffLength', 'cuffWidth']);
  });
});

describe('measurementRows', () => {
  it('lists only filled values by default, in list order, retired ones last', () => {
    const rows = measurementRows({ neck: 40, midSleeveWidth: 14, hips: 100, length: 145, waist: 0, collarType: 'classic' });
    expect(rows.map((r) => r.key)).toEqual(['length', 'neck', 'midSleeveWidth', 'hips']);
    expect(rows[0]).toEqual({ key: 'length', labelKey: 'measurements.part_label.length', value: 145, note: '' });
  });

  it('with includeEmpty keeps all sixteen, and a retired key only when it has a value', () => {
    expect(measurementRows({}, true).map((r) => r.key)).toEqual(MEASUREMENT_KEYS);
    expect(measurementRows({ hips: 100 }, true)).toHaveLength(17);
    expect(measurementRows(null)).toEqual([]);
  });
});

describe('both validators accept every key in the list', () => {
  it('customerSchema keeps all sixteen and the retired hips through a save', () => {
    const measurements = { ...allSixteen, hips: 100 };
    const parsed = customerSchema.parse({ name: 'عميل تجربة', phone: '0500000000', measurements });
    expect(parsed.measurements).toMatchObject(measurements);
  });

  it('a customer with an old mid-sleeve width keeps it through a save', () => {
    const parsed = customerSchema.parse({ name: 'عميل تجربة', phone: '0500000000', measurements: { midSleeveWidth: 14.3 } });
    expect(parsed.measurements).toMatchObject({ midSleeveWidth: 14.3 });
  });

  it('the public form validator accepts all sixteen, the mid-sleeve width among them', () => {
    const result = validateMeasurementsPayload({ ...allSixteen });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatchObject(allSixteen);
  });
});

describe('advanced values', () => {
  it('counts advanced values: a stored waist opens the section, zeros and basics do not', () => {
    expect(hasAdvancedValues({ waist: 90 })).toBe(true);
    expect(hasAdvancedValues({ length: 145, chest: 110, waist: 0, midSleeveWidth: 14 })).toBe(false);
    expect(hasAdvancedValues(null)).toBe(false);
    // A note on an advanced measurement opens it too; a note on a basic one does not.
    expect(hasAdvancedValues({ fieldNotes: { waist: 'واسع شوي' } })).toBe(true);
    expect(hasAdvancedValues({ fieldNotes: { length: 'قصير' } })).toBe(false);
    expect(countAdvancedValues({ waist: 90, neckFold: 41, bottomHem: 5, length: 145 })).toBe(3);
  });
});

// seen-measurements-basic-advanced-task.md, section 2 and acceptance 3.
describe('a note per measurement', () => {
  it('measurementRows carries the note, and lists a measurement that has only a note', () => {
    const rows = measurementRows({ length: 145, fieldNotes: { length: 'قصّره نص', shoulder: 'كتف مايل' } });
    expect(rows.map((r) => [r.key, r.note])).toEqual([['length', 'قصّره نص'], ['shoulder', 'كتف مايل']]);
  });

  it('validateFieldNotes: list keys only, text only, trimmed, 80 characters at most, empty dropped', () => {
    expect(validateFieldNotes(undefined)).toEqual({ ok: true, value: undefined });
    expect(validateFieldNotes({ shoulder: '  كتف مايل  ', neck: '   ' })).toEqual({ ok: true, value: { shoulder: 'كتف مايل' } });
    expect(validateFieldNotes({ neck: '' })).toEqual({ ok: true, value: undefined });
    expect(validateFieldNotes({ shoulder: 'x'.repeat(80) }).ok).toBe(true);
    expect(validateFieldNotes({ shoulder: 'x'.repeat(81) })).toMatchObject({ ok: false, error: 'too_long', key: 'shoulder' });
    expect(validateFieldNotes({ collar: 'x' })).toMatchObject({ ok: false, error: 'unknown_key' });
    expect(validateFieldNotes({ shoulder: 3 })).toMatchObject({ ok: false, error: 'not_text' });
    expect(validateFieldNotes(['x'])).toMatchObject({ ok: false, error: 'not_an_object' });
  });

  it('customerSchema keeps the notes through a save, and refuses one of 81 characters', () => {
    const ok = customerSchema.parse({ name: 'عميل تجربة', phone: '0500000000', measurements: { length: 145, fieldNotes: { length: 'قصّره نص' } } });
    expect(ok.measurements).toMatchObject({ length: 145, fieldNotes: { length: 'قصّره نص' } });
    const tooLong = customerSchema.safeParse({ name: 'عميل تجربة', phone: '0500000000', measurements: { fieldNotes: { length: 'x'.repeat(81) } } });
    expect(tooLong.success).toBe(false);
  });

  it('the server validator accepts notes and refuses bad ones', () => {
    expect(validateMeasurementsPayload({ length: 145, fieldNotes: { length: 'قصّره نص' } })).toEqual({ ok: true, value: { length: 145, fieldNotes: { length: 'قصّره نص' } } });
    expect(validateMeasurementsPayload({ fieldNotes: { collar: 'x' } }).ok).toBe(false);
    expect(validateMeasurementsPayload({ fieldNotes: { length: 5 } }).ok).toBe(false);
    expect(validateMeasurementsPayload({ fieldNotes: { length: 'x'.repeat(81) } }).ok).toBe(false);
  });
});
