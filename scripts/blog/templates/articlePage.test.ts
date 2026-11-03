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
  expect(html).not.toContain('wrap related');
});

test('a "## نموذج" section renders its print button INSIDE #tpl, not as an inline onclick handler', () => {
  const withModel = { ...parsed, sections: [{ id: 's1', heading: 'نموذج كذا', bodyHtml: '<table></table>', isModel: true }] };
  const html = renderArticlePage(baseArticle, withModel, [baseArticle]);
  expect(html).not.toContain('onclick');
  expect(html).toContain('data-print-tpl');
  const tplOpen = html.indexOf('id="tpl"');
  const printBtn = html.indexOf('data-print-tpl');
  const tplClose = html.indexOf('</div></section>', tplOpen);
  expect(printBtn).toBeGreaterThan(tplOpen);
  expect(printBtn).toBeLessThan(tplClose);
});

test('the blog client script is referenced as an external tag, with no inline TOC/print script left on the page', () => {
  const html = renderArticlePage(baseArticle, parsed, [baseArticle]);
  expect(html).toContain('<script src="/blog/blog.js" defer></script>');
  expect(html).not.toMatch(/<script>[\s\S]*IntersectionObserver/);
});

test('escapes quotes and angle brackets from frontmatter title/description in the rendered meta tags', () => {
  const dangerous = { ...baseArticle, frontmatter: { ...baseArticle.frontmatter, title: 'عنوان "خاص" <script>', metaDescription: 'وصف & <تنبيه>' } };
  const html = renderArticlePage(dangerous, parsed, [dangerous]);
  expect(html).toContain('عنوان &quot;خاص&quot; &lt;script&gt;');
  expect(html).toContain('وصف &amp; &lt;تنبيه&gt;');
  expect(html).not.toContain('<script>عنوان');
});

test('json-ld script content escapes "<" so a title containing "</script>" cannot break out of the script tag', () => {
  const dangerous = { ...baseArticle, frontmatter: { ...baseArticle.frontmatter, title: 'عنوان</script><script>alert(1)</script>' } };
  const html = renderArticlePage(dangerous, parsed, [dangerous]);
  expect(html).not.toContain('</script><script>alert');
});

test('byline includes the calendar and clock icons from the reference design', () => {
  const html = renderArticlePage(baseArticle, parsed, [baseArticle]);
  expect(html).toContain('M4 7a2 2 0 0 1 2 -2h12');
  expect(html).toContain('M3 12a9 9 0 1 0 18 0');
});

test('a plain markdown table inside a non-model section is wrapped in .tbl for mobile horizontal scroll', () => {
  const withTable = { ...parsed, sections: [{ id: 's1', heading: 'قسم', bodyHtml: '<table><tr><td>١</td></tr></table>', isModel: false }] };
  const html = renderArticlePage(baseArticle, withTable, [baseArticle]);
  expect(html).toContain('<div class="tbl"><table>');
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
