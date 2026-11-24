/**
 * seen-measurements-basic-advanced-task.md, acceptance 6: the measurement
 * selector in its three places -- the new order form, the customer form, the
 * customer's own link -- at 360, 768 and 1280, with the advanced section
 * closed and open. Fixture backend, no account, no real data (mockBackend.ts).
 *
 *   npx tsx scripts/responsive/measurement-shots.ts --label after [--port 5196] [--dev]
 *
 * Writes docs/responsive/measurements/<label>/<place>-<width>-<state>.jpg and
 * results.json: per shot, the visible fields and the largest empty gap
 * between two neighbouring fields in a column (no holes around the figure).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { build, createServer, preview } from 'vite';
import { MOCK_ANON_KEY, MOCK_SUPABASE_URL, installMockBackend } from './mockBackend';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const LABEL = arg('label', 'after');
const PORT = Number(arg('port', '5196'));
const BASE = `http://127.0.0.1:${PORT}`;
// --dir picks the folder under docs/responsive (measurements-v2 for the second task).
const OUT = path.join(ROOT, 'docs/responsive', arg('dir', 'measurements'), LABEL);
// --receipt-only: just the receipt shot, added to an existing set.
const RECEIPT_ONLY = process.argv.includes('--receipt-only');
const WIDTHS = RECEIPT_ONLY ? [1280] : [360, 768, 1280];

type Place = { key: string; path: string; open?: (page: Page) => Promise<void> };
const PLACES: Place[] = [
  // The new order form: its "new customer" window carries the measurements.
  { key: 'order', path: '/orders', open: async (page) => {
    await page.locator('#tour-orders-new-btn').click({ timeout: 10_000 });
    await page.getByRole('button', { name: /إضافة عميل جديد/ }).first().click({ timeout: 10_000 });
  } },
  { key: 'customer', path: '/customers', open: async (page) => { await page.locator('#tour-customers-add-btn').click({ timeout: 10_000 }); } },
  { key: 'public', path: '/measurements/fixture-token' },
];

async function measure(page: Page) {
  return page.evaluate(() => {
    const fields = Array.from(document.querySelectorAll<HTMLElement>('input[id^="thobe-part-"]'))
      .map((input) => input.closest<HTMLElement>('[id^="thobe-field-"]') ?? input.parentElement!.parentElement!)
      .filter((box) => box.offsetParent !== null);
    // Group by column (left edge), then the largest gap between neighbours.
    const columns = new Map<number, DOMRect[]>();
    for (const box of fields) {
      const r = box.getBoundingClientRect();
      const col = Math.round(r.left / 10);
      columns.set(col, [...(columns.get(col) || []), r]);
    }
    let maxGap = 0;
    for (const rects of columns.values()) {
      rects.sort((a, b) => a.top - b.top);
      for (let i = 1; i < rects.length; i++) maxGap = Math.max(maxGap, Math.round(rects[i].top - rects[i - 1].bottom));
    }
    return { visible: fields.length, maxGapPx: maxGap };
  });
}

async function main() {
  process.env.VITE_SUPABASE_URL = MOCK_SUPABASE_URL;
  process.env.VITE_SUPABASE_ANON_KEY = MOCK_ANON_KEY;
  let stop: () => Promise<void>;
  if (process.argv.includes('--dev')) {
    const server = await createServer({ root: ROOT, server: { port: PORT, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
    await server.listen();
    stop = () => server.close();
  } else {
    const dist = path.join(ROOT, '.responsive-out/dist-measurements');
    await build({ root: ROOT, logLevel: 'error', build: { outDir: dist, emptyOutDir: true } });
    const server = await preview({ root: ROOT, logLevel: 'error', build: { outDir: dist }, preview: { port: PORT, strictPort: true, host: '127.0.0.1' } });
    stop = () => new Promise((resolve) => server.httpServer.close(() => resolve()));
  }
  if (!RECEIPT_ONLY) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const resultsFile = path.join(OUT, 'results.json');
  const results: Record<string, unknown>[] = RECEIPT_ONLY && existsSync(resultsFile)
    ? (JSON.parse(readFileSync(resultsFile, 'utf8')) as Record<string, unknown>[]).filter((r) => r.place !== 'receipt')
    : [];
  try {
    for (const width of WIDTHS) {
      const context = await browser.newContext({
        viewport: { width, height: width < 768 ? 800 : 900 }, hasTouch: width <= 1024, isMobile: width < 768,
        serviceWorkers: 'block', locale: 'ar-SA', reducedMotion: 'reduce', deviceScaleFactor: 1,
      });
      await context.addInitScript(() => { (window as unknown as Record<string, unknown>).__name = (f: unknown) => f; });
      await installMockBackend(context, { lang: 'ar' });
      // The customer's own link: a customer with nothing stored yet.
      await context.route('**/api/public/measurements/**', (route) => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ customer_name: 'عميل تجريبي', shop_name: 'مشغل الأناقة للخياطة', shop_logo_url: null, measurement_unit: 'cm', measurements: {} }),
      }));
      const page = await context.newPage();
      for (const place of RECEIPT_ONLY ? [] : PLACES) {
        await page.goto(`${BASE}${place.path}`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
        await page.waitForSelector('main, input[id^="thobe-part-"]', { timeout: 60_000 });
        await page.waitForTimeout(2500);
        if (place.open) await place.open(page);
        const first = page.locator('#thobe-part-length').first();
        await first.waitFor({ timeout: 20_000 });
        const tagged = page.locator('[data-measurement-selector]').first();
        const selector = (await tagged.count()) > 0 ? tagged : first.locator('xpath=ancestor::div[contains(@class,"shadow-xl")][1]');
        await selector.scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        const button = selector.getByRole('button', { name: /مقاسات متقدمة|المقاسات المتقدمة|إخفاء المتقدمة/ });
        const hasButton = (await button.count()) > 0;
        for (const state of hasButton ? ['closed', 'open'] : ['all']) {
          if (state === 'open') { await button.click(); await page.waitForTimeout(400); }
          const name = `${place.key}-${width}-${state}`;
          await selector.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 70 });
          results.push({ place: place.key, width, state, ...(await measure(page)) });
          process.stdout.write('.');
        }
        // A field in focus, with its fraction buttons (the section still open).
        const chest = page.locator('#thobe-part-chest').first();
        await chest.click();
        await chest.fill('');
        await chest.pressSequentially('52.5');
        await page.waitForTimeout(300);
        await selector.screenshot({ path: path.join(OUT, `${place.key}-${width}-focus.jpg`), type: 'jpeg', quality: 70 });
        results.push({ place: place.key, width, state: 'focus', ...(await measure(page)) });
        await chest.fill('');
        await page.keyboard.press('Tab');
        await page.waitForTimeout(200);
        if (hasButton) { await button.click(); await page.waitForTimeout(200); }
      }
      // The printed receipt with measurements (acceptance 7): the invoice
      // layout's live preview, its sample values to the quarter.
      if (width === 1280) {
        try {
          await page.goto(`${BASE}/settings?tab=invoice`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
          const toggle = page.locator('label').filter({ hasText: 'تفاصيل الخياطة المخصصة' }).first();
          await toggle.waitFor({ timeout: 60_000 });
          const box = toggle.locator('input[type="checkbox"]');
          if ((await box.count()) > 0 && !(await box.isChecked())) await toggle.click();
          // Beside the options on a wide screen; behind its own tab otherwise.
          const previewTab = page.getByRole('button', { name: /المعاينة المباشرة/ });
          if (await previewTab.isVisible().catch(() => false)) await previewTab.click();
          const preview = page.getByText('محاكاة حية للفاتورة المطبوعة').first();
          await preview.waitFor({ timeout: 30_000 });
          await page.waitForTimeout(600);
          const paper = preview.locator('xpath=ancestor::div[2]');
          await paper.screenshot({ path: path.join(OUT, 'receipt-1280.jpg'), type: 'jpeg', quality: 75 });
          results.push({ place: 'receipt', width, state: 'measurements' });
        } catch (err) {
          console.warn(`receipt shot skipped: ${(err as Error).message.split(String.fromCharCode(10))[0]}`);
          await page.screenshot({ path: path.join(ROOT, '.responsive-out', 'receipt-debug.png'), fullPage: true }).catch(() => {});
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
    await stop();
  }
  writeFileSync(resultsFile, JSON.stringify(results, null, 1));
  console.log(`\n${results.length} shots in ${path.relative(ROOT, OUT)}`);
  for (const r of results) console.log(`  ${r.place} ${r.width} ${r.state}${r.visible !== undefined ? `: ${r.visible} fields, largest gap ${r.maxGapPx}px` : ''}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
