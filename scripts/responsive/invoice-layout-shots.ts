/**
 * seen-invoice-layout-settings-task.md, acceptance: every option left on the
 * invoice layout screen changes the print, on 80mm and A4. The preview uses
 * the very templates a sale and a reprint print with (lib/invoiceLayout.ts),
 * so each shot is the printed paper. Fixture backend, no account, no real data.
 *
 *   npx tsx scripts/responsive/invoice-layout-shots.ts --label after [--port 5221] [--dev]
 *
 * Writes docs/responsive/invoice-layout/<label>/<paper>-<step>.jpg.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { build, createServer, preview } from 'vite';
import { MOCK_ANON_KEY, MOCK_SUPABASE_URL, installMockBackend } from './mockBackend';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const LABEL = arg('label', 'after');
const PORT = Number(arg('port', '5221'));
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(ROOT, 'docs/responsive/invoice-layout', LABEL);

type Step = { key: string; label: string; act: (page: Page) => Promise<void> };

const toggle = (text: string) => async (page: Page) => {
  await page.locator('label').filter({ hasText: text }).first().click();
};
const fillField = (labelText: string, value: string) => async (page: Page) => {
  const field = page.locator('div.space-y-2').filter({ hasText: labelText }).locator('textarea, input').first();
  await field.fill(value);
};
const align = (name: RegExp) => async (page: Page) => {
  const byName = page.getByRole('button', { name });
  if (await byName.count()) { await byName.first().click(); return; }
  // Before this task the buttons had no name: their order is right, centre, left.
  const index = name.source.includes('يمين') ? 0 : name.source.includes('يسار') ? 2 : 1;
  await page.locator('button:has(svg.lucide-align-right), button:has(svg.lucide-align-center), button:has(svg.lucide-align-left)').nth(index).click();
};

const STEPS: Step[] = [
  { key: '0-default', label: 'الافتراضي', act: async () => {} },
  { key: '1-no-unit-price', label: 'بدون سعر الوحدة', act: toggle('عرض سعر الوحدة') },
  { key: '2-no-barcode', label: 'بدون الباركود', act: toggle('باركود الطلب') },
  { key: '3-align-right', label: 'محاذاة لليمين', act: align(/محاذاة لليمين/) },
  { key: '4-align-left', label: 'محاذاة لليسار', act: align(/محاذاة لليسار/) },
  { key: '5-footer', label: 'رسالة ختام وسياسة استبدال', act: async (page) => {
    await fillField('رسالة الختام', 'نسعد بخدمتك دائماً')(page);
    await fillField('سياسة الاستبدال', 'الاستبدال خلال 7 أيام مع الفاتورة، والقماش المفصّل لا يُسترجع.')(page);
  } },
  { key: '6-no-discount-switch', label: 'إيقاف «الخصم» (يبقى في الفاتورة الضريبية)', act: toggle('إدراج عمود الخصم') },
];

async function main() {
  process.env.VITE_SUPABASE_URL = MOCK_SUPABASE_URL;
  process.env.VITE_SUPABASE_ANON_KEY = MOCK_ANON_KEY;
  let stop: () => Promise<void>;
  if (process.argv.includes('--dev')) {
    const server = await createServer({ root: ROOT, server: { port: PORT, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
    await server.listen();
    stop = () => server.close();
  } else {
    const dist = path.join(ROOT, '.responsive-out/dist-invoice-layout');
    await build({ root: ROOT, logLevel: 'error', build: { outDir: dist, emptyOutDir: true } });
    const server = await preview({ root: ROOT, logLevel: 'error', build: { outDir: dist }, preview: { port: PORT, strictPort: true, host: '127.0.0.1' } });
    stop = () => new Promise((resolve) => server.httpServer.close(() => resolve()));
  }
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const results: Record<string, unknown>[] = [];
  try {
    for (const paper of [{ key: '80mm', button: /حراري 80mm/ }, { key: 'A4', button: /^A4$/ }]) {
      // Wide enough for the options and the preview side by side.
      const context = await browser.newContext({ viewport: { width: 1900, height: 2600 }, locale: 'ar-SA', serviceWorkers: 'block', reducedMotion: 'reduce', deviceScaleFactor: 1 });
      await context.addInitScript(() => { (window as unknown as Record<string, unknown>).__name = (f: unknown) => f; });
      await installMockBackend(context, { lang: 'ar' });
      const page = await context.newPage();
      await page.goto(`${BASE}/settings?tab=invoice`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
      const previewTitle = page.getByText('محاكاة حية للفاتورة المطبوعة').first();
      await previewTitle.waitFor({ timeout: 60_000 });
      await page.waitForTimeout(1500);
      await page.getByRole('button', { name: paper.button }).first().click();
      // The preview shrinks the paper and caps its height; the shots want the
      // whole paper at its own size.
      await page.addStyleTag({ content: '[class*="max-h-[850px]"]{max-height:none!important;overflow:visible!important}[class*="scale-["]{transform:none!important}' });
      const paperEl = page.locator('#simplified-invoice-container, #standard-tax-invoice-container').first();
      for (const step of STEPS) {
        try {
          await step.act(page);
          await page.waitForTimeout(400);
          await paperEl.screenshot({ path: path.join(OUT, `${paper.key}-${step.key}.jpg`), type: 'jpeg', quality: 80 });
          results.push({ paper: paper.key, step: step.key, label: step.label, ok: true });
        } catch (err) {
          results.push({ paper: paper.key, step: step.key, label: step.label, ok: false, error: (err as Error).message.split(String.fromCharCode(10))[0] });
        }
        process.stdout.write('.');
      }
      await context.close();
    }
  } finally {
    await browser.close();
    await stop();
  }
  writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} shots in ${path.relative(ROOT, OUT)}`);
  for (const r of results.filter((x) => !x.ok)) console.log(`  missing ${r.paper} ${r.step}: ${r.error}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
