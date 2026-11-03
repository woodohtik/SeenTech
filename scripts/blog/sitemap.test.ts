import { test, expect } from 'vitest';
import { buildSitemapXml, buildRobotsTxt } from './sitemap';

test('sitemap wraps each url in a <url><loc> entry', () => {
  const xml = buildSitemapXml(['https://seentech.io/blog/', 'https://seentech.io/blog/how-to']);
  expect(xml).toContain('<loc>https://seentech.io/blog/</loc>');
  expect(xml).toContain('<loc>https://seentech.io/blog/how-to</loc>');
  expect(xml.trim().startsWith('<?xml')).toBe(true);
});

test('robots.txt allows /blog/ and points at the sitemap', () => {
  const txt = buildRobotsTxt('https://seentech.io/sitemap.xml');
  expect(txt).toContain('Allow: /blog/');
  expect(txt).toContain('Sitemap: https://seentech.io/sitemap.xml');
});
