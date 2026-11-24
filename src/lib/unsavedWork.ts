import { useEffect, useRef } from 'react';

/**
 * Work on screen that a page reload would lose (seen-update-delivery-fix-
 * task.md, phase 3.1): a point-of-sale cart, a form with unsaved changes, a
 * sale being sent from the offline outbox. An update applies only when
 * hasUnsavedWork() is false, and is retried each time work settles.
 *
 * Queued offline sales are not "unsaved": they live in IndexedDB and survive
 * a reload. Only a send in progress counts (registered by outbox.ts).
 */

type Check = () => boolean;

const sources = new Map<string, Check>();
const settledListeners = new Set<() => void>();

/** Same name as outbox.ts OUTBOX_DRAINED_EVENT (not imported, to keep this file free of Dexie). */
export const OUTBOX_DRAINED_EVENT_NAME = 'seen-outbox-drained';

export function registerUnsavedWork(id: string, check: Check): () => void {
  sources.set(id, check);
  return () => {
    if (sources.get(id) === check) {
      sources.delete(id);
      notifyWorkSettled();
    }
  };
}

export function hasUnsavedWork(): boolean {
  for (const check of sources.values()) {
    try {
      if (check()) return true;
    } catch {
      return true; // unknown counts as unsaved: never reload on a guess
    }
  }
  return false;
}

/** Called whenever some work may have finished; listeners re-check hasUnsavedWork(). */
export function notifyWorkSettled(): void {
  settledListeners.forEach((listener) => listener());
}

export function onWorkSettled(listener: () => void): () => void {
  settledListeners.add(listener);
  return () => settledListeners.delete(listener);
}

if (typeof window !== 'undefined') {
  window.addEventListener(OUTBOX_DRAINED_EVENT_NAME, notifyWorkSettled);
}

/** A component's unsaved work: true while the cart has items or the form has changes. */
export function useUnsavedWork(id: string, dirty: boolean): void {
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => registerUnsavedWork(id, () => dirtyRef.current), [id]);
  const wasDirty = useRef(dirty);
  useEffect(() => {
    if (wasDirty.current && !dirty) notifyWorkSettled();
    wasDirty.current = dirty;
  }, [dirty]);
}
