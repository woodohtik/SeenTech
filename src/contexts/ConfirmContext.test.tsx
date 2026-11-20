// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { test, expect, vi, afterEach } from 'vitest';

vi.mock('../lib/direction', () => ({
  useDirection: () => ({ dir: 'rtl', t: (k: string) => k }),
}));

afterEach(() => {
  cleanup();
  vi.doUnmock('./ConfirmMotionFrame');
  vi.resetModules();
});

async function openConfirm() {
  const { ConfirmProvider, useConfirm } = await import('./ConfirmContext');
  let api: ReturnType<typeof useConfirm> | null = null;
  function Grab() {
    api = useConfirm();
    return null;
  }
  render(
    <ConfirmProvider>
      <Grab />
    </ConfirmProvider>,
  );
  let answer!: Promise<boolean>;
  act(() => {
    answer = api!.confirm({ title: 'حذف الطلب؟', description: 'لا يمكن التراجع' });
  });
  // wrapped: an async function returning the promise itself would wait for the answer
  return { answer };
}

// The dialog's animation now loads lazily (seen-performance-first-open-login-
// task.md Phase 2.4); the dialog itself must not wait for it.
test('the dialog shows straight away and returns the answer', async () => {
  const { answer } = await openConfirm();
  expect(screen.getByText('حذف الطلب؟')).toBeTruthy();
  fireEvent.click(screen.getByText('common.confirm'));
  await expect(answer).resolves.toBe(true);
});

test('if the animation cannot load, the dialog still works', async () => {
  vi.doMock('./ConfirmMotionFrame', () => {
    throw new Error('chunk failed to load');
  });
  const { answer } = await openConfirm();
  // the static frame (fallback while loading, and after the load fails)
  expect(await screen.findByText('حذف الطلب؟')).toBeTruthy();
  fireEvent.click(screen.getByText('common.cancel'));
  await expect(answer).resolves.toBe(false);
});
