import { supabase } from '../supabase/client';
import i18n from 'i18next';
import { offlineDb, type OutboxEntry } from './db';
import { requestPersistentStorage } from './persistentStorage';
import { onConnectivityChange, checkConnectivityNow } from './connectivity';
import { getActorStaffId, OFFLINE_ACTOR_HEADER } from '../actingSession';
import { logError } from '../logger';
import { registerUnsavedWork } from '../unsavedWork';

/**
 * The outbox queue (seen-offline-sync-architecture-task.md Phase 3).
 *
 * `pos_sale` and `order_create` are the two recognized entry types.
 * Standard B2B invoices are explicitly excluded from `pos_sale` (owner
 * decision, see the task file: ZATCA requires live clearance for those)
 * and must never reach this queue -- `order_create` (a tailoring/service
 * order, not a point-of-sale tax invoice) has no such restriction.
 */

const MAX_AUTO_RETRIES = 5;
/** P3.3 / RELIABILITY-04: an entry left "syncing" this long (a closed tab, a crash) is sent again. */
export const STUCK_SYNCING_MS = 2 * 60 * 1000;
/** P3.3: how long a sale waits for the server before it is treated as offline. */
export const SALE_TIMEOUT_MS = 15_000;

/**
 * P3.3 / RELIABILITY-06: the network, a timeout, the server or its gateway
 * being down, rate limiting or an expired session -- worth trying again later,
 * and not counted against the attempts. Anything else is the server turning
 * the operation down and is counted.
 */
export function isTransientSyncError(err: any): boolean {
  if (isNetworkFailure(err)) return true;
  const status = Number(err?.status);
  if (status === 429 || status === 401 || status >= 500) return true;
  return err?.code === 'PGRST301' || /JWT expired/i.test(String(err?.message || ''));
}

/** Delay before the next try after `failures` network/server failures: 30 s doubling, at most 15 minutes. */
export function retryDelayMs(failures: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, failures - 1), 15 * 60_000);
}

async function currentAuthUid(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------------------
   Phase 4 needs a synchronous "how many are pending right now" read for the
   `beforeunload` handler below -- that event can't await a Dexie query and
   still block the unload, so a plain in-memory count is kept in step with
   the real table instead. The live UI badge (OfflineStatusIndicator) reads
   the table itself via dexie-react-hooks' useLiveQuery and doesn't need
   this; this cache exists only for the synchronous check.
   -------------------------------------------------------------------------- */
let cachedPendingCount = 0;

async function refreshCachedPendingCount(): Promise<void> {
  cachedPendingCount = await getPendingOutboxCount();
}

export function getCachedPendingCount(): number {
  return cachedPendingCount;
}

/** Same "was this actually a network failure" check already used in
 *  Login.tsx's handleEmailLogin/handleRegister -- kept consistent rather
 *  than inventing a second heuristic for the same problem.
 *
 *  navigator.onLine is checked first and short-circuits everything else:
 *  when the browser itself reports no network, whatever error a Supabase
 *  call surfaced is a network failure regardless of its exact message
 *  text -- message-substring matching alone is fragile (it depends on
 *  which browser/JS engine worded the underlying fetch rejection, and on
 *  every layer this error passed through -- e.g. postgrest-js wraps a raw
 *  fetch TypeError into a plain error OBJECT whose .message is prefixed
 *  with the original error's name, not a TypeError instance itself, so
 *  `err instanceof TypeError` never actually matches it in practice). */
export function isNetworkFailure(err: any): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  // P3.3 / RELIABILITY-10: a request that timed out, a gateway error (the
  // server or its proxy is down) or an HTML error page in place of JSON is
  // the network's failure too -- safe to queue, every operation is idempotent.
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return true;
  const status = Number(err?.status);
  if ([502, 503, 504, 520, 521, 522, 523, 524].includes(status)) return true;
  if (/timed? ?out|aborted|Unexpected token '<'|is not valid JSON/i.test(String(err?.message || ''))) return true;
  return (
    (err instanceof TypeError && (err.message?.includes('fetch') || err.message?.includes('Network'))) ||
    !!err?.message?.includes('Failed to fetch') ||
    !!err?.message?.includes('NetworkError') ||
    !!err?.message?.includes('Load failed') ||
    !!err?.message?.includes('ERR_INTERNET_DISCONNECTED') ||
    !!err?.message?.includes('ERR_NETWORK')
  );
}

export type PosSaleFailureAction =
  | { kind: 'rethrow' }
  | { kind: 'b2b_offline_blocked' }
  | { kind: 'queue_offline' };

/**
 * seen-offline-sync-architecture-task.md Phase 3: only a real network
 * failure (not a legitimate rejection like insufficient stock, which must
 * still fail loudly) falls back to the outbox. Standard B2B invoices are
 * explicitly excluded from offline queueing (owner decision, Phase 1) --
 * ZATCA requires live clearance for those, so they must block outright
 * instead. Extracted from POS.tsx's handleCheckout as a pure decision so
 * this exact branching (the actual mechanism deciding whether a failed
 * sale gets queued, blocked, or surfaced as a real error) is unit-testable
 * without needing to render POS.tsx.
 */
export function decidePosSaleFailureAction(saleError: unknown, isB2B: boolean): PosSaleFailureAction {
  if (!isNetworkFailure(saleError)) return { kind: 'rethrow' };
  if (isB2B) return { kind: 'b2b_offline_blocked' };
  return { kind: 'queue_offline' };
}

export async function enqueuePosSale(operationId: string, payload: {
  p_operation_id: string;
  p_order: unknown;
  p_items: unknown;
  p_invoice: unknown;
}): Promise<void> {
  const isFirstEver = (await offlineDb.outbox.count()) === 0;

  await offlineDb.outbox.put({
    id: operationId,
    type: 'pos_sale',
    payload,
    createdAt: Date.now(),
    status: 'pending',
    retries: 0,
    actorStaffId: getActorStaffId(),
    authUid: await currentAuthUid(),
  });

  if (isFirstEver) {
    // Called from within the checkout button's own click handler -- a real
    // user interaction, matching Phase 2's requirement not to ask for
    // persistent storage speculatively on page load.
    void requestPersistentStorage().catch(() => {});
  }
  await refreshCachedPendingCount();
}

/**
 * A tailoring/service order (Orders.tsx), not a point-of-sale tax invoice --
 * no ZATCA live-clearance restriction applies, unlike pos_sale/B2B. `orderId`
 * is generated client-side (crypto.randomUUID()) and included as `id` inside
 * `orderData` itself, so replaying this insert is idempotent the same way
 * pos_sale's operation_id is: a retried sync after a dropped response hits a
 * primary-key conflict server-side instead of creating a duplicate order
 * (see syncEntry below).
 */
export async function enqueueOrderCreate(orderId: string, orderData: Record<string, unknown>): Promise<void> {
  const isFirstEver = (await offlineDb.outbox.count()) === 0;

  await offlineDb.outbox.put({
    id: orderId,
    type: 'order_create',
    payload: { orderData },
    createdAt: Date.now(),
    status: 'pending',
    retries: 0,
    authUid: await currentAuthUid(),
  });

  if (isFirstEver) {
    void requestPersistentStorage().catch(() => {});
  }
  await refreshCachedPendingCount();
}

/**
 * Queues a tailoring order for create_tailoring_order. The operation id is the
 * order id and the server's idempotency key, so a replay after a dropped
 * response returns the order already created instead of making another.
 */
export async function enqueueTailoringOrder(operationId: string, payload: {
  p_operation_id: string;
  p_order: unknown;
  p_items: unknown;
}): Promise<void> {
  const isFirstEver = (await offlineDb.outbox.count()) === 0;

  await offlineDb.outbox.put({
    id: operationId,
    type: 'tailoring_order',
    payload,
    createdAt: Date.now(),
    status: 'pending',
    retries: 0,
    actorStaffId: getActorStaffId(),
    authUid: await currentAuthUid(),
  });

  if (isFirstEver) {
    void requestPersistentStorage().catch(() => {});
  }
  await refreshCachedPendingCount();
}

/**
 * seen-permissions-fix-task.md Phase 2 (founder question 4): a sale or order
 * made offline is the employee's who made it. The replay names them in
 * x-seen-offline-actor -- the server uses it for attribution only (created_by,
 * the shift, "سُجّلت بدون اتصال" in the history), never for permissions, and
 * only for an active employee of the same shop -- and the PIN session header
 * is left off this request.
 */
function withActor<T extends { setHeader: (name: string, value: string) => T }>(call: T, entry: OutboxEntry): T {
  return entry.actorStaffId ? call.setHeader(OFFLINE_ACTOR_HEADER, entry.actorStaffId) : call;
}

/** The HTTP status rides on the error, so a 5xx can be told from a rejection. */
const withStatus = (error: any, status?: number) => (error && status ? Object.assign(error, { status }) : error);

async function syncEntry(entry: OutboxEntry): Promise<'synced' | 'failed'> {
  await offlineDb.outbox.update(entry.id, { status: 'syncing', syncingAt: Date.now() });
  try {
    if (entry.type === 'pos_sale') {
      const payload = entry.payload as { p_operation_id: string; p_order: unknown; p_items: unknown; p_invoice: unknown };
      const { error, status } = await withActor(supabase.rpc('create_pos_sale', payload), entry).abortSignal(AbortSignal.timeout(SALE_TIMEOUT_MS * 2));
      if (error) throw withStatus(error, status);
    } else if (entry.type === 'tailoring_order') {
      const payload = entry.payload as { p_operation_id: string; p_order: unknown; p_items: unknown };
      const { data, error, status } = await withActor(supabase.rpc('create_tailoring_order', payload), entry).abortSignal(AbortSignal.timeout(SALE_TIMEOUT_MS * 2));
      if (error) throw withStatus(error, status);
      // The staff member took a deposit while offline, but by the time this
      // synced they had no open shift, so the server saved the order without
      // it. Nobody is looking at a form now: leave a notification on the shop.
      if (data?.deposit_skipped && !data?.replayed && data?.order?.tenant_id) {
        try {
          await supabase.from('notifications').insert({
            tenant_id: data.order.tenant_id,
            title: i18n.t('orders.deposit_needs_shift_title'),
            message: i18n.t('orders.deposit_skipped_on_sync', {
              number: data.order.order_number || '',
              customer: data.order.customer_name || '',
            }),
            type: 'order',
            status: 'unread',
            created_at: new Date().toISOString(),
            metadata: { order_id: data.order.id },
          });
        } catch (notifyErr) {
          console.warn('[outbox] could not record the skipped-deposit notice:', notifyErr);
        }
      }
    } else if (entry.type === 'order_create') {
      // Legacy: queued by the direct-insert path before create_tailoring_order.
      // Nothing enqueues this type any more; it stays so old entries still drain.
      const payload = entry.payload as { orderData: Record<string, unknown> };
      const { error, status } = await supabase.from('orders').insert(payload.orderData);
      // 23505 = unique_violation on the client-generated id -- an earlier
      // sync attempt already succeeded server-side even though its response
      // never made it back here (e.g. the connection dropped mid-response).
      // That's a success, not a failure to retry.
      if (error && (error as any).code !== '23505') throw withStatus(error, status);
    }
    await offlineDb.outbox.delete(entry.id);
    return 'synced';
  } catch (err: any) {
    const lastError = err?.message || String(err);
    if (isTransientSyncError(err)) {
      // The network or the server, not a rejection: wait longer each time, keep the attempts.
      const transientFailures = (entry.transientFailures ?? 0) + 1;
      await offlineDb.outbox.update(entry.id, {
        status: 'failed', lastError, transientFailures, nextAttemptAt: Date.now() + retryDelayMs(transientFailures),
      });
    } else {
      const retries = entry.retries + 1;
      await offlineDb.outbox.update(entry.id, { status: 'failed', retries, lastError, nextAttemptAt: Date.now() + 60_000 });
      // RELIABILITY-16: a rejected sync reaches the support team, without personal data.
      logError(err, {
        context: 'offline_sync_rejected', operation: entry.type, entryId: entry.id, code: err?.code ?? null,
        retries, exhausted: retries >= MAX_AUTO_RETRIES,
      });
    }
    return 'failed';
  }
}

/** P3.3 / RELIABILITY-04: entries left "syncing" too long go back to pending (the server never makes one twice). */
export async function releaseStuckEntries(now = Date.now()): Promise<number> {
  const stuck = await offlineDb.outbox
    .where('status').equals('syncing')
    .and(entry => (entry.syncingAt ?? 0) < now - STUCK_SYNCING_MS)
    .toArray();
  for (const entry of stuck) await offlineDb.outbox.update(entry.id, { status: 'pending' });
  return stuck.length;
}

let draining = false;

/** P3.4 / RELIABILITY-15: fired on window after each drain, so a re-fetch lands after the queue's writes. */
export const OUTBOX_DRAINED_EVENT = 'seen-outbox-drained';
export const isOutboxDraining = () => draining;
// A sale being sent is work a reload could cut in half: no update applies
// meanwhile (seen-update-delivery-fix-task.md 3.1). The drained event settles it.
registerUnsavedWork('offline-outbox-send', isOutboxDraining);

/**
 * Drains everything currently queued, oldest first. Safe to call
 * repeatedly/concurrently (a no-op re-entry guard) -- both the connectivity
 * monitor and app startup call this independently.
 */
export async function drainOutbox(): Promise<{ synced: number; failed: number }> {
  if (draining) return { synced: 0, failed: 0 };
  draining = true;
  let synced = 0;
  let failed = 0;
  try {
    const online = await checkConnectivityNow();
    if (!online) return { synced, failed };
    // RELIABILITY-05: never without a session, and only this account's entries
    // (another account's wait untouched, attempts and all). Entries from before
    // P3 carry no account and go with whoever is signed in, as before.
    const uid = await currentAuthUid();
    if (!uid) return { synced, failed };
    await releaseStuckEntries();

    const now = Date.now();
    const pending = await offlineDb.outbox
      .where('status').anyOf('pending', 'failed')
      .and(entry => entry.retries < MAX_AUTO_RETRIES && (entry.nextAttemptAt ?? 0) <= now && (!entry.authUid || entry.authUid === uid))
      .sortBy('createdAt');

    for (const entry of pending) {
      const result = await syncEntry(entry);
      if (result === 'synced') synced++; else failed++;
    }
  } catch (err) {
    // Every call site here is fire-and-forget (`void drainOutbox()` at app
    // startup and on every connectivity-change tick) -- an exception
    // escaping this function becomes an unhandled rejection, which the
    // top-level ErrorBoundary turns into a full-page crash for the whole
    // app, for what should be a background sync attempt failing once.
    console.error('[outbox] drainOutbox failed (will retry on next connectivity check):', err);
  } finally {
    await refreshCachedPendingCount().catch(() => {});
    draining = false;
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(OUTBOX_DRAINED_EVENT));
  }
  return { synced, failed };
}

/**
 * P3.4 / RELIABILITY-07: operations made on this shift that have not reached
 * the server yet. Closing the shift first would make the server refuse them
 * for good (a sale needs its shift open) and leave the drawer short.
 */
export async function getUnsyncedCountForShift(shiftId: string): Promise<number> {
  return offlineDb.outbox
    .where('status').anyOf('pending', 'syncing', 'failed')
    .and(entry => ((entry.payload as any)?.p_order?.shift_id ?? null) === shiftId)
    .count();
}

export async function getPendingOutboxCount(): Promise<number> {
  return offlineDb.outbox.where('status').anyOf('pending', 'syncing', 'failed').count();
}

/**
 * Entries that hit MAX_AUTO_RETRIES: drainOutbox() will never pick these up
 * again (its query filters retries < MAX_AUTO_RETRIES), but they were still
 * counted the same as an actively-retrying entry by getPendingOutboxCount()
 * with no way to tell them apart in the UI. A financial record stuck here
 * needs a human to look at it, not just another automatic retry that will
 * never come.
 */
/**
 * P3.3 / RELIABILITY-04: every entry a person may want to send again now --
 * failed (whether or not it is still retrying on its own) or left "syncing".
 */
export async function getEntriesNeedingAttention(now = Date.now()): Promise<OutboxEntry[]> {
  return offlineDb.outbox
    .where('status').anyOf('failed', 'syncing')
    .and(entry => entry.status === 'failed' || (entry.syncingAt ?? 0) < now - STUCK_SYNCING_MS)
    .toArray();
}

export async function getExhaustedOutboxEntries(): Promise<OutboxEntry[]> {
  return offlineDb.outbox
    .where('status').equals('failed')
    .and(entry => entry.retries >= MAX_AUTO_RETRIES)
    .toArray();
}

/**
 * What an operation was, for the "needs review" list (team review M-9): an
 * operation the server rejected for good -- e.g. a tailoring order whose
 * deposit came out above its total after a tax change -- used to show only
 * as a count. Staff took money for it, so they need to see which one it was
 * and why it failed.
 */
export interface OutboxEntryDescription {
  id: string;
  kind: 'pos_sale' | 'tailoring_order' | 'order_create' | 'other';
  customerName: string | null;
  paid: number;
  createdAt: number;
  reason: string | null;
}

export async function describeOutboxEntry(entry: OutboxEntry): Promise<OutboxEntryDescription> {
  const p = (entry.payload || {}) as Record<string, any>;
  const order = (p.p_order || p.orderData || {}) as Record<string, any>;
  let customerName: string | null = order.customer_name || null;
  if (!customerName && order.customer_id) {
    try {
      customerName = (await offlineDb.cachedCustomers.get(String(order.customer_id)))?.name || null;
    } catch {
      customerName = null;
    }
  }
  const kind = entry.type === 'pos_sale' || entry.type === 'tailoring_order' || entry.type === 'order_create'
    ? entry.type
    : 'other';
  return {
    id: entry.id,
    kind,
    customerName,
    paid: Number(order.paid_amount ?? order.paidAmount ?? 0) || 0,
    createdAt: entry.createdAt,
    reason: entry.lastError || null,
  };
}

/**
 * Sends a failed operation again: back to pending with its attempts reset,
 * then a drain. Safe to repeat -- the server functions key on the
 * operation's id and never create it twice. Nothing is ever deleted here.
 */
export async function requeueOutboxEntry(id: string): Promise<void> {
  await offlineDb.outbox.update(id, { status: 'pending', retries: 0, transientFailures: 0, nextAttemptAt: 0 });
  await refreshCachedPendingCount();
}

/**
 * Phase 4's ZATCA clock: a simplified (B2C) invoice must reach the "فاتورة"
 * platform within 24 hours of issuance. That 24-hour clock starts at the
 * moment the sale was made (this entry's createdAt, generated client-side
 * at checkout) -- not whenever it eventually reaches the server -- so this
 * has to be computed from the local outbox, not from anything server-side.
 * `hoursThreshold` defaults to 20h, leaving a 4-hour buffer before the
 * actual legal deadline instead of warning exactly as it's missed.
 */
export async function getZatcaApproachingEntries(hoursThreshold = 20): Promise<OutboxEntry[]> {
  const cutoff = Date.now() - hoursThreshold * 60 * 60 * 1000;
  const entries = await offlineDb.outbox.where('status').anyOf('pending', 'syncing', 'failed').toArray();
  return entries.filter(entry => entry.createdAt <= cutoff);
}

let initialized = false;

/** Call once at app startup (App.tsx). Idempotent. */
export function initOutboxSync(): void {
  if (initialized) return;
  initialized = true;
  void refreshCachedPendingCount().catch(() => {});
  onConnectivityChange(online => {
    if (online) void drainOutbox();
  });
  void drainOutbox();
  // P3.3 / RELIABILITY-06: also every minute while the page is in front --
  // a failed entry used to wait for the connection to drop and come back.
  window.setInterval(() => {
    if (document.visibilityState === 'visible') void drainOutbox();
  }, 60_000);

  /* --------------------------------------------------------------------
     Phase 4: warn before closing/reloading the tab while sales are still
     unsynced. Browsers ignore any custom string here and show their own
     generic "leave site?" dialog regardless (a long-standing, deliberate
     browser security restriction, not something to work around) -- the
     task only asks that this fire *conditionally*, only while the queue
     is actually non-empty, which is what the synchronous cached count
     below is for.
     -------------------------------------------------------------------- */
  window.addEventListener('beforeunload', (e) => {
    if (getCachedPendingCount() > 0) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}
