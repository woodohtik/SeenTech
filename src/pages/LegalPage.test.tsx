// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// seen-readiness-fixes-task.md P5 (PLATFORM-01; founder question 6).
const lang = vi.hoisted(() => ({ value: 'ar' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: lang.value, changeLanguage: () => {} } }) }));

import LegalPage from './LegalPage';
import { PRIVACY, TERMS } from '../legal/legalDocuments';

afterEach(cleanup);

describe('the legal pages', () => {
  it.each(['ar', 'en', 'ur'])('in %s, both say they are drafts, and neither claims approval', (l) => {
    lang.value = l;
    for (const kind of ['privacy', 'terms'] as const) {
      render(<LegalPage kind={kind} />);
      const doc = (kind === 'privacy' ? PRIVACY : TERMS)[l as 'ar'];
      expect(screen.getByRole('note').textContent).toBe(doc.draftNotice);
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(doc.title);
      expect(document.body.textContent).not.toMatch(/معتمد من|approved by ZATCA/);
      cleanup();
    }
  });

  it('the privacy policy names the processors and how to ask for deletion or export', () => {
    const text = JSON.stringify(PRIVACY.ar);
    for (const name of ['Supabase', 'Vercel', 'Firebase', 'Sentry']) expect(text).toContain(name);
    expect(text).toMatch(/حذف/);
    expect(text).toMatch(/تصدير/);
  });
});
