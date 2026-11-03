import { test, expect } from 'vitest';
import { renderIndexPage, renderCategoryPage } from './indexPage';
import { CATEGORIES } from '../categories';

const article = { slug: 'how-to', canonicalUrl: 'https://seentech.io/blog/how-to', readTimeMinutes: 3,
  frontmatter: { title: 'كيف تتابع الطلبات؟', metaDescription: 'وصف', cluster: 'orders', publishDate: '2026-11-03', related: [] },
  rawBody: '' } as any;

test('index page lists every article title', () => {
  expect(renderIndexPage([article])).toContain('كيف تتابع الطلبات؟');
});

test('index page renders all eight category chips regardless of article count', () => {
  const html = renderIndexPage([]);
  for (const c of CATEGORIES) expect(html).toContain(c.label);
});

test('category page with no articles shows a "coming soon" state, not an empty grid', () => {
  const html = renderCategoryPage(CATEGORIES[0], []);
  expect(html).toContain('قريباً');
});

test('category page with articles lists them and omits the coming-soon state', () => {
  const html = renderCategoryPage(CATEGORIES.find(c => c.slug === 'orders')!, [article]);
  expect(html).toContain('كيف تتابع الطلبات؟');
  expect(html).not.toContain('قريباً');
});

test('cta buttons say "ابدأ الآن" on both page types', () => {
  expect(renderIndexPage([article])).toContain('ابدأ الآن');
  expect(renderCategoryPage(CATEGORIES[0], [])).toContain('ابدأ الآن');
});
