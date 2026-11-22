import { describe, expect, it } from 'vitest';
import ar from './locales/ar.json';

// seen-readiness-fixes-task.md P4 (UX-03): English left in the Arabic file
// showed up in the Arabic interface ("Item deleted successfully", "Appearance").
// Every Arabic value has an Arabic letter, except names that are not words.
const ALLOWED = new Set([
  'billing.modal_proof_formats', // PNG, JPG, JPEG, PDF
  'saas.assistant_settings.provider_openai', // OpenAI
  'saas.assistant_settings.provider_gemini', // Gemini (Google)
]);

function englishOnly(o: unknown, path: string[] = [], out: string[] = []): string[] {
  if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) englishOnly(v, [...path, k], out);
  } else if (typeof o === 'string') {
    const text = o.replace(/\{\{[^}]*\}\}|<[^>]*>/g, '');
    if (/[A-Za-z]{3,}/.test(text) && !/[؀-ۿ]/.test(text)) out.push(path.join('.'));
  }
  return out;
}

describe('the Arabic locale', () => {
  it('has no English-only text', () => {
    expect(englishOnly(ar).filter((k) => !ALLOWED.has(k))).toEqual([]);
  });
});
