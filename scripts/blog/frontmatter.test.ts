import { test, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadArticles, parseArticleFrontmatter } from './frontmatter';

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

test('skips README.md instead of treating it as an article', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'blog-'));
  writeFileSync(path.join(dir, 'README.md'), '# not an article, just docs for whoever adds one');
  writeArticle(dir, 'how-to.md', 'title: "عنوان"\nmeta_description: "وصف"\ncluster: orders\npublish_date: "2026-11-03"\nrelated: []', 'نص.');
  const articles = loadArticles(dir);
  expect(articles).toHaveLength(1);
  expect(articles[0].slug).toBe('how-to');
  rmSync(dir, { recursive: true });
});

test('throws with the file name when cluster is not one of the eight fixed slugs', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'blog-'));
  writeArticle(dir, 'bad.md', 'title: "ق"\nmeta_description: "و"\ncluster: not-a-cluster\npublish_date: "2026-11-03"\nrelated: []', 'نص.');
  expect(() => loadArticles(dir)).toThrow(/bad\.md/);
  rmSync(dir, { recursive: true });
});

test('throws with the file name when title is missing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'blog-'));
  writeArticle(dir, 'bad.md', 'meta_description: "و"\ncluster: orders\npublish_date: "2026-11-03"\nrelated: []', 'نص.');
  expect(() => loadArticles(dir)).toThrow(/bad\.md/);
  rmSync(dir, { recursive: true });
});

test('throws with the file name when meta_description is empty', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'blog-'));
  writeArticle(dir, 'bad.md', 'title: "ق"\nmeta_description: ""\ncluster: orders\npublish_date: "2026-11-03"\nrelated: []', 'نص.');
  expect(() => loadArticles(dir)).toThrow(/bad\.md/);
  rmSync(dir, { recursive: true });
});

test('throws with the file name when publish_date is not a YYYY-MM-DD string', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'blog-'));
  writeArticle(dir, 'bad.md', 'title: "ق"\nmeta_description: "و"\ncluster: orders\npublish_date: "3 نوفمبر 2026"\nrelated: []', 'نص.');
  expect(() => loadArticles(dir)).toThrow(/bad\.md/);
  rmSync(dir, { recursive: true });
});

test('throws with the file name when related is present but not an array', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'blog-'));
  writeArticle(dir, 'bad.md', 'title: "ق"\nmeta_description: "و"\ncluster: orders\npublish_date: "2026-11-03"\nrelated: "not-an-array"', 'نص.');
  expect(() => loadArticles(dir)).toThrow(/bad\.md/);
  rmSync(dir, { recursive: true });
});

test('accepts a full ISO-8601 datetime with a timezone offset for publish_date', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'blog-'));
  writeArticle(dir, 'how-to.md', 'title: "ق"\nmeta_description: "و"\ncluster: orders\npublish_date: "2026-11-04T23:25:00+03:00"\nrelated: []', 'نص.');
  // `now` is pinned safely past the fixture's publish_date so this test
  // (about datetime validation/round-tripping, not about the future-date
  // filter added later in this file) doesn't flip pass/fail depending on
  // the wall-clock instant it happens to run at.
  const [article] = loadArticles(dir, new Date('2099-01-01T00:00:00Z'));
  expect(article.frontmatter.publishDate).toBe('2026-11-04T23:25:00+03:00');
  rmSync(dir, { recursive: true });
});

test('still accepts a date-only publish_date (midnight UTC that day)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'blog-'));
  writeArticle(dir, 'how-to.md', 'title: "ق"\nmeta_description: "و"\ncluster: orders\npublish_date: "2026-11-03"\nrelated: []', 'نص.');
  expect(() => loadArticles(dir)).not.toThrow();
  rmSync(dir, { recursive: true });
});

test('still throws with the file name when publish_date is not a parseable date at all', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'blog-'));
  writeArticle(dir, 'bad.md', 'title: "ق"\nmeta_description: "و"\ncluster: orders\npublish_date: "3 نوفمبر"\nrelated: []', 'نص.');
  expect(() => loadArticles(dir)).toThrow(/bad\.md/);
  rmSync(dir, { recursive: true });
});

test('parseArticleFrontmatter parses the same raw string loadArticles would read from disk', () => {
  const raw = '---\ntitle: "عنوان"\nmeta_description: "وصف"\ncluster: orders\npublish_date: "2026-11-03"\nrelated: []\n---\n\nنص المقالة.';
  const { frontmatter, rawBody } = parseArticleFrontmatter('how-to.md', raw);
  expect(frontmatter.title).toBe('عنوان');
  expect(rawBody).toBe('نص المقالة.');
});

test('parseArticleFrontmatter throws with the filename for an invalid cluster', () => {
  const raw = '---\ntitle: "ق"\nmeta_description: "و"\ncluster: not-a-cluster\npublish_date: "2026-11-03"\nrelated: []\n---\n\nنص.';
  expect(() => parseArticleFrontmatter('bad.md', raw)).toThrow(/bad\.md/);
});

test('an article dated after `now` is excluded from loadArticles entirely', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'blog-'));
  writeArticle(dir, 'future.md', 'title: "ق"\nmeta_description: "و"\ncluster: orders\npublish_date: "2026-11-05T00:00:00Z"\nrelated: []', 'نص.');
  const articles = loadArticles(dir, new Date('2026-11-04T12:00:00Z'));
  expect(articles).toHaveLength(0);
  rmSync(dir, { recursive: true });
});

test('an article dated at or before `now` is still included', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'blog-'));
  writeArticle(dir, 'due.md', 'title: "ق"\nmeta_description: "و"\ncluster: orders\npublish_date: "2026-11-04T11:00:00Z"\nrelated: []', 'نص.');
  const articles = loadArticles(dir, new Date('2026-11-04T12:00:00Z'));
  expect(articles).toHaveLength(1);
  rmSync(dir, { recursive: true });
});

test('a publishDate in a different timezone offset is compared by real instant, not wall-clock digits', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'blog-'));
  // 23:25 +03:00 is 20:25 UTC -- still due at "now" = 20:30 UTC
  writeArticle(dir, 'tz.md', 'title: "ق"\nmeta_description: "و"\ncluster: orders\npublish_date: "2026-11-04T23:25:00+03:00"\nrelated: []', 'نص.');
  const articles = loadArticles(dir, new Date('2026-11-04T20:30:00Z'));
  expect(articles).toHaveLength(1);
  rmSync(dir, { recursive: true });
});
