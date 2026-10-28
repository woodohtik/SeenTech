import { test, expect } from 'vitest';
import { parseArabicNumber } from './parseArabicNumber';

test.each([
  ['40', 40],                          // browser already gave digits
  ['٤٠', 40],                          // Arabic-Indic digits
  ['أربعون', 40],
  ['أربعين', 40],                      // spoken accusative form, same value
  ['خمسة وأربعين', 45],
  ['واحد وعشرون', 21],
  ['مئة', 100],
  ['مئة وخمسة', 105],
  ['مئتان', 200],
  ['ثلاثمئة', 300],
  ['صفر', 0],
])('parses %s as %d', (input, expected) => {
  expect(parseArabicNumber(input)).toBe(expected);
});

test.each(['', 'كلام غير مفهوم', 'xyz'])('returns null for unparseable input %s', (input) => {
  expect(parseArabicNumber(input)).toBeNull();
});
