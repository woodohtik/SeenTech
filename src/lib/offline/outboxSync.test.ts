import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// seen-readiness-fixes-task.md P3.3 (RELIABILITY-04, -05, -06, -10, -16): the
// queue against a fake server.
const server = vi.hoisted(() => ({
  session: { user: { id: 'u1' } } as any,
  answer: { data: {}, error: null as any, status: 200 },
  calls: [] as string[],
}));

vi.mock('../supabase/client', () => {
  const call = (id: string) => {
    const b: any = {
      setHeader: () => b,
      abortSignal: () => Promise.resolve(server.answer),
    };
    server.calls.push(id);
    return b;
  };
  return {
    supabase: {
      auth: { getSession: async () => ({ data: { session: server.session } }) },
      rpc: (_fn: string, payload: any) => call(payload.p_operation_id),
      from: () => ({ insert: async () => server.answer }),
    },
  };
});
vi.mock('./connectivity', () => ({ checkConnectivityNow: async () => true, onConnectivityChange: () => () => {} }));
const logged = vi.hoisted(() => [] as any[]);
vi.mock('../logger', () => ({ logError: (_e: any, ctx: any) => logged.push(ctx) }));

import { offlineDb, type OutboxEntry } from './db';
import {
  drainOutbox, getEntriesNeedingAttention, isNetworkFailure, isTransientSyncError, releaseStuckEntries, retryDelayMs, STUCK_SYNCING_MS,
} from './outbox';

const entry = (id: string, over: Partial<OutboxEntry> = {}): OutboxEntry => ({
  id, type: 'pos_sale', payload: { p_operation_id: id, p_order: {}, p_items: [], p_invoice: {} },
  createdAt: Date.now(), status: 'pending', retries: 0, authUid: 'u1', ...over,
});

beforeEach(async () => {
  await offlineDb.outbox.clear();
  server.session = { user: { id: 'u1' } };
  server.answer = { data: {}, error: null, status: 200 };
  server.calls = [];
  logged.length = 0;
});

describe('who sends what', () => {
  it('nothing is sent without a session', async () => {
    await offlineDb.outbox.put(entry('a'));
    server.session = null;
    expect(await drainOutbox()).toEqual({ synced: 0, failed: 0 });
    expect((await offlineDb.outbox.get('a'))?.status).toBe('pending');
  });

  it("only this account's entries are sent; another account's wait untouched", async () => {
    await offlineDb.outbox.bulkPut([entry('mine'), entry('theirs', { authUid: 'u2' }), entry('legacy', { authUid: undefined })]);
    expect(await drainOutbox()).toEqual({ synced: 2, failed: 0 });
    expect(server.calls.sort()).toEqual(['legacy', 'mine']);
    expect(await offlineDb.outbox.get('theirs')).toMatchObject({ status: 'pending', retries: 0 });
  });
});

describe('failures', () => {
  it('a server outage (503) waits with a growing delay and does not use up the attempts', async () => {
    await offlineDb.outbox.put(entry('a'));
    server.answer = { data: null, error: { message: 'Service Unavailable' }, status: 503 };
    await drainOutbox();
    const a = await offlineDb.outbox.get('a');
    expect(a).toMatchObject({ status: 'failed', retries: 0, transientFailures: 1 });
    expect(a!.nextAttemptAt!).toBeGreaterThan(Date.now() + 25_000);
    // Not tried again before its time.
    server.calls = [];
    await drainOutbox();
    expect(server.calls).toEqual([]);
    expect(logged).toEqual([]);
  });

  it('a rejection counts as an attempt and reaches the support team', async () => {
    await offlineDb.outbox.put(entry('a'));
    server.answer = { data: null, error: { message: 'الوردية مغلقة', code: '22023' }, status: 400 };
    await drainOutbox();
    expect(await offlineDb.outbox.get('a')).toMatchObject({ status: 'failed', retries: 1 });
    expect(logged).toEqual([expect.objectContaining({ context: 'offline_sync_rejected', operation: 'pos_sale', code: '22023', exhausted: false })]);
  });
});

describe('entries left "syncing"', () => {
  it('go back to pending after two minutes, and are sent', async () => {
    await offlineDb.outbox.bulkPut([
      entry('old', { status: 'syncing', syncingAt: Date.now() - STUCK_SYNCING_MS - 1000 }),
      entry('now', { status: 'syncing', syncingAt: Date.now() }),
    ]);
    expect((await getEntriesNeedingAttention()).map((e) => e.id)).toEqual(['old']);
    expect(await drainOutbox()).toEqual({ synced: 1, failed: 0 });
    expect(await offlineDb.outbox.get('old')).toBeUndefined();
    expect((await offlineDb.outbox.get('now'))?.status).toBe('syncing');
    expect(await releaseStuckEntries(Date.now() + STUCK_SYNCING_MS + 1000)).toBe(1);
  });
});

describe('what counts as the network', () => {
  it('a timeout, a gateway error and an HTML page are the network', () => {
    expect(isNetworkFailure({ name: 'TimeoutError', message: 'signal timed out' })).toBe(true);
    expect(isNetworkFailure({ name: 'AbortError', message: 'aborted' })).toBe(true);
    expect(isNetworkFailure({ message: 'x', status: 504 })).toBe(true);
    expect(isNetworkFailure({ message: "Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON" })).toBe(true);
    expect(isNetworkFailure({ message: 'insufficient stock', code: '23514', status: 400 })).toBe(false);
  });
  it('a 5xx, 429 and an expired session are worth retrying; a rejection is not', () => {
    expect(isTransientSyncError({ message: 'x', status: 500 })).toBe(true);
    expect(isTransientSyncError({ message: 'x', status: 429 })).toBe(true);
    expect(isTransientSyncError({ message: 'JWT expired', code: 'PGRST301', status: 401 })).toBe(true);
    expect(isTransientSyncError({ message: 'forbidden', code: '42501', status: 403 })).toBe(false);
  });
  it('the delay doubles from 30 seconds and stops at 15 minutes', () => {
    expect([1, 2, 3].map(retryDelayMs)).toEqual([30_000, 60_000, 120_000]);
    expect(retryDelayMs(20)).toBe(15 * 60_000);
  });
});
