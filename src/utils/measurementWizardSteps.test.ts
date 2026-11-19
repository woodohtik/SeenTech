import { test, expect } from 'vitest';
import { getNextMeasurementStep, MEASUREMENT_WIZARD_ORDER } from './measurementWizardSteps';

test('starts at the first field', () => {
  expect(getNextMeasurementStep(-1)).toBe('length');
});

test('walks the fifteen approved measurements in the founder\'s order', () => {
  expect(MEASUREMENT_WIZARD_ORDER).toEqual([
    'length', 'shoulder', 'sleeveCuff', 'sleeve', 'sleeveTopWidth', 'handWidth', 'sleeveHem',
    'cuffLength', 'cuffWidth', 'waist', 'chest', 'bottomHem', 'bottomWidth', 'neck', 'neckFold',
  ]);
  expect(getNextMeasurementStep(0)).toBe('shoulder');
  expect(getNextMeasurementStep(13)).toBe('neckFold');
});

test('returns null after the last field', () => {
  expect(getNextMeasurementStep(14)).toBeNull();
});
