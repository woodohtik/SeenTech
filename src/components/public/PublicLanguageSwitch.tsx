import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * seen-readiness-fixes-task.md P4 (UX-04): the customer's own pages (order
 * tracking, the measurements form, the digital invoice) can be read in
 * Arabic, English or Urdu -- a small switch, and ?lang=ar|en|ur in the link so
 * the shop can send it in the customer's language.
 */
const LANGS = [
  { code: 'ar', name: 'العربية' },
  { code: 'en', name: 'English' },
  { code: 'ur', name: 'اردو' },
] as const;
type Code = typeof LANGS[number]['code'];

function apply(i18n: { changeLanguage: (l: string) => unknown }, code: Code) {
  void i18n.changeLanguage(code);
  if (typeof document !== 'undefined') {
    document.documentElement.dir = code === 'en' ? 'ltr' : 'rtl';
    document.documentElement.lang = code;
  }
}

/** The language named in ?lang=, if it is one of ours. */
export function langFromQuery(search: string): Code | null {
  const v = new URLSearchParams(search).get('lang');
  return LANGS.some((l) => l.code === v) ? (v as Code) : null;
}

export default function PublicLanguageSwitch({ className = '' }: { className?: string }) {
  const { i18n } = useTranslation();

  useEffect(() => {
    const fromLink = typeof window !== 'undefined' ? langFromQuery(window.location.search) : null;
    if (fromLink && fromLink !== i18n.language) apply(i18n, fromLink);
    // only on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`flex items-center justify-center gap-1 text-sm font-bold ${className}`} role="group" aria-label="Language / اللغة / زبان">
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          lang={l.code}
          onClick={() => apply(i18n, l.code)}
          aria-pressed={i18n.language === l.code}
          className={`min-h-9 px-3 rounded-full transition-colors ${i18n.language === l.code ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
        >
          {l.name}
        </button>
      ))}
    </div>
  );
}
