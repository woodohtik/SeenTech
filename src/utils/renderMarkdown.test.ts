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
