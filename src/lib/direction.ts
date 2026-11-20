/**
 * direction.ts
 * Single source of truth for language direction (RTL/LTR).
 *
 * Historically the codebase tested `i18n.language === 'ar'` to decide direction,
 * which silently rendered Urdu (an RTL language) left-to-right. Every direction
 * decision must go through the helpers below instead.
 */

import i18n from 'i18next';
import { useTranslation } from 'react-i18next';

export const SUPPORTED_LANGS = ['ar', 'en', 'ur'] as const;
export type AppLang = (typeof SUPPORTED_LANGS)[number];

/** Languages written right-to-left. Arabic AND Urdu. */
export const RTL_LANGS: readonly string[] = ['ar', 'ur', 'fa', 'he'];

export const DEFAULT_LANG: AppLang = 'ar';

/** Normalize any i18next language tag (e.g. "en-US", "ur-PK") to a supported app language. */
export function normalizeLang(lang?: string | null): AppLang {
  if (!lang) return DEFAULT_LANG;
  const base = String(lang).toLowerCase().split(/[-_]/)[0];
  return (SUPPORTED_LANGS as readonly string[]).includes(base)
    ? (base as AppLang)
    : DEFAULT_LANG;
}

/** True when the given language (defaults to the active one) is right-to-left. */
export function isRtlLang(lang?: string | null): boolean {
  const base = String(lang ?? i18n.language ?? DEFAULT_LANG)
    .toLowerCase()
    .split(/[-_]/)[0];
  return RTL_LANGS.includes(base);
}

/** 'rtl' | 'ltr' for the given language (defaults to the active one). */
export function dirOf(lang?: string | null): 'rtl' | 'ltr' {
  return isRtlLang(lang) ? 'rtl' : 'ltr';
}

/** Currently active app language, normalized. */
export function currentLang(): AppLang {
  return normalizeLang(i18n.language);
}

/** BCP-47 locale for Intl / toLocaleString, always with Latin digits. */
export function localeOf(lang?: string | null): string {
  switch (normalizeLang(lang ?? i18n.language)) {
    case 'ar':
      return 'ar-SA-u-nu-latn';
    case 'ur':
      return 'ur-PK-u-nu-latn';
    default:
      return 'en-US';
  }
}

/** Font stack per language — Tajawal has no Urdu coverage, Noto Nastaliq/Noto Sans Arabic do. */
export function fontFamilyOf(lang?: string | null): string {
  switch (normalizeLang(lang ?? i18n.language)) {
    case 'ur':
      return '"Noto Nastaliq Urdu", "Noto Naskh Arabic", "Tajawal", ui-sans-serif, system-ui, sans-serif';
    case 'en':
      return '"Inter", "Tajawal", ui-sans-serif, system-ui, sans-serif';
    default:
      return '"Tajawal", ui-sans-serif, system-ui, sans-serif';
  }
}

/**
 * Apply language, direction and font to <html>. Called by the i18n bootstrap on
 * load and on every `languageChanged`, so components never need to touch the DOM.
 */
export function applyDocumentDirection(lang?: string | null): void {
  if (typeof document === 'undefined') return;
  const normalized = normalizeLang(lang ?? i18n.language);
  const root = document.documentElement;
  root.lang = normalized;
  root.dir = dirOf(normalized);
  root.setAttribute('data-lang', normalized);
  root.style.setProperty('--font-sans', fontFamilyOf(normalized));
  ensureLanguageFonts(normalized);
}

/**
 * Google Fonts stylesheets, only for the languages that use them
 * (seen-performance-first-open-login-task.md Phase 1). Arabic uses the local
 * Tajawal / IBM Plex Sans Arabic files, so an Arabic visitor downloads none
 * of this; it used to be a render-blocking <link> in index.html for everyone.
 * display=swap: text shows in a fallback font until the web font arrives.
 */
const LANGUAGE_FONT_CSS: Partial<Record<AppLang, string>> = {
  ur: 'https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;500;600;700&family=Noto+Naskh+Arabic:wght@400;500;600;700&display=swap',
  en: 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap',
};

export function ensureLanguageFonts(lang: AppLang): void {
  const href = LANGUAGE_FONT_CSS[lang];
  if (!href || typeof document === 'undefined') return;
  const id = `seen-fonts-${lang}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = href;
  link.crossOrigin = 'anonymous';
  document.head.appendChild(link);
}

/**
 * React hook: everything a component needs for a language-aware render.
 *
 *   const { t, lang, isRtl, dir, locale } = useDirection();
 *   <div dir={dir} className={isRtl ? 'text-right' : 'text-left'}>
 *
 * Re-renders on language change because it wraps useTranslation().
 */
export function useDirection() {
  const { t, i18n: instance } = useTranslation();
  const lang = normalizeLang(instance.language);
  const rtl = isRtlLang(lang);
  return {
    t,
    i18n: instance,
    lang,
    isRtl: rtl,
    dir: (rtl ? 'rtl' : 'ltr') as 'rtl' | 'ltr',
    locale: localeOf(lang),
    /** Pick a value by direction: `pick('text-right', 'text-left')` */
    pick: <T,>(rtlValue: T, ltrValue: T): T => (rtl ? rtlValue : ltrValue),
  };
}

/** Changes language and keeps the document in sync. Prefer this over i18n.changeLanguage. */
export async function changeAppLanguage(lang: string): Promise<void> {
  const normalized = normalizeLang(lang);
  await i18n.changeLanguage(normalized);
  try {
    localStorage.setItem('i18nextLng', normalized);
  } catch {
    /* storage unavailable — non-critical */
  }
  applyDocumentDirection(normalized);
}
