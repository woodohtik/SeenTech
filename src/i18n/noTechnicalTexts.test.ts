import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import ar from './locales/ar.json';
import en from './locales/en.json';
import ur from './locales/ur.json';

// seen-friendly-errors-everywhere-task.md, phase 6: what keeps the technical
// words and the raw error texts from coming back.

const BANNED = /supabase|firebase|jwt|\brls\b|secrets|\bsql\b|postgres|pgrst|vite_|127\.0\.0\.1|server-side|\{\{\s*(error|message|details|url)\s*\}\}|قاعدة البيانات|السيرفر|الخادم/i;

function strings(node: unknown, path: string): Array<[string, string]> {
  if (typeof node === 'string') return [[path, node]];
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k));
}

describe('no technical word in the texts people see', () => {
  it.each([['ar', ar], ['en', en], ['ur', ur]])('%s', (_lang, locale) => {
    // saas.* is the platform team's own screens.
    const hits = strings(locale, '').filter(([path, text]) => !path.startsWith('saas.') && BANNED.test(text));
    expect(hits).toEqual([]);
  });

  it('the rule itself catches what it should', () => {
    expect(BANNED.test('فشل الحفظ: {{error}}')).toBe(true);
    expect(BANNED.test('تعذر الاتصال بقاعدة البيانات')).toBe(true);
    expect(BANNED.test('Row Level Security (RLS)')).toBe(true);
    expect(BANNED.test('ما وصلت الطباعة للطابعة {{host}}:{{port}}')).toBe(false);
  });
});

describe('the lint rule: an error\'s own text handed to the screen', () => {
  const lint = async (code: string) => {
    const eslint = new ESLint();
    const [result] = await eslint.lintText(code, { filePath: 'src/components/__lint_probe__.tsx' });
    return result.messages.filter((m) => m.ruleId === 'no-restricted-syntax').length;
  };

  it('fails on e.message, e?.message || fallback, res.error', async () => {
    expect(await lint('declare const toastError: (m: unknown) => void; declare const e: any; toastError(e.message);\n')).toBe(1);
    expect(await lint("declare const setError: (m: unknown) => void; declare const e: any; setError(e?.message || 'x');\n")).toBe(1);
    expect(await lint("declare const showError: (m: unknown) => void; declare const res: any; showError(res.error || 'x');\n")).toBe(1);
  }, 60_000);

  it('passes on the error itself and on our helpers', async () => {
    expect(await lint('declare const toastError: (m: unknown) => void; declare const e: any; toastError(e);\n')).toBe(0);
    expect(await lint("declare const setError: (m: unknown) => void; declare const explainOr: (e: unknown, f: string) => string; declare const e: any; setError(explainOr(e, 'x'));\n")).toBe(0);
  }, 60_000);
});
