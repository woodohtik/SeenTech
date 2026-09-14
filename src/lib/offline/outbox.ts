import { supabase } from '../supabase/client';
import { offlineDb, type OutboxEntry } from './db';
import { requestPersistentStorage } from './persistentStorage';
import { onConnectivityChange, checkConnectivityNow } from './connectivity';

/**
 * The outbox queue (seen-offline-sync-architecture-task.md Phase 3).
 *
 * Only `pos_sale` is a recognized entry type -- Phase 1's own scope decision
 * limits what's safe to queue offline to simplified (B2C) POS sales;
 * standard B2B invoices are explicitly excluded (owner decision, see the
 * task file) and must never reach this queue.
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
 *  than inventing a second heuristic for the same problem. */
export function isNetworkFailure(err: any): boolean {
  return (
    (err instanceof TypeError && (err.message?.includes('fetch') || err.message?.includes('Network'))) ||
    !!err?.message?.includes('Failed to fetch') ||
    !!err?.message?.includes('NetworkError')
  );
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
    void requestPersistentStorage();
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
  } finally {
    await refreshCachedPendingCount();
    draining = false;
  }
  return { synced, failed };
}

export async function getPendingOutboxCount(): Promise<number> {
  return offlineDb.outbox.where('status').anyOf('pending', 'syncing', 'failed').count();
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
  void refreshCachedPendingCount();
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
