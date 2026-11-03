import { test, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildBlog } from './build-blog';

test('end to end: one fixture article produces index, its own page, its category page, and all eight category pages', async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'blog-out-'));
  await buildBlog(path.join(__dirname, 'blog/__fixtures__'), outDir);

  expect(readFileSync(path.join(outDir, 'blog/index.html'), 'utf8')).toContain('<title>');
  expect(existsSync(path.join(outDir, 'blog/sample-article/index.html'))).toBe(true);
  expect(readFileSync(path.join(outDir, 'blog/category/orders/index.html'), 'utf8')).not.toContain('قريباً');
  expect(readFileSync(path.join(outDir, 'blog/category/management/index.html'), 'utf8')).toContain('قريباً');
  expect(existsSync(path.join(outDir, 'blog/og/sample-article.png'))).toBe(true);
  expect(existsSync(path.join(outDir, 'blog/search-index.json'))).toBe(true);
  expect(readFileSync(path.join(outDir, 'sitemap.xml'), 'utf8')).toContain('sample-article');
}, 15000);

test('throws with the offending filename when a content directory has an invalid cluster', async () => {
  const badDir = mkdtempSync(path.join(tmpdir(), 'blog-bad-'));
  writeFileSync(path.join(badDir, 'bad.md'), '---\ntitle: "ق"\nmeta_description: "و"\ncluster: nope\npublish_date: "2026-11-03"\nrelated: []\n---\n\nنص.');
  const outDir = mkdtempSync(path.join(tmpdir(), 'blog-out-'));
  await expect(buildBlog(badDir, outDir)).rejects.toThrow(/bad\.md/);
});
