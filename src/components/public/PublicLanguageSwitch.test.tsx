// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

// seen-readiness-fixes-task.md P4 (UX-04).
const i18n = vi.hoisted(() => ({ language: 'ar', changeLanguage: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n }) }));

import PublicLanguageSwitch, { langFromQuery } from './PublicLanguageSwitch';

afterEach(() => { cleanup(); i18n.changeLanguage.mockReset(); });

test('?lang= picks one of the three languages, nothing else', () => {
  expect(langFromQuery('?lang=ur')).toBe('ur');
  expect(langFromQuery('?x=1&lang=en')).toBe('en');
  expect(langFromQuery('?lang=fr')).toBeNull();
  expect(langFromQuery('')).toBeNull();
});

test('choosing Urdu switches the language and the page direction', () => {
  render(<PublicLanguageSwitch />);
  fireEvent.click(screen.getByText('اردو'));
  expect(i18n.changeLanguage).toHaveBeenCalledWith('ur');
  expect(document.documentElement.dir).toBe('rtl');
  fireEvent.click(screen.getByText('English'));
  expect(document.documentElement.dir).toBe('ltr');
});
