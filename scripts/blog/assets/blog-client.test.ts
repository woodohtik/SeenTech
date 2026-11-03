import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(path.join(__dirname, 'blog-client.js'), 'utf8');

// This file is the one and only <script src> every blog page loads
// (scripts/blog/templates/shared.ts's BLOG_CLIENT_SCRIPT_TAG) -- nothing
// in it may be an inline <script>, since vercel.json's CSP ships
// script-src 'self' with no 'unsafe-inline'. These are content-presence
// checks, not DOM-behavior tests: the logic itself is a verbatim carry-over
// of what was previously tested as inline-script string content in
// shared.test.ts/indexPage.test.ts/searchPage.ts before being consolidated
// here for CSP compliance.
test('consolidates click tracking, chip filter, TOC/print, and search -- the four scripts every blog page previously inlined', () => {
  expect(source).toContain('window.dataLayer');
  expect(source).toContain('data-track');
  expect(source).toContain("data-blog-page") ;
  expect(source).toContain('data-pillar');
  expect(source).toContain('IntersectionObserver');
  expect(source).toContain('data-print-tpl');
  expect(source).toContain('search-index.json');
});

test('chip filter only attaches on data-blog-page="index", not on category pages', () => {
  expect(source).toContain("getAttribute('data-blog-page') === 'index'");
});

test('contains no onclick-style inline handler strings that would need unsafe-inline CSP', () => {
  expect(source).not.toContain('onclick');
});
