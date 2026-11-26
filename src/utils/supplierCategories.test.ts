import { expect, test } from 'vitest';
import { supplierCategoryFilter, supplierCategories, toggleExtraCategory } from './supplierCategories';

// seen-merchant-trial-test-2026-11-26.md, phase 3 item 4: an accessories
// supplier sells buttons and thread -- more than one category.
test('the filter finds a supplier by its main category or an extra one', () => {
  expect(supplierCategoryFilter('buttons')).toBe('category.eq.buttons,extra_categories.cs.{buttons}');
});

test("a supplier's categories: the main one first, no repeats", () => {
  expect(supplierCategories({ category: 'accessories', extra_categories: ['buttons', 'accessories', 'thread'] })).toEqual(['accessories', 'buttons', 'thread']);
  expect(supplierCategories({ category: 'fabric', extra_categories: null })).toEqual(['fabric']);
});

test('ticking an extra category adds it once; ticking again removes it; never the main one', () => {
  expect(toggleExtraCategory(['thread'], 'buttons', 'accessories')).toEqual(['thread', 'buttons']);
  expect(toggleExtraCategory(['thread', 'buttons'], 'buttons', 'accessories')).toEqual(['thread']);
  expect(toggleExtraCategory([], 'accessories', 'accessories')).toEqual([]);
});
