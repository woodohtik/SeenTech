import { test, expect } from 'vitest';
import { getNextMeasurementStep, MEASUREMENT_WIZARD_ORDER, measurementWizardOrder } from './measurementWizardSteps';

const BASIC = ['length', 'shoulder', 'sleeve', 'chest', 'neck', 'handWidth', 'midSleeveWidth', 'cuffLength', 'bottomWidth'];

test('starts at the first field', () => {
  expect(getNextMeasurementStep(-1)).toBe('length');
});

test('walks the sixteen approved measurements in the founder\'s order', () => {
  expect(MEASUREMENT_WIZARD_ORDER).toEqual([
    ...BASIC, 'sleeveCuff', 'sleeveTopWidth', 'sleeveHem', 'cuffWidth', 'waist', 'bottomHem', 'neckFold',
  ]);
  expect(getNextMeasurementStep(0)).toBe('shoulder');
  expect(getNextMeasurementStep(14)).toBe('neckFold');
});

test('returns null after the last field', () => {
  expect(getNextMeasurementStep(15)).toBeNull();
});

// seen-measurements-basic-advanced-task.md, acceptance 5.
test('reads the nine basic measurements while the advanced section is closed', () => {
  const order = measurementWizardOrder(false);
  expect(order).toEqual(BASIC);
  expect(getNextMeasurementStep(-1, order)).toBe('length');
  expect(getNextMeasurementStep(8, order)).toBeNull();
});

test('reads all sixteen when the advanced section is open', () => {
  const order = measurementWizardOrder(true);
  expect(order).toHaveLength(16);
  expect(order).toEqual(MEASUREMENT_WIZARD_ORDER);
});
