// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { test, expect, vi, afterEach } from 'vitest';
import { FractionPicker } from './FractionPicker';

// No `globals: true` in vitest.config.ts, so @testing-library/react's
// auto-cleanup never registers -- see VoiceMicButton.test.tsx for the same
// pattern.
afterEach(() => {
  cleanup();
});

test('selecting a fraction sets it on top of the current whole number', () => {
  const onSelect = vi.fn();
  render(<FractionPicker value={40} onSelect={onSelect} />);
  fireEvent.click(screen.getByRole('button', { name: '½' }));
  expect(onSelect).toHaveBeenCalledWith(40.5);
});

test('selecting a fraction replaces an existing fraction without changing the whole part', () => {
  const onSelect = vi.fn();
  render(<FractionPicker value={40.75} onSelect={onSelect} />);
  fireEvent.click(screen.getByRole('button', { name: '¼' }));
  expect(onSelect).toHaveBeenCalledWith(40.25);
});

test('selecting the zero option clears the fraction', () => {
  const onSelect = vi.fn();
  render(<FractionPicker value={40.5} onSelect={onSelect} />);
  fireEvent.click(screen.getByRole('button', { name: '٠' }));
  expect(onSelect).toHaveBeenCalledWith(40);
});

test('treats a missing/zero value as a whole part of 0', () => {
  const onSelect = vi.fn();
  render(<FractionPicker value={0} onSelect={onSelect} />);
  fireEvent.click(screen.getByRole('button', { name: '¾' }));
  expect(onSelect).toHaveBeenCalledWith(0.75);
});

test('marks the button matching the current fraction as pressed', () => {
  render(<FractionPicker value={40.5} onSelect={() => {}} />);
  expect(screen.getByRole('button', { name: '½' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: '¼' })).toHaveAttribute('aria-pressed', 'false');
});
