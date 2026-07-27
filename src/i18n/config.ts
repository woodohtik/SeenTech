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
  // Safe localStorage.clear wrapper to preserve user language selection
  const originalClear = localStorage.clear;
  localStorage.clear = function() {
    const lang = localStorage.getItem('i18nextLng');
    originalClear.apply(this);
    if (lang) {
      localStorage.setItem('i18nextLng', lang);
    } else {
      localStorage.setItem('i18nextLng', 'ar');
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
