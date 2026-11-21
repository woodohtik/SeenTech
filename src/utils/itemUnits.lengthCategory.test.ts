import { afterEach, describe, expect, test } from 'vitest';
import { isLengthCategory, isLengthItem, isFabricCategory, setLengthCategories, lengthCategoryKeyList } from './itemUnits';

// seen-verticals-readiness-task.md Phase 1: a fabric store's cotton / silk ...
// are sold by length; men's tailoring keeps `fabric` only.
afterEach(() => setLengthCategories([]));

describe('isLengthCategory', () => {
  test("before any settings, and for men's tailoring: fabric only (as before)", () => {
    expect(isLengthCategory('fabric')).toBe(true);
    for (const k of ['lining', 'thread', 'button', 'accessories', 'ready_made', 'other', 'cotton']) expect(isLengthCategory(k)).toBe(false);
    setLengthCategories([{ category_key: 'fabric', measure_kind: 'length' }, { category_key: 'lining', measure_kind: 'count' }]);
    expect(isLengthCategory('fabric')).toBe(true);
    expect(isLengthCategory('lining')).toBe(false);
    expect(lengthCategoryKeyList()).toEqual(['fabric']);
  });

  test("a fabric store's categories", () => {
    setLengthCategories([
      { category_key: 'cotton', measure_kind: 'length' }, { category_key: 'silk', measure_kind: 'length' },
      { category_key: 'accessories', measure_kind: 'count' },
    ]);
    expect(isLengthCategory('cotton')).toBe(true);
    expect(isFabricCategory('silk')).toBe(true);
    expect(isLengthCategory('accessories')).toBe(false);
  });

  test('an explicit list with measure_kind decides for its keys', () => {
    expect(isLengthCategory('upholstery_fabric', [{ category_key: 'upholstery_fabric', measure_kind: 'length' }])).toBe(true);
    expect(isLengthCategory('fabric', [{ category_key: 'fabric', measure_kind: 'count' }])).toBe(false);
  });

  test("an item: legacy fabric, or a length category key (a men's fabric item stays fabric whatever its key)", () => {
    expect(isLengthItem({ category: 'fabric', category_key: 'premium_custom' })).toBe(true);
    expect(isLengthItem({ category: 'other', category_key: 'cotton' })).toBe(false);
    setLengthCategories([{ category_key: 'cotton', measure_kind: 'length' }]);
    expect(isLengthItem({ category: 'other', category_key: 'cotton' })).toBe(true);
    expect(isLengthItem({ category: 'other', category_key: null })).toBe(false);
  });
});
