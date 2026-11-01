import { test, expect } from 'vitest';
import { levenshteinDistance } from './levenshtein';

test('distance between identical strings is 0', () => {
  expect(levenshteinDistance('abc', 'abc')).toBe(0);
  expect(levenshteinDistance('', '')).toBe(0);
});

test('distance against empty string is the other string\'s length', () => {
  expect(levenshteinDistance('abc', '')).toBe(3);
  expect(levenshteinDistance('', 'abc')).toBe(3);
});

test('one substitution counts as distance 1', () => {
  expect(levenshteinDistance('abc', 'abd')).toBe(1);
});

test('one deletion counts as distance 1', () => {
  expect(levenshteinDistance('abc', 'ab')).toBe(1);
});

test('one insertion counts as distance 1', () => {
  expect(levenshteinDistance('abc', 'abcd')).toBe(1);
});

test('classic kitten/sitting example is distance 3', () => {
  expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
});

test('is symmetric', () => {
  expect(levenshteinDistance('اربعين', 'اربعيين')).toBe(levenshteinDistance('اربعيين', 'اربعين'));
});
