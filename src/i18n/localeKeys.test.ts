import { describe, expect, it } from 'vitest';
import { missingKeys } from '../../scripts/i18n/find-missing-keys';

// seen-readiness-fixes-task.md P4 (UX-02): every translation key the code uses
// exists in the locale files -- ~220 did not, and showed in Arabic (the code's
// fallback) to English and Urdu users. The platform admin screens (saas.*) are
// for the platform team and need Arabic only; two placeholders are generated
// per attribute in the code on purpose.
const DYNAMIC = new Set(['inventory.variants.attribute_name_placeholder', 'inventory.variants.value_placeholder']);

describe('translation keys', () => {
  const missing = missingKeys();
  it('every key the code uses is in Arabic', () => {
    expect(missing.ar.map((k) => k.key).filter((k) => !DYNAMIC.has(k))).toEqual([]);
  });
  it.each(['en', 'ur'] as const)('every shop-facing key is in %s', (lang) => {
    expect(missing[lang].map((k) => k.key).filter((k) => !k.startsWith('saas.') && !DYNAMIC.has(k))).toEqual([]);
  });
});
