export type MeasurementUnit = 'cm' | 'inch';

const CM_PER_INCH = 2.54;

export function isValidMeasurementUnit(value: unknown): value is MeasurementUnit {
  return value === 'cm' || value === 'inch';
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

export function cmToDisplayUnit(cm: number, unit: MeasurementUnit): number {
  return unit === 'inch' ? round1(cm / CM_PER_INCH) : cm;
}

export function displayUnitToCm(value: number, unit: MeasurementUnit): number {
  return unit === 'inch' ? round1(value * CM_PER_INCH) : value;
}

export function unitLabelKey(unit: MeasurementUnit): string {
  return unit === 'inch' ? 'measurements.unit_inch' : 'measurements.unit_cm';
}
