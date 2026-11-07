import { test, expect } from 'vitest';
import { buildSitemapXml, buildRobotsTxt } from './sitemap';

test('sitemap wraps each url in a <url><loc> entry', () => {
  const xml = buildSitemapXml(['https://seentech.io/blog/', 'https://seentech.io/blog/how-to']);
  expect(xml).toContain('<loc>https://seentech.io/blog/</loc>');
  expect(xml).toContain('<loc>https://seentech.io/blog/how-to</loc>');
  expect(xml.trim().startsWith('<?xml')).toBe(true);
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
