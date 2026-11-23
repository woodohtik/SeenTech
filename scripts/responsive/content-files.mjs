/**
 * seen-responsive-layout-task.md Phase 3 -- which files are "content".
 *
 * A component is content if it is only ever shown inside the app's content
 * area (<main> of Layout.tsx or SaaSLayout.tsx). Content decides by the
 * content's width (`main-*` variants); everything else -- the shell, the pages
 * with no shell (login, landing, public links), and the components both
 * share -- decides by the window's (`sm: md: lg: xl:`).
 *
 * Worked out from the imports, not kept as a list by hand:
 *   content = reachable from the screens the two layouts show
 *             minus reachable from anything shown outside them
 *             minus the print documents (paper has its own sizes)
 *
 *   node scripts/responsive/content-files.mjs          prints the content files
 *   import { contentFiles } from './content-files.mjs' the same, as a function
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'src');
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');

/** The shell: these decide by the window, and so does everything only they use. */
export const SHELL = ['src/components/Layout.tsx', 'src/components/SaaSLayout.tsx'];
/**
 * Windows and bottom sheets decide by the WINDOW (the task, phase 2 item 6:
 * "under 640px of the window: a full-width bottom sheet"), wherever they are used.
 */
export const BY_WINDOW = [/^src\/components\/ui\/Modal\.tsx$/];
/** Paper, not screen: sizes there are the printer's. */
export const PRINT = [
  /^src\/components\/printing\//, /ReportPrintDocument\.tsx$/, /ZReport\.tsx$/, /^src\/pages\/PublicInvoice\.tsx$/,
  /^src\/utils\/print/, /^src\/lib\/print/, /^src\/components\/orders\/OrderWorkCard\.tsx$/,
];

function resolveImport(from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), spec);
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`, path.join(base, 'index.tsx'), path.join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const importCache = new Map();
function importsOf(file) {
  if (importCache.has(file)) return importCache.get(file);
  const text = readFileSync(file, 'utf8');
  const out = new Set();
  const re = /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const target = resolveImport(file, m[1] || m[2] || m[3]);
    if (target && /\.tsx?$/.test(target) && !/\.test\.tsx?$/.test(target)) out.add(target);
  }
  importCache.set(file, [...out]);
  return importCache.get(file);
}

function reach(roots, stopAt = new Set()) {
  const seen = new Set();
  const queue = [...roots];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || stopAt.has(file)) continue;
    seen.add(file);
    for (const next of importsOf(file)) queue.push(next);
  }
  return seen;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

export function contentFiles() {
  const app = path.join(SRC, 'App.tsx');
  const shell = SHELL.map((f) => path.join(ROOT, f));
  const appText = readFileSync(app, 'utf8');

  // The screens the layouts show: what App.tsx renders between <Layout> / <SaaSLayout> and its closing tag.
  const inside = new Set();
  const lazy = new Map();
  // React.lazy, lazyWithPreload, or any other wrapper around a dynamic import.
  for (const m of appText.matchAll(/const\s+(\w+)\s*=\s*[\w.]+\(\s*\(\)\s*=>\s*import\(\s*['"]([^'"]+)['"]/g)) lazy.set(m[1], m[2]);
  for (const m of appText.matchAll(/import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g)) lazy.set(m[1], m[2]);
  for (const m of appText.matchAll(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g)) for (const n of m[1].split(',')) lazy.set(n.trim().split(/\s+as\s+/).pop(), m[2]);
  const blocks = [...appText.matchAll(/<(Layout|SaaSLayout)\b[\s\S]*?<\/\1>/g)].map((m) => m[0]);
  const insideNames = new Set();
  for (const block of blocks) for (const m of block.matchAll(/<([A-Z]\w+)/g)) insideNames.add(m[1]);
  const outsideNames = new Set();
  const rest = blocks.reduce((text, block) => text.replace(block, ''), appText);
  for (const m of rest.matchAll(/<([A-Z]\w+)/g)) outsideNames.add(m[1]);

  const fileOf = (name) => (lazy.has(name) ? resolveImport(app, lazy.get(name)) : null);
  const insideRoots = [...insideNames].map(fileOf).filter((f) => f && !shell.includes(f));
  const outsideRoots = [...outsideNames].filter((n) => !insideNames.has(n)).map(fileOf).filter(Boolean);

  // Outside: what App shows with no layout, and what the layouts themselves use for their chrome.
  const stop = new Set(insideRoots);
  const outside = reach([...outsideRoots, ...shell, path.join(SRC, 'main.tsx')].filter(existsSync), stop);
  for (const f of reach(insideRoots)) if (!outside.has(f)) inside.add(f);

  return walk(SRC)
    .filter((f) => inside.has(f))
    .map(rel)
    .filter((f) => !PRINT.some((re) => re.test(f)))
    .filter((f) => !BY_WINDOW.some((re) => re.test(f)))
    .sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = contentFiles();
  console.log(files.join('\n'));
  console.error(`${files.length} content files`);
}
