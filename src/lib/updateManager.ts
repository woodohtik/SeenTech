/**
 * When an update applies (seen-update-delivery-fix-task.md, phase 3).
 *
 * A newer build is reported by /version.json (appVersion.ts) or by a waiting
 * service worker (pwaUpdate.ts). Then:
 *  - safe screen (hasUnsavedWork() false): apply now, silently;
 *  - unsafe (a cart, an open form, a sale being sent): wait, show a fixed
 *    "update ready, applies after this" bar, and apply as soon as the work
 *    settles;
 *  - mandatory over unsafe work: a full "update required" screen.
 *
 * Applying: registration.update() -> the new worker -> SKIP_WAITING ->
 * controllerchange -> reload. If that has not happened within 30 seconds:
 * the hard way (no worker, no caches, from the network; IndexedDB stays).
 * And never a loop: landing on the same old build within 2 minutes of an
 * apply goes the hard way once; after that it stops and says so.
 */
import { CURRENT_BUILD, type RemoteVersion } from './appVersion';
import { hardRecover } from './chunkRecovery';
import { hasUnsavedWork, onWorkSettled } from './unsavedWork';

export type UpdateStatus = 'none' | 'waiting-for-safe' | 'mandatory' | 'applying' | 'stuck';

export const APPLY_RECORD_KEY = 'seen:update-apply';
export const HARD_RECORD_KEY = 'seen:update-hard';
const APPLY_LOOP_WINDOW_MS = 2 * 60_000;
const HARD_LOOP_WINDOW_MS = 10 * 60_000;
const APPLY_TIMEOUT_MS = 30_000;
const STEP_TIMEOUT_MS = 10_000;

let currentBuild = CURRENT_BUILD;
let status: UpdateStatus = 'none';
let pending: RemoteVersion | null = null;
const listeners = new Set<(s: UpdateStatus) => void>();
let settleSubscription: (() => void) | null = null;

function setStatus(next: UpdateStatus) {
  if (status === next) return;
  status = next;
  listeners.forEach((listener) => listener(next));
}

export const getUpdateStatus = (): UpdateStatus => status;
export const getPendingUpdate = (): RemoteVersion | null => pending;

export function onUpdateStatus(listener: (s: UpdateStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function evaluate() {
  if (!pending || status === 'applying' || status === 'stuck') return;
  if (!hasUnsavedWork()) {
    void applyUpdateNow();
    return;
  }
  setStatus(pending.mandatory ? 'mandatory' : 'waiting-for-safe');
}

/** A newer build is live (or a new worker is waiting). */
export function reportUpdate(remote: RemoteVersion): void {
  pending = { ...pending, ...remote, mandatory: !!(remote.mandatory || pending?.mandatory) };
  if (!settleSubscription) settleSubscription = onWorkSettled(evaluate);
  evaluate();
}

function readRecord(key: string): { from?: string; at?: number } | null {
  try {
    return JSON.parse(sessionStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}
function writeRecord(key: string) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ from: currentBuild, at: Date.now() }));
  } catch { /* no storage: the loop guard below still stops at "stuck" within this page */ }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([promise, delay(ms).then(() => undefined)]);
}

async function waitForWaitingWorker(registration: ServiceWorkerRegistration): Promise<ServiceWorker | null> {
  if (registration.waiting) return registration.waiting;
  const installing = registration.installing;
  if (!installing) return null;
  await withTimeout(new Promise<void>((resolve) => {
    installing.addEventListener('statechange', () => { if (installing.state === 'installed' || installing.state === 'redundant') resolve(); });
  }), STEP_TIMEOUT_MS);
  return registration.waiting;
}

async function takeOverAndReload(): Promise<void> {
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
  const registration = sw ? await withTimeout(sw.getRegistration(), STEP_TIMEOUT_MS) : undefined;
  if (sw && registration) {
    await withTimeout(registration.update().catch(() => undefined), STEP_TIMEOUT_MS);
    const waiting = await waitForWaitingWorker(registration);
    if (waiting) {
      const tookOver = new Promise<void>((resolve) => sw.addEventListener('controllerchange', () => resolve(), { once: true }));
      waiting.postMessage({ type: 'SKIP_WAITING' });
      await tookOver; // the 30-second limit in applyUpdateNow covers a worker that never takes over
    }
  }
  window.location.reload();
}

/** Applies the update now (also the "update now" button). */
export async function applyUpdateNow(): Promise<void> {
  if (status === 'applying') return;
  const last = readRecord(APPLY_RECORD_KEY);
  const backOnSameBuild = last?.from === currentBuild && Date.now() - (last.at ?? 0) < APPLY_LOOP_WINDOW_MS;
  if (backOnSameBuild) {
    // The last apply reloaded onto this same old build: the worker or a
    // cache still serves it. Once the hard way; then stop.
    const hard = readRecord(HARD_RECORD_KEY);
    if (hard?.from === currentBuild && Date.now() - (hard.at ?? 0) < HARD_LOOP_WINDOW_MS) {
      setStatus('stuck');
      return;
    }
    writeRecord(HARD_RECORD_KEY);
    setStatus('applying');
    await hardRecover();
    return;
  }

  writeRecord(APPLY_RECORD_KEY);
  setStatus('applying');
  let finished = false;
  const normal = takeOverAndReload().then(() => { finished = true; });
  await Promise.race([normal, delay(APPLY_TIMEOUT_MS)]);
  if (!finished) {
    writeRecord(HARD_RECORD_KEY);
    await hardRecover();
  }
}

/** Tests only. */
export function __resetUpdateManagerForTests(build: string): void {
  currentBuild = build;
  status = 'none';
  pending = null;
  listeners.clear();
  settleSubscription?.();
  settleSubscription = null;
}
