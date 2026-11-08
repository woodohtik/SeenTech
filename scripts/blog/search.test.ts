import { test, expect } from 'vitest';
import { buildSearchIndex, filterSearchIndex } from './search';

const article = { slug: 'how-to', canonicalUrl: 'https://seentech.io/blog/how-to', readTimeMinutes: 3,
  frontmatter: { title: 'كيف تتابع الطلبات؟', metaDescription: 'دليل عملي للمتابعة', cluster: 'orders', publishDate: '2026-11-03', related: [] },
  rawBody: '' } as any;

test('search index has one entry per article with title and excerpt', () => {
  const idx = buildSearchIndex([article]);
  expect(idx).toEqual([{ slug: 'how-to', title: 'كيف تتابع الطلبات؟', excerpt: 'دليل عملي للمتابعة' }]);
});

test('filter matches a substring of the title, case/diacritics aside', () => {
  const idx = buildSearchIndex([article]);
  expect(filterSearchIndex(idx, 'تتابع')).toHaveLength(1);
});

test('filter matches a substring of the excerpt too', () => {
  const idx = buildSearchIndex([article]);
  expect(filterSearchIndex(idx, 'دليل')).toHaveLength(1);
});

test('filter returns nothing for a query matching neither field', () => {
  const idx = buildSearchIndex([article]);
  expect(filterSearchIndex(idx, 'لا علاقة')).toHaveLength(0);
});
