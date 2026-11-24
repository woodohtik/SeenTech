/**
 * seen-update-delivery-fix-task.md, acceptance: a real browser, a real
 * service worker, consecutive builds -- no reload loop, and every device
 * reaches the new build without a tap.
 *
 *   npx tsx scripts/responsive/update-delivery-check.ts [--port 5310] [--skip-build]
 *
 * Builds (fixture backend, no account, no real data):
 *   OLD -- the commit before 22 Nov (autoUpdate, unguarded reload): the
 *          devices stuck in the 23 Nov video;
 *   A   -- this working tree;
 *   B   -- A with one visible change in Settings, so its code files have
 *          new names, as after any real deploy.
 * A small server plays Vercel: static files, a real 404 under /assets/,
 * index.html for every other path, the same cache headers as vercel.json.
 *
 * Scenarios, each with a video in docs/reports/update-delivery/:
 *   1 no-loop  -- on A with /dashboard open, B is published, the person opens
 *                 Settings (a file A knew by an old name): the page settles
 *                 on B with at most one reload.
 *   2 guard    -- the Settings file stays missing for good: one automatic
 *                 reload, then the still "updating" screen, no more reloads.
 *   3 rescue   -- a device on OLD with /dashboard open; A is published: it
 *                 lands on A by itself, with one reload.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { MOCK_ANON_KEY, MOCK_SUPABASE_URL, installMockBackend } from './mockBackend';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const PORT = Number(arg('port', '5310'));
const BASE = `http://127.0.0.1:${PORT}`;
const WORK = path.join(ROOT, '.responsive-out', 'update-delivery');
const VIDEO_DIR = path.join(ROOT, 'docs', 'reports', 'update-delivery');
const OLD_COMMIT = 'bdadc2e~1';

const env = { ...process.env, VITE_SUPABASE_URL: MOCK_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: MOCK_ANON_KEY };

function viteBuild(cwd: string, outDir: string) {
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], { cwd, env, stdio: 'inherit' });
}

/** A git worktree at `ref` sharing this repo's node_modules (a junction, removed before the worktree). */
function withWorktree(ref: string, name: string, run: (dir: string) => void) {
  const dir = path.join(WORK, `tree-${name}`);
  if (existsSync(dir)) {
    try { execFileSync('cmd', ['/c', 'rmdir', path.join(dir, 'node_modules')]); } catch { /* none */ }
    execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: ROOT });
  }
  execFileSync('git', ['worktree', 'add', '--detach', dir, ref], { cwd: ROOT, stdio: 'ignore' });
  execFileSync('cmd', ['/c', 'mklink', '/J', path.join(dir, 'node_modules'), path.join(ROOT, 'node_modules')], { stdio: 'ignore' });
  try {
    run(dir);
  } finally {
    execFileSync('cmd', ['/c', 'rmdir', path.join(dir, 'node_modules')]);
    execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: ROOT });
  }
}

function buildAll() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  console.log('build A (this tree)');
  viteBuild(ROOT, path.join(WORK, 'A'));
  console.log('build B (A + a change in Settings)');
  // Outside the repo: a copy cannot go inside the folder it copies.
  const b = path.join(process.env.CLAUDE_JOB_DIR ? path.join(process.env.CLAUDE_JOB_DIR, 'tmp') : os.tmpdir(), 'seen-update-b-src');
  rmSync(b, { recursive: true, force: true });
  cpSync(ROOT, b, { recursive: true, filter: (src) => !/[\\/](node_modules|\.git|dist|\.responsive-out|graphify-out|android|docs)([\\/]|$)/.test(src.slice(ROOT.length)) });
  const settings = path.join(b, 'src', 'components', 'Settings.tsx');
  writeFileSync(settings, readFileSync(settings, 'utf8').replace('<BuildStamp className="mt-12 text-center" />', '<BuildStamp className="mt-12 text-center" data-variant="b" />'));
  execFileSync('cmd', ['/c', 'mklink', '/J', path.join(b, 'node_modules'), path.join(ROOT, 'node_modules')], { stdio: 'ignore' });
  try {
    execFileSync('git', ['init', '-q'], { cwd: b });
    viteBuild(b, path.join(WORK, 'B'));
  } finally {
    execFileSync('cmd', ['/c', 'rmdir', path.join(b, 'node_modules')]);
    rmSync(b, { recursive: true, force: true });
  }
  console.log(`build OLD (${OLD_COMMIT})`);
  withWorktree(OLD_COMMIT, 'old', (dir) => viteBuild(dir, path.join(WORK, 'OLD')));
}

// ---- a tiny Vercel ---------------------------------------------------------
const TYPES: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.txt': 'text/plain', '.xml': 'application/xml',
};
const NO_STORE = new Set(['/sw.js', '/sw-extra.js', '/index.html', '/', '/version.json', '/manifest.webmanifest']);
let servedDir = '';
const hidden = new Set<string>();

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', BASE);
  let file = path.join(servedDir, decodeURIComponent(url.pathname));
  const name = path.basename(url.pathname);
  const exists = !hidden.has(name) && existsSync(file) && statSync(file).isFile();
  if (!exists) {
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/api/')) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    file = path.join(servedDir, 'index.html');
  }
  const headers: Record<string, string> = { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' };
  if (NO_STORE.has(url.pathname) || file.endsWith('index.html')) headers['cache-control'] = 'no-cache, no-store, must-revalidate';
  else if (url.pathname.startsWith('/assets/')) headers['cache-control'] = 'public, max-age=31536000, immutable';
  res.writeHead(200, headers);
  res.end(readFileSync(file));
});

const serve = (build: 'OLD' | 'A' | 'B') => { servedDir = path.join(WORK, build); hidden.clear(); };
const mainScript = (build: 'OLD' | 'A' | 'B') => {
  const html = readFileSync(path.join(WORK, build, 'index.html'), 'utf8');
  return /\/assets\/index-[A-Za-z0-9_-]+\.js/.exec(html)![0];
};
const settingsFile = (build: 'A' | 'B') => readdirSync(path.join(WORK, build, 'assets')).find((f) => /^Settings-.*\.js$/.test(f))!;

// ---- the browser -------------------------------------------------------------
async function openContext(browser: import('playwright').Browser, video: string): Promise<{ context: BrowserContext; page: Page; loads: () => number }> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }, locale: 'ar-SA', serviceWorkers: 'allow',
    recordVideo: { dir: path.join(WORK, 'video-tmp', video), size: { width: 1280, height: 800 } },
  });
  await context.addInitScript(() => { (window as unknown as Record<string, unknown>).__name = (f: unknown) => f; });
  await installMockBackend(context, { lang: 'ar' });
  const page = await context.newPage();
  let count = 0;
  page.on('load', () => { count++; console.log(`  ${stamp()} [${video}] load ${count}: ${page.url()}`); });
  page.on('console', (msg) => { if (msg.type() === 'error' || msg.type() === 'warning') console.log(`  [${video}] ${msg.type()}: ${msg.text().slice(0, 200)}`); });
  return { context, page, loads: () => count };
}

async function controlled(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 60_000 }).catch(async () => {
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 60_000 });
  });
  // the precache finishes installing
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(3000);
}

const T0 = Date.now();
const stamp = () => `${((Date.now() - T0) / 1000).toFixed(1)}s`;
/** The page's main script; '(busy)' if the page does not answer within 3 s. */
const pageScript = (page: Page) => Promise.race([
  page.evaluate(() => document.querySelector('script[type="module"][src*="/assets/index-"]')?.getAttribute('src') ?? ''),
  new Promise<string>((resolve) => setTimeout(() => resolve('(busy)'), 3000)),
]);

async function workerState(page: Page) {
  return page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    const s = (w: ServiceWorker | null | undefined) => (w ? `${w.state}` : '-');
    return `active=${s(r?.active)} waiting=${s(r?.waiting)} installing=${s(r?.installing)} controller=${navigator.serviceWorker.controller ? 'yes' : 'no'}`;
  }).catch((e) => `(${(e as Error).message.split(String.fromCharCode(10))[0]})`);
}

async function saveVideo(context: BrowserContext, page: Page, name: string) {
  console.log(`  [${name}] worker: ${await workerState(page)}`);
  await page.screenshot({ path: path.join(WORK, `${name}.png`) }).catch(() => {});
  const video = page.video();
  await context.close();
  if (video) {
    mkdirSync(VIDEO_DIR, { recursive: true });
    await video.saveAs(path.join(VIDEO_DIR, `${name}.webm`));
  }
}

type Result = { scenario: string; ok: boolean; detail: string };

/** Waits (up to 90 s) until the page runs `target`, then 10 s more so any further reload shows. */
async function settleOn(page: Page, target: string): Promise<boolean> {
  const start = Date.now();
  const deadline = start + 150_000;
  let lastLog = 0;
  while (Date.now() < deadline) {
    if (process.argv.includes('--trace') && Date.now() - lastLog > 5000) {
      lastLog = Date.now();
      console.log(`    ${stamp()} page=${await pageScript(page).catch(() => '?')}`);
    }
    if ((await pageScript(page).catch(() => '')) === target) {
      await page.waitForTimeout(10_000);
      return (await pageScript(page).catch(() => '')) === target;
    }
    await page.waitForTimeout(1000);
  }
  return false;
}

async function noLoop(browser: import('playwright').Browser): Promise<Result> {
  serve('A');
  const { context, page, loads } = await openContext(browser, 'no-loop');
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'load' });
  await controlled(page);
  const before = loads();
  serve('B');
  // The person opens Settings: A knows its file by A's name, gone on B.
  await page.evaluate(() => { history.pushState({}, '', '/settings'); window.dispatchEvent(new PopStateEvent('popstate')); });
  const onB = await settleOn(page, mainScript('B'));
  const reloads = loads() - before;
  const script = await pageScript(page).catch(() => '');
  await saveVideo(context, page, '1-no-loop-A-to-B');
  return { scenario: '1 no-loop (A -> B, opening Settings)', ok: onB && reloads <= 1, detail: `${reloads} reload(s); page now on ${onB ? 'B' : `"${script}" (not B)`}` };
}

async function guard(browser: import('playwright').Browser): Promise<Result> {
  serve('B');
  hidden.add(settingsFile('B')); // missing for good: a permanent 404
  const { context, page, loads } = await openContext(browser, 'guard');
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  const before = loads();
  await page.evaluate(() => { history.pushState({}, '', '/settings'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await page.waitForTimeout(40_000);
  const reloads = loads() - before;
  const calm = await page.getByText('نحدّث النظام').count();
  await saveVideo(context, page, '2-guard-permanent-404');
  return { scenario: '2 guard (Settings file missing for good)', ok: reloads <= 1 && calm > 0, detail: `${reloads} automatic reload(s) in 40s; "نحدّث النظام" shown: ${calm > 0}` };
}

async function rescue(browser: import('playwright').Browser): Promise<Result> {
  serve('OLD');
  const { context, page, loads } = await openContext(browser, 'rescue');
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'load' });
  await controlled(page);
  const before = loads();
  serve('A');
  // The browser's own periodic check of sw.js (old code also checks on focus/visibility).
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update())).catch(() => {});
  const onA = await settleOn(page, mainScript('A'));
  const reloads = loads() - before;
  const script = await pageScript(page).catch(() => '');
  await saveVideo(context, page, '3-rescue-OLD-to-A');
  return { scenario: '3 rescue (pre-22-Nov device -> this fix)', ok: onA && reloads >= 1 && reloads <= 2, detail: `${reloads} reload(s); page now on ${onA ? 'A' : `"${script}" (not A)`}` };
}

async function main() {
  if (!process.argv.includes('--skip-build')) buildAll();
  await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  const results: Result[] = [];
  try {
    const only = arg('only', '');
    for (const scenario of [noLoop, guard, rescue].filter((s) => !only || s.name === only)) {
      try {
        results.push(await scenario(browser));
      } catch (err) {
        results.push({ scenario: scenario.name, ok: false, detail: `error: ${(err as Error).message.split('\n')[0]}` });
      }
      console.log(results[results.length - 1]);
    }
  } finally {
    await browser.close();
    server.close();
  }
  mkdirSync(VIDEO_DIR, { recursive: true });
  writeFileSync(path.join(VIDEO_DIR, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `\n${failed.length} scenario(s) failed` : '\nall scenarios passed');
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
