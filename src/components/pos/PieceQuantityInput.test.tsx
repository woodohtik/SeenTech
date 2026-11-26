// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PieceQuantityInput } from './PieceQuantityInput';

// seen-merchant-trial-test-2026-11-26.md, phase 3 item 7: the cart's quantity
// could not be typed -- ten buttons took ten taps.
afterEach(cleanup);

test('typing 10 and pressing Enter sets 10', () => {
  const onCommit = vi.fn();
  render(<PieceQuantityInput value={1} onCommit={onCommit} label="الكمية" />);
  const box = screen.getByRole('spinbutton', { name: 'الكمية' });
  fireEvent.change(box, { target: { value: '10' } });
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(onCommit).toHaveBeenCalledWith(10);
});

test('nothing, zero or a fraction is not a quantity: the old one comes back', () => {
  const onCommit = vi.fn();
  render(<PieceQuantityInput value={3} onCommit={onCommit} label="الكمية" />);
  const box = screen.getByRole('spinbutton', { name: 'الكمية' }) as HTMLInputElement;
  fireEvent.change(box, { target: { value: '0' } });
  fireEvent.blur(box);
  expect(onCommit).not.toHaveBeenCalled();
  expect(box.value).toBe('3');
});
