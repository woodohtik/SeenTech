import { test, expect } from 'vitest';
import { buildArticleJsonLd, buildFaqJsonLd } from './jsonLd';

test('article json-ld carries headline, description and canonical url', () => {
  const article = { slug: 'x', canonicalUrl: 'https://seentech.io/blog/x', readTimeMinutes: 3,
    frontmatter: { title: 'عنوان', metaDescription: 'وصف', cluster: 'orders', publishDate: '2026-11-03', related: [] },
    rawBody: '' } as any;
  const ld = buildArticleJsonLd(article) as any;
  expect(ld['@type']).toBe('Article');
  expect(ld.headline).toBe('عنوان');
  expect(ld.mainEntityOfPage).toBe('https://seentech.io/blog/x');
  expect(ld.datePublished).toBe('2026-11-03');
});

test('faq json-ld maps question/answer pairs', () => {
  const ld = buildFaqJsonLd([{ question: 'س؟', answerHtml: '<p>ج.</p>' }]) as any;
  expect(ld['@type']).toBe('FAQPage');
  expect(ld.mainEntity[0].name).toBe('س؟');
  expect(ld.mainEntity[0].acceptedAnswer.text).toContain('ج.');
});

test('faq json-ld is null for an empty faq list', () => {
  expect(buildFaqJsonLd([])).toBeNull();
});
