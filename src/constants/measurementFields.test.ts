import { describe, expect, it } from 'vitest';
import {
  ADVANCED_MEASUREMENT_KEYS,
  ALL_NUMERIC_MEASUREMENT_KEYS,
  BASIC_MEASUREMENT_KEYS,
  MEASUREMENT_FIELDS,
  MEASUREMENT_KEYS,
  countAdvancedValues,
  hasAdvancedValues,
  measurementRows,
} from './measurementFields';
import { customerSchema } from '../lib/validations';
import { validateMeasurementsPayload } from '../server/validateMeasurementsPayload';

const allFifteen = Object.fromEntries(MEASUREMENT_KEYS.map((key, i) => [key, 10 + i]));

describe('the approved measurement list', () => {
  it('has fifteen measurements in the founder\'s order', () => {
    expect(MEASUREMENT_KEYS).toEqual([
      'length', 'shoulder', 'sleeveCuff', 'sleeve', 'sleeveTopWidth', 'handWidth', 'sleeveHem',
      'cuffLength', 'cuffWidth', 'waist', 'chest', 'bottomHem', 'bottomWidth', 'neck', 'neckFold',
    ]);
  });

  it('puts eight body measurements on the right and seven sleeve and cuff ones on the left', () => {
    expect(MEASUREMENT_FIELDS.filter((f) => f.side === 'right').map((f) => f.key)).toEqual([
      'length', 'shoulder', 'waist', 'chest', 'bottomHem', 'bottomWidth', 'neck', 'neckFold',
    ]);
    expect(MEASUREMENT_FIELDS.filter((f) => f.side === 'left').map((f) => f.key)).toEqual([
      'sleeveCuff', 'sleeve', 'sleeveTopWidth', 'handWidth', 'sleeveHem', 'cuffLength', 'cuffWidth',
    ]);
  });

  it('keeps the two retired keys readable', () => {
    expect(ALL_NUMERIC_MEASUREMENT_KEYS).toContain('midSleeveWidth');
    expect(ALL_NUMERIC_MEASUREMENT_KEYS).toContain('hips');
    expect(MEASUREMENT_KEYS).not.toContain('midSleeveWidth');
    expect(MEASUREMENT_KEYS).not.toContain('hips');
  });
});

describe('measurementRows', () => {
  it('lists only filled values by default, in list order, retired ones last', () => {
    const rows = measurementRows({ neck: 40, midSleeveWidth: 14, length: 145, waist: 0, collarType: 'classic' });
    expect(rows.map((r) => r.key)).toEqual(['length', 'neck', 'midSleeveWidth']);
    expect(rows[0]).toEqual({ key: 'length', labelKey: 'measurements.part_label.length', value: 145 });
  });

  it('with includeEmpty keeps all fifteen, and a retired key only when it has a value', () => {
    expect(measurementRows({}, true).map((r) => r.key)).toEqual(MEASUREMENT_KEYS);
    expect(measurementRows({ hips: 100 }, true)).toHaveLength(16);
    expect(measurementRows(null)).toEqual([]);
  });
});

describe('both validators accept every key in the list', () => {
  it('customerSchema keeps all fifteen and the retired two through a save', () => {
    const measurements = { ...allFifteen, midSleeveWidth: 14, hips: 100 };
    const parsed = customerSchema.parse({ name: 'عميل تجربة', phone: '0500000000', measurements });
    expect(parsed.measurements).toMatchObject(measurements);
  });

  it('the public form validator accepts all fifteen without an unknown-field error', () => {
    const result = validateMeasurementsPayload({ ...allFifteen, midSleeveWidth: 14 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatchObject(allFifteen);
  });
});

// seen-measurements-basic-advanced-task.md, acceptance 1.
describe('basic and advanced measurements', () => {
  it('seven basic and eight advanced, together the fifteen in the same order', () => {
    expect(BASIC_MEASUREMENT_KEYS).toEqual(['length', 'shoulder', 'sleeve', 'handWidth', 'cuffLength', 'chest', 'neck']);
    expect(ADVANCED_MEASUREMENT_KEYS).toEqual(['sleeveCuff', 'sleeveTopWidth', 'sleeveHem', 'cuffWidth', 'waist', 'bottomHem', 'bottomWidth', 'neckFold']);
    const merged = MEASUREMENT_KEYS.filter((k) => BASIC_MEASUREMENT_KEYS.includes(k) || ADVANCED_MEASUREMENT_KEYS.includes(k));
    expect(merged).toEqual(MEASUREMENT_KEYS);
    expect(new Set([...BASIC_MEASUREMENT_KEYS, ...ADVANCED_MEASUREMENT_KEYS]).size).toBe(15);
  });

  it('the mid-sleeve width stays out of entry', () => {
    expect(MEASUREMENT_KEYS).not.toContain('midSleeveWidth');
    expect(MEASUREMENT_FIELDS.every((f) => f.tier === 'basic' || f.tier === 'advanced')).toBe(true);
  });

  it('counts advanced values: a stored waist opens the section, zeros and basics do not', () => {
    expect(hasAdvancedValues({ waist: 90 })).toBe(true);
    expect(hasAdvancedValues({ length: 145, chest: 110, waist: 0 })).toBe(false);
    expect(hasAdvancedValues(null)).toBe(false);
    expect(countAdvancedValues({ waist: 90, neckFold: 41, bottomHem: 5, length: 145 })).toBe(3);
  });
});
