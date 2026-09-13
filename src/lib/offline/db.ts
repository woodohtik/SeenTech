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

class SeenOfflineDatabase extends Dexie {
  outbox!: Table<OutboxEntry, string>;
  cachedInventoryItems!: Table<CachedInventoryItem, string>;
  cachedBranchStock!: Table<CachedBranchStock, string>;
  cachedCustomers!: Table<CachedCustomer, string>;

  constructor() {
    super('seen-offline');
    this.version(1).stores({
      outbox: 'id, status, createdAt',
      cachedInventoryItems: 'id, tenantId, barcode, sku',
      cachedBranchStock: 'key, branchId, itemId, tenantId',
      cachedCustomers: 'id, tenantId, phone',
    });
  }
}

/** Single shared instance -- Dexie itself handles connection reuse/locking. */
export const offlineDb = new SeenOfflineDatabase();
