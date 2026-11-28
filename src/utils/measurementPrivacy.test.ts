import { describe, expect, it } from 'vitest';
import { canSeeMeasurements, MEASUREMENTS_PERMISSION } from './measurementPrivacy';

// seen-open-verticals-task.md, wave 1 (question 6's default): in a women's
// shop the customers' measurements are seen only with «عرض مقاسات العملاء»
// (owner, manager, the tailors -- not the cashier). Men's tailoring unchanged.
describe('canSeeMeasurements', () => {
  const allow = (key: string) => key === MEASUREMENTS_PERMISSION;
  const deny = () => false;
  it("a women's shop: only with the permission", () => {
    expect(canSeeMeasurements('womens', allow)).toBe(true);
    expect(canSeeMeasurements('womens', deny)).toBe(false);
  });
  it("men's tailoring: as before, for everyone who sees the customer", () => {
    expect(canSeeMeasurements('thobe', deny)).toBe(true);
  });
  it('a shop that takes none: nothing to show', () => {
    expect(canSeeMeasurements(null, allow)).toBe(false);
  });
});
