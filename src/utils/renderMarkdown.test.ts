import { test, expect } from 'vitest';
import { renderMarkdown } from './renderMarkdown';

test('converts basic markdown to HTML', () => {
  expect(renderMarkdown('# عنوان\n\nفقرة **عريضة**.')).toContain('<h1');
  expect(renderMarkdown('# عنوان\n\nفقرة **عريضة**.')).toContain('<strong>عريضة</strong>');
});

test('raw script tags in the source are not rendered as live markup', () => {
  const html = renderMarkdown('نص عادي <script>alert(1)</script> بعده');
  expect(html).not.toContain('<script>');
});

test('empty input renders to an empty or near-empty string', () => {
  expect(renderMarkdown('').trim()).toBe('');
});

test('javascript: URI in a markdown link is not rendered as a live href', () => {
  const html = renderMarkdown('[اضغط هنا](javascript:alert(1))');
  expect(html).not.toContain('javascript:');
});

test('javascript: URI in a markdown image src is not rendered as a live src', () => {
  const html = renderMarkdown('![صورة](javascript:alert(1))');
  expect(html).not.toContain('javascript:');
});

test('a normal https link still renders as a working anchor', () => {
  const html = renderMarkdown('[رابط](https://example.com)');
  expect(html).toContain('<a href="https://example.com">رابط</a>');
});
