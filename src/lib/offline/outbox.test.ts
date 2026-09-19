import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { offlineDb } from './db';
import {
  isNetworkFailure,
  getZatcaApproachingEntries,
  getExhaustedOutboxEntries,
  getPendingOutboxCount,
  decidePosSaleFailureAction,
} from './outbox';

const HOUR = 60 * 60 * 1000;

function makeEntry(overrides: Partial<Parameters<typeof offlineDb.outbox.put>[0]> = {}) {
  return {
    id: crypto.randomUUID(),
    type: 'pos_sale',
    payload: {},
    createdAt: Date.now(),
    status: 'pending' as const,
    retries: 0,
    ...overrides,
  };
}

beforeEach(async () => {
  await offlineDb.outbox.clear();
});

afterAll(() => {
  offlineDb.close();
});

describe('isNetworkFailure', () => {
  const originalNavigator = globalThis.navigator;

  afterAll(() => {
    vi.stubGlobal('navigator', originalNavigator);
  });

  it('returns true whenever navigator.onLine is false, regardless of the error', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(isNetworkFailure(new Error('some unrelated message'))).toBe(true);
    expect(isNetworkFailure(null)).toBe(true);
  });

  it('matches "Failed to fetch" (the standard browser fetch rejection)', () => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(isNetworkFailure(new Error('Failed to fetch'))).toBe(true);
  });

  it('matches a plain error object wrapping a TypeError message (postgrest-js behavior)', () => {
    // The real bug this function exists to fix: postgrest-js wraps a raw
    // fetch TypeError into a plain object, so `err instanceof TypeError`
    // never matches it -- message-substring matching is what actually
    // catches this case in practice.
    vi.stubGlobal('navigator', { onLine: true });
    const wrapped = { message: 'TypeError: Failed to fetch' };
    expect(isNetworkFailure(wrapped)).toBe(true);
  });

  it('matches Safari\'s "Load failed" wording', () => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(isNetworkFailure(new Error('Load failed'))).toBe(true);
  });

  it('matches Chrome network-error codes', () => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(isNetworkFailure(new Error('net::ERR_INTERNET_DISCONNECTED'))).toBe(true);
    expect(isNetworkFailure(new Error('net::ERR_NETWORK_CHANGED does not match ERR_NETWORK'))).toBe(true);
  });

  it('does NOT treat a genuine server/business-logic error as a network failure', () => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(isNetworkFailure(new Error('duplicate key value violates unique constraint'))).toBe(false);
    expect(isNetworkFailure({ message: 'insufficient stock' })).toBe(false);
  });

  it('handles null/undefined errors safely when online', () => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(isNetworkFailure(null)).toBe(false);
    expect(isNetworkFailure(undefined)).toBe(false);
  });
});

describe('getPendingOutboxCount', () => {
  it('counts pending, syncing, and failed entries but not synced (deleted) ones', async () => {
    await offlineDb.outbox.bulkPut([
      makeEntry({ status: 'pending' }),
      makeEntry({ status: 'syncing' }),
      makeEntry({ status: 'failed', retries: 1 }),
    ]);
    expect(await getPendingOutboxCount()).toBe(3);
  });

  it('returns 0 for an empty outbox', async () => {
    expect(await getPendingOutboxCount()).toBe(0);
  });
});

describe('getExhaustedOutboxEntries', () => {
  it('returns only failed entries that reached MAX_AUTO_RETRIES (5)', async () => {
    const exhausted = makeEntry({ status: 'failed', retries: 5 });
    const stillRetrying = makeEntry({ status: 'failed', retries: 2 });
    const pending = makeEntry({ status: 'pending', retries: 0 });
    await offlineDb.outbox.bulkPut([exhausted, stillRetrying, pending]);

    const result = await getExhaustedOutboxEntries();
    expect(result.map(e => e.id)).toEqual([exhausted.id]);
  });

  it('returns an empty array when nothing has exhausted its retries', async () => {
    await offlineDb.outbox.bulkPut([
      makeEntry({ status: 'failed', retries: 1 }),
      makeEntry({ status: 'pending', retries: 0 }),
    ]);
    expect(await getExhaustedOutboxEntries()).toEqual([]);
  });
});

describe('getZatcaApproachingEntries', () => {
  it('flags an entry older than the threshold and excludes a recent one', async () => {
    const old = makeEntry({ createdAt: Date.now() - 21 * HOUR }); // past the default 20h threshold
    const recent = makeEntry({ createdAt: Date.now() - 1 * HOUR });
    await offlineDb.outbox.bulkPut([old, recent]);

    const result = await getZatcaApproachingEntries();
    expect(result.map(e => e.id)).toEqual([old.id]);
  });

  it('excludes already-synced entries (not present in the outbox at all)', async () => {
    // Nothing to put -- a synced sale is deleted from the outbox entirely
    // (see syncEntry), so an empty table must yield an empty result, not
    // an error.
    expect(await getZatcaApproachingEntries()).toEqual([]);
  });

  it('respects a custom hoursThreshold', async () => {
    const entry = makeEntry({ createdAt: Date.now() - 2 * HOUR });
    await offlineDb.outbox.put(entry);

    expect(await getZatcaApproachingEntries(20)).toEqual([]);
    const result = await getZatcaApproachingEntries(1);
    expect(result.map(e => e.id)).toEqual([entry.id]);
  });

  it('only considers pending/syncing/failed statuses (a hypothetical stuck "conflict" entry is excluded)', async () => {
    const conflictEntry = makeEntry({ status: 'conflict' as any, createdAt: Date.now() - 30 * HOUR });
    await offlineDb.outbox.put(conflictEntry);
    expect(await getZatcaApproachingEntries()).toEqual([]);
  });
});

describe('decidePosSaleFailureAction', () => {
  // Extracted from POS.tsx's handleCheckout -- this is the exact branching
  // that decides whether a failed sale gets queued for offline retry,
  // blocked outright (B2B), or surfaced as a real error to the cashier.
  const originalNavigator = globalThis.navigator;
  beforeEach(() => {
    vi.stubGlobal('navigator', { onLine: true });
  });
  afterAll(() => {
    vi.stubGlobal('navigator', originalNavigator);
  });

  it('rethrows a genuine business-logic rejection (e.g. insufficient stock) instead of queueing it', () => {
    const stockError = new Error('لا يوجد رصيد لهذا الصنف في هذا الفرع');
    expect(decidePosSaleFailureAction(stockError, false)).toEqual({ kind: 'rethrow' });
    expect(decidePosSaleFailureAction(stockError, true)).toEqual({ kind: 'rethrow' });
  });

  it('queues a B2C sale offline on a real network failure', () => {
    const networkError = new Error('Failed to fetch');
    expect(decidePosSaleFailureAction(networkError, false)).toEqual({ kind: 'queue_offline' });
  });

  it('blocks a B2B sale outright on a network failure instead of queueing it (ZATCA needs live clearance)', () => {
    const networkError = new Error('Failed to fetch');
    expect(decidePosSaleFailureAction(networkError, true)).toEqual({ kind: 'b2b_offline_blocked' });
  });

  it('treats navigator.onLine === false as a network failure even with an unrelated error message', () => {
    vi.stubGlobal('navigator', { onLine: false });
    const genericError = new Error('some opaque RPC error');
    expect(decidePosSaleFailureAction(genericError, false)).toEqual({ kind: 'queue_offline' });
  });
});
