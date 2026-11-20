/**
 * Run `fn` once the browser is idle after the first screen has drawn (or
 * after `fallbackMs` where requestIdleCallback is missing, e.g. Safari).
 * Used to fetch code that is not needed for the first screen but should be
 * ready before it is first used (seen-performance-first-open-login-task.md).
 */
export function whenIdle(fn: () => void, fallbackMs = 2000): () => void {
  if (typeof window === 'undefined') return () => {};
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout: fallbackMs * 2 });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(fn, fallbackMs);
  return () => window.clearTimeout(id);
}
