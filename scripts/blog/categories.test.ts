import { test, expect } from 'vitest';
import { CATEGORIES, getCategory } from './categories';

test('has exactly the eight fixed categories in spec order', () => {
  expect(CATEGORIES.map(c => c.slug)).toEqual([
    'management', 'orders', 'measurements', 'software',
    'season', 'e-invoicing', 'womens', 'curtains',
  ]);
});

test('every category has a non-empty label and svg icon markup', () => {
  for (const c of CATEGORIES) {
    expect(c.label.length).toBeGreaterThan(0);
    expect(c.icon).toMatch(/^<svg[\s\S]*<\/svg>$/);
  }
});

test('getCategory returns undefined for an unknown slug', () => {
  expect(getCategory('not-a-real-slug')).toBeUndefined();
});
