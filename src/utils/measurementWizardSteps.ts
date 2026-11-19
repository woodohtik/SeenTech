import { MEASUREMENT_KEYS, type MeasurementKey } from '../constants/measurementFields';

export type ThobePart = MeasurementKey;

/** The approved list, in the founder's order: Tab and the voice wizard both follow it. */
export const MEASUREMENT_WIZARD_ORDER: readonly ThobePart[] = MEASUREMENT_KEYS;

export function getNextMeasurementStep(currentIndex: number): ThobePart | null {
  return MEASUREMENT_WIZARD_ORDER[currentIndex + 1] ?? null;
}
