// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DialogFrame } from './DialogFrame';

// seen-ui-responsive-alignment-audit-task.md, finding 03 (critical): a window
// is a dialog (role, aria-modal, its title), focus goes into it, Esc closes it,
// focus comes back to what opened it, and the page behind is inert.
afterEach(() => { cleanup(); document.body.innerHTML = ''; });

function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div id="root">
      <button onClick={() => setOpen(true)}>فتح</button>
      {open && (
        <DialogFrame onClose={() => { onClose?.(); setOpen(false); }} labelledBy="t">
          <h2 id="t">أمر شراء</h2>
          <input aria-label="الكمية" />
        </DialogFrame>
      )}
    </div>
  );
}

describe('DialogFrame', () => {
  it('is a labelled modal dialog, with focus inside', () => {
    render(<Harness />, { container: document.body.appendChild(document.createElement('div')) });
    fireEvent.click(screen.getByText('فتح'));
    const dialog = screen.getByRole('dialog', { name: 'أمر شراء' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('focus stays in it; Esc closes it and focus returns to the opener', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />, { container: document.body.appendChild(document.createElement('div')) });
    const opener = screen.getByText('فتح');
    opener.focus();
    fireEvent.click(opener);
    // Focus wandering to the page behind comes back into the window.
    opener.focus();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
  });
});

it('a confirmation box inside the app (aria-modal) can still take focus', () => {
  render(<Harness />, { container: document.body.appendChild(document.createElement('div')) });
  fireEvent.click(screen.getByText('فتح'));
  const confirmBox = document.getElementById('root')!.appendChild(document.createElement('div'));
  confirmBox.setAttribute('aria-modal', 'true');
  const yes = confirmBox.appendChild(document.createElement('button'));
  yes.focus();
  expect(document.activeElement).toBe(yes);
  // Its Esc is its own: the window under it stays open.
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByRole('dialog', { name: 'أمر شراء' })).toBeTruthy();
});
