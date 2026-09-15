import '../lib/intlSetup';
import { createI18n } from './createI18n';

// Lazy per-language loading (seen-offline-coverage-and-performance-
// task.md Phase 6): these three files together were 1.2MB, over half of
// the app's 2.35MB main bundle, downloaded by every visitor regardless of
// which single language they actually use. Only the active language is
// fetched now; main.tsx awaits `ready` before rendering so nothing flashes
// untranslated, and switching languages fetches (then caches) the other
// one on demand.
const { i18n, ready } = createI18n((lang) => import(`./locales/${lang}.json`));

export { ready };
export default i18n;
