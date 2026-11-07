import { test, expect, afterEach } from 'vitest';
import { renderSearchPage } from './searchPage';

const originalVercelEnv = process.env.VERCEL_ENV;
const originalBlogSiteUrl = process.env.BLOG_SITE_URL;
afterEach(() => {
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
  if (originalBlogSiteUrl === undefined) delete process.env.BLOG_SITE_URL;
  else process.env.BLOG_SITE_URL = originalBlogSiteUrl;
});

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

// The search form posts to this build's own origin -- it must stay on
// whichever origin served this build, not a hardcoded production domain.
test('search form action follows BLOG_SITE_URL', () => {
  process.env.VERCEL_ENV = 'preview';
  process.env.BLOG_SITE_URL = 'https://staging.seentech.io';
  const html = renderSearchPage();
  expect(html).toContain('action="https://staging.seentech.io/blog/search"');
});
