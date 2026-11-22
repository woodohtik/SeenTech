#!/usr/bin/env node
/**
 * Startup-JS budget (seen-performance-first-open-login-task.md Phase 2.5).
 *
 *   npm run build && npm run size          (or: node scripts/check-bundle-size.mjs <distDir>)
 *
 * Fails (exit 1) when, in the built index.html:
 *  - the entry script plus every <link rel="modulepreload"> exceeds 250KB gzip;
 *  - vendor-firebase is among them (it belongs to push notifications only);
 *  - a core language file (the one main.tsx waits for before the first
 *    render) exceeds 40KB gzip.
 * Sizes are gzip at the default level, measured from the files on disk.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_STARTUP_KB = 250;
const BUDGET_CORE_LOCALE_KB = 40;

const dist = process.argv[2] || 'dist';
const htmlPath = join(dist, 'index.html');
if (!existsSync(htmlPath)) {
  console.error(`size: ${htmlPath} not found -- build first (npm run build).`);
  process.exit(2);
}
const html = readFileSync(htmlPath, 'utf8');

const kb = (n) => Math.round((n / 1024) * 10) / 10;
const gz = (file) => gzipSync(readFileSync(join(dist, file))).length;
const rel = (src) => src.replace(/^\//, '');

const entry = [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((m) => rel(m[1]));
const preloads = [...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)].map((m) => rel(m[1]));
if (entry.length === 0) {
  console.error('size: no module entry script in index.html');
  process.exit(2);
}

const startup = [...new Set([...entry, ...preloads])].map((f) => ({ file: f, gzip: gz(f) }));
const startupTotal = startup.reduce((s, f) => s + f.gzip, 0);

// Core language files: imported straight from the entry (virtual:i18n-core/*),
// unlike the full files, which sit behind a "./locales/<lang>.json" key.
const entrySrc = readFileSync(join(dist, entry[0]), 'utf8');
const dir = entry[0].includes('/') ? entry[0].slice(0, entry[0].lastIndexOf('/') + 1) : '';
const full = new Set(
  [...entrySrc.matchAll(/"\.\/locales\/[a-z]+\.json":\(\)=>[^,]*?import\("\.\/([a-z]{2}-[\w-]+\.js)"\)/g)].map((m) => m[1]),
);
// seen-readiness-fixes-task.md P3.4 named them i18n-core-<lang>-<hash>.js (so the
// en-*/ur-* precache exclusions miss them); the older <lang>-<hash>.js still counts.
const core = [...new Set([...entrySrc.matchAll(/import\("\.\/((?:i18n-core-)?(?:ar|en|ur)-[\w-]+\.js)"\)/g)].map((m) => m[1]))]
  .filter((f) => !full.has(f))
  .map((f) => ({ file: dir + f, gzip: gz(dir + f) }));

const failures = [];
if (kb(startupTotal) > BUDGET_STARTUP_KB) failures.push(`startup JS ${kb(startupTotal)}KB gzip > ${BUDGET_STARTUP_KB}KB`);
const firebase = startup.find((f) => /vendor-firebase/.test(f.file));
if (firebase) failures.push(`${firebase.file} is loaded at startup`);
if (core.length === 0) failures.push('could not find the core language files in the entry');
for (const c of core) {
  if (kb(c.gzip) > BUDGET_CORE_LOCALE_KB) failures.push(`core language file ${c.file} ${kb(c.gzip)}KB gzip > ${BUDGET_CORE_LOCALE_KB}KB`);
}

console.log('Startup JS (gzip):');
for (const f of startup) console.log(`  ${String(kb(f.gzip)).padStart(7)}KB  ${f.file}`);
console.log(`  ${String(kb(startupTotal)).padStart(7)}KB  total (budget ${BUDGET_STARTUP_KB}KB)`);
console.log('Core language files (gzip):');
for (const c of core) console.log(`  ${String(kb(c.gzip)).padStart(7)}KB  ${c.file} (budget ${BUDGET_CORE_LOCALE_KB}KB)`);

if (failures.length) {
  console.error('\nsize budget FAILED:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('\nsize budget OK');
