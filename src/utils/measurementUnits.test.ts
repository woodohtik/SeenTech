import { test, expect } from 'vitest';
import { isValidMeasurementUnit, cmToDisplayUnit, displayUnitToCm, unitLabelKey } from './measurementUnits';

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

test('converts inch to cm, rounded to the nearest 0.01', () => {
  expect(displayUnitToCm(15.7, 'inch')).toBe(39.88); // 15.7 * 2.54 = 39.878
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
