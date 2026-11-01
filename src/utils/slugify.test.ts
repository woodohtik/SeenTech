import { test, expect } from 'vitest';
import { slugify } from './slugify';

test('converts spaces to hyphens', () => {
  expect(slugify('مرحباً بكم في المدونة')).toBe('مرحباً-بكم-في-المدونة');
});

test('strips punctuation', () => {
  expect(slugify('سؤال: كيف تطّرز ثوباً؟!')).toBe('سؤال-كيف-تطّرز-ثوباً');
});

test('collapses repeated whitespace into one hyphen', () => {
  expect(slugify('عنوان   فيه   مسافات')).toBe('عنوان-فيه-مسافات');
});

test('trims leading and trailing punctuation/whitespace', () => {
  expect(slugify('  -- عنوان --  ')).toBe('عنوان');
});

test('keeps Latin letters and digits as-is', () => {
  expect(slugify('Seen POS 2026 إطلاق')).toBe('Seen-POS-2026-إطلاق');
});

test('empty input produces an empty string', () => {
  expect(slugify('')).toBe('');
});
