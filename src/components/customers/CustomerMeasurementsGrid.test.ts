import { expect, test } from 'vitest';
import { splitMeasurements } from './CustomerMeasurementsGrid';

// seen-merchant-trial-test-2026-11-26.md, phase 2 item 4: empty measurements
// crowded the profile as "- inch" cards.
test('filled measurements are cards; empty ones are only named', () => {
  const { filled, empty } = splitMeasurements({ length: 145, sleeve: 62, shoulder: 0 });
  expect(filled.map((r) => r.key)).toEqual(expect.arrayContaining(['length', 'sleeve']));
  expect(filled.some((r) => r.key === 'shoulder')).toBe(false);
  expect(empty.length).toBeGreaterThan(0);
  expect(empty.every((r) => !(r.value > 0))).toBe(true);
});

test('a measurement with only a note still shows as a card', () => {
  const { filled, empty } = splitMeasurements({ length: 145, fieldNotes: { shoulder: 'كتف مائل' } });
  expect(filled.find((r) => r.key === 'shoulder')?.note).toBe('كتف مائل');
  expect(empty.some((r) => r.key === 'shoulder')).toBe(false);
});
