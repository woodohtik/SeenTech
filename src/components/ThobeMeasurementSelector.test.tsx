// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from '../i18n/locales/ar.json';
import type { Measurements } from '../types';
import { ADVANCED_MEASUREMENT_KEYS, MEASUREMENT_KEYS, fieldsDownTheFigure } from '../constants/measurementFields';
import type { MeasurementUnit } from '../utils/measurementUnits';

vi.mock('./Branding', () => ({ default: () => null }));
vi.mock('../hooks/useSpeechRecognition', () => ({ isSpeechRecognitionSupported: () => false }));

import ThobeMeasurementSelector, { SHOW_ADVANCED_KEY } from './ThobeMeasurementSelector';

// seen-measurements-basic-advanced-task.md (founder decision, 24 Nov 2026), acceptance 2-4.

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ lng: 'ar', resources: { ar: { translation: ar } }, interpolation: { escapeValue: false } });
});
beforeEach(() => localStorage.clear());
afterEach(cleanup);

function Harness({ initial = {}, onValues, unit = 'cm' }: { initial?: Measurements; onValues?: (v: Measurements) => void; unit?: MeasurementUnit }) {
  const [values, setValues] = useState<Measurements>(initial);
  return (
    <ThobeMeasurementSelector
      values={values}
      onChange={(next) => { setValues(next); onValues?.(next); }}
      measurementUnit={unit}
    />
  );
}

/** The measurement inputs a person can reach, in DOM (= Tab) order. */
const shownInputs = () =>
  Array.from(document.querySelectorAll<HTMLInputElement>('input[id^="thobe-part-"]'))
    .filter((input) => !input.closest('[hidden]'))
    .map((input) => input.id.replace('thobe-part-', ''));

const input = (key: string) => document.getElementById(`thobe-part-${key}`) as HTMLInputElement;
const card = (key: string) => document.getElementById(`thobe-field-${key}`) as HTMLElement;
const advancedButton = () => screen.getByRole('button', { name: /مقاسات متقدمة|إخفاء المتقدمة/ });

const BASIC_DOWN = [...fieldsDownTheFigure('right', false), ...fieldsDownTheFigure('left', false)];
const ALL_DOWN = [...fieldsDownTheFigure('right', true), ...fieldsDownTheFigure('left', true)];

describe('ThobeMeasurementSelector: basic and advanced', () => {
  it('shows the nine basic measurements, body side then sleeve side, each down the thobe, and one button', () => {
    render(<Harness />);
    expect(shownInputs()).toEqual(BASIC_DOWN);
    expect(BASIC_DOWN).toEqual(['neck', 'shoulder', 'chest', 'length', 'sleeveTopWidth', 'midSleeveWidth', 'sleeve', 'handWidth', 'cuffLength']);
    expect(screen.getAllByRole('button', { name: /مقاسات متقدمة/ })).toHaveLength(1);
    expect(advancedButton().textContent).toContain('7');
    expect(advancedButton().getAttribute('aria-expanded')).toBe('false');
  });

  it('shows all sixteen after the button, each beside its part, and back', () => {
    render(<Harness />);
    fireEvent.click(advancedButton());
    expect(shownInputs()).toEqual(ALL_DOWN);
    expect(shownInputs()).toHaveLength(16);
    expect(advancedButton().getAttribute('aria-expanded')).toBe('true');
    expect(advancedButton().textContent).toContain('إخفاء المتقدمة');
    // Focus goes to the first advanced field in Tab order: the fold-over neck, beside the neck.
    expect(document.activeElement?.id).toBe('thobe-part-neckFold');
    fireEvent.click(advancedButton());
    expect(shownInputs()).toEqual(BASIC_DOWN);
    expect(advancedButton().getAttribute('aria-expanded')).toBe('false');
  });

  it('gives each side consecutive rows of the shown fields only: no holes', () => {
    render(<Harness />);
    const rowOf = (key: string) => Number(card(key).style.getPropertyValue('--field-row-md'));
    expect(fieldsDownTheFigure('right', false).map(rowOf)).toEqual([1, 2, 3, 4]);
    expect(fieldsDownTheFigure('left', false).map(rowOf)).toEqual([1, 2, 3, 4, 5]);
    fireEvent.click(advancedButton());
    expect(fieldsDownTheFigure('right', true).map(rowOf)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(fieldsDownTheFigure('left', true).map(rowOf)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('points the button at the seven advanced fields', () => {
    render(<Harness />);
    const controls = advancedButton().getAttribute('aria-controls')!.split(' ');
    expect(controls).toEqual(ADVANCED_MEASUREMENT_KEYS.map((k) => `thobe-field-${k}`));
    expect(controls).toHaveLength(7);
    for (const id of controls) expect(document.getElementById(id)).not.toBeNull();
  });

  it('a customer with a stored waist starts with the section open', () => {
    render(<Harness initial={{ waist: 90 } as Measurements} />);
    expect(shownInputs()).toHaveLength(16);
    expect(advancedButton().getAttribute('aria-expanded')).toBe('true');
  });

  it('counts the advanced values entered on the button', () => {
    localStorage.setItem(SHOW_ADVANCED_KEY, '0');
    render(<Harness initial={{ waist: 90, neckFold: 41, bottomHem: 5 } as Measurements} />);
    fireEvent.click(advancedButton());
    expect(advancedButton().textContent).toContain('3 مُدخلة');
  });

  it('remembers on this device that it was left open', () => {
    const first = render(<Harness />);
    fireEvent.click(advancedButton());
    expect(localStorage.getItem(SHOW_ADVANCED_KEY)).toBe('1');
    first.unmount();
    render(<Harness />);
    expect(shownInputs()).toHaveLength(16);
  });

  it('does not remember on the customer link (rememberAdvanced off)', () => {
    localStorage.setItem(SHOW_ADVANCED_KEY, '1');
    render(<ThobeMeasurementSelector values={{} as Measurements} onChange={() => {}} measurementUnit="cm" rememberAdvanced={false} />);
    expect(shownInputs()).toEqual(BASIC_DOWN);
  });

  it('pressing an advanced-only zone on the drawing opens the section and focuses its field', () => {
    render(<Harness />);
    fireEvent.click(document.getElementById('part-waist')!);
    expect(advancedButton().getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.id).toBe('thobe-part-waist');
  });

  it('the mid-sleeve width has its own zone on the drawing', () => {
    render(<Harness />);
    fireEvent.click(document.getElementById('part-midSleeve')!);
    expect(document.activeElement?.id).toBe('thobe-part-midSleeveWidth');
  });

  it('keeps all sixteen stored values through an edit made with the section closed', () => {
    const all = Object.fromEntries(MEASUREMENT_KEYS.map((k, i) => [k, 20 + i])) as unknown as Measurements;
    localStorage.setItem(SHOW_ADVANCED_KEY, '0');
    const seen: Measurements[] = [];
    render(<Harness initial={all} onValues={(v) => seen.push(v)} />);
    fireEvent.click(advancedButton());
    expect(shownInputs()).toEqual(BASIC_DOWN);
    fireEvent.focus(input('length'));
    fireEvent.change(input('length'), { target: { value: '150' } });
    const last = seen[seen.length - 1] as unknown as Record<string, number>;
    expect(last.length).toBe(150);
    for (const [i, key] of MEASUREMENT_KEYS.entries()) if (key !== 'length') expect(last[key]).toBe(20 + i);
  });

  it('an old customer with a mid-sleeve width shows it, and an untouched open keeps every value as stored', () => {
    const seen: Measurements[] = [];
    render(<Harness initial={{ midSleeveWidth: 14.3, length: 147.37 } as Measurements} onValues={(v) => seen.push(v)} />);
    expect(input('midSleeveWidth').value).toBe('14 ¼');
    expect(input('length').value).toBe('147 ¼');
    // Looked at, not typed in: nothing is rewritten.
    fireEvent.focus(input('length'));
    fireEvent.blur(input('length'));
    expect(seen).toHaveLength(0);
  });
});

describe('ThobeMeasurementSelector: fractions', () => {
  it('shows a stored value as a whole and a quarter, never two decimals, and an empty field as a dash', () => {
    render(<Harness unit="inch" initial={{ chest: 59.06 * 2.54, neck: 20.74 * 2.54 } as Measurements} />);
    expect(input('chest').value).toBe('59');
    expect(input('neck').value).toBe('20 ¾');
    expect(input('shoulder').value).toBe('');
    expect(input('shoulder').placeholder).toBe('—');
    for (const key of BASIC_DOWN) expect(input(key).value).not.toMatch(/\.\d\d/);
  });

  it.each([
    ['20 3/4', 20.75],
    ['٢٠٫٥', 20.5],
    ['20¾', 20.75],
    ['20,5', 20.5],
  ])('typing %s saves %s and shows it as a fraction', (typed, value) => {
    const seen: Measurements[] = [];
    render(<Harness onValues={(v) => seen.push(v)} />);
    fireEvent.focus(input('chest'));
    fireEvent.change(input('chest'), { target: { value: typed } });
    fireEvent.blur(input('chest'));
    expect((seen[seen.length - 1] as Record<string, number>).chest).toBe(value);
    expect(input('chest').value).toMatch(/^20 [½¾]$/);
  });

  it('rounds what was typed to the nearest quarter on leaving the field, and says so', () => {
    vi.useFakeTimers();
    try {
      const seen: Measurements[] = [];
      render(<Harness onValues={(v) => seen.push(v)} />);
      fireEvent.focus(input('chest'));
      fireEvent.change(input('chest'), { target: { value: '52.6' } });
      fireEvent.blur(input('chest'));
      expect((seen[seen.length - 1] as Record<string, number>).chest).toBe(52.5);
      expect(input('chest').value).toBe('52 ½');
      expect(screen.getByRole('status').textContent).toContain('52 ½');
      act(() => { vi.advanceTimersByTime(3000); });
      expect(screen.queryByRole('status')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('text that is not a measurement leaves the last value in place', () => {
    const seen: Measurements[] = [];
    render(<Harness initial={{ chest: 52 } as Measurements} onValues={(v) => seen.push(v)} />);
    fireEvent.focus(input('chest'));
    fireEvent.change(input('chest'), { target: { value: '52 3' } });
    fireEvent.blur(input('chest'));
    expect(seen).toHaveLength(0);
    expect(input('chest').value).toBe('52');
  });

  it('a quarter chosen on the fraction buttons is saved exactly, and comes back as the same quarter in inches', () => {
    const seen: Measurements[] = [];
    const { unmount } = render(<Harness unit="inch" onValues={(v) => seen.push(v)} />);
    fireEvent.focus(input('sleeve'));
    fireEvent.change(input('sleeve'), { target: { value: '24' } });
    const buttons = card('sleeve').querySelectorAll('button[aria-pressed]');
    expect(buttons).toHaveLength(4);
    fireEvent.click(buttons[3]); // ¾
    fireEvent.blur(input('sleeve'));
    const stored = (seen[seen.length - 1] as Record<string, number>).sleeve;
    expect(stored).toBe(62.865); // 24.75 in
    unmount();
    render(<Harness unit="inch" initial={{ sleeve: stored } as Measurements} />);
    expect(input('sleeve').value).toBe('24 ¾');
  });

  it('marks a filled field with a dot next to its name', () => {
    render(<Harness initial={{ chest: 52 } as Measurements} />);
    expect(card('chest').querySelector('span.rounded-full.bg-brand')).not.toBeNull();
    expect(card('neck').querySelector('span.rounded-full.bg-brand')).toBeNull();
  });

  it('never cuts a name short', () => {
    render(<Harness />);
    fireEvent.click(advancedButton());
    for (const key of MEASUREMENT_KEYS) expect(card(key).querySelector('label')!.className).not.toContain('truncate');
  });

  it('uses the new names: المفصل and وسع اليد', () => {
    render(<Harness />);
    expect(card('sleeveTopWidth').querySelector('label')!.textContent).toBe('المفصل');
    expect(card('handWidth').querySelector('label')!.textContent).toBe('وسع اليد');
    expect(document.body.textContent).not.toContain('وسع الكم أعلى');
  });
});
