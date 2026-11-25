import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import { signIn } from './helpers';

/**
 * Not a check: a map of the screens the next golden paths walk through
 * (their accessibility tree), written to golden-probe/ -- run only with
 * GOLDEN_PROBE=1, to write those paths from what the screens really show.
 */
test.skip(!process.env.GOLDEN_PROBE, 'probe only with GOLDEN_PROBE=1');

const OUT = 'golden-probe';

async function snap(page: import('@playwright/test').Page, name: string) {
  mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(1500);
  writeFileSync(path.join(OUT, `${name}.yml`), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}

test('probe the screens of the next paths', async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, 'owner');
  for (const [name, url] of [
    ['orders', '/orders'], ['customers', '/customers'], ['inventory', '/inventory'],
    ['settings', '/settings'], ['sales', '/sales'],
  ] as const) {
    await page.goto(url);
    await snap(page, name);
  }
  // The new tailoring order form.
  await page.goto('/orders');
  await page.getByText('إنشاء طلب جديد').first().click().catch(() => {});
  await snap(page, 'orders-new-form');
});
