import { supabase } from '../supabase/client';

/**
 * seen-readiness-fixes-task.md P3.2 (RELIABILITY-02): order and invoice
 * numbers this device reserved on the server in advance
 * (reserve_offline_numbers), so a sale made offline prints the number it
 * will keep. create_pos_sale takes the slot back as p_order.offline_number.
 *
 * Kept in localStorage per shop; a slot is marked used before the receipt
 * prints, so it is never handed out twice on this device.
 */

export type OfflineBlock = { block_id: string; order_from: number; invoice_from: number; size: number; next: number };
export type OfflineNumber = { block_id: string; slot: number; orderNumber: number; invoiceNumber: number };

const BLOCK_SIZE = 20;
const TOP_UP_BELOW = 5;
const key = (tenantId: string) => `seen_offline_numbers:${tenantId}`;

function read(tenantId: string): OfflineBlock[] {
  try {
    const raw = localStorage.getItem(key(tenantId));
    const blocks = raw ? JSON.parse(raw) : [];
    return Array.isArray(blocks) ? blocks : [];
  } catch {
    return [];
  }
}

function write(tenantId: string, blocks: OfflineBlock[]): void {
  try {
    localStorage.setItem(key(tenantId), JSON.stringify(blocks.filter((b) => b.next < b.size)));
  } catch {
    // storage unavailable: offline sales fall back to a provisional receipt
  }
}

export function deviceId(): string {
  try {
    let id = localStorage.getItem('seen_device_id');
    if (!id) {
      id = globalThis.crypto.randomUUID();
      localStorage.setItem('seen_device_id', id);
    }
    return id;
  } catch {
    return globalThis.crypto.randomUUID();
  }
}

export function remainingOfflineNumbers(tenantId: string): number {
  return read(tenantId).reduce((n, b) => n + Math.max(0, b.size - b.next), 0);
}

/** The next reserved number, marked used at once. Null when this device has none left. */
export function takeOfflineNumber(tenantId: string): OfflineNumber | null {
  const blocks = read(tenantId);
  const b = blocks.find((x) => x.next < x.size);
  if (!b) return null;
  const slot = b.next;
  b.next += 1;
  write(tenantId, blocks);
  return { block_id: b.block_id, slot, orderNumber: b.order_from + slot, invoiceNumber: b.invoice_from + slot };
}

let topping = false;
/** Online: reserve another block when fewer than five numbers are left. Never throws. */
export async function topUpOfflineNumbers(tenantId: string): Promise<void> {
  if (topping || remainingOfflineNumbers(tenantId) >= TOP_UP_BELOW) return;
  topping = true;
  try {
    const { data, error } = await supabase.rpc('reserve_offline_numbers', { p_device_id: deviceId(), p_size: BLOCK_SIZE });
    if (error || !data?.block_id) return;
    write(tenantId, [...read(tenantId), {
      block_id: data.block_id, order_from: Number(data.order_from), invoice_from: Number(data.invoice_from), size: Number(data.size), next: 0,
    }]);
  } catch {
    // offline or refused: try again next time
  } finally {
    topping = false;
  }
}

/** The sale time as the server writes it in the QR (whole seconds, UTC). */
export function saleTimestamp(now = Date.now()): string {
  return new Date(Math.floor(now / 1000) * 1000).toISOString();
}
