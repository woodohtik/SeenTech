import { useEffect, useState } from 'react';

/**
 * Whether any window is open (seen-ui-responsive-alignment-audit-task.md,
 * finding 01, question 1's default): an aria-modal element, or one of the
 * hand-built full-screen layers (`fixed inset-0`, ~114 of them) not yet on
 * the shared Modal. The assistant's own panel ([data-ai-fab]) does not count.
 * Layout hides the assistant button while this is true -- it covered the
 * windows' save buttons on phones.
 */
export function hasOpenDialog(doc: Document): boolean {
  for (const el of doc.querySelectorAll('[aria-modal="true"], .fixed.inset-0')) {
    if (el.closest('[data-ai-fab]')) continue;
    let hidden = false;
    for (let n: Element | null = el; n; n = n.parentElement) {
      const s = doc.defaultView?.getComputedStyle(n);
      if (s && (s.display === 'none' || s.visibility === 'hidden')) { hidden = true; break; }
    }
    if (!hidden) return true;
  }
  return false;
}

export function useDialogOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let frame = 0;
    const check = () => { frame = 0; setOpen(hasOpenDialog(document)); };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(check); };
    const observer = new MutationObserver(schedule);
    // Windows mount and unmount (childList); a few toggle aria-modal.
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal'] });
    check();
    return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, []);
  return open;
}
