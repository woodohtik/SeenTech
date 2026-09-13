/**
 * navigator.storage.persist() (seen-offline-sync-architecture-task.md Phase 2).
 *
 * Without this, IndexedDB stays in the browser's "best-effort" bucket --
 * eligible for automatic eviction (LRU) if the device runs low on storage,
 * with no relation to whether the browser or tab is even open. Must be
 * called from within a real user interaction, not on page load, and only
 * makes sense to ask for once there's actually something worth protecting.
 *
 * Deliberately NOT called anywhere yet: there is no real trigger for it
 * until Phase 3 records the first pending outbox entry. Call this from
 * there, once, right after that first successful write -- not here, and
 * not speculatively on app load.
 */
export async function requestPersistentStorage(): Promise<{ supported: boolean; granted: boolean }> {
  if (!navigator.storage?.persist) {
    return { supported: false, granted: false };
  }
  const alreadyPersisted = await navigator.storage.persisted?.();
  if (alreadyPersisted) {
    return { supported: true, granted: true };
  }
  const granted = await navigator.storage.persist();
  return { supported: true, granted };
}
