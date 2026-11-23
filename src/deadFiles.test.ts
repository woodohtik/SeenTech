import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// seen-readiness-fixes-task.md P6 (CODEHEALTH-08): a source file that no
// production code imports is dead weight -- it gets edited, translated and
// reviewed for nothing (a payment page with an unverified webhook sat here
// unused). This fails when a new one appears: import it, delete it, or add
// it to ENTRY_POINTS / TEST_SUPPORT below with the reason.
const ENTRY_POINTS = new Set([
  'src/main.tsx', // the app (index.html)
  'src/main-customer.tsx', // the customer app (index.customer.html)
  'src/App.tsx',
]);
/** Used by tests only, on purpose. */
const TEST_SUPPORT = new Set([
  'src/server/zatcaTestCertificate.ts', // an in-memory certificate for the ZATCA tests
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const path = `${dir}/${name}`;
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const isCode = (f: string) => /\.(ts|tsx|mjs|js|html)$/.test(f);
const isTest = (f: string) => /\.test\.tsx?$/.test(f) || f.includes('/test/');

describe('dead source files', () => {
  it('every file in src is imported by production code', () => {
    const roots = ['src', 'scripts', 'server.ts', 'index.html', 'index.customer.html', 'vite.config.ts', 'vite.customer.config.ts', 'capacitor.config.ts'];
    const all = roots.flatMap((r) => { try { return statSync(r).isDirectory() ? walk(r) : [r]; } catch { return []; } }).filter(isCode);
    const text = new Map(all.map((f) => [f, readFileSync(f, 'utf8')] as const));
    const production = all.filter((f) => !isTest(f));

    const dead = all
      .filter((f) => f.startsWith('src/') && /\.tsx?$/.test(f) && !isTest(f) && !f.endsWith('.d.ts'))
      .filter((f) => !ENTRY_POINTS.has(f) && !TEST_SUPPORT.has(f))
      .filter((f) => {
        const name = basename(f, extname(f));
        // a quoted path ending in the file's name, with or without its extension
        const imported = new RegExp(`['"\`][^'"\`\\n]*\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\.tsx?|\\.js)?['"\`]`);
        return !production.some((g) => g !== f && imported.test(text.get(g) || ''));
      });

    expect(dead, 'no production code imports these -- import, delete, or list them above with the reason').toEqual([]);
  });

  it('the allow-lists name files that exist', () => {
    for (const f of [...ENTRY_POINTS, ...TEST_SUPPORT]) expect(() => statSync(join(f)), f).not.toThrow();
  });
});
