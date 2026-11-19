import { describe, expect, it } from 'vitest';
import { contentToMeters, metersToContent, splitStockByUom } from './fabricUomConverter';
import { needsRollContent, resolveUnitColumns, unitFieldsFromItem } from './itemUnits';

const base = { conversionRate: 1, rollContent: 0, contentUnit: 'yard' as const };

describe('roll content conversion', () => {
  it('stores 25 yards as 22.86 meters and shows it back as 25 yards', () => {
    expect(contentToMeters(25, 'yard')).toBe(22.86);
    expect(metersToContent(22.86, 'yard')).toBe(25);
  });

  it('keeps meters unchanged', () => {
    expect(contentToMeters(30, 'meter')).toBe(30);
    expect(metersToContent(30, 'meter')).toBe(30);
  });

  it('5 rolls of 25 yards is 114.30 meters and splits back into exactly 5 rolls', () => {
    const rate = contentToMeters(25, 'yard');
    expect(Number((5 * rate).toFixed(2))).toBe(114.3);
    expect(splitStockByUom(5 * rate, rate)).toEqual({ largeUnits: 5, remainingBase: 0 });
  });
});

describe('resolveUnitColumns', () => {
  it('fabric by the roll: rate in meters, content unit as typed, base meter', () => {
    expect(resolveUnitColumns({ ...base, category: 'fabric', unit: 'roll', rollContent: 25 })).toEqual({
      conversion_rate: 22.86, content_unit: 'yard', base_unit: 'meter',
    });
    expect(resolveUnitColumns({ ...base, category: 'fabric', unit: 'roll', rollContent: 30, contentUnit: 'meter' })).toEqual({
      conversion_rate: 30, content_unit: 'meter', base_unit: 'meter',
    });
  });

  it('fabric by the meter or yard needs no roll content', () => {
    expect(resolveUnitColumns({ ...base, category: 'fabric', unit: 'meter' })).toEqual({
      conversion_rate: 1, content_unit: null, base_unit: 'meter',
    });
    expect(resolveUnitColumns({ ...base, category: 'fabric', unit: 'yard' })).toEqual({
      conversion_rate: 0.9144, content_unit: 'yard', base_unit: 'meter',
    });
  });

  it('non-fabric: rate 1, piece base, existing rate preserved', () => {
    expect(resolveUnitColumns({ ...base, category: 'button', unit: 'piece' })).toEqual({
      conversion_rate: 1, content_unit: null, base_unit: 'piece',
    });
    expect(resolveUnitColumns({ ...base, category: 'button', unit: 'box', conversionRate: 12 }).conversion_rate).toBe(12);
  });
});

describe('needsRollContent / unitFieldsFromItem', () => {
  it('asks for roll content only for fabric in rolls', () => {
    expect(needsRollContent({ category: 'fabric', unit: 'roll' })).toBe(true);
    expect(needsRollContent({ category: 'fabric', unit: 'meter' })).toBe(false);
    expect(needsRollContent({ category: 'button', unit: 'roll' })).toBe(false);
  });

  it('reopens a stored item in the unit it was typed in', () => {
    expect(unitFieldsFromItem({ conversion_rate: 22.86, content_unit: 'yard' })).toEqual({
      conversionRate: 22.86, contentUnit: 'yard', rollContent: 25,
    });
    expect(unitFieldsFromItem({ conversion_rate: '25', content_unit: null })).toEqual({
      conversionRate: 25, contentUnit: 'meter', rollContent: 25,
    });
  });
});
