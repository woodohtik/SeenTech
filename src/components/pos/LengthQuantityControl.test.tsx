// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, d?: string) => d || k }) }));

import LengthQuantityControl from './LengthQuantityControl';

afterEach(() => cleanup());

// seen-verticals-readiness-task.md Phase 5: a cart line sold by length.
test('± steps, a typed decimal, and a whole roll', () => {
  const onStep = vi.fn();
  const onCommit = vi.fn();
  render(<LengthQuantityControl meters={2.5} unit="meter" metersPerRoll={30} onStep={onStep} onCommit={onCommit} />);

  const field = screen.getByLabelText('الكمية') as HTMLInputElement;
  expect(field.value).toBe('2.5');

  fireEvent.click(screen.getByLabelText('pos.increase_quantity'));
  expect(onStep).toHaveBeenCalledWith(1);

  fireEvent.change(field, { target: { value: '3,75' } });
  fireEvent.blur(field);
  expect(onCommit).toHaveBeenLastCalledWith(3.75, 'meter');

  fireEvent.change(screen.getByLabelText('الوحدة'), { target: { value: 'roll' } });
  expect(onCommit).toHaveBeenLastCalledWith(1, 'roll');
});

test('no roll choice when the item has no roll content', () => {
  render(<LengthQuantityControl meters={1} unit="meter" metersPerRoll={0} onStep={vi.fn()} onCommit={vi.fn()} />);
  expect(screen.queryByRole('option', { name: 'طاقة' })).toBeNull();
});
