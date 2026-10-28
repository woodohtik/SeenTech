import { test, expect } from 'vitest';
import { getNextMeasurementStep, MEASUREMENT_WIZARD_ORDER } from './measurementWizardSteps';

test('starts at the first field', () => {
  expect(getNextMeasurementStep(-1)).toBe('neck');
});

test('advances through all 8 fields in order', () => {
  expect(MEASUREMENT_WIZARD_ORDER).toEqual(['neck', 'chest', 'waist', 'hips', 'shoulder', 'sleeve', 'length', 'bottomWidth']);
  expect(getNextMeasurementStep(0)).toBe('chest');
  expect(getNextMeasurementStep(6)).toBe('bottomWidth');
});

test('returns null after the last field', () => {
  expect(getNextMeasurementStep(7)).toBeNull();
});
