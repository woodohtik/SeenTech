import { test, expect } from 'vitest';
import { STYLE_PREF_KEYS, applyStylePrefs, mergeStylePrefs, stylePrefsOf } from './customerStylePrefs';

// seen-merchant-trial-test-2026-11-26.md, phase 2 item 3 (question 4's
// default): one place for a customer's preferences -- the same fields as an
// order line -- filled into a new order and refreshed after each order.

const SAVED = {
  length: 145, sleeve: 62,
  collarType: 'stand', pocketType: 'visible', cuttingType: 'saudi', collarPadding: 'hard', closureType: 'buttons', closureVisibility: 'hidden',
};

test("a customer's preferences are their style fields, not their measurements", () => {
  expect(stylePrefsOf(SAVED)).toEqual({
    collarType: 'stand', pocketType: 'visible', cuttingType: 'saudi', collarPadding: 'hard', closureType: 'buttons', closureVisibility: 'hidden',
  });
  expect(stylePrefsOf(null)).toEqual({});
  expect(stylePrefsOf({ collarType: '', pocketType: null })).toEqual({});
});

test('a new line takes them over its defaults, keeping its own cloth and price', () => {
  const line = { garmentType: 'ثوب', price: 250, fabricId: 'f1', collarType: 'plain', collarPadding: 'soft', pocketType: 'single', cuffType: 'plain' };
  expect(applyStylePrefs(line, stylePrefsOf(SAVED))).toEqual({
    garmentType: 'ثوب', price: 250, fabricId: 'f1', cuffType: 'plain',
    collarType: 'stand', collarPadding: 'hard', pocketType: 'visible', cuttingType: 'saudi', closureType: 'buttons', closureVisibility: 'hidden',
  });
});

test("after an order, the customer's preferences are the order's choices; measurements stay", () => {
  const order = { collarType: 'classic', pocketType: 'hidden', price: 300, garmentType: 'ثوب' };
  const merged = mergeStylePrefs(SAVED, order);
  expect(merged).toMatchObject({ length: 145, sleeve: 62, collarType: 'classic', pocketType: 'hidden', cuttingType: 'saudi' });
  expect(merged).not.toHaveProperty('price');
  expect(merged).not.toHaveProperty('garmentType');
});

test('the keys are the order line style fields', () => {
  expect(STYLE_PREF_KEYS).toEqual(['collarType', 'cuffType', 'pocketType', 'chestStyle', 'shoulderStyle', 'cuttingType', 'collarPadding', 'closureType', 'closureVisibility']);
});
