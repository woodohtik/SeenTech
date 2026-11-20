/**
 * seen-performance-first-open-login-task.md Phase 1: the first paint waits
 * for a small "core" of each language file instead of the whole file.
 *
 * `import('virtual:i18n-core/ar')` resolves to only the sections listed in
 * CORE_SECTIONS of src/i18n/locales/ar.json, generated at build time from
 * that same file -- so there is still one source of truth per language and
 * no text is copied or changed. The full file still loads right after the
 * first render (src/i18n/config.ts) and is merged over the core.
 *
 * Used by vite.config.ts and vitest.config.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * What the screens shown before the full file arrives use: the login form,
 * the PIN screens (login/staff), error messages, form validation and the
 * shared words. Checked against Login, PinLogin, ForcePinSetup,
 * StaffPinSetup, LockScreen, ErrorBoundary and the toasts.
 */
export const CORE_SECTIONS = ['common', 'login', 'errors', 'validation', 'staff'] as const;

const PREFIX = 'virtual:i18n-core/';

export function i18nCorePlugin(root: string): Plugin {
  return {
    name: 'seen-i18n-core',
    resolveId(id) {
      return id.startsWith(PREFIX) ? '\0' + id : null;
    },
    load(id) {
      if (!id.startsWith('\0' + PREFIX)) return null;
      const lang = id.slice(('\0' + PREFIX).length);
      if (!/^[a-z]{2}$/.test(lang)) throw new Error(`seen-i18n-core: bad language "${lang}"`);
      const file = path.resolve(root, `src/i18n/locales/${lang}.json`);
      this.addWatchFile(file);
      const all = JSON.parse(fs.readFileSync(file, 'utf8'));
      const core = Object.fromEntries(CORE_SECTIONS.filter((k) => k in all).map((k) => [k, all[k]]));
      return `export default ${JSON.stringify(core)};`;
    },
  };
}
