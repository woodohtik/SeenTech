import { supabase } from '../supabase/client';
import { offlineDb, type OutboxEntry } from './db';
import { requestPersistentStorage } from './persistentStorage';
import { onConnectivityChange, checkConnectivityNow } from './connectivity';

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
  });

  if (isFirstEver) {
    void requestPersistentStorage().catch(() => {});
  }
  await refreshCachedPendingCount();
}

async function syncEntry(entry: OutboxEntry): Promise<'synced' | 'failed'> {
  await offlineDb.outbox.update(entry.id, { status: 'syncing' });
  try {
    if (entry.type === 'pos_sale') {
      const payload = entry.payload as { p_operation_id: string; p_order: unknown; p_items: unknown; p_invoice: unknown };
      const { error } = await supabase.rpc('create_pos_sale', payload);
      if (error) throw error;
    } else if (entry.type === 'order_create') {
      const payload = entry.payload as { orderData: Record<string, unknown> };
      const { error } = await supabase.from('orders').insert(payload.orderData);
      // 23505 = unique_violation on the client-generated id -- an earlier
      // sync attempt already succeeded server-side even though its response
      // never made it back here (e.g. the connection dropped mid-response).
      // That's a success, not a failure to retry.
      if (error && (error as any).code !== '23505') throw error;
    }
    await offlineDb.outbox.delete(entry.id);
    return 'synced';
  } catch (err: any) {
    await offlineDb.outbox.update(entry.id, {
      status: 'failed',
      retries: entry.retries + 1,
      lastError: err?.message || String(err),
    });
    return 'failed';
  }
}

let draining = false;

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

    const pending = await offlineDb.outbox
      .where('status').anyOf('pending', 'failed')
      .and(entry => entry.retries < MAX_AUTO_RETRIES)
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
  }
  return { synced, failed };
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
export async function getExhaustedOutboxEntries(): Promise<OutboxEntry[]> {
  return offlineDb.outbox
    .where('status').equals('failed')
    .and(entry => entry.retries >= MAX_AUTO_RETRIES)
    .toArray();
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
