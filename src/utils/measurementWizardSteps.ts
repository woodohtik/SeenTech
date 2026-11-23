import { BASIC_MEASUREMENT_KEYS, MEASUREMENT_KEYS, type MeasurementKey } from '../constants/measurementFields';

export type ThobePart = MeasurementKey;

/** The approved list, in the founder's order: Tab and the voice wizard both follow it. */
export const MEASUREMENT_WIZARD_ORDER: readonly ThobePart[] = MEASUREMENT_KEYS;

/**
 * The fields the voice wizard reads (task file question 3): the seven basic
 * ones, and all fifteen when the advanced section is open -- the wizard fills
 * what is on screen.
 */
export function measurementWizardOrder(includeAdvanced: boolean): readonly ThobePart[] {
  return includeAdvanced ? MEASUREMENT_KEYS : BASIC_MEASUREMENT_KEYS;
}

export function getNextMeasurementStep(currentIndex: number, order: readonly ThobePart[] = MEASUREMENT_WIZARD_ORDER): ThobePart | null {
  return order[currentIndex + 1] ?? null;
}
