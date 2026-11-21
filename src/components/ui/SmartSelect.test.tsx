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
