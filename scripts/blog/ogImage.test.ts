import { test, expect } from 'vitest';
import { renderOgImagePng } from './ogImage';

test('renders a non-empty PNG buffer for a title', async () => {
  const buf = await renderOgImagePng('كيف تتابع طلبات الخياط؟');
  expect(buf.length).toBeGreaterThan(1000);
  expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])); // PNG signature
});
