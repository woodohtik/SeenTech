import { test, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildBlog } from './build-blog';

const originalVercelEnv = process.env.VERCEL_ENV;
afterEach(() => {
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
});

test('end to end: one fixture article produces index, its own page, its category page, and all eight category pages', async () => {
  const contentDir = mkdtempSync(path.join(tmpdir(), 'blog-content-'));
  copyFileSync(
    path.join(__dirname, 'blog/__fixtures__/sample-article.md'),
    path.join(contentDir, 'sample-article.md'),
  );
  writeFileSync(
    path.join(contentDir, 'far-future.md'),
    '---\ntitle: "مقالة مستقبلية"\nmeta_description: "لا يجب أن تظهر الآن"\ncluster: orders\npublish_date: "2099-01-01T00:00:00Z"\nrelated: []\n---\n\nنص.',
  );

  const outDir = mkdtempSync(path.join(tmpdir(), 'blog-out-'));
  await buildBlog(contentDir, outDir);

  expect(readFileSync(path.join(outDir, 'blog/index.html'), 'utf8')).toContain('<title>');
  expect(existsSync(path.join(outDir, 'blog/sample-article/index.html'))).toBe(true);
  expect(readFileSync(path.join(outDir, 'blog/category/orders/index.html'), 'utf8')).not.toContain('قريباً');
  expect(readFileSync(path.join(outDir, 'blog/category/management/index.html'), 'utf8')).toContain('قريباً');
  expect(existsSync(path.join(outDir, 'blog/og/sample-article.png'))).toBe(true);
  expect(existsSync(path.join(outDir, 'blog/search-index.json'))).toBe(true);
  expect(readFileSync(path.join(outDir, 'sitemap.xml'), 'utf8')).toContain('sample-article');
  expect(readFileSync(path.join(outDir, 'blog/blog.js'), 'utf8')).toContain('window.dataLayer');
  expect(existsSync(path.join(outDir, 'blog/blog-config.js'))).toBe(true);
  expect(existsSync(path.join(outDir, 'blog/far-future/index.html'))).toBe(false);
  expect(readFileSync(path.join(outDir, 'blog/index.html'), 'utf8')).not.toContain('far-future');
}, 15000);

test('sitemap gives the index and the article a lastmod from the article\'s publishDate, and omits it for an empty category', async () => {
  const contentDir = mkdtempSync(path.join(tmpdir(), 'blog-content-'));
  copyFileSync(
    path.join(__dirname, 'blog/__fixtures__/sample-article.md'),
    path.join(contentDir, 'sample-article.md'),
  );
  const outDir = mkdtempSync(path.join(tmpdir(), 'blog-out-'));
  await buildBlog(contentDir, outDir);

  const sitemapXml = readFileSync(path.join(outDir, 'sitemap.xml'), 'utf8');
  expect(sitemapXml).toContain('<url><loc>https://seentech.io/blog/sample-article</loc><lastmod>2026-11-03</lastmod></url>');
  expect(sitemapXml).toContain('<url><loc>https://seentech.io/blog/</loc><lastmod>2026-11-03</lastmod></url>');
  expect(sitemapXml).toContain('<url><loc>https://seentech.io/blog/category/orders</loc><lastmod>2026-11-03</lastmod></url>');
  expect(sitemapXml).toContain('<url><loc>https://seentech.io/blog/category/management</loc></url>');
});

test('robots.txt disallows all crawling outside of a production build', async () => {
  process.env.VERCEL_ENV = 'preview';
  const contentDir = mkdtempSync(path.join(tmpdir(), 'blog-content-'));
  copyFileSync(
    path.join(__dirname, 'blog/__fixtures__/sample-article.md'),
    path.join(contentDir, 'sample-article.md'),
  );
  const outDir = mkdtempSync(path.join(tmpdir(), 'blog-out-'));
  await buildBlog(contentDir, outDir);

  const robotsTxt = readFileSync(path.join(outDir, 'robots.txt'), 'utf8');
  expect(robotsTxt).toContain('Disallow: /');
  expect(robotsTxt).not.toContain('Sitemap:');
});

test('robots.txt allows indexing on a production build', async () => {
  process.env.VERCEL_ENV = 'production';
  const contentDir = mkdtempSync(path.join(tmpdir(), 'blog-content-'));
  copyFileSync(
    path.join(__dirname, 'blog/__fixtures__/sample-article.md'),
    path.join(contentDir, 'sample-article.md'),
  );
  const outDir = mkdtempSync(path.join(tmpdir(), 'blog-out-'));
  await buildBlog(contentDir, outDir);

  const robotsTxt = readFileSync(path.join(outDir, 'robots.txt'), 'utf8');
  expect(robotsTxt).toContain('Allow: /blog/');
  expect(robotsTxt).toContain('Sitemap:');
});

test('throws with the offending filename when a content directory has an invalid cluster', async () => {
  const badDir = mkdtempSync(path.join(tmpdir(), 'blog-bad-'));
  writeFileSync(path.join(badDir, 'bad.md'), '---\ntitle: "ق"\nmeta_description: "و"\ncluster: nope\npublish_date: "2026-11-03"\nrelated: []\n---\n\nنص.');
  const outDir = mkdtempSync(path.join(tmpdir(), 'blog-out-'));
  await expect(buildBlog(badDir, outDir)).rejects.toThrow(/bad\.md/);
});
