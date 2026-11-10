import { registerSW } from 'virtual:pwa-register';

/**
 * Proper service-worker lifecycle management -- previously the app relied
 * entirely on vite-plugin-pwa's bare auto-injected registration (no
 * explicit `registerSW` call anywhere), which only checks for a new SW
 * version on the browser's own schedule (typically on navigation). A POS
 * terminal realistically stays open on one tab for a whole shift with no
 * reload in between, so that check might not fire for hours -- during
 * which the offline precache stays pinned to whatever was deployed when
 * the tab was first opened. That's the direct cause of a real report: most
 * routes failed to open offline while a couple that happened to already be
 * loaded in memory kept working -- the service worker's cached manifest no
 * longer matched the currently-referenced (content-hashed) chunk names for
 * routes not yet visited in that session.
 *
 * Deliberately does NOT auto-reload when an update is found: this is a POS
 * handling live payments with no draft-cart persistence, so forcing a
 * reload could discard a cashier's in-progress, not-yet-submitted sale.
 * Instead: check for updates hourly (covers a long-running tab) and surface
 * a dismissible prompt the user applies on their own schedule.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let updateAvailable = false;
let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null;
let initialized = false;

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly -- frequent enough for a long shift, not so frequent it matters for cost/battery
const UPDATE_CHECK_DEBOUNCE_MS = 60 * 1000; // avoid back-to-back checks from rapid focus/online churn

export function initPwaUpdates(): void {
  if (initialized) return;
  initialized = true;

  applyUpdate = registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;

      // All of these only ever call registration.update() -- which just asks
      // the browser to re-fetch the service worker script and fires
      // onNeedRefresh() below if it changed. None of them apply the update
      // themselves; that stays a user-only action via applyPendingUpdate().
      let lastCheckAt = 0;
      const checkForUpdate = () => {
        const now = Date.now();
        if (now - lastCheckAt < UPDATE_CHECK_DEBOUNCE_MS) return;
        lastCheckAt = now;
        registration.update().catch(() => {});
      };

      setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
      });
      window.addEventListener('focus', checkForUpdate);
      window.addEventListener('online', checkForUpdate);
    },
    onNeedRefresh() {
      updateAvailable = true;
      listeners.forEach(listener => listener());
    },
  });
}

export function isUpdateAvailable(): boolean {
  return updateAvailable;
}

/** Call from a user-initiated action only (a button click) -- reloads the page once the new service worker takes control. */
export function applyPendingUpdate(): void {
  void applyUpdate?.(true);
}

/** Returns an unsubscribe function. */
export function onUpdateAvailable(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
