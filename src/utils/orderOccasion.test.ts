import { describe, expect, it } from 'vitest';
import { sortByOccasion, occasionOf } from './orderOccasion';

// seen-open-verticals-task.md, wave 1 (women's tailoring item 3): "nearest
// occasion first" -- the dated ones by date (urgent first on the same day),
// then the rest as they were.
const o = (id: string, occasion?: string | null, urgent = false) => ({ id, occasion_date: occasion ?? null, is_urgent: urgent });

describe('sortByOccasion', () => {
  it('nearest occasion first; undated ones after, in their order', () => {
    const list = [o('a'), o('b', '2027-03-01'), o('c', '2027-02-14'), o('d'), o('e', '2027-02-14', true)];
    expect(sortByOccasion(list).map((x) => x.id)).toEqual(['e', 'c', 'b', 'a', 'd']);
  });
  it('reads both spellings', () => {
    expect(occasionOf({ occasionDate: '2027-01-01', isUrgent: true })).toEqual({ date: '2027-01-01', urgent: true });
    expect(occasionOf({ occasion_date: null })).toEqual({ date: null, urgent: false });
  });
});
