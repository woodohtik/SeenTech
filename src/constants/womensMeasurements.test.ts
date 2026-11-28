import { describe, expect, it } from 'vitest';
import {
  ALL_NUMERIC_MEASUREMENT_KEYS, measurementRows, measurementSetFor, WOMENS_MEASUREMENT_FIELDS, womensFieldsInColumn,
} from './measurementFields';
import { customerSchema } from '../lib/validations';

// seen-open-verticals-task.md, wave 1 (question 2's default): the women's
// list -- ten basic, six behind "advanced", each with a note, Enter to the
// next -- on the shared measurement data; men's tailoring unchanged.
describe("women's measurements", () => {
  it('ten basic, then six advanced, in order', () => {
    const basic = WOMENS_MEASUREMENT_FIELDS.filter((f) => f.tier === 'basic').map((f) => f.key);
    const advanced = WOMENS_MEASUREMENT_FIELDS.filter((f) => f.tier === 'advanced').map((f) => f.key);
    expect(basic).toEqual(['length', 'shoulder', 'chest', 'waist', 'hips', 'sleeve', 'sleeveTopWidth', 'handWidth', 'neck', 'bottomWidth']);
    expect(advanced).toEqual(['underBust', 'backLength', 'backWidth', 'bustPointLength', 'sideLength', 'frontWaistLength']);
    expect(WOMENS_MEASUREMENT_FIELDS.map((f) => f.slot)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });

  it("a women's tailoring shop now has measurements", () => {
    expect(measurementSetFor('womens').length).toBe(16);
    expect(measurementSetFor('thobe').length).toBe(16);
  });

  it('two columns: basic 1-5 | 6-10, advanced 11-13 | 14-16', () => {
    expect(womensFieldsInColumn('start', 'basic')).toEqual(['length', 'shoulder', 'chest', 'waist', 'hips']);
    expect(womensFieldsInColumn('end', 'advanced')).toEqual(['bustPointLength', 'sideLength', 'frontWaistLength']);
  });

  it('a saved customer keeps the women-only measurements (the schema does not strip them)', () => {
    for (const k of ['underBust', 'backLength', 'backWidth', 'bustPointLength', 'sideLength', 'frontWaistLength']) {
      expect(ALL_NUMERIC_MEASUREMENT_KEYS).toContain(k);
    }
    const parsed = customerSchema.safeParse({ name: 'عميلة', phone: '0501234567', measurements: { chest: 92, underBust: 78, backLength: 40 } });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.measurements).toMatchObject({ chest: 92, underBust: 78, backLength: 40 });
  });

  it("rows: the women's set in its order with its own labels; men's rows unchanged", () => {
    const m = { chest: 92, underBust: 78 };
    const womens = measurementRows(m, false, 'womens');
    expect(womens.map((r) => r.key)).toEqual(['chest', 'underBust']);
    expect(womens[0].labelKey).toBe('measurements.part_label_womens.chest');
    const thobe = measurementRows(m, true);
    expect(thobe.map((r) => r.key)).not.toContain('underBust');
    expect(thobe.find((r) => r.key === 'chest')!.labelKey).toBe('measurements.part_label.chest');
  });
});
