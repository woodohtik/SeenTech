/**
 * Which build is running, and whether a newer one is live
 * (seen-update-delivery-fix-task.md, phases 1-2).
 *
 * The service worker's own update check can lag or never fire (an installed
 * app that is never closed). /version.json, written by every build
 * (scripts/vite-build-id.ts) and served with no-store, says what is live now.
 */

declare const __BUILD_ID__: string | undefined;
declare const __BUILT_AT__: string | undefined;

/** This build's id ("f5852d3-202611251930"); "dev" outside a real build (tests, dev server without the plugin). */
export const CURRENT_BUILD: string = typeof __BUILD_ID__ !== 'undefined' && __BUILD_ID__ ? __BUILD_ID__ : 'dev';
export const CURRENT_BUILT_AT: string = typeof __BUILT_AT__ !== 'undefined' && __BUILT_AT__ ? __BUILT_AT__ : '';

export interface RemoteVersion {
  build: string;
  builtAt?: string;
  mandatory?: boolean;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

const MIN_GAP_MS = 60_000;
const INTERVAL_MS = 10 * 60_000;

/** The live build, or null when it cannot be known (offline, an error page): never an error. */
export async function fetchRemoteVersion(fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<RemoteVersion | null> {
  try {
    const res = await fetchImpl('/version.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<RemoteVersion> | null;
    if (!body || typeof body.build !== 'string' || !body.build) return null;
    return { build: body.build, builtAt: body.builtAt, mandatory: body.mandatory === true };
  } catch {
    return null;
  }
}

export function isNewerBuild(remote: RemoteVersion | null, current: string = CURRENT_BUILD): boolean {
  return !!remote && current !== 'dev' && remote.build !== current;
}

let navigationListener: (() => void) | null = null;

/** Called on every route change (history.pushState and popstate, see startVersionChecks). */
export function noteNavigation(): void {
  navigationListener?.();
}

/**
 * Checks /version.json at start, every 10 minutes, when the tab comes back,
 * when the connection comes back, and on navigation -- at most once a minute
 * (the start excepted). onUpdate fires once, with the live build.
 */
export function startVersionChecks(options: {
  onUpdate: (remote: RemoteVersion) => void;
  current?: string;
  fetchImpl?: FetchLike;
}): () => void {
  const current = options.current ?? CURRENT_BUILD;
  let lastAt = -Infinity;
  let reported = false;
  let stopped = false;

  const check = async (force = false) => {
    if (stopped || reported) return;
    const now = Date.now();
    if (!force && now - lastAt < MIN_GAP_MS) return;
    lastAt = now;
    const remote = await fetchRemoteVersion(options.fetchImpl);
    if (!stopped && !reported && remote && isNewerBuild(remote, current)) {
      reported = true;
      options.onUpdate(remote);
    }
  };

  const onVisible = () => { if (document.visibilityState !== 'hidden') void check(); };
  const onOnline = () => { void check(); };
  const timer = setInterval(() => { void check(); }, INTERVAL_MS);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);
  navigationListener = () => { void check(); };
  // Navigation: the router moves with history.pushState / popstate.
  const originalPush = history.pushState;
  history.pushState = function patchedPushState(this: History, ...args: Parameters<History['pushState']>) {
    const result = originalPush.apply(this, args);
    noteNavigation();
    return result;
  } as History['pushState'];
  const onPop = () => noteNavigation();
  window.addEventListener('popstate', onPop);
  void check(true);

  return () => {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('popstate', onPop);
    history.pushState = originalPush;
    navigationListener = null;
  };
}
