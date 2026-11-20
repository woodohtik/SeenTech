import '../lib/intlSetup';
import { useEffect, useState } from 'react';
import { createI18n } from './createI18n';

// Lazy per-language loading (seen-offline-coverage-and-performance-
// task.md Phase 6): only the active language is ever fetched, and
// switching languages fetches (then caches) the other one on demand.
//
// seen-performance-first-open-login-task.md Phase 1: the first render
// waits only for the language's "core" (login, PIN, errors, validation and
// common words -- scripts/vite-i18n-core.ts), about a tenth of the file.
// The full file follows straight after and is merged over it; anything
// past the login screen waits for `fullReady` (useFullTranslations below,
// used by App.tsx) so no screen shows a raw key.
const loadCore = (lang: 'ar' | 'en' | 'ur') =>
  lang === 'en' ? import('virtual:i18n-core/en')
    : lang === 'ur' ? import('virtual:i18n-core/ur')
      : import('virtual:i18n-core/ar');

const { i18n, ready, fullReady } = createI18n(
  (lang) => import(`./locales/${lang}.json`),
  loadCore,
);

let fullLoaded = false;
fullReady.then(() => { fullLoaded = true; });

/** True once the active language's whole file is in (it starts loading right after the first render). */
export function useFullTranslations(): boolean {
  const [loaded, setLoaded] = useState(fullLoaded);
  useEffect(() => {
    if (loaded) return;
    let alive = true;
    fullReady.then(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [loaded]);
  return loaded;
}

export { ready, fullReady };
export default i18n;
