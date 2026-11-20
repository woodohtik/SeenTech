/**
 * Real connectivity detection (seen-offline-sync-architecture-task.md
 * Phase 3): `navigator.onLine` alone is not reliable -- it reports "online"
 * in plenty of situations with no real internet reachable (connected to a
 * Wi-Fi router that itself lost its upstream, captive portals, etc). A
 * lightweight periodic ping against a real, cheap, unauthenticated server
 * endpoint (`/api/health`) drives the actual online/offline signal the
 * outbox queue reacts to.
 */

// seen-performance-first-open-login-task.md Phase 5: /api/ping answers
// without touching the database (/api/health queries Supabase and stays
// for server monitoring), checked every 60 seconds only while the tab is
// visible -- plus at start, when the tab comes back, on the browser's
// online event, and whenever a request fails (outbox / services call
// checkConnectivityNow). It used to be /api/health every 20 seconds from
// every tab, hidden or not.
const PING_URL = '/api/ping';
const PING_INTERVAL_MS = 60000;
// seen-ux-fixes-batch-task.md #3: 5000ms could time out on a genuinely slow
// (not dead) network, producing the same false "offline" the task reports.
const PING_TIMEOUT_MS = 8000;

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

// Calls that overlap share one check (start-up used to send two at once).
let inFlight: Promise<boolean> | null = null;

export function checkConnectivityNow(): Promise<boolean> {
  if (!inFlight) inFlight = runCheck().finally(() => { inFlight = null; });
  return inFlight;
}

async function runCheck(): Promise<boolean> {
  const wasOnline = isOnline;
  let nowOnline = await pingServer();
  if (!nowOnline) {
    // لا نُعلِن "غير متصل" من أول فشل -- قد يكون 429 عابراً من تحديد المعدّل
    // على فرع فيه عدة أجهزة كاشير على نفس IP، أو هفوة شبكة لحظية، لا انقطاعاً
    // فعلياً (seen-ux-fixes-batch-task.md #3). محاولة واحدة إضافية بعد ثانية
    // قبل تغيير الحالة الظاهرة للمستخدم فعلياً.
    await new Promise(resolve => setTimeout(resolve, 1000));
    nowOnline = await pingServer();
  }
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
  intervalHandle = setInterval(() => {
    if (document.visibilityState === 'visible') void checkConnectivityNow();
  }, PING_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkConnectivityNow();
  });
  window.addEventListener('online', () => { void checkConnectivityNow(); });
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
