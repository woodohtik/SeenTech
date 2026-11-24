/*
 * Loaded into the app's service worker (vite.config.ts, workbox.importScripts).
 * seen-update-delivery-fix-task.md, phases 0.5 and 5.
 */

// Permanent: the old on-demand code cache may hold an HTML page stored as a
// code file (a missing file used to come back as index.html). Its successor
// is seen-on-demand-chunks-v2, which keeps only real JavaScript.
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.delete('seen-on-demand-chunks').catch(() => false));
});

// ---------------------------------------------------------------------------
// RESCUE RELEASE -- remove this block after 2 Dec 2026 (task file 5.3).
//
// Devices that opened Seen before 22 Nov run code that never tells a waiting
// worker to take over, so they stayed on an old copy (and its unguarded
// reload loop). This worker takes over by itself, and when it replaces an
// older worker each open window is reloaded once -- once per device,
// recorded in a cache -- so it lands on the current build. A first visit
// (no older worker) is not reloaded. Founder decision (question 1): yes,
// released after closing time. From then on the app decides when an update
// applies (src/lib/updateManager.ts).
// ---------------------------------------------------------------------------
const RESCUE_MARK_CACHE = 'seen-rescue';
const RESCUE_MARK_URL = '/__seen-rescue-done';
let replacesOlderWorker = false;

self.addEventListener('install', () => {
  // An active worker at install time means this is an update, not a first visit.
  replacesOlderWorker = !!self.registration.active;
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  const activation = (async () => {
    await self.clients.claim();
    const marks = await caches.open(RESCUE_MARK_CACHE);
    if (await marks.match(RESCUE_MARK_URL)) return [];
    await marks.put(RESCUE_MARK_URL, new Response(new Date().toISOString()));
    if (!replacesOlderWorker) return [];
    return self.clients.matchAll({ type: 'window' });
  })();
  event.waitUntil(activation);
  // The reloads start AFTER activation, not inside waitUntil: a reload is a
  // page request this worker answers only once it is active, so awaiting it
  // here would deadlock the two (the page froze ~5 minutes in the test).
  activation.then((windows) => {
    windows.forEach((client) => { client.navigate(client.url).catch(() => undefined); });
  }).catch(() => undefined);
});
