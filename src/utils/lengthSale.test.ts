import { describe, expect, test } from 'vitest';
import { stepMeters, toMeters, fromMeters, firstLengthQuantity, LENGTH_STEP_METERS } from './lengthSale';

// seen-verticals-readiness-task.md Phase 5.
describe('selling by length', () => {
  test('± moves by a quarter metre, never below one step', () => {
    expect(stepMeters(2.25, 1)).toBe(2.5);
    expect(stepMeters(2.5, -1)).toBe(2.25);
    expect(stepMeters(0.25, -1)).toBe(LENGTH_STEP_METERS);
    expect(stepMeters(0.1 + 0.2, 1)).toBe(0.55);
  });

  test('yards and rolls become metres; metres are kept to the centimetre', () => {
    expect(toMeters(2.5, 'meter', 30)).toBe(2.5);
    expect(toMeters(1, 'yard', 30)).toBe(0.91);
    expect(toMeters(1, 'roll', 30)).toBe(30);
    expect(toMeters(0, 'meter', 30)).toBeNull();
    expect(toMeters(1, 'roll', 0)).toBeNull();
    expect(fromMeters(30, 'roll', 30)).toBe(1);
    expect(fromMeters(0.9144, 'yard', 30)).toBe(1);
  });

  test('a new line starts at one metre, or what is left', () => {
    expect(firstLengthQuantity(30)).toBe(1);
    expect(firstLengthQuantity(0.6)).toBe(0.6);
  });
});
