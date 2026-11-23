// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from '../i18n/locales/ar.json';
import type { Measurements } from '../types';
import { ADVANCED_MEASUREMENT_KEYS, BASIC_MEASUREMENT_KEYS, MEASUREMENT_KEYS } from '../constants/measurementFields';

vi.mock('./Branding', () => ({ default: () => null }));
vi.mock('../hooks/useSpeechRecognition', () => ({ isSpeechRecognitionSupported: () => false }));

import ThobeMeasurementSelector, { SHOW_ADVANCED_KEY } from './ThobeMeasurementSelector';

// seen-measurements-basic-advanced-task.md, acceptance 2 and 3.

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ lng: 'ar', resources: { ar: { translation: ar } }, interpolation: { escapeValue: false } });
});
beforeEach(() => localStorage.clear());
afterEach(cleanup);

function Harness({ initial = {}, onValues }: { initial?: Measurements; onValues?: (v: Measurements) => void }) {
  const [values, setValues] = useState<Measurements>(initial);
  return (
    <ThobeMeasurementSelector
      values={values}
      onChange={(next) => { setValues(next); onValues?.(next); }}
      measurementUnit="cm"
    />
  );
}

/** The measurement inputs a person can reach, in DOM (= Tab) order. */
const shownInputs = () =>
  Array.from(document.querySelectorAll<HTMLInputElement>('input[id^="thobe-part-"]'))
    .filter((input) => !input.closest('[hidden]'))
    .map((input) => input.id.replace('thobe-part-', ''));

const advancedButton = () => screen.getByRole('button', { name: /مقاسات متقدمة|إخفاء المقاسات المتقدمة/ });

describe('ThobeMeasurementSelector: basic and advanced', () => {
  it('shows the seven basic measurements and one button by default', () => {
    render(<Harness />);
    expect(shownInputs()).toEqual([...BASIC_MEASUREMENT_KEYS]);
    expect(screen.getAllByRole('button', { name: /مقاسات متقدمة/ })).toHaveLength(1);
    expect(advancedButton().textContent).toContain('(8)');
    expect(advancedButton().getAttribute('aria-expanded')).toBe('false');
  });

  it('shows all fifteen after the button, in list order (the Tab order), and back', () => {
    render(<Harness />);
    fireEvent.click(advancedButton());
    expect(shownInputs()).toEqual([...MEASUREMENT_KEYS]);
    expect(advancedButton().getAttribute('aria-expanded')).toBe('true');
    expect(advancedButton().textContent).toContain('إخفاء المقاسات المتقدمة');
    // Focus goes to the first advanced field.
    expect(document.activeElement?.id).toBe(`thobe-part-${ADVANCED_MEASUREMENT_KEYS[0]}`);
    fireEvent.click(advancedButton());
    expect(shownInputs()).toEqual([...BASIC_MEASUREMENT_KEYS]);
    expect(advancedButton().getAttribute('aria-expanded')).toBe('false');
  });

  it('points the button at the eight advanced fields', () => {
    render(<Harness />);
    const controls = advancedButton().getAttribute('aria-controls')!.split(' ');
    expect(controls).toEqual(ADVANCED_MEASUREMENT_KEYS.map((k) => `thobe-field-${k}`));
    for (const id of controls) expect(document.getElementById(id)).not.toBeNull();
  });

  it('a customer with a stored waist starts with the section open', () => {
    render(<Harness initial={{ waist: 90 } as Measurements} />);
    expect(shownInputs()).toEqual([...MEASUREMENT_KEYS]);
    expect(advancedButton().getAttribute('aria-expanded')).toBe('true');
  });

  it('counts the advanced values entered on the closed button', () => {
    localStorage.setItem(SHOW_ADVANCED_KEY, '0');
    render(<Harness initial={{ waist: 90, neckFold: 41, bottomHem: 5 } as Measurements} />);
    // Opened on its own (stored values); close it to read the count.
    fireEvent.click(advancedButton());
    expect(advancedButton().textContent).toContain('3 مُدخلة');
  });

  it('remembers on this device that it was left open', () => {
    const first = render(<Harness />);
    fireEvent.click(advancedButton());
    expect(localStorage.getItem(SHOW_ADVANCED_KEY)).toBe('1');
    first.unmount();
    render(<Harness />);
    expect(shownInputs()).toEqual([...MEASUREMENT_KEYS]);
  });

  it('does not remember on the customer link (rememberAdvanced off)', () => {
    localStorage.setItem(SHOW_ADVANCED_KEY, '1');
    render(<ThobeMeasurementSelector values={{} as Measurements} onChange={() => {}} measurementUnit="cm" rememberAdvanced={false} />);
    expect(shownInputs()).toEqual([...BASIC_MEASUREMENT_KEYS]);
  });

  it('pressing an advanced-only zone on the drawing opens the section and focuses its field', () => {
    render(<Harness />);
    fireEvent.click(document.getElementById('part-waist')!);
    expect(advancedButton().getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.id).toBe('thobe-part-waist');
  });

  it('keeps all fifteen stored values through an edit made with the section closed', () => {
    const all = Object.fromEntries(MEASUREMENT_KEYS.map((k, i) => [k, 20 + i])) as unknown as Measurements;
    localStorage.setItem(SHOW_ADVANCED_KEY, '0');
    const seen: Measurements[] = [];
    render(<Harness initial={all} onValues={(v) => seen.push(v)} />);
    // Stored advanced values open it; close it and edit a basic field.
    fireEvent.click(advancedButton());
    expect(shownInputs()).toEqual([...BASIC_MEASUREMENT_KEYS]);
    fireEvent.change(document.getElementById('thobe-part-length')!, { target: { value: '150' } });
    const last = seen[seen.length - 1] as unknown as Record<string, number>;
    expect(last.length).toBe(150);
    for (const [i, key] of MEASUREMENT_KEYS.entries()) if (key !== 'length') expect(last[key]).toBe(20 + i);
  });
});
