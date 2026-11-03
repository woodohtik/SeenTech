import { test, expect, afterEach } from 'vitest';
import { renderIndexPage, renderCategoryPage } from './indexPage';
import { CATEGORIES } from '../categories';
import { blogConfig } from '../../../content/blog.config';

const originalConfig = { ...blogConfig };
afterEach(() => {
  Object.assign(blogConfig, originalConfig);
});

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

test('index page chips carry data-f and the grid cards carry data-pillar, for the instant client-side filter', () => {
  const html = renderIndexPage([article]);
  expect(html).toContain('data-f="orders"');
  expect(html).toContain('data-pillar="orders"');
  expect(html).toContain('<script src="/blog/blog.js" defer></script>');
});

test('index page marks the body with data-blog-page="index" so the external chip filter attaches', () => {
  expect(renderIndexPage([article])).toContain('data-blog-page="index"');
});

test('category page marks its own chip active, not "الكل", and does not mark the body as the index page', () => {
  const html = renderCategoryPage(CATEGORIES.find(c => c.slug === 'orders')!, [article]);
  const ordersChipStart = html.indexOf('data-f="orders"');
  const ordersChipTagStart = html.lastIndexOf('<a class="chip', ordersChipStart);
  expect(html.slice(ordersChipTagStart, ordersChipStart)).toContain(' on');
  expect(html).not.toContain('data-blog-page="index"');
  expect(html).toContain('data-blog-page="category"');
});

test('index page cta panel omits the WhatsApp button when whatsappNumber is unset', () => {
  blogConfig.whatsappNumber = '';
  expect(renderIndexPage([article])).not.toContain('wa.me');
});

test('byline date formats correctly even when publishDate carries a time component', () => {
  const withTime = { ...article, frontmatter: { ...article.frontmatter, publishDate: '2026-11-04T23:25:00+03:00' } };
  const html = renderIndexPage([withTime]);
  expect(html).toContain('4 نوفمبر 2026');
});

test('card title and description are HTML-escaped', () => {
  const dangerous = { ...article, frontmatter: { ...article.frontmatter, title: 'عنوان <script>', metaDescription: 'وصف "خاص"' } };
  const html = renderIndexPage([dangerous]);
  expect(html).toContain('عنوان &lt;script&gt;');
  expect(html).toContain('وصف &quot;خاص&quot;');
});
