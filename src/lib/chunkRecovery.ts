/**
 * Recovery when a page's code file cannot be loaded
 * (seen-update-delivery-fix-task.md, phase 0.5).
 *
 * A tab that runs an older build asks for code files by their old names;
 * after a deploy those files are gone. Reloading is the cure, but a reload
 * that lands on the same old build (an old service worker still serving it)
 * fails the same way -- the endless loop in the founder's 23 Nov video. So:
 *
 *  - one automatic try in 60 seconds, for the whole app (claimAutoRecovery),
 *    and that try first lets a new service worker take over and drops the
 *    on-demand chunk caches (recoverFromStaleBuild);
 *  - after that, a calm screen with one button that clears the worker and
 *    the caches and loads from the network (hardRecover).
 *
 * Offline data (IndexedDB: the outbox of unsent sales, cached records) is
 * never touched.
 */

export const CHUNK_RELOAD_KEY = 'seen:chunk-reload';
const AUTO_RECOVERY_WINDOW_MS = 60_000;
const STEP_TIMEOUT_MS = 3_000;
/** The runtime caches of code files fetched on first use (old and current name). */
const ON_DEMAND_CHUNK_CACHES = ['seen-on-demand-chunks', 'seen-on-demand-chunks-v2'];

/** A failed dynamic import or preload: the file is missing, or something else came back. */
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, message } = error as { name?: string; message?: string };
  if (name === 'ChunkLoadError') return true;
  const text = String(message || '');
  return /dynamically imported module|Importing a module script failed|Unable to preload CSS|Failed to load module script/i.test(text);
}

/**
 * Whether an automatic recovery may run now; records it if so. One per 60
 * seconds for the whole app, kept in sessionStorage so it survives the
 * reload it causes. Without storage it says no: a loop it cannot count is
 * worse than a button.
 */
export function claimAutoRecovery(now: number = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
    if (now - last < AUTO_RECOVERY_WINDOW_MS) return false;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number = STEP_TIMEOUT_MS): Promise<T | undefined> {
  return Promise.race([promise, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))]);
}

async function deleteCaches(match: (name: string) => boolean): Promise<void> {
  if (typeof caches === 'undefined' || !caches) return;
  const names = (await withTimeout(caches.keys())) ?? [];
  await withTimeout(Promise.all(names.filter(match).map((name) => caches.delete(name))));
}

/** The automatic try: a new worker if there is one, no stale chunk caches, then one reload. */
export async function recoverFromStaleBuild(): Promise<void> {
  try {
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    if (sw) {
      const registration = await withTimeout(sw.getRegistration());
      if (registration) {
        await withTimeout(registration.update().catch(() => undefined));
        registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
      }
    }
    await deleteCaches((name) => ON_DEMAND_CHUNK_CACHES.includes(name));
  } catch {
    /* recovery must never stop the reload */
  }
  window.location.reload();
}

/**
 * The button on the "updating" screen: no service worker and none of the
 * app's caches, so the reload comes from the network. IndexedDB stays.
 */
export async function hardRecover(): Promise<void> {
  try {
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    if (sw) {
      const registrations = (await withTimeout(sw.getRegistrations())) ?? [];
      await withTimeout(Promise.all(registrations.map((r) => r.unregister())));
    }
    // Every Cache Storage entry on this origin is the app's own (precache,
    // on-demand chunks, pages); the offline records live in IndexedDB.
    await deleteCaches(() => true);
  } catch {
    /* fall through to the reload */
  }
  window.location.reload();
}
