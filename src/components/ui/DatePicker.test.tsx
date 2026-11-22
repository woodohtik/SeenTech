// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

// seen-readiness-fixes-task.md P4 (UX-07): the picker speaks the interface's
// language -- Urdu included -- not a fixed Arabic/English pair.
const lang = vi.hoisted(() => ({ value: 'ur' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: lang.value } }) }));

import { DatePicker } from './DatePicker';

afterEach(cleanup);

test('the selected date is written in Urdu for an Urdu interface', () => {
  lang.value = 'ur';
  render(<DatePicker value="2026-11-22" onChange={() => {}} />);
  const urduNovember = new Intl.DateTimeFormat('ur-PK-u-ca-gregory-nu-latn', { month: 'long' }).format(new Date(2026, 10, 1));
  expect(screen.getByText(new RegExp(urduNovember))).toBeTruthy();
});

test('an empty picker shows its translated prompt', () => {
  lang.value = 'en';
  render(<DatePicker value="" onChange={() => {}} />);
  expect(screen.getByText('common.date_picker.select_date')).toBeTruthy();
});
