/**
 * seen-readiness-fixes-task.md P4 (UX-02): the translation keys the code uses
 * that the locale files do not have -- they showed in Arabic (the fallback
 * text written in the code) to English and Urdu users, or as the raw key.
 *
 *   npx tsx scripts/i18n/find-missing-keys.ts          # list them
 *   npx tsx scripts/i18n/find-missing-keys.ts --json   # with the code's fallback text
 *
 * Only literal keys are checked (t('a.b'), t("a.b"), i18n.t('a.b')); keys
 * built at run time (t(`x.${y}`)) cannot be known here.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LOCALES = ['ar', 'en', 'ur'] as const;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return ['node_modules', 'locales'].includes(e.name) ? [] : walk(p);
    return /\.(tsx?|jsx?)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

function flatten(obj: unknown, prefix = '', out = new Map<string, string>()): Map<string, string> {
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object') flatten(v, key, out);
      else out.set(key, String(v));
    }
  }
  return out;
}

export type UsedKey = { key: string; fallback: string | null; file: string };

export function usedKeys(files = walk(path.join(ROOT, 'src'))): UsedKey[] {
  const re = /\bt\(\s*(['"])([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)\1\s*(?:,\s*(['"`])((?:\\.|(?!\3).)*)\3)?/g;
  const found = new Map<string, UsedKey>();
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(re)) {
      const key = m[2];
      if (!found.has(key) || (!found.get(key)!.fallback && m[4])) {
        found.set(key, { key, fallback: m[4] ?? null, file: path.relative(ROOT, file) });
      }
    }
  }
  return [...found.values()];
}

/** A key counts as present when the locale has it, or its i18next plural forms. */
function has(locale: Map<string, string>, key: string): boolean {
  return locale.has(key) || ['_one', '_other', '_zero', '_two', '_few', '_many'].some((s) => locale.has(key + s));
}

export function missingKeys(): Record<(typeof LOCALES)[number], UsedKey[]> {
  const used = usedKeys();
  const result = {} as Record<(typeof LOCALES)[number], UsedKey[]>;
  for (const lang of LOCALES) {
    const locale = flatten(JSON.parse(fs.readFileSync(path.join(ROOT, `src/i18n/locales/${lang}.json`), 'utf8')));
    // A key that is a section (has children) is not a missing string.
    const sections = new Set([...locale.keys()].flatMap((k) => k.split('.').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('.'))));
    result[lang] = used.filter((u) => !has(locale, u.key) && !sections.has(u.key));
  }
  return result;
}

if (process.argv[1] && /find-missing-keys/.test(process.argv[1])) {
  const missing = missingKeys();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(missing, null, 2));
  } else {
    for (const lang of LOCALES) console.log(`${lang}: ${missing[lang].length} missing`);
  }
}
