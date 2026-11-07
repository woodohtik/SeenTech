import { test, expect } from 'vitest';
import { buildSitemapXml, buildRobotsTxt } from './sitemap';

test('sitemap wraps each url in a <url><loc> entry', () => {
  const xml = buildSitemapXml([{ url: 'https://seentech.io/blog/' }, { url: 'https://seentech.io/blog/how-to' }]);
  expect(xml).toContain('<loc>https://seentech.io/blog/</loc>');
  expect(xml).toContain('<loc>https://seentech.io/blog/how-to</loc>');
  expect(xml.trim().startsWith('<?xml')).toBe(true);
});

test('an entry with a lastmod gets a <lastmod> tag; one without gets none', () => {
  const xml = buildSitemapXml([
    { url: 'https://seentech.io/blog/how-to', lastmod: '2026-11-03T10:00:00Z' },
    { url: 'https://seentech.io/blog/category/management' },
  ]);
  expect(xml).toContain('<url><loc>https://seentech.io/blog/how-to</loc><lastmod>2026-11-03T10:00:00Z</lastmod></url>');
  expect(xml).toContain('<url><loc>https://seentech.io/blog/category/management</loc></url>');
});

test('robots.txt allows /blog/ and points at the sitemap when indexing is allowed', () => {
  const txt = buildRobotsTxt('https://seentech.io/sitemap.xml', true);
  expect(txt).toContain('Allow: /blog/');
  expect(txt).toContain('Sitemap: https://seentech.io/sitemap.xml');
});

// A non-production build (staging, local) must never invite crawling --
// Disallow: / is the standard signal, and takes priority over any Allow.
test('robots.txt disallows everything when indexing is not allowed, regardless of sitemap url', () => {
  const txt = buildRobotsTxt('https://seentech.io/sitemap.xml', false);
  expect(txt).toContain('Disallow: /');
  expect(txt).not.toContain('Allow: /blog/');
  expect(txt).not.toContain('Sitemap:');
});
