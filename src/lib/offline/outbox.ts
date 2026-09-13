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
    draining = false;
  }
  return { synced, failed };
}

export async function getPendingOutboxCount(): Promise<number> {
  return offlineDb.outbox.where('status').anyOf('pending', 'syncing', 'failed').count();
}

let initialized = false;

/** Call once at app startup (App.tsx). Idempotent. */
export function initOutboxSync(): void {
  if (initialized) return;
  initialized = true;
  onConnectivityChange(online => {
    if (online) void drainOutbox();
  });
  void drainOutbox();
}
