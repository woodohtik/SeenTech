/**
 * createI18n — shared i18next bootstrap, parameterized only by which
 * translation resources to load. Extracted so the customer app build
 * (config-customer.ts) can ship a trimmed resource set (only the keys the
 * customer app actually uses) instead of the full admin-app locale files
 * (~900KB of JSON across ar/en/ur) that config.ts loads. Every other
 * behavior (digit normalization, RTL sync, fallback chain, missing-key
 * dev warnings) is identical for both builds.
 *
 * Accepts either:
 *  - a plain `{ar, en, ur}` resources object (eager, synchronous --
 *    config-customer.ts still uses this: its locale files are ~2-3KB each,
 *    not worth splitting), or
 *  - a `(lang) => Promise<resource>` loader (config.ts uses this): wired
 *    through i18next-resources-to-backend so only the ACTIVE language is
 *    ever fetched -- the other two languages' JSON only download if/when
 *    the user actually switches to them (seen-offline-coverage-and-
 *    performance-task.md Phase 6: the three full locale files were 1.2MB
 *    of the app's 2.35MB main bundle, over half of it, downloaded by every
 *    visitor regardless of which single language they use).
 *
 * Either way this returns `{ i18n, ready }` -- `ready` resolves once the
 * ACTIVE language's resources have actually loaded (for the loader mode,
 * that's the one real network fetch; for the eager mode it resolves on the
 * same tick, no behavior change from before). Callers must await `ready`
 * before their first render so nothing ever flashes an untranslated key.
 */
import { toLatinDigits } from '../lib/intlSetup';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import resourcesToBackend from 'i18next-resources-to-backend';

import {
  applyDocumentDirection,
  normalizeLang,
  SUPPORTED_LANGS,
  DEFAULT_LANG,
} from '../lib/direction';

type SupportedLang = 'ar' | 'en' | 'ur';
type Loader = (lang: SupportedLang) => Promise<any>;

export function createI18n(
  resourcesOrLoader: { ar: object; en: object; ur: object } | Loader
): { i18n: typeof i18n; ready: Promise<void> } {
  // Get and normalize the language choice, default to 'ar'
  let defaultLanguage: string = DEFAULT_LANG;
  if (typeof window !== 'undefined') {
    // Safe localStorage.clear wrapper: logout wipes storage, but a few keys must
    // survive it — the chosen language, and the onboarding-tour state (otherwise
    // the guided tour would re-launch for the same user after every logout).
    const originalClear = localStorage.clear;
    const PRESERVED_PREFIXES = ['seenTourState_v2', 'hasSeenOnboarding'];

    localStorage.clear = function() {
      const lang = localStorage.getItem('i18nextLng');

      const preserved: Array<[string, string]> = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (PRESERVED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
          const value = localStorage.getItem(key);
          if (value !== null) preserved.push([key, value]);
        }
      }

      originalClear.apply(this);

      if (lang) {
        localStorage.setItem('i18nextLng', lang);
      } else {
        localStorage.setItem('i18nextLng', 'ar');
      }

      for (const [key, value] of preserved) {
        try {
          localStorage.setItem(key, value);
        } catch {
          /* quota exceeded — non-critical */
        }
      }
    };

    const saved = localStorage.getItem('i18nextLng');
    const normalized = saved ? normalizeLang(saved) : null;
    if (normalized && saved && (SUPPORTED_LANGS as readonly string[]).includes(normalized)) {
      defaultLanguage = normalized;
      // Rewrite region-tagged values ("en-US") back to the bare code so the
      // resource bundles always resolve on the next boot.
      if (saved !== normalized) localStorage.setItem('i18nextLng', normalized);
    } else {
      localStorage.setItem('i18nextLng', DEFAULT_LANG);
      defaultLanguage = DEFAULT_LANG;
    }
  }

  const SUPPORTED_LNG_LIST = [...SUPPORTED_LANGS];

  // Add custom postProcessor to guarantee all i18n output uses English (Latin) digits (0-9)
  i18n.use({
    type: 'postProcessor',
    name: 'latinDigits',
    process: (value: string) => toLatinDigits(value),
  });

  const isLazy = typeof resourcesOrLoader === 'function';

  const baseOptions: any = {
    lng: defaultLanguage,
    saveMissing: Boolean(import.meta.env?.DEV),
    // Strip region subtags ("en-US" -> "en") so bundles always resolve.
    load: 'languageOnly',
    supportedLngs: SUPPORTED_LNG_LIST,
    nonExplicitSupportedLngs: true,
    // A missing Urdu key must NOT fall back to Arabic — that is exactly the
    // "mixed language UI" bug. Urdu degrades to English, English to Arabic.
    fallbackLng: {
      ur: ['en', 'ar'],
      en: ['ar'],
      default: ['ar'],
    },
    postProcess: ['latinDigits'],
    interpolation: {
      escapeValue: false,
      format: (value: any) => {
        if (typeof value === 'number') {
          return new Intl.NumberFormat('en-US').format(value);
        }
        if (typeof value === 'string') {
          return toLatinDigits(value);
        }
        return value;
      },
    },
    detection: {
      order: ['localStorage'],
      caches: ['localStorage'],
    },
  };

  let chain = i18n.use(LanguageDetector).use(initReactI18next);

  if (isLazy) {
    // Only the active language's JSON is ever fetched; fallbackLng above
    // still works once a listed fallback is actually needed -- the backend
    // fetches it on demand at that point too, it just isn't preloaded.
    chain = chain.use(resourcesToBackend((lang: string) => resourcesOrLoader(lang as SupportedLang)));
    baseOptions.react = {
      // No Suspense boundary exists at the app root, and adding one there
      // is a bigger, separately-scoped change -- with this off, a language
      // switch to a not-yet-loaded language shows the raw key for the
      // ~one network fetch it takes to load that bundle (cached after
      // first use) instead of suspending the tree with no fallback UI.
      // The initial/active language never hits this path since `ready`
      // below is awaited before the app's first render.
      useSuspense: false,
    };
  } else {
    baseOptions.resources = {
      ar: { translation: resourcesOrLoader.ar },
      en: { translation: resourcesOrLoader.en },
      ur: { translation: resourcesOrLoader.ur },
    };
  }

  const ready: Promise<void> = chain.init(baseOptions).then(() => undefined);

  // Synchronize <html lang/dir/font> immediately on load AND on every language
  // change. Centralizing it here means no component has to touch the DOM, and
  // Urdu correctly gets dir="rtl" (it used to be treated as LTR).
  applyDocumentDirection(defaultLanguage);
  i18n.on('languageChanged', (lng) => {
    applyDocumentDirection(lng);
  });

  // Development guard: surface any key that resolves to nothing so untranslated
  // strings are caught before they reach users instead of silently showing Arabic.
  if (import.meta.env?.DEV) {
    i18n.on('missingKey', (lngs, namespace, key) => {
      // eslint-disable-next-line no-console
      console.warn(`[i18n] missing key "${key}" for ${JSON.stringify(lngs)} (${namespace})`);
    });
  }

  return { i18n, ready };
}
