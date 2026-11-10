// @vitest-environment jsdom
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import LandingPage from './LandingPage';

// Visitors here are never authenticated (App.tsx only renders this component
// in the unauthenticated branch of its root route), so there is no
// in-progress sale to protect -- unlike the rest of the app, it's safe to
// auto-apply a pending update instead of waiting for a banner click.
let updateListener: (() => void) | null = null;
const mocks = vi.hoisted(() => ({
  isUpdateAvailable: vi.fn(() => false),
  applyPendingUpdate: vi.fn(),
}));

vi.mock('../lib/pwaUpdate', () => ({
  isUpdateAvailable: mocks.isUpdateAvailable,
  applyPendingUpdate: mocks.applyPendingUpdate,
  onUpdateAvailable: (listener: () => void) => {
    updateListener = listener;
    return () => { updateListener = null; };
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

beforeEach(() => {
  mocks.isUpdateAvailable.mockReturnValue(false);
  mocks.applyPendingUpdate.mockClear();
  updateListener = null;
});

describe('LandingPage auto-update', () => {
  test('applies a pending update immediately if one is already available on mount', () => {
    mocks.isUpdateAvailable.mockReturnValue(true);
    render(<LandingPage />);
    expect(mocks.applyPendingUpdate).toHaveBeenCalledTimes(1);
  });

  test('applies the update as soon as one becomes available while mounted', () => {
    render(<LandingPage />);
    expect(mocks.applyPendingUpdate).not.toHaveBeenCalled();
    updateListener?.();
    expect(mocks.applyPendingUpdate).toHaveBeenCalledTimes(1);
  });

  test('never applies anything when no update is available', () => {
    render(<LandingPage />);
    expect(mocks.applyPendingUpdate).not.toHaveBeenCalled();
  });
});
