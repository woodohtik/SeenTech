// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WomensMeasurementSelector } from './WomensMeasurementSelector';
import type { Measurements } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o?.name !== undefined ? `${k}:${o.name}` : o?.count !== undefined ? `${k}:${o.count}` : k), i18n: { language: 'ar', dir: () => 'rtl' } }),
}));

// seen-open-verticals-task.md, wave 1 (question 2's default): the women's
// measurements -- ten basic, six advanced, a note each, Enter to the next.
afterEach(cleanup);

function Harness({ unit = 'cm' as const, onValues }: { unit?: 'cm' | 'inch'; onValues?: (v: Measurements) => void }) {
  const [values, setValues] = useState<Measurements>({});
  return (
    <WomensMeasurementSelector
      values={values}
      onChange={(v) => { setValues(v); onValues?.(v); }}
      measurementUnit={unit}
      showNotes
      rememberAdvanced={false}
    />
  );
}

const field = (key: string) => screen.getByLabelText(`measurements.part_label_womens.${key}`) as HTMLInputElement;

describe('WomensMeasurementSelector', () => {
  it('ten basic measurements, with the women\'s names; the advanced six behind a button', () => {
    render(<Harness />);
    for (const k of ['length', 'shoulder', 'chest', 'waist', 'hips', 'sleeve', 'sleeveTopWidth', 'handWidth', 'neck', 'bottomWidth']) expect(field(k)).toBeTruthy();
    expect(screen.queryByLabelText('measurements.part_label_womens.underBust')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /measurements.womens_advanced/ }));
    expect(field('underBust')).toBeTruthy();
    expect(field('frontWaistLength')).toBeTruthy();
  });

  it('a value is stored in cm (from inches too)', () => {
    const onValues = vi.fn();
    const { unmount } = render(<Harness onValues={onValues} />);
    fireEvent.change(field('chest'), { target: { value: '92' } });
    fireEvent.blur(field('chest'));
    expect(onValues.mock.lastCall![0].chest).toBe(92);
    unmount();
    const onInch = vi.fn();
    render(<Harness unit="inch" onValues={onInch} />);
    fireEvent.change(field('waist'), { target: { value: '30' } });
    fireEvent.blur(field('waist'));
    expect(onInch.mock.lastCall![0].waist).toBeCloseTo(76.2, 1);
  });

  it('Enter goes to the next measurement in order', () => {
    render(<Harness />);
    field('length').focus();
    fireEvent.change(field('length'), { target: { value: '140' } });
    fireEvent.keyDown(field('length'), { key: 'Enter' });
    expect(document.activeElement).toBe(field('shoulder'));
  });

  it('a note per measurement', () => {
    const onValues = vi.fn();
    render(<Harness onValues={onValues} />);
    fireEvent.change(screen.getByLabelText('measurements.field_note_label:measurements.part_label_womens.waist'), { target: { value: 'واسع شوي' } });
    expect(onValues.mock.lastCall![0].fieldNotes?.waist).toBe('واسع شوي');
  });
});
