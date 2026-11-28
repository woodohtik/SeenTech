import { describe, expect, it } from 'vitest';
import { remnantAgeDays } from './ConvertToRemnantDialog';

// seen-open-verticals-task.md, wave 1 (fabric stores item 3): a remnant's age,
// to mark the old ones down.
describe('remnantAgeDays', () => {
  it('whole days since it was made', () => {
    expect(remnantAgeDays('2027-01-01T10:00:00Z', new Date('2027-01-11T09:00:00Z'))).toBe(9);
    expect(remnantAgeDays(null)).toBe(0);
    expect(remnantAgeDays('2027-02-01T00:00:00Z', new Date('2027-01-01T00:00:00Z'))).toBe(0);
  });
});
