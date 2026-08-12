import '../lib/intlSetup';
import { toLatinDigits } from '../lib/intlSetup';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import {
  applyDocumentDirection,
  normalizeLang,
  SUPPORTED_LANGS,
  DEFAULT_LANG,
} from '../lib/direction';

import ar from './locales/ar.json';
import en from './locales/en.json';
import ur from './locales/ur.json';

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

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    lng: defaultLanguage,
    saveMissing: Boolean(import.meta.env?.DEV),
    resources: {
      ar: { translation: ar },
      en: { translation: en },
      ur: { translation: ur },
    },
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
  } as any);

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

export default i18n;
