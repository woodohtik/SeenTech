import { describe, expect, test } from 'vitest';
import { MEASUREMENT_FIELDS, MEASUREMENT_SETS, measurementSetFor } from './measurementFields';

// seen-verticals-readiness-task.md Phase 4; the list itself:
// seen-measurements-basic-advanced-task.md (founder decision, 24 Nov 2026).
describe('measurement sets', () => {
  test('the thobe set is the 16 fields, in the founder\'s order', () => {
    expect(MEASUREMENT_SETS.thobe).toBe(MEASUREMENT_FIELDS);
    expect(MEASUREMENT_SETS.thobe.map((f) => [f.key, f.side, f.zone, f.maxCm, f.tier])).toEqual([
      ['length', 'right', 'length', 300, 'basic'],
      ['shoulder', 'right', 'shoulder', 100, 'basic'],
      ['sleeve', 'left', 'sleeve', 150, 'basic'],
      ['chest', 'right', 'chest', 200, 'basic'],
      ['neck', 'right', 'neck', 100, 'basic'],
      ['handWidth', 'left', 'wrist', 100, 'basic'],
      ['midSleeveWidth', 'left', 'midSleeve', 100, 'basic'],
      ['cuffLength', 'left', 'cuff', 100, 'basic'],
      ['bottomWidth', 'right', 'bottomWidth', 200, 'basic'],
      ['sleeveCuff', 'left', 'sleeve', 150, 'advanced'],
      ['sleeveTopWidth', 'left', 'sleeveTop', 100, 'advanced'],
      ['sleeveHem', 'left', 'cuff', 50, 'advanced'],
      ['cuffWidth', 'left', 'cuffWidth', 50, 'advanced'],
      ['waist', 'right', 'waist', 200, 'advanced'],
      ['bottomHem', 'right', 'bottomHem', 50, 'advanced'],
      ['neckFold', 'right', 'neck', 100, 'advanced'],
    ]);
  });

  test("a shop's set from its activity: thobe for men's tailoring; none (section hidden) otherwise", () => {
    expect(measurementSetFor('thobe')).toHaveLength(16);
    // The women's list waits for the founder's approval (task file question 4).
    expect(measurementSetFor('womens')).toHaveLength(0);
    expect(measurementSetFor(null)).toHaveLength(0);
    expect(measurementSetFor(undefined)).toHaveLength(0);
    expect(measurementSetFor('unknown')).toHaveLength(0);
  });
});
