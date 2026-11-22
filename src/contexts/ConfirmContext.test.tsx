// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
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

// seen-readiness-fixes-task.md P4 (UX-08).
test('the confirmation is an alert dialog; Escape answers no; a dangerous one starts on cancel', async () => {
  const { ConfirmProvider: Provider, useConfirm: use } = await import('./ConfirmContext');
  let answer: boolean | undefined;
  function Ask() {
    const { confirm } = use();
    return <button onClick={async () => { answer = await confirm({ description: 'حذف؟', danger: true }); }}>ask</button>;
  }
  render(<Provider><Ask /></Provider>);
  fireEvent.click(screen.getByText('ask'));
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(document.activeElement?.textContent).toMatch(/cancel|إلغاء/);
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(answer).toBe(false));
});
