import { test, expect } from 'vitest';
import { getNextMeasurementStep, MEASUREMENT_WIZARD_ORDER, measurementWizardOrder } from './measurementWizardSteps';

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

// seen-measurements-basic-advanced-task.md, acceptance 4.
test('reads the seven basic measurements while the advanced section is closed', () => {
  const order = measurementWizardOrder(false);
  expect(order).toEqual(['length', 'shoulder', 'sleeve', 'handWidth', 'cuffLength', 'chest', 'neck']);
  expect(getNextMeasurementStep(-1, order)).toBe('length');
  expect(getNextMeasurementStep(6, order)).toBeNull();
});

test('reads all fifteen when the advanced section is open', () => {
  const order = measurementWizardOrder(true);
  expect(order).toHaveLength(15);
  expect(order).toEqual(MEASUREMENT_WIZARD_ORDER);
});
