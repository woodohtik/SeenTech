import { test, expect } from 'vitest';
import { renderSearchPage } from './searchPage';

test('search page has no inline <script> (CSP script-src has no unsafe-inline) and loads the external blog client instead', () => {
  const html = renderSearchPage();
  expect(html).toContain('<script src="/blog/blog.js" defer></script>');
  expect(html).not.toMatch(/<script>[\s\S]*fetch/);
});

test('search page has the results container and noindex (not meant to be crawled as its own content page)', () => {
  const html = renderSearchPage();
  expect(html).toContain('id="results"');
  expect(html).toContain('name="robots" content="noindex"');
});
