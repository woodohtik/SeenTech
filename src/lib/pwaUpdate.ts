import { registerSW } from 'virtual:pwa-register';
import { applyUpdateNow, reportUpdate } from './updateManager';
import { CURRENT_BUILD, fetchRemoteVersion, isNewerBuild } from './appVersion';

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
 * A waiting worker is reported to updateManager.ts
 * (seen-update-delivery-fix-task.md phase 3), which applies it by itself on
 * a safe screen and only after the sale or the save otherwise -- never
 * mid-sale, and no longer only on a tap. /version.json (appVersion.ts)
 * reports a new build too, without waiting on the worker.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let updateAvailable = false;
let initialized = false;

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly -- frequent enough for a long shift, not so frequent it matters for cost/battery
const UPDATE_CHECK_DEBOUNCE_MS = 60 * 1000; // avoid back-to-back checks from rapid focus/online churn

export function initPwaUpdates(): void {
  if (initialized) return;
  initialized = true;

  // seen-performance-first-open-login-task.md Phase 6: registering the
  // service worker starts the precache download, which used to compete
  // with the first screen's own requests. Registered once the page has
  // loaded and the browser is idle (at most ~5 seconds later) instead.
  const register = () => {
    const idle = (window as any).requestIdleCallback as ((cb: () => void, opts?: { timeout: number }) => number) | undefined;
    if (idle) idle(registerNow, { timeout: 5000 }); else window.setTimeout(registerNow, 3000);
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

function registerNow(): void {
  registerSW({
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

      // seen-cto-sprint0-critical-fixes-task.md follow-up (cache/update
      // report 2026-11-14): none of the triggers below fire on a plain page
      // load of an already-visible, already-focused tab -- visibilitychange
      // needs a transition, focus needs the window to have been blurred
      // first, online needs an actual reconnect, and the hourly interval's
      // first tick is an hour away. So right after a deploy, reloading the
      // page found no update at all until the browser's own internal
      // (throttled, unreliable) registration-time check happened to catch
      // it -- which looked like "needs a hard refresh" but had nothing to
      // do with HTTP/CDN caching. One explicit check right here, as soon as
      // registration succeeds, closes that gap for every normal reload.
      checkForUpdate();

      setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
      });
      window.addEventListener('focus', checkForUpdate);
      window.addEventListener('online', checkForUpdate);
    },
    // A new worker is waiting. If the live build is newer than this page,
    // the update manager applies it when safe. If this page already IS the
    // live build (it was loaded from the network under the old worker), the
    // new worker just takes over -- no reload.
    onNeedRefresh() {
      updateAvailable = true;
      listeners.forEach(listener => listener());
      void (async () => {
        const remote = await fetchRemoteVersion();
        if (isNewerBuild(remote)) {
          reportUpdate(remote!);
        } else if (remote?.build === CURRENT_BUILD) {
          const registration = await navigator.serviceWorker?.getRegistration();
          registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
        } else {
          reportUpdate({ build: 'waiting-worker' });
        }
      })();
    },
    // A new worker took control (the library's default is to reload). Only
    // a page older than the live build needs a reload, via the manager.
    onNeedReload() {
      void (async () => {
        const remote = await fetchRemoteVersion();
        if (isNewerBuild(remote)) reportUpdate(remote!);
      })();
    },
  });
}

export function isUpdateAvailable(): boolean {
  return updateAvailable;
}

/** Applies a pending update now (the "update now" button, the landing page). */
export function applyPendingUpdate(): void {
  void applyUpdateNow();
}

/** Returns an unsubscribe function. */
export function onUpdateAvailable(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
