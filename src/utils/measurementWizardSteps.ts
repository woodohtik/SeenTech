// Duplicated verbatim from the ThobePart union in src/components/ThobeMeasurementSelector.tsx
// (that union is not exported there).
export type ThobePart = 'neck' | 'chest' | 'waist' | 'hips' | 'shoulder' | 'sleeve' | 'length' | 'bottomWidth';

export const MEASUREMENT_WIZARD_ORDER: ThobePart[] = [
  'neck',
  'chest',
  'waist',
  'hips',
  'shoulder',
  'sleeve',
  'length',
  'bottomWidth',
];

export function getNextMeasurementStep(currentIndex: number): ThobePart | null {
  return MEASUREMENT_WIZARD_ORDER[currentIndex + 1] ?? null;
}
