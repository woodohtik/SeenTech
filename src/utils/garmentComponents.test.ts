import { test, expect } from 'vitest';
import { defaultComponentsFor, garmentTypesOf, isComponentsDue } from './garmentComponents';

// seen-merchant-trial-test-2026-11-26.md, phase 2 item 2: a thobe's buttons
// come with it at cutting -- the shop's defaults, times the pieces.
const DEFAULTS = [
  { garment_type: 'ثوب', item_id: 'btn', quantity: 5, item_name: 'أزرار صدف' },
  { garment_type: 'ثوب', item_id: 'thread', quantity: 1, item_name: 'بكرة خيط' },
  { garment_type: 'سروال', item_id: 'thread', quantity: 1, item_name: 'بكرة خيط' },
];

test('two thobes take 10 buttons and 2 spools; the garment type is matched trimmed', () => {
  const items = [{ garmentType: ' ثوب ', quantity: 2 }];
  expect(defaultComponentsFor(items, DEFAULTS)).toEqual([
    { itemId: 'btn', name: 'أزرار صدف', quantity: 10 },
    { itemId: 'thread', name: 'بكرة خيط', quantity: 2 },
  ]);
});

test('a thobe and trousers add up per item', () => {
  const items = [{ garmentType: 'ثوب', quantity: 1 }, { garmentType: 'سروال', quantity: 1 }];
  expect(defaultComponentsFor(items, DEFAULTS)).toEqual([
    { itemId: 'btn', name: 'أزرار صدف', quantity: 5 },
    { itemId: 'thread', name: 'بكرة خيط', quantity: 2 },
  ]);
});

test('a garment with no defaults takes nothing', () => {
  expect(defaultComponentsFor([{ garmentType: 'بشت', quantity: 1 }], DEFAULTS)).toEqual([]);
  expect(defaultComponentsFor(null, DEFAULTS)).toEqual([]);
});

test('the order\'s garment types, once each', () => {
  expect(garmentTypesOf([{ garmentType: 'ثوب' }, { garmentType: ' ثوب' }, { name: 'سروال' }, {}])).toEqual(['ثوب', 'سروال']);
});

test('components are due on the first move to cutting or past it, until taken', () => {
  expect(isComponentsDue({ currentStatus: 'measurements_taken', targetStatus: 'cutting', componentsTakenAt: null })).toBe(true);
  expect(isComponentsDue({ currentStatus: 'measurements_taken', targetStatus: 'ready', componentsTakenAt: null })).toBe(true);
  expect(isComponentsDue({ currentStatus: 'cutting', targetStatus: 'sewing', componentsTakenAt: '2026-11-26' })).toBe(false);
  expect(isComponentsDue({ currentStatus: 'measurements_taken', targetStatus: 'measurements_taken', componentsTakenAt: null })).toBe(false);
  expect(isComponentsDue({ currentStatus: 'cutting', targetStatus: 'cancelled', componentsTakenAt: null })).toBe(false);
});
