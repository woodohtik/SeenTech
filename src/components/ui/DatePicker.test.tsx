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

// seen-merchant-trial-test-2026-11-26.md, phase 3 item 6.
import { fireEvent } from '@testing-library/react';

test('in Arabic the right arrow goes back a month and the left one forward', () => {
  lang.value = 'ar';
  render(<DatePicker value="2026-11-22" onChange={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /2026|22/ }));
  const prev = screen.getByRole('button', { name: 'common.date_picker.previous_month' });
  const next = screen.getByRole('button', { name: 'common.date_picker.next_month' });
  // In a right-to-left row the first button sits on the right.
  expect(prev.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('a delivery date cannot be in the past', () => {
  lang.value = 'en';
  const onChange = vi.fn();
  render(<DatePicker value="2026-11-22" onChange={onChange} minDate="2026-11-20" />);
  fireEvent.click(screen.getByRole('button', { name: /2026|22/ }));
  const past = screen.getAllByRole('button', { name: '19' })[0];
  expect((past as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(past);
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole('button', { name: '21' })[0]);
  expect(onChange).toHaveBeenCalledWith('2026-11-21');
});
