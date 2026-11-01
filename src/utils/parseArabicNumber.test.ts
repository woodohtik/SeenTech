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
  ['٤٥٫٥', 45.5],                      // Arabic-Indic digits + Arabic decimal separator
])('parses %s as %d', (input, expected) => {
  expect(parseArabicNumber(input)).toBe(expected);
});

test.each(['', 'كلام غير مفهوم', 'xyz', '12 كيلو'])('returns null for unparseable input %s', (input) => {
  expect(parseArabicNumber(input)).toBeNull();
});

// Speech recognition sometimes adds/drops/swaps a single letter -- these
// should still resolve to the closest number word rather than failing.
test.each([
  ['اربعيين', 40],   // "أربعين" (40) with an extra ي
  ['اربغين', 40],    // "أربعين" (40) with ع misheard as غ
  ['تسعيين', 90],    // "تسعين" (90) with an extra ي
  ['مانين', 80],     // "ثمانين" (80) missing the ث
])('fuzzy-resolves %s to %d despite a one-letter speech-recognition error', (input, expected) => {
  expect(parseArabicNumber(input)).toBe(expected);
});

test('does not fuzzy-resolve input that is too far from any number word', () => {
  expect(parseArabicNumber('بيت')).toBeNull();
});
