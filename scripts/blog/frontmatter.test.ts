import { test, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadArticles } from './frontmatter';

function writeArticle(dir: string, filename: string, frontmatter: string, body: string) {
  writeFileSync(path.join(dir, filename), `---\n${frontmatter}\n---\n\n${body}`);
}

test('loads slug from filename and computes canonical url', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'blog-'));
  writeArticle(dir, 'how-to.md', 'title: "عنوان"\nmeta_description: "وصف"\ncluster: orders\npublish_date: "2026-11-03"\nrelated: []', 'نص المقالة.');
  const [article] = loadArticles(dir);
  expect(article.slug).toBe('how-to');
  expect(article.canonicalUrl).toBe('https://seentech.io/blog/how-to');
  rmSync(dir, { recursive: true });
});

test('read time floors at 2 minutes for a short article', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'blog-'));
  writeArticle(dir, 'short.md', 'title: "ق"\nmeta_description: "و"\ncluster: orders\npublish_date: "2026-11-03"\nrelated: []', 'كلمتين بس هنا.');
  const [article] = loadArticles(dir);
  expect(article.readTimeMinutes).toBe(2);
  rmSync(dir, { recursive: true });
});

test('throws with the file name when cluster is not one of the eight fixed slugs', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'blog-'));
  writeArticle(dir, 'bad.md', 'title: "ق"\nmeta_description: "و"\ncluster: not-a-cluster\npublish_date: "2026-11-03"\nrelated: []', 'نص.');
  expect(() => loadArticles(dir)).toThrow(/bad\.md/);
  rmSync(dir, { recursive: true });
});
