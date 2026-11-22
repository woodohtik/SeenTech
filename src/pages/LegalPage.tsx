import React from 'react';
import { useTranslation } from 'react-i18next';
import PublicLanguageSwitch from '../components/public/PublicLanguageSwitch';
import { PRIVACY, TERMS, type LegalLang } from '../legal/legalDocuments';

/**
 * seen-readiness-fixes-task.md P5 (PLATFORM-01): /privacy and /terms, public,
 * in the interface's language (or ?lang=), each clearly marked as a draft
 * until the founder's lawyer approves the text.
 */
export default function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const { i18n } = useTranslation();
  const lang: LegalLang = i18n.language === 'en' || i18n.language === 'ur' ? i18n.language : 'ar';
  const doc = (kind === 'privacy' ? PRIVACY : TERMS)[lang];
  const dir = lang === 'en' ? 'ltr' : 'rtl';

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900" dir={dir} lang={lang}>
      <div className="mx-auto max-w-3xl space-y-6">
        <PublicLanguageSwitch />
        <p role="note" className="rounded-2xl border-2 border-amber-500 bg-amber-50 p-4 text-center text-sm font-black text-amber-900">
          {doc.draftNotice}
        </p>
        <article className="rounded-3xl bg-white p-6 shadow-sm sm:p-10 space-y-6">
          <header className="space-y-1 text-center">
            <h1 className="text-2xl font-black">{doc.title}</h1>
            <p className="text-sm text-slate-600">{doc.updated}</p>
          </header>
          {doc.sections.map((s) => (
            <section key={s.heading} className="space-y-2">
              <h2 className="text-lg font-black">{s.heading}</h2>
              {s.paragraphs.map((p) => <p key={p} className="leading-relaxed text-slate-800">{p}</p>)}
            </section>
          ))}
          <nav className="flex justify-center gap-6 border-t border-slate-200 pt-6 text-sm font-bold">
            <a href="/privacy" className="text-blue-700 underline">{PRIVACY[lang].title.split(' — ')[0]}</a>
            <a href="/terms" className="text-blue-700 underline">{TERMS[lang].title.split(' — ')[0]}</a>
          </nav>
        </article>
      </div>
    </div>
  );
}
