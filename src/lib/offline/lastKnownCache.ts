/**
 * A much lighter version of cacheSync.ts's Dexie-backed caches, for the
 * tabs seen-offline-coverage-and-performance-task.md Phase 2 explicitly
 * says don't need real offline support (no financial writes happen there
 * while disconnected): Dashboard, Suppliers, Reports, Settings. These just
 * need to show the last successfully-fetched data instead of a blank
 * screen when a fetch fails, with an honest "this may be stale" notice --
 * not a write queue, not idempotency, not Dexie's IndexedDB schema. Plain
 * localStorage is enough for that and needs no schema migration to add.
 */

const PREFIX = 'seen_last_known:';

export function saveLastKnown<T>(tenantId: string, resource: string, data: T): void {
  try {
    localStorage.setItem(`${PREFIX}${tenantId}:${resource}`, JSON.stringify({ data, cachedAt: Date.now() }));
  } catch {
    // localStorage can be unavailable (private browsing) or full -- this
    // cache is best-effort only, never load-bearing.
  }
}

export function getLastKnown<T>(tenantId: string, resource: string): { data: T; cachedAt: number } | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}${tenantId}:${resource}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
