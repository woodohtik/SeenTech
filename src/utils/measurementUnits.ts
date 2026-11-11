export type MeasurementUnit = 'cm' | 'inch';

const CM_PER_INCH = 2.54;

export function isValidMeasurementUnit(value: unknown): value is MeasurementUnit {
  return value === 'cm' || value === 'inch';
}

// 2 decimals (not 1) so quarter-inch fractions (.25/.5/.75) -- the ones
// FractionPicker actually offers -- survive a cm round-trip exactly instead
// of collapsing onto the nearest 0.1 (e.g. .25 -> .2, .75 -> .7).
const round2 = (value: number): number => Math.round(value * 100) / 100;

export function cmToDisplayUnit(cm: number, unit: MeasurementUnit): number {
  return unit === 'inch' ? round2(cm / CM_PER_INCH) : cm;
}

export function displayUnitToCm(value: number, unit: MeasurementUnit): number {
  return unit === 'inch' ? round2(value * CM_PER_INCH) : value;
}

export function unitLabelKey(unit: MeasurementUnit): string {
  return unit === 'inch' ? 'measurements.unit_inch' : 'measurements.unit_cm';
}
