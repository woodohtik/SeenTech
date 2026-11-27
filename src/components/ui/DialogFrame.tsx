import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, type HTMLMotionProps } from 'motion/react';
import { cn } from '../../lib/utils';

/**
 * The frame of a window (seen-ui-responsive-alignment-audit-task.md, finding
 * 03 and phase 2) -- for the hand-built windows, around their own markup:
 *
 *   * on <body> (a portal), above the page and its fixed buttons (--z-modal);
 *   * role="dialog", aria-modal, named by its title (labelledBy);
 *   * focus moves in when it opens and back to what opened it when it closes;
 *   * the page behind takes no taps (the overlay covers it) and no focus:
 *     focus that lands there comes back into the window -- unless it is in
 *     another modal (the app's confirmation box) or a menu's own portal;
 *   * Esc closes the top window only. A tap outside does NOT close it (a
 *     half-filled purchase order is not lost by a stray tap).
 *
 * `overlayClassName` is the old outer div's layout (where the panel sits);
 * `panelClassName` the old panel's.
 */
const stack: symbol[] = [];

function appRoot(): HTMLElement | null {
  return document.getElementById('root');
}

export interface DialogFrameProps {
  onClose: () => void;
  /** The id of the window's title. */
  labelledBy?: string;
  /** Or a name when there is no visible title. */
  label?: string;
  overlayClassName?: string;
  panelClassName?: string;
  dir?: 'rtl' | 'ltr';
  children: React.ReactNode;
}

/**
 * The behaviour of a window, for one that keeps its own markup: give its
 * panel role="dialog" aria-modal="true" aria-labelledby, and this ref.
 * Focus in on open, back to the opener on close; focus that wanders to the
 * page behind comes back; Esc closes the top window (not when another modal
 * on top has the focus).
 */
export function useDialogBehavior(panel: React.RefObject<HTMLElement | null>, onClose: () => void, active = true): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!active) return;
    const id = Symbol('dialog');
    stack.push(id);
    const opener = document.activeElement as HTMLElement | null;
    const root = appRoot();
    // Focus into the window: its first field or button, else the panel itself.
    const first = panel.current?.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), select, textarea, button:not([disabled]), [tabindex]:not([tabindex="-1"])');
    (first ?? panel.current)?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      // Not when another modal on top has the focus (the confirmation box answers its own Esc).
      const owner = (document.activeElement as Element | null)?.closest('[aria-modal="true"]');
      if (owner && owner !== panel.current) return;
      if (e.key === 'Escape' && stack[stack.length - 1] === id && !e.defaultPrevented) {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    // Focus that wanders to the page behind (Tab past the end) comes back.
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as Element | null;
      if (stack[stack.length - 1] !== id || !target || !panel.current) return;
      if (panel.current.contains(target)) return;
      if (!root || !root.contains(target)) return; // a menu or another window on <body>
      if (target.closest('[aria-modal="true"]')) return; // the app's confirmation box
      (first ?? panel.current).focus({ preventScroll: true });
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocusIn);
      const at = stack.indexOf(id);
      if (at >= 0) stack.splice(at, 1);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}

export function DialogFrame({ onClose, labelledBy, label, overlayClassName, panelClassName, dir, children }: DialogFrameProps) {
  const panel = useRef<HTMLDivElement>(null);
  useDialogBehavior(panel, onClose);


  return createPortal(
    <div className={cn('fixed inset-0 z-[var(--z-modal,200)] bg-black/60 backdrop-blur-sm', overlayClassName)} dir={dir}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
        tabIndex={-1}
        className={cn('outline-none', panelClassName)}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * A window's animated panel with the dialog behaviour, for windows that keep
 * their own overlay: mounted only while the window is open.
 */
export function DialogPanel({ onClose, labelledBy, children, ...rest }: HTMLMotionProps<'div'> & { onClose: () => void; labelledBy: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogBehavior(ref, onClose);
  return (
    <motion.div ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} {...rest}>
      {children}
    </motion.div>
  );
}

/** A window's outer div that is the dialog itself (role, aria-modal, the behaviour). */
export function DialogDiv({ onClose, children, ...rest }: React.HTMLAttributes<HTMLDivElement> & { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogBehavior(ref, onClose);
  return (
    <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1} {...rest}>
      {children}
    </div>
  );
}
