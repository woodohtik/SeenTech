import { test, expect } from 'vitest';
import { STYLE_BLOCK, FONTS_PRECONNECT, renderSiteHeader, renderSiteFooter, renderStickyMobileCta, renderSideCta, renderTrackingScript } from './shared';

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

test('fonts preconnect block references Tajawal and IBM Plex Sans Arabic', () => {
  expect(FONTS_PRECONNECT).toContain('fonts.googleapis.com');
  expect(FONTS_PRECONNECT).toContain('Tajawal');
  expect(FONTS_PRECONNECT).toContain('IBM+Plex+Sans+Arabic');
});

test('tracking script pushes data-track clicks to dataLayer', () => {
  const script = renderTrackingScript();
  expect(script).toContain('window.dataLayer');
  expect(script).toContain('data-track');
});
