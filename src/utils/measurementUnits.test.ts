import { describe, test, expect } from 'vitest';
import { isValidMeasurementUnit, cmToDisplayUnit, displayUnitToCm, unitLabelKey, formatMeasurement, parseMeasurementInput, roundToQuarter, spokenMeasurement } from './measurementUnits';

test('isValidMeasurementUnit accepts only cm and inch', () => {
  expect(isValidMeasurementUnit('cm')).toBe(true);
  expect(isValidMeasurementUnit('inch')).toBe(true);
  expect(isValidMeasurementUnit('foo')).toBe(false);
  expect(isValidMeasurementUnit(undefined)).toBe(false);
  expect(isValidMeasurementUnit(null)).toBe(false);
  expect(isValidMeasurementUnit(123)).toBe(false);
});

test('cm stays unchanged in cm mode', () => {
  expect(cmToDisplayUnit(40, 'cm')).toBe(40);
});

test('converts cm to inch, rounded to the nearest 0.01', () => {
  expect(cmToDisplayUnit(40, 'inch')).toBe(15.75); // 40 / 2.54 = 15.748...
});

test('value stays unchanged in cm mode', () => {
  expect(displayUnitToCm(40, 'cm')).toBe(40);
});

test('converts inch to cm without rounding early (kept to 0.0001 cm)', () => {
  // seen-measurements-basic-advanced-task.md 2.3: a chosen quarter is stored
  // precisely enough to come back as the same quarter.
  expect(displayUnitToCm(15.7, 'inch')).toBe(39.878); // 15.7 * 2.54
  expect(displayUnitToCm(20.75, 'inch')).toBe(52.705);
});

test('a value round-trips through inch and back to cm within 0.1', () => {
  const original = 100;
  const asInch = cmToDisplayUnit(original, 'inch');
  const backToCm = displayUnitToCm(asInch, 'inch');
  expect(Math.abs(backToCm - original)).toBeLessThanOrEqual(0.1);
});

test('quarter-inch fractions (ربع/نصف/ثلاثة أرباع) survive a cm round-trip exactly', () => {
  for (const fraction of [0.25, 0.5, 0.75]) {
    const cm = displayUnitToCm(fraction, 'inch');
    expect(cmToDisplayUnit(cm, 'inch')).toBe(fraction);
  }
});

test('unitLabelKey returns the i18n key for each unit', () => {
  expect(unitLabelKey('cm')).toBe('measurements.unit_cm');
  expect(unitLabelKey('inch')).toBe('measurements.unit_inch');
});

// seen-measurements-basic-advanced-task.md, section 2 and acceptance 3.
describe('formatMeasurement: to the nearest quarter, never two decimals', () => {
  test.each([
    [59.06 * 2.54, 'inch', '59'],
    [20.74 * 2.54, 'inch', '20 ¾'],
    [20 * 2.54, 'inch', '20'],
    [20.25 * 2.54, 'inch', '20 ¼'],
    [20.5 * 2.54, 'inch', '20 ½'],
    [145, 'cm', '145'],
    [145.3, 'cm', '145 ¼'],
    [145.4, 'cm', '145 ½'],
    [145.9, 'cm', '146'],
    [0.5, 'cm', '½'],
  ] as const)('%s cm in %s shows %s', (cm, unit, shown) => {
    expect(formatMeasurement(cm, unit)).toBe(shown);
  });

  test('nothing stored shows nothing', () => {
    expect(formatMeasurement(0, 'cm')).toBe('');
    expect(formatMeasurement(Number.NaN, 'inch')).toBe('');
  });

  test('no value from 0 to 300 cm ever shows a decimal point', () => {
    for (let cm = 0.1; cm < 300; cm += 0.37) {
      for (const unit of ['cm', 'inch'] as const) expect(formatMeasurement(cm, unit)).not.toMatch(/[.,٫]/);
    }
  });
});

describe('parseMeasurementInput: what a person types', () => {
  test.each([
    ['20.75', 20.75],
    ['20 3/4', 20.75],
    ['20¾', 20.75],
    ['20 ¾', 20.75],
    ['٢٠٫٧٥', 20.75],
    ['٢٠٫٥', 20.5],
    ['20,5', 20.5],
    ['20', 20],
    ['  21 ½ ', 21.5],
    ['3/4', 0.75],
    ['½', 0.5],
    ['20 1/2', 20.5],
  ])('%s is %s', (text, value) => {
    expect(parseMeasurementInput(text)).toBe(value);
  });

  test.each(['', '   '])('empty (%j) clears the field', (text) => {
    expect(parseMeasurementInput(text)).toBe(0);
  });

  test.each(['abc', '20 3', '20/0', '-5', '20..5', '1/2/3', '20 ¾ ½'])('%j is not a measurement', (text) => {
    expect(parseMeasurementInput(text)).toBeNull();
  });
});

describe('a chosen quarter comes back as the same quarter', () => {
  test.each(['inch', 'cm'] as const)('in %s, for every quarter from 10 to 80', (unit) => {
    for (let q = 10; q <= 80; q += 0.25) {
      const stored = displayUnitToCm(q, unit);
      expect(formatMeasurement(stored, unit)).toBe(formatMeasurement(displayUnitToCm(q, unit), unit));
      expect(roundToQuarter(cmToDisplayUnit(stored, unit))).toBe(q);
    }
  });

  test('a typed "20 3/4" inch is saved and shown as 20 ¾', () => {
    const cm = displayUnitToCm(parseMeasurementInput('20 3/4')!, 'inch');
    expect(formatMeasurement(cm, 'inch')).toBe('20 ¾');
  });
});

describe('spokenMeasurement: for screen readers and the voice wizard', () => {
  const words = { quarter: 'وربع', half: 'ونص', threeQuarters: 'وثلاثة أرباع' };
  test('reads the quarter as a word', () => {
    expect(spokenMeasurement(20.75 * 2.54, 'inch', words)).toBe('20 وثلاثة أرباع');
    expect(spokenMeasurement(20.5, 'cm', words)).toBe('20 ونص');
    expect(spokenMeasurement(20, 'cm', words)).toBe('20');
  });
});
