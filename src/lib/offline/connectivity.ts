/**
 * Real connectivity detection (seen-offline-sync-architecture-task.md
 * Phase 3): `navigator.onLine` alone is not reliable -- it reports "online"
 * in plenty of situations with no real internet reachable (connected to a
 * Wi-Fi router that itself lost its upstream, captive portals, etc). A
 * lightweight periodic ping against a real, cheap, unauthenticated server
 * endpoint (`/api/health`) drives the actual online/offline signal the
 * outbox queue reacts to.
 */

const PING_URL = '/api/health';
const PING_INTERVAL_MS = 20000;
const PING_TIMEOUT_MS = 5000;

type ConnectivityListener = (isOnline: boolean) => void;

let isOnline = true; // optimistic until the first real check resolves
let started = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<ConnectivityListener>();

async function pingServer(): Promise<boolean> {
  if (!navigator.onLine) return false; // trust the browser's own "definitely offline" signal
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
    const res = await fetch(PING_URL, { method: 'GET', cache: 'no-store', signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

export async function checkConnectivityNow(): Promise<boolean> {
  const wasOnline = isOnline;
  const nowOnline = await pingServer();
  isOnline = nowOnline;
  if (nowOnline !== wasOnline) {
    listeners.forEach(listener => listener(nowOnline));
  }
  return nowOnline;
}

export function startConnectivityMonitor(): void {
  if (started) return;
  started = true;
  void checkConnectivityNow();
  intervalHandle = setInterval(checkConnectivityNow, PING_INTERVAL_MS);
  window.addEventListener('online', checkConnectivityNow);
  window.addEventListener('offline', () => {
    isOnline = false;
    listeners.forEach(listener => listener(false));
  });
}

export function stopConnectivityMonitor(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
  started = false;
}

/** Returns an unsubscribe function. */
export function onConnectivityChange(listener: ConnectivityListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getIsOnline(): boolean {
  return isOnline;
}
