import '../lib/intlSetup';
import { toLatinDigits } from '../lib/intlSetup';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import ar from './locales/ar.json';
import en from './locales/en.json';
import ur from './locales/ur.json';

// Get and normalize the language choice, default to 'ar'
let defaultLanguage = 'ar';
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
  if (saved === 'ar' || saved === 'en' || saved === 'ur') {
    defaultLanguage = saved;
  } else {
    localStorage.setItem('i18nextLng', 'ar');
    defaultLanguage = 'ar';
  }
}

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
    resources: {
      ar: { translation: ar },
      en: { translation: en },
      ur: { translation: ur },
    },
    fallbackLng: 'ar',
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

// Synchronize document dir and lang immediately on load
if (typeof window !== 'undefined') {
  const dir = defaultLanguage === 'en' ? 'ltr' : 'rtl';
  document.documentElement.dir = dir;
  document.documentElement.lang = defaultLanguage;
}

export default i18n;
