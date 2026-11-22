// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

// seen-readiness-fixes-task.md P4 (UX-01): a failed save is never silent.
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'ar' } }) }));
vi.mock('i18next', () => ({ default: { t: (k: string) => k } }));
vi.mock('../lib/logger', () => ({ logError: () => {} }));
vi.mock('../lib/whenIdle', () => ({ whenIdle: () => () => {} }));
vi.mock('../lib/direction', () => ({ useDirection: () => 'rtl' }));
vi.mock('./ToastMotionStack', () => ({ default: () => null }));

import { ToastProvider, useToast } from './ToastContext';
import { handleFirestoreError, OperationType } from '../lib/appErrors';

let api: ReturnType<typeof useToast>;
function Grab() { api = useToast(); return null; }
afterEach(cleanup);

test('a failed write shows one message; a failed read shows none', () => {
  render(<ToastProvider><Grab /></ToastProvider>);
  let thrown: any;
  act(() => { try { handleFirestoreError(new Error('duplicate key value'), OperationType.WRITE, 'orders'); } catch (e) { thrown = e; } });
  expect(screen.getAllByText('errors.write_failed')).toHaveLength(1);
  // the caller passing it on to the toast's handleError does not show it twice
  act(() => api.handleError(thrown, 'save'));
  expect(screen.getAllByText('errors.write_failed')).toHaveLength(1);
  expect(screen.queryByText('errors.system_error')).toBeNull();

  act(() => { try { handleFirestoreError(new Error('x'), OperationType.LIST, 'orders'); } catch { /* read */ } });
  expect(screen.getAllByText('errors.write_failed')).toHaveLength(1);
});
