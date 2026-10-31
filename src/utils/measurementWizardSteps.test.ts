import { test, expect } from 'vitest';
import { getNextMeasurementStep, MEASUREMENT_WIZARD_ORDER } from './measurementWizardSteps';

test('starts at the first field', () => {
  expect(getNextMeasurementStep(-1)).toBe('length');
});

test('advances through all 8 fields in the new order', () => {
  expect(MEASUREMENT_WIZARD_ORDER).toEqual([
    'length', 'shoulder', 'sleeve', 'chest', 'neck', 'handWidth', 'midSleeveWidth', 'cuffLength',
  ]);
  expect(getNextMeasurementStep(0)).toBe('shoulder');
  expect(getNextMeasurementStep(6)).toBe('cuffLength');
});

test('returns null after the last field', () => {
  expect(getNextMeasurementStep(7)).toBeNull();
});
