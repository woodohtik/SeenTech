import { test, expect } from 'vitest';
import { renderArticlePage } from './articlePage';

const baseArticle = {
  slug: 'how-to', canonicalUrl: 'https://seentech.io/blog/how-to', readTimeMinutes: 3,
  frontmatter: { title: 'كيف تتابع الطلبات؟', metaDescription: 'وصف قصير', cluster: 'orders', publishDate: '2026-11-03', related: ['other'] },
  rawBody: '',
} as any;
const otherArticle = { ...baseArticle, slug: 'other', frontmatter: { ...baseArticle.frontmatter, title: 'مقالة أخرى' } };
const parsed = { summaryHtml: '<p>ملخص.</p>', sections: [{ id: 's1', heading: 'قسم', bodyHtml: '<p>نص.</p>', isModel: false }], whereSeenFitsHtml: '<p>في سين كل طلب له موعد.</p>', aboutSeenHtml: null, faq: [] } as any;

test('page title and canonical come from frontmatter/article', () => {
  const html = renderArticlePage(baseArticle, parsed, [baseArticle, otherArticle]);
  expect(html).toContain('<title>كيف تتابع الطلبات؟');
  expect(html).toContain('rel="canonical" href="https://seentech.io/blog/how-to"');
});

test('inline "وين تدخل منصة سين؟" box keeps the unchanged button, not the config cta', () => {
  const html = renderArticlePage(baseArticle, parsed, [baseArticle, otherArticle]);
  expect(html).toContain('نوريك إياه في محلك');
  expect(html).toContain('https://seentech.io/#book');
});

test('related cards resolve from frontmatter.related against the full article list', () => {
  const html = renderArticlePage(baseArticle, parsed, [baseArticle, otherArticle]);
  expect(html).toContain('مقالة أخرى');
});

test('a dangling related slug is skipped without throwing', () => {
  const withBadRelated = { ...baseArticle, frontmatter: { ...baseArticle.frontmatter, related: ['does-not-exist'] } };
  expect(() => renderArticlePage(withBadRelated, parsed, [withBadRelated])).not.toThrow();
});

test('zero related articles renders no related section, not an empty one', () => {
  const withNoRelated = { ...baseArticle, frontmatter: { ...baseArticle.frontmatter, related: [] } };
  const html = renderArticlePage(withNoRelated, parsed, [withNoRelated]);
  expect(html).not.toContain('class="related"');
});

test('a "## نموذج" section renders inside a print-button wrapper', () => {
  const withModel = { ...parsed, sections: [{ id: 's1', heading: 'نموذج كذا', bodyHtml: '<table></table>', isModel: true }] };
  const html = renderArticlePage(baseArticle, withModel, [baseArticle]);
  expect(html).toContain('printTpl()');
});

test('faq accordion and FAQPage json-ld are absent when faq is empty', () => {
  const html = renderArticlePage(baseArticle, parsed, [baseArticle]);
  expect(html).not.toContain('class="faq"');
  expect(html).not.toContain('"@type":"FAQPage"');
});

test('includes Article json-ld script tag', () => {
  const html = renderArticlePage(baseArticle, parsed, [baseArticle]);
  expect(html).toContain('"@type":"Article"');
});
