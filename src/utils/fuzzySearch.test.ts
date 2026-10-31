import { test, expect } from 'vitest';
import { fuzzyIncludes } from './fuzzySearch';

test('empty query matches anything', () => {
  expect(fuzzyIncludes('احمد محمد', '')).toBe(true);
  expect(fuzzyIncludes('احمد محمد', '   ')).toBe(true);
});

test('exact word match', () => {
  expect(fuzzyIncludes('احمد محمد', 'احمد')).toBe(true);
});

test('one-letter speech-recognition error on a short word still matches', () => {
  expect(fuzzyIncludes('احمد محمد', 'احمض')).toBe(true); // د -> ض substitution
});

test('an unrelated short word does not match', () => {
  expect(fuzzyIncludes('احمد محمد', 'فاطمة')).toBe(false);
});

test('every word in a multi-word query must match some word in the text', () => {
  expect(fuzzyIncludes('محمد احمد علي', 'احمد علي')).toBe(true);
  expect(fuzzyIncludes('محمد احمد علي', 'احمد سالم')).toBe(false);
});

test('longer words tolerate a two-letter difference', () => {
  expect(fuzzyIncludes('قماش كتاني مستورد', 'كتانو')).toBe(true);
});

test('case-insensitive for latin text', () => {
  expect(fuzzyIncludes('Blue Fabric', 'blue')).toBe(true);
});
