import { test, expect, afterEach } from 'vitest';
import { renderArticlePage } from './articlePage';

const originalVercelEnv = process.env.VERCEL_ENV;
const originalBlogSiteUrl = process.env.BLOG_SITE_URL;
afterEach(() => {
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
  if (originalBlogSiteUrl === undefined) delete process.env.BLOG_SITE_URL;
  else process.env.BLOG_SITE_URL = originalBlogSiteUrl;
});

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

test('byline date formats correctly even when publishDate carries a time component', () => {
  const withTime = { ...baseArticle, frontmatter: { ...baseArticle.frontmatter, publishDate: '2026-11-04T23:25:00+03:00' } };
  const html = renderArticlePage(withTime, parsed, [withTime]);
  expect(html).toContain('4 نوفمبر 2026');
});

// Regression (I8): formatArabicDate must use Riyadh-local time, not UTC --
// 00:30 Riyadh time on the 5th is 21:30 UTC on the 4th, so a UTC-based
// formatter would wrongly show "4 نوفمبر" to the author who scheduled it
// for the 5th.
test('byline date shows the Riyadh-local day, not the UTC day, near a midnight boundary', () => {
  const nearMidnight = { ...baseArticle, frontmatter: { ...baseArticle.frontmatter, publishDate: '2026-11-05T00:30:00+03:00' } };
  const html = renderArticlePage(nearMidnight, parsed, [nearMidnight]);
  expect(html).toContain('5 نوفمبر 2026');
  expect(html).not.toContain('4 نوفمبر 2026');
});

test('article pages carry a noindex meta tag outside of a production build', () => {
  process.env.VERCEL_ENV = 'preview';
  const html = renderArticlePage(baseArticle, parsed, [baseArticle]);
  expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
});

test('article pages omit the noindex meta tag on a production build', () => {
  process.env.VERCEL_ENV = 'production';
  const html = renderArticlePage(baseArticle, parsed, [baseArticle]);
  expect(html).not.toContain('noindex');
});

// The breadcrumb is internal navigation -- it must stay on whichever origin
// served this build, unlike the canonical/og:image URLs which intentionally
// stay pinned to production (see getSiteUrl's comment in shared.ts).
test('article pages carry og:type=article, article:published_time, and a full Twitter Card', () => {
  const html = renderArticlePage(baseArticle, parsed, [baseArticle, otherArticle]);
  expect(html).toContain('<meta property="og:type" content="article">');
  expect(html).toContain('<meta property="article:published_time" content="2026-11-03">');
  expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  expect(html).toContain('<meta name="twitter:title" content="كيف تتابع الطلبات؟">');
  expect(html).toContain('<meta name="twitter:description" content="وصف قصير">');
  expect(html).toContain('<meta name="twitter:image" content="https://seentech.io/blog/og/how-to.png">');
});

test('breadcrumb nav follows BLOG_SITE_URL, not a hardcoded production domain', () => {
  process.env.VERCEL_ENV = 'preview';
  process.env.BLOG_SITE_URL = 'https://staging.seentech.io';
  const html = renderArticlePage(baseArticle, parsed, [baseArticle]);
  expect(html).toContain('href="https://staging.seentech.io/blog/"');
  expect(html).toContain('href="https://staging.seentech.io/blog/category/orders"');
  expect(html).not.toContain('href="https://seentech.io/blog/"');
});
