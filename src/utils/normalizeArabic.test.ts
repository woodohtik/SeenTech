import { test, expect } from 'vitest';
import { normalizeArabicText } from './normalizeArabic';

test('maps all hamza-bearing alef forms to plain alef', () => {
  expect(normalizeArabicText('أحمد')).toBe(normalizeArabicText('احمد'));
  expect(normalizeArabicText('إحمد')).toBe(normalizeArabicText('احمد'));
  expect(normalizeArabicText('آحمد')).toBe(normalizeArabicText('احمد'));
});

test('maps taa marbuta to haa', () => {
  expect(normalizeArabicText('فاطمة')).toBe(normalizeArabicText('فاطمه'));
});

test('maps alef maksura to yaa', () => {
  expect(normalizeArabicText('هدى')).toBe(normalizeArabicText('هدي'));
});

test('strips harakat and tatweel', () => {
  expect(normalizeArabicText('مُحَمَّد')).toBe('محمد');
  expect(normalizeArabicText('بـــارد')).toBe('بارد');
});

test('trims surrounding whitespace', () => {
  expect(normalizeArabicText('  مرحبا  ')).toBe('مرحبا');
});
