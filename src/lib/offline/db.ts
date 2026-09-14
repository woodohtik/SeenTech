import Dexie, { type Table } from 'dexie';
import type { InventoryItem, Customer } from '../../types';

/**
 * Local persistent store (seen-offline-sync-architecture-task.md Phase 2).
 *
 * Dexie over IndexedDB, shared by the PWA and the Capacitor app (the native
 * webview runs IndexedDB too -- same code works in both, no separate SQLite
 * plugin needed unless a real gap shows up later).
 *
 * Two concerns share this one database:
 *  - `outbox`: pending write operations recorded while offline. Phase 2 only
 *    defines the table shape here; Phase 3 owns actually writing to it and
 *    draining it back to the server.
 *  - `cachedInventoryItems` / `cachedBranchStock` / `cachedCustomers`: a
 *    read-through cache of the data POS.tsx needs to keep working
 *    (product lookup, stock display, customer selection) while offline.
 */

export type OutboxStatus = 'pending' | 'syncing' | 'failed' | 'conflict';

export interface OutboxEntry {
  /** Client-generated UUID. Doubles as the idempotency key sent to the server RPC. */
  id: string;
  type: string;
  payload: unknown;
  createdAt: number;
  status: OutboxStatus;
  retries: number;
  lastError?: string;
}

export interface CachedInventoryItem extends InventoryItem {
  cachedAt: number;
}

export interface CachedBranchStock {
  /** `${branchId}:${itemId}` */
  key: string;
  branchId: string;
  itemId: string;
  tenantId: string;
  quantity: number;
  cachedAt: number;
}

export interface CachedCustomer extends Customer {
  cachedAt: number;
}

/**
 * One staff member's own PIN, cached locally only after THEY successfully
 * verified it online at least once on this specific device (Phase 5) --
 * never the whole tenant roster. That distinction is load-bearing: an
 * earlier version of PIN verification fetched every active staff member's
 * PIN to the browser so it could be checked client-side, which let any
 * staff member read a coworker's or the owner's PIN straight out of the
 * network response (see server.ts's /api/staff/verify-pin comment). This
 * cache only ever grows one entry at a time, each written at the exact
 * moment its own owner typed it correctly against the real server.
 * `pinHashHex` is a client-side SHA-256 of the PIN -- there's no legitimate
 * reason to ever read the plaintext back out of this particular cache, so
 * it isn't stored plaintext here even though the server itself does.
 */
export interface CachedStaffAuth {
  staffId: string;
  tenantId: string;
  pinHashHex: string;
  staff: unknown;
  cachedAt: number;
}

export interface OfflinePinLockout {
  tenantId: string;
  failedCount: number;
  lockUntil: number | null;
}

class SeenOfflineDatabase extends Dexie {
  outbox!: Table<OutboxEntry, string>;
  cachedInventoryItems!: Table<CachedInventoryItem, string>;
  cachedBranchStock!: Table<CachedBranchStock, string>;
  cachedCustomers!: Table<CachedCustomer, string>;
  cachedStaffAuth!: Table<CachedStaffAuth, string>;
  offlinePinLockout!: Table<OfflinePinLockout, string>;

  constructor() {
    super('seen-offline');
    this.version(1).stores({
      outbox: 'id, status, createdAt',
      cachedInventoryItems: 'id, tenantId, barcode, sku',
      cachedBranchStock: 'key, branchId, itemId, tenantId',
      cachedCustomers: 'id, tenantId, phone',
    });
    this.version(2).stores({
      cachedStaffAuth: 'staffId, tenantId',
      offlinePinLockout: 'tenantId',
    });
  }
}

/** Single shared instance -- Dexie itself handles connection reuse/locking. */
export const offlineDb = new SeenOfflineDatabase();
