import { test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
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

// Round-2 regression: a hand-rolled scheme allowlist missed HTML
// character-reference obfuscation (&#106; decodes to "j" during browser
// attribute parsing, so "&#106;avascript:" becomes "javascript:" live).
// A raw substring check on the output ("not.toContain('javascript:')")
// would NOT have caught this -- the serialized HTML literally contains
// "&#106;avascript:", not the substring "javascript:". So this test
// parses the actual DOM and inspects the decoded `href` attribute value,
// the way a browser would resolve it.
test('HTML character-reference obfuscated javascript: scheme does not produce a live javascript: href', () => {
  const html = renderMarkdown('[text](&#106;avascript:alert(1))');
  const dom = new JSDOM(`<!DOCTYPE html><body>${html}</body>`);
  const anchor = dom.window.document.querySelector('a');
  const href = anchor?.getAttribute('href') ?? null;
  expect(href === null || !/^javascript:/i.test(href)).toBe(true);
});
