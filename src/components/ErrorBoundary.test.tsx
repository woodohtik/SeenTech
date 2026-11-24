// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from 'i18next';
import ar from '../i18n/locales/ar.json';

const recoverFromStaleBuild = vi.fn().mockResolvedValue(undefined);
const hardRecover = vi.fn().mockResolvedValue(undefined);
vi.mock('../lib/chunkRecovery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/chunkRecovery')>()),
  recoverFromStaleBuild: () => recoverFromStaleBuild(),
  hardRecover: () => hardRecover(),
}));
vi.mock('../lib/logger', () => ({ logError: vi.fn() }));

import ErrorBoundary from './ErrorBoundary';

// seen-update-delivery-fix-task.md, phase 0.5: a missing code file reloads the
// page once at most; then a calm screen with one button -- never a loop.

beforeAll(async () => {
  await i18n.init({ lng: 'ar', resources: { ar: { translation: ar } } });
});
beforeEach(() => {
  sessionStorage.clear();
  recoverFromStaleBuild.mockClear();
  hardRecover.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function MissingChunk(): React.ReactElement {
  throw new Error('Failed to fetch dynamically imported module: https://www.seentech.io/assets/CartesianChart-old.js');
}

describe('ErrorBoundary: a page whose code file is missing', () => {
  it('tries one automatic recovery, then shows the "updating" screen instead of reloading again', () => {
    const first = render(<ErrorBoundary><MissingChunk /></ErrorBoundary>);
    expect(recoverFromStaleBuild).toHaveBeenCalledTimes(1);
    first.unmount();

    // The page came back on the same old build and failed again, within the minute.
    render(<ErrorBoundary><MissingChunk /></ErrorBoundary>);
    expect(recoverFromStaleBuild).toHaveBeenCalledTimes(1);
    expect(screen.getByText('نحدّث النظام')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'تحديث' });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(button);
    expect(hardRecover).toHaveBeenCalledTimes(1);
  });

  it('the guard covers the whole app: a chart on another page after a reload does not reload again', () => {
    render(<ErrorBoundary variant="inline"><MissingChunk /></ErrorBoundary>);
    cleanup();
    render(<ErrorBoundary variant="inline"><MissingChunk /></ErrorBoundary>);
    expect(recoverFromStaleBuild).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'تحديث' })).toBeTruthy();
  });

  it('offline, it never reloads: the code cannot be fetched anyway', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<ErrorBoundary><MissingChunk /></ErrorBoundary>);
    expect(recoverFromStaleBuild).not.toHaveBeenCalled();
  });
});
