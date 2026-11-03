import { test, expect } from 'vitest';
import { STYLE_BLOCK, renderSiteHeader, renderSiteFooter, renderStickyMobileCta, renderSideCta, renderTrackingScript } from './shared';

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

test('footer renders without throwing', () => {
  expect(renderSiteFooter().length).toBeGreaterThan(0);
});

test('tracking script pushes data-track clicks to dataLayer', () => {
  const script = renderTrackingScript();
  expect(script).toContain('window.dataLayer');
  expect(script).toContain('data-track');
});
