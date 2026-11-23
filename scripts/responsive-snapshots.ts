/**
 * seen-responsive-layout-task.md Phase 0 -- the layout snapshot tool.
 *
 *   npx tsx scripts/responsive-snapshots.ts --label baseline
 *   npx tsx scripts/responsive-snapshots.ts --label after --strict
 *   npx tsx scripts/responsive-snapshots.ts --label try --screens dashboard --widths 1280 --dev
 *
 * It runs THIS BRANCH's code (a build served locally, or the dev server with
 * --dev) against the fixture backend in scripts/responsive/mockBackend.ts --
 * no staging, no account, no real data -- and for every screen, width and
 * shell state:
 *   - runs the automatic checks (scripts/responsive/checks.ts);
 *   - at the four report widths, runs the ux-ui-audit probes
 *     (scripts/ux-probes) and saves a screenshot.
 *
 * Output: docs/responsive/<label>/results.json, summary.md and shots/;
 * the probes' raw output goes to .responsive-out/<label>/probes (not
 * committed -- it is a lead list to read, not a report).
 * --strict exits 1 when any state fails a check.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { build, createServer, preview } from 'vite';
import { failuresOf, layoutChecks, MIN_TEXT_PX, MIN_TOUCH_PX, TOUCH_MAX_WIDTH, type LayoutReport } from './responsive/checks.ts';
import { installMockBackend, MOCK_ANON_KEY, MOCK_SUPABASE_URL, type Unmocked } from './responsive/mockBackend.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = Number(process.argv[process.argv.indexOf('--port') + 1]) || 5199;
const BASE = `http://127.0.0.1:${PORT}`;
const NOW = new Date('2026-11-23T09:00:00Z');

type Screen = { key: string; path: string; open?: (page: Page) => Promise<void> };
const SCREENS: Screen[] = [
  { key: 'dashboard', path: '/dashboard' },
  { key: 'pos', path: '/sales' },
  { key: 'orders', path: '/orders' },
  { key: 'order-new', path: '/orders', open: async (page) => { await page.locator('#tour-orders-new-btn').click({ timeout: 5000 }); await page.waitForTimeout(600); } },
  { key: 'customers', path: '/customers' },
  { key: 'inventory', path: '/inventory' },
  { key: 'reports', path: '/reports' },
  { key: 'settings', path: '/settings' },
];
const WIDTHS = [360, 390, 768, 1024, 1280, 1366, 1440, 1536, 1920];
/** WCAG 1.4.10 reflow: checked for horizontal scroll only, no screenshot. */
const REFLOW_WIDTH = 320;
/** The widths in the founder's report, and where the probes run. */
const REPORT_WIDTHS = [360, 1024, 1280, 1920];
const PROBES = ['probe-core', 'probe-rtl', 'probe-heuristics', 'probe-perception'];

const locale = (lang: string) => JSON.parse(readFileSync(path.join(ROOT, `src/i18n/locales/${lang}.json`), 'utf8')) as { ai: Record<string, string> };
const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const EXPAND_NAMES = new RegExp(`^(${['ar', 'en'].flatMap((l) => [locale(l).ai.expand, locale(l).ai.collapse]).map(escapeRe).join('|')})$`);

type Assistant = 'closed' | 'open' | 'expanded';
type Sidebar = 'open' | 'collapsed';
type State = { assistant: Assistant; sidebar: Sidebar };
type Row = {
  screen: string; width: number; dir: 'rtl' | 'ltr'; assistant: Assistant; sidebar: Sidebar;
  report?: LayoutReport; failures: string[]; shot?: string; error?: string;
};

function args() {
  const a = process.argv.slice(2);
  const value = (name: string) => { const i = a.indexOf(`--${name}`); return i >= 0 ? a[i + 1] : undefined; };
  return {
    label: value('label') || 'run',
    screens: value('screens')?.split(','),
    widths: value('widths')?.split(',').map(Number),
    dev: a.includes('--dev'),
    strict: a.includes('--strict'),
    noProbes: a.includes('--no-probes'),
    noLtr: a.includes('--no-ltr'),
  };
}

function statesFor(width: number, screen: string): State[] {
  if (width < 1024) {
    // Below the sidebar's breakpoint there is a drawer, not a sidebar; the assistant is a sheet.
    return screen === 'dashboard'
      ? [{ assistant: 'closed', sidebar: 'open' }, { assistant: 'open', sidebar: 'open' }]
      : [{ assistant: 'closed', sidebar: 'open' }];
  }
  const out: State[] = [];
  for (const sidebar of ['open', 'collapsed'] as const) {
    for (const assistant of ['closed', 'open', 'expanded'] as const) out.push({ assistant, sidebar });
  }
  return out;
}

/** The state shown in the founder's report for a width (acceptance criterion 7). */
function isReportState(width: number, s: State, screen: string): boolean {
  if (!REPORT_WIDTHS.includes(width)) return false;
  if (width === 1280) return s.sidebar === 'open' && (s.assistant === 'open' || (screen === 'dashboard' && s.assistant === 'expanded'));
  return s.assistant === 'closed' && s.sidebar === 'open';
}

async function settle(page: Page) {
  await page.waitForFunction(() => !!document.querySelector('main'), undefined, { timeout: 30_000 });
  // Skeletons gone, fonts in: then the layout is the one a person sees.
  // (A page-sized pulsing block is a skeleton; a pulsing dot is not.)
  await page.waitForFunction(() => !Array.from(document.querySelectorAll('main .animate-pulse')).some((el) => el.getBoundingClientRect().height > 120), undefined, { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready);
  // The screen is lazy and reads its data after it mounts: wait until what it
  // shows stops changing (the same text length on three looks, 250ms apart).
  let last = -1;
  let same = 0;
  for (let i = 0; i < 40 && same < 3; i++) {
    const length = await page.evaluate(() => (document.querySelector('main')?.textContent || '').length);
    same = length === last && length > 0 ? same + 1 : 0;
    last = length;
    await page.waitForTimeout(250);
  }
}

async function goTo(page: Page, screen: Screen) {
  // In-app navigation (no reload): the router listens for popstate.
  await page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); }, screen.path);
  await settle(page);
  if (screen.open) await screen.open(page);
}

/**
 * The sidebar as a person leaves it. Where `want` is what the app shows by
 * default at this width, nothing is chosen -- so the app's own rule (fold to
 * make room for the assistant) is what gets measured. The other state is the
 * person's own choice, made with the fold button. Returns true if it reloaded.
 */
async function setSidebar(page: Page, want: Sidebar, width: number): Promise<boolean> {
  const aside = page.locator('#tour-sidebar');
  if (!(await aside.count())) return false;
  const byDefault: Sidebar = width >= 1280 ? 'open' : 'collapsed';
  if (want === byDefault) {
    const cleared = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith('seen_sidebar_choice_'));
      for (const k of keys) localStorage.removeItem(k);
      return keys.length;
    });
    if (cleared) { await page.reload({ waitUntil: 'domcontentloaded' }); await settle(page); return true; }
  }
  const is: Sidebar = (await aside.evaluate((el) => el.getBoundingClientRect().width)) <= 100 ? 'collapsed' : 'open';
  if (is === want) return false;
  await aside.locator('> button').first().click();
  await page.waitForTimeout(450);
  return false;
}

async function setAssistant(page: Page, want: Assistant) {
  const panel = page.getByRole('dialog').filter({ has: page.locator('textarea') });
  const isOpen = (await panel.count()) > 0;
  if (want === 'closed') {
    if (isOpen) { await page.keyboard.press('Escape'); await page.waitForTimeout(450); }
    return;
  }
  if (!isOpen) {
    await page.locator('#tour-ai-fab').click({ timeout: 5000 });
    await page.waitForTimeout(500);
  }
  // The expand button, by its name in either state and either language.
  const toggle = panel.getByRole('button', { name: EXPAND_NAMES }).first();
  if (await toggle.count()) {
    const pressed = (await toggle.getAttribute('aria-pressed')) === 'true';
    if (pressed !== (want === 'expanded')) { await toggle.click(); await page.waitForTimeout(450); }
  }
}

async function runProbes(page: Page, dir: string, name: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const probe of PROBES) {
    try {
      const source = readFileSync(path.join(ROOT, 'scripts/ux-probes', `${probe}.js`), 'utf8');
      const raw = await page.evaluate(source);
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      writeFileSync(path.join(dir, `${name}.${probe}.json`), JSON.stringify(parsed, null, 1));
      out[probe] = parsed;
    } catch (err) {
      out[probe] = { error: String(err).slice(0, 200) };
    }
  }
  return out;
}

async function newContext(browser: Awaited<ReturnType<typeof chromium.launch>>, width: number, lang: 'ar' | 'en') {
  const context = await browser.newContext({
    viewport: { width, height: width < 1024 ? 800 : 900 },
    // A touch screen up to 1024 (a tablet held sideways is 1024): the touch-target check applies there too.
    hasTouch: width <= 1024, isMobile: width < 768, deviceScaleFactor: 1,
    serviceWorkers: 'block', locale: lang === 'ar' ? 'ar-SA' : 'en-GB', reducedMotion: 'reduce',
  });
  // tsx compiles with keepNames: functions sent to the page reference this helper.
  await context.addInitScript(() => { (window as unknown as Record<string, unknown>).__name = (f: unknown) => f; });
  // A fixed "today", so day counts on screen do not change between runs. Only
  // Date is replaced: Playwright's clock also freezes performance.now, which
  // leaves every entrance animation stuck at its first frame (opacity 0).
  await context.addInitScript((startAt: number) => {
    const RealDate = Date;
    const origin = performance.now();
    const now = () => startAt + Math.round(performance.now() - origin);
    class FixedDate extends RealDate {
      constructor(...a: unknown[]) {
        if (a.length === 0) super(now());
        else super(...(a as [number]));
      }
      static now() { return now(); }
    }
    (window as unknown as { Date: unknown }).Date = FixedDate;
  }, NOW.getTime());
  const unmocked = await installMockBackend(context, { lang });
  return { context, unmocked };
}

async function main() {
  const opt = args();
  const outDir = path.join(ROOT, 'docs/responsive', opt.label);
  const shotsDir = path.join(outDir, 'shots');
  const rawDir = path.join(ROOT, '.responsive-out', opt.label, 'probes');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(shotsDir, { recursive: true });
  mkdirSync(rawDir, { recursive: true });

  process.env.VITE_SUPABASE_URL = MOCK_SUPABASE_URL;
  process.env.VITE_SUPABASE_ANON_KEY = MOCK_ANON_KEY;
  let stop: () => Promise<void>;
  if (opt.dev) {
    const server = await createServer({ root: ROOT, server: { port: PORT, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
    await server.listen();
    stop = () => server.close();
  } else {
    const dist = path.join(ROOT, '.responsive-out/dist');
    console.log('Building this branch against the fixture backend...');
    await build({ root: ROOT, logLevel: 'error', build: { outDir: dist, emptyOutDir: true } });
    const server = await preview({ root: ROOT, logLevel: 'error', build: { outDir: dist }, preview: { port: PORT, strictPort: true, host: '127.0.0.1' } });
    stop = () => new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
  }

  const screens = SCREENS.filter((s) => !opt.screens || opt.screens.includes(s.key));
  const widths = (opt.widths || WIDTHS).filter((w) => Number.isFinite(w));
  const browser = await chromium.launch();
  const rows: Row[] = [];
  const probeLeads: Array<{ screen: string; width: number; probes: Record<string, unknown> }> = [];
  const unmockedAll = new Set<string>();
  const blockedAll = new Set<string>();
  const pageErrors = new Set<string>();

  const runWidth = async (width: number, lang: 'ar' | 'en', which: Screen[], reflowOnly = false) => {
    const { context, unmocked } = await newContext(browser, width, lang);
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.add(String(e).slice(0, 160)));
    const dir = lang === 'ar' ? 'rtl' : 'ltr';
    try {
      await page.goto(`${BASE}${which[0].path}`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
      await settle(page);
      for (const screen of which) {
        const states = reflowOnly || lang === 'en' ? [{ assistant: 'closed', sidebar: 'open' } as State] : statesFor(width, screen.key);
        for (const state of states) {
          const row: Row = { screen: screen.key, width, dir, ...state, failures: [] };
          try {
            // Each state from a clean screen: close what the last one opened.
            await setAssistant(page, 'closed');
            // A screen that opens a window: leave it first, so the last state's window is gone.
            if (screen.open) await goTo(page, { key: 'away', path: '/403' });
            if (width >= 1024) await setSidebar(page, state.sidebar, width);
            await goTo(page, screen);
            await setAssistant(page, state.assistant);
            const report = await page.evaluate(layoutChecks, { minText: MIN_TEXT_PX, minTouch: MIN_TOUCH_PX, touchMaxWidth: TOUCH_MAX_WIDTH });
            row.report = report;
            row.failures = reflowOnly ? (report.horizontalScroll.fail ? [`horizontal scroll (${report.horizontalScroll.scrollWidth} > ${width})`] : []) : failuresOf(report);
            if (!reflowOnly && isReportState(width, state, screen.key)) {
              const name = `${screen.key}-${width}-${dir}-${state.assistant === 'closed' ? 'page' : `assistant-${state.assistant}`}`;
              row.shot = `shots/${name}.jpg`;
              await page.screenshot({ path: path.join(shotsDir, `${name}.jpg`), type: 'jpeg', quality: 62 });
              // And where the eye would catch a defect, if there is one: scrolled to it.
              for (const kind of ['overlap', 'crushed', 'overflow']) {
                const defect = page.locator(`[data-layout-defect="${kind}"]`).first();
                if (!(await defect.count())) continue;
                await defect.scrollIntoViewIfNeeded().catch(() => {});
                await page.screenshot({ path: path.join(shotsDir, `${name}-${kind}.jpg`), type: 'jpeg', quality: 62 });
                await page.evaluate(() => document.querySelector('main')?.scrollTo(0, 0));
              }
              if (!opt.noProbes && lang === 'ar' && state.assistant !== 'expanded') {
                probeLeads.push({ screen: screen.key, width, probes: await runProbes(page, rawDir, name) });
              }
            }
          } catch (err) {
            row.error = String(err).split('\n')[0].slice(0, 200);
            row.failures = [`could not reach this state: ${row.error}`];
          }
          rows.push(row);
          process.stdout.write(row.failures.length ? 'x' : '.');
        }
      }
    } finally {
      for (const u of unmocked) unmockedAll.add(`${u.method} ${u.url}`);
      for (const h of (unmocked as Unmocked[] & { blockedHosts?: Set<string> }).blockedHosts || []) blockedAll.add(h);
      await context.close();
    }
  };

  try {
    for (const width of widths) await runWidth(width, 'ar', screens);
    if (!opt.widths) await runWidth(REFLOW_WIDTH, 'ar', screens, true);
    if (!opt.noLtr) {
      const sample = screens.filter((s) => s.key === 'dashboard' || s.key === 'orders');
      for (const width of [360, 1280, 1920].filter((w) => widths.includes(w))) if (sample.length) await runWidth(width, 'en', sample);
    }
  } finally {
    await browser.close();
    await stop();
  }
  console.log('');

  const failed = rows.filter((r) => r.failures.length);
  const totals: Record<string, number> = {};
  for (const r of rows) {
    for (const f of r.failures) {
      const kind = f.replace(/ x\d+$/, '').replace(/\s*\(.*\)$/, '').replace(/: .*$/, '');
      totals[kind] = (totals[kind] || 0) + 1;
    }
  }
  writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({
    label: opt.label, generatedFor: 'fixture backend (no real data)', clock: NOW.toISOString(),
    checks: { minTextPx: MIN_TEXT_PX, minTouchPx: MIN_TOUCH_PX, touchMaxWidth: TOUCH_MAX_WIDTH, reflowWidth: REFLOW_WIDTH },
    totals: { states: rows.length, failing: failed.length, byCheck: totals },
    unmocked: [...unmockedAll].sort(), blockedHosts: [...blockedAll].sort(), pageErrors: [...pageErrors],
    rows,
  }, null, 1));

  // "asked -> shown": the sidebar and the assistant as requested, and how the shell placed them.
  const shown = (asked: string, got?: string) => (got && got !== asked ? `${asked} → ${got}` : asked);
  const line = (r: Row) => `| ${r.screen} | ${r.width} | ${r.dir} | ${shown(r.sidebar, r.report?.shell.sidebar)} | ${shown(r.assistant, r.report?.shell.assistant)} | ${r.report?.mainWidth ?? '—'} | ${r.report?.title.lines ?? '—'} | ${r.failures.join('; ') || 'ok'} |`;
  const md = [
    `# Layout checks — ${opt.label}`,
    '',
    `Fixture backend, clock fixed at ${NOW.toISOString()}. ${rows.length} states, **${failed.length} failing**.`,
    '',
    '| check | failing states |', '|---|---|',
    ...Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '## Failing states', '',
    '| screen | width | dir | sidebar | assistant | main px | title lines | failures |', '|---|---|---|---|---|---|---|---|',
    ...failed.map(line),
    '',
    '## Passing states', '',
    '| screen | width | dir | sidebar | assistant | main px | title lines | failures |', '|---|---|---|---|---|---|---|---|',
    ...rows.filter((r) => !r.failures.length).map(line),
    '',
    pageErrors.size ? `## Page errors\n\n${[...pageErrors].map((e) => `- ${e}`).join('\n')}\n` : '',
    unmockedAll.size ? `## Requests with no fixture (answered empty)\n\n${[...unmockedAll].sort().map((e) => `- ${e}`).join('\n')}\n` : '',
  ].join('\n');
  writeFileSync(path.join(outDir, 'summary.md'), md);
  writeFileSync(path.join(ROOT, '.responsive-out', opt.label, 'probe-leads.json'), JSON.stringify(probeLeads, null, 1));

  console.log(`${rows.length} states, ${failed.length} failing. ${path.relative(ROOT, outDir)}/summary.md`);
  for (const [k, v] of Object.entries(totals).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
  if (pageErrors.size) console.log(`  page errors: ${pageErrors.size}`);
  if (opt.strict && failed.length) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
