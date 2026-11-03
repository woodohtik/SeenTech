import { test, expect, afterEach } from 'vitest';
import { blogConfig } from '../../content/blog.config';
import { buildAnalyticsInitScript, hasAnyAnalyticsConfigured } from './analytics';

const original = { ...blogConfig };

afterEach(() => {
  Object.assign(blogConfig, original);
});

test('empty config produces no init script and reports nothing configured', () => {
  expect(buildAnalyticsInitScript()).toBe('');
  expect(hasAnyAnalyticsConfigured()).toBe(false);
});

test('a configured GA4 id produces a gtag config call for that exact id', () => {
  blogConfig.ga4MeasurementId = 'G-TEST123';
  expect(buildAnalyticsInitScript()).toContain("gtag('config','G-TEST123')");
  expect(hasAnyAnalyticsConfigured()).toBe(true);
});

test('a configured Snapchat pixel id produces a snaptr init call for that exact id', () => {
  blogConfig.snapchatPixelId = 'snap-test-id';
  expect(buildAnalyticsInitScript()).toContain("snaptr('init','snap-test-id')");
});

test('a configured Meta pixel id produces an fbq init call for that exact id', () => {
  blogConfig.metaPixelId = 'meta-test-id';
  expect(buildAnalyticsInitScript()).toContain("fbq('init','meta-test-id')");
});
