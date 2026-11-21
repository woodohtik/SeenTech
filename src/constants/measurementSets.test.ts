import { describe, expect, test } from 'vitest';
import { MEASUREMENT_FIELDS, MEASUREMENT_SETS, measurementSetFor } from './measurementFields';

// seen-verticals-readiness-task.md Phase 4.
describe('measurement sets', () => {
  test('the thobe set is the 15 fields, in the founder\'s order, unchanged', () => {
    expect(MEASUREMENT_SETS.thobe).toBe(MEASUREMENT_FIELDS);
    expect(MEASUREMENT_SETS.thobe.map((f) => [f.key, f.side, f.zone, f.maxCm])).toEqual([
      ['length', 'right', 'length', 300],
      ['shoulder', 'right', 'shoulder', 100],
      ['sleeveCuff', 'left', 'sleeve', 150],
      ['sleeve', 'left', 'sleeve', 150],
      ['sleeveTopWidth', 'left', 'sleeveTop', 100],
      ['handWidth', 'left', 'wrist', 100],
      ['sleeveHem', 'left', 'cuff', 50],
      ['cuffLength', 'left', 'cuff', 100],
      ['cuffWidth', 'left', 'cuffWidth', 50],
      ['waist', 'right', 'waist', 200],
      ['chest', 'right', 'chest', 200],
      ['bottomHem', 'right', 'bottomHem', 50],
      ['bottomWidth', 'right', 'bottomWidth', 200],
      ['neck', 'right', 'neck', 100],
      ['neckFold', 'right', 'neck', 100],
    ]);
  });

  test("a shop's set from its activity: thobe for men's tailoring; none (section hidden) otherwise", () => {
    expect(measurementSetFor('thobe')).toHaveLength(15);
    // The women's list waits for the founder's approval (task file question 4).
    expect(measurementSetFor('womens')).toHaveLength(0);
    expect(measurementSetFor(null)).toHaveLength(0);
    expect(measurementSetFor(undefined)).toHaveLength(0);
    expect(measurementSetFor('unknown')).toHaveLength(0);
  });
});
