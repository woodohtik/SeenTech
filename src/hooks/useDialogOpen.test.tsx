// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { hasOpenDialog } from './useDialogOpen';

// seen-ui-responsive-alignment-audit-task.md, finding 01 / question 1: the
// assistant button hides while any window is open (it sat on the purchase
// order's "save as draft" on phones). A window is an aria-modal element or a
// hand-built full-screen layer (fixed inset-0) -- not the assistant's own panel.
afterEach(() => { document.body.innerHTML = ''; });

describe('hasOpenDialog', () => {
  it('nothing open: no', () => {
    document.body.innerHTML = '<main><button>حفظ</button></main>';
    expect(hasOpenDialog(document)).toBe(false);
  });
  it('a hand-built window (fixed inset-0): yes', () => {
    document.body.innerHTML = '<main><div class="fixed inset-0 z-50"><button>حفظ كمسودة</button></div></main>';
    expect(hasOpenDialog(document)).toBe(true);
  });
  it('an aria-modal dialog: yes', () => {
    document.body.innerHTML = '<div role="dialog" aria-modal="true"></div>';
    expect(hasOpenDialog(document)).toBe(true);
  });
  it("the assistant's own panel does not count", () => {
    document.body.innerHTML = '<div data-ai-fab><div class="fixed inset-0"></div></div>';
    expect(hasOpenDialog(document)).toBe(false);
  });
  it('a hidden layer does not count', () => {
    document.body.innerHTML = '<div class="fixed inset-0" style="display:none"></div>';
    expect(hasOpenDialog(document)).toBe(false);
  });
});
