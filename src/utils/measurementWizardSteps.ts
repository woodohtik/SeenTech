// Duplicated verbatim from the ThobePart union in src/components/ThobeMeasurementSelector.tsx
// (that union is not exported there).
export type ThobePart = 'neck' | 'chest' | 'shoulder' | 'sleeve' | 'length' | 'handWidth' | 'midSleeveWidth' | 'cuffLength';

export const MEASUREMENT_WIZARD_ORDER: ThobePart[] = [
  'length',
  'shoulder',
  'sleeve',
  'chest',
  'neck',
  'handWidth',
  'midSleeveWidth',
  'cuffLength',
];

export function getNextMeasurementStep(currentIndex: number): ThobePart | null {
  return MEASUREMENT_WIZARD_ORDER[currentIndex + 1] ?? null;
}
