import { test, expect, afterEach } from 'vitest';
import { blogConfig } from '../../../content/blog.config';
import {
  STYLE_BLOCK, FONTS_PRECONNECT, renderSiteHeader, renderSiteFooter, renderStickyMobileCta, renderSideCta,
  BLOG_CLIENT_SCRIPT_TAG, renderAnalyticsLoaderTags, renderAnalyticsConfigScriptTag, escapeHtml,
  isProductionBuild, renderRobotsMetaTag, getSiteUrl,
} from './shared';

const originalConfig = { ...blogConfig };
const originalVercelEnv = process.env.VERCEL_ENV;
const originalBlogSiteUrl = process.env.BLOG_SITE_URL;
afterEach(() => {
  Object.assign(blogConfig, originalConfig);
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
  if (originalBlogSiteUrl === undefined) delete process.env.BLOG_SITE_URL;
  else process.env.BLOG_SITE_URL = originalBlogSiteUrl;
});

// Internal navigation links (header, chips, breadcrumbs, search form) must
// stay on whichever origin served this build, so a staging reader clicking
// around never bounces to production -- see getSiteUrl's own comment for
// why SEO-facing URLs (canonical, JSON-LD, sitemap) do the opposite.
test('getSiteUrl defaults to the production domain when BLOG_SITE_URL is unset', () => {
  delete process.env.BLOG_SITE_URL;
  expect(getSiteUrl()).toBe('https://seentech.io');
});

test('getSiteUrl follows BLOG_SITE_URL on a non-production build', () => {
  process.env.VERCEL_ENV = 'preview';
  process.env.BLOG_SITE_URL = 'https://staging.seentech.io';
  expect(getSiteUrl()).toBe('https://staging.seentech.io');
});

test('getSiteUrl ignores BLOG_SITE_URL and stays on the production domain for a production build', () => {
  process.env.VERCEL_ENV = 'production';
  process.env.BLOG_SITE_URL = 'https://staging.seentech.io';
  expect(getSiteUrl()).toBe('https://seentech.io');
});

test('style block is non-empty css with no style tags', () => {
  expect(STYLE_BLOCK.length).toBeGreaterThan(100);
  expect(STYLE_BLOCK).not.toMatch(/<\/?style>/);
});

test('sticky mobile cta uses "ابدأ الآن" and the seentech.io link, not the old copy', () => {
  const html = renderStickyMobileCta();
  expect(html).toContain('ابدأ الآن');
  expect(html).not.toContain('احجز زيارة');
  expect(html).toMatch(/href="https:\/\/seentech\.io"/);
  expect(html).not.toContain('#book');
});

test('side cta aria-label and button both say "ابدأ الآن"', () => {
  const html = renderSideCta();
  expect(html).toContain('aria-label="ابدأ الآن"');
  expect(html).toContain('ابدأ الآن');
  expect(html).not.toContain('احجز زيارة');
});

test('site header marks the "المدونة" nav link as current, on every page type', () => {
  expect(renderSiteHeader()).toContain('aria-current="page"');
});

test('site header logo and nav links follow BLOG_SITE_URL, not a hardcoded production domain', () => {
  process.env.VERCEL_ENV = 'preview';
  process.env.BLOG_SITE_URL = 'https://staging.seentech.io';
  const html = renderSiteHeader();
  expect(html).toContain('href="https://staging.seentech.io/"');
  expect(html).toContain('href="https://staging.seentech.io/blog/"');
  expect(html).not.toContain('href="https://seentech.io/"');
});

test('footer renders without throwing', () => {
  expect(renderSiteFooter().length).toBeGreaterThan(0);
});

test('fonts preconnect block references Tajawal and IBM Plex Sans Arabic', () => {
  expect(FONTS_PRECONNECT).toContain('fonts.googleapis.com');
  expect(FONTS_PRECONNECT).toContain('Tajawal');
  expect(FONTS_PRECONNECT).toContain('IBM+Plex+Sans+Arabic');
});

test('escapeHtml escapes quotes, ampersands and angle brackets', () => {
  expect(escapeHtml(`وصف فيه "اقتباس" & <رمز>`)).toBe('وصف فيه &quot;اقتباس&quot; &amp; &lt;رمز&gt;');
});

test('the blog client script is loaded as an external same-origin file, not inlined', () => {
  expect(BLOG_CLIENT_SCRIPT_TAG).toBe('<script src="/blog/blog.js" defer></script>');
});

test('sticky mobile cta omits the WhatsApp button entirely when whatsappNumber is unset', () => {
  blogConfig.whatsappNumber = '';
  expect(renderStickyMobileCta()).not.toContain('wa.me');
});

test('sticky mobile cta includes the WhatsApp button once whatsappNumber is configured', () => {
  blogConfig.whatsappNumber = '966500000000';
  expect(renderStickyMobileCta()).toContain('https://wa.me/966500000000');
});

test('side cta omits the WhatsApp link entirely when whatsappNumber is unset', () => {
  blogConfig.whatsappNumber = '';
  expect(renderSideCta()).not.toContain('wa.me');
});

test('analytics loader tags and config script tag are empty when nothing is configured', () => {
  blogConfig.ga4MeasurementId = '';
  blogConfig.snapchatPixelId = '';
  blogConfig.metaPixelId = '';
  expect(renderAnalyticsLoaderTags()).toBe('');
  expect(renderAnalyticsConfigScriptTag()).toBe('');
});

test('a configured GA4 id produces an external gtag.js loader tag and the config script tag', () => {
  blogConfig.ga4MeasurementId = 'G-TEST123';
  expect(renderAnalyticsLoaderTags()).toContain('https://www.googletagmanager.com/gtag/js?id=G-TEST123');
  expect(renderAnalyticsConfigScriptTag()).toBe('<script src="/blog/blog-config.js" defer></script>');
});

test('isProductionBuild is true only when VERCEL_ENV is exactly "production"', () => {
  process.env.VERCEL_ENV = 'production';
  expect(isProductionBuild()).toBe(true);
  process.env.VERCEL_ENV = 'preview';
  expect(isProductionBuild()).toBe(false);
  delete process.env.VERCEL_ENV;
  expect(isProductionBuild()).toBe(false);
});

test('renderRobotsMetaTag emits noindex on a non-production build and nothing on production', () => {
  process.env.VERCEL_ENV = 'preview';
  expect(renderRobotsMetaTag()).toContain('name="robots"');
  expect(renderRobotsMetaTag()).toContain('noindex');
  process.env.VERCEL_ENV = 'production';
  expect(renderRobotsMetaTag()).toBe('');
});
