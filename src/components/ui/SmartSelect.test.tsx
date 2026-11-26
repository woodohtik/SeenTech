// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('../../lib/direction', () => ({ useDirection: () => ({ t: (k: string) => k, dir: 'rtl' }) }));

import { SmartSelect } from './SmartSelect';

afterEach(() => cleanup());

// seen-verticals-readiness-task.md Phase 0: a vertical that is not ready is
// listed with «قريباً» and cannot be chosen.
test('a disabled option shows its badge and cannot be chosen', async () => {
  const onChange = vi.fn();
  render(
    <SmartSelect
      value="mens_tailoring"
      onChange={onChange}
      options={[
        { value: 'mens_tailoring', label: 'خياطة رجالية' },
        { value: 'furniture', label: 'أثاث وتنجيد', disabled: true, badge: 'قريباً' },
      ]}
    />,
  );
  fireEvent.click(screen.getByRole('button'));
  const option = await screen.findByRole('option', { name: /أثاث وتنجيد/ });
  expect(option.getAttribute('aria-disabled')).toBe('true');
  expect(screen.getByText('قريباً')).toBeTruthy();
  fireEvent.click(option);
  expect(onChange).not.toHaveBeenCalled();
});

// seen-merchant-trial-test-2026-11-26.md, phase 3 item 8: in a long list
// (the customers), the "choose a customer..." line was the input's VALUE,
// so typing a name was added after it and found nothing.
const many = [
  { value: '', label: 'اختر عميل...' },
  ...Array.from({ length: 12 }, (_, i) => ({ value: `c${i}`, label: i === 7 ? 'فيصل' : `عميل ${i}` })),
];

test('with nothing chosen, the empty line is the hint, not the text in the box', () => {
  render(<SmartSelect value="" onChange={() => {}} options={many} />);
  const input = screen.getByRole('combobox') as HTMLInputElement;
  expect(input.value).toBe('');
  expect(input.placeholder).toBe('اختر عميل...');
});

test('typing a name finds it', async () => {
  render(<SmartSelect value="" onChange={() => {}} options={many} />);
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'فيصل' } });
  expect(await screen.findByRole('option', { name: 'فيصل' })).toBeTruthy();
});

test('a chosen customer shows their name', () => {
  render(<SmartSelect value="c7" onChange={() => {}} options={many} />);
  expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('فيصل');
});
