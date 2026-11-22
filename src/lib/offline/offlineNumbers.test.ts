// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// seen-readiness-fixes-task.md P3.2 (RELIABILITY-02).
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../supabase/client', () => ({ supabase: { rpc } }));

import { remainingOfflineNumbers, saleTimestamp, takeOfflineNumber, topUpOfflineNumbers } from './offlineNumbers';

beforeEach(() => {
  localStorage.clear();
  rpc.mockReset();
});

describe('reserved offline numbers', () => {
  it('a block is reserved when fewer than five are left, then handed out in order, each once', async () => {
    rpc.mockResolvedValue({ data: { block_id: 'b1', order_from: 1000, invoice_from: 500, size: 3 }, error: null });
    await topUpOfflineNumbers('t1');
    expect(rpc).toHaveBeenCalledWith('reserve_offline_numbers', expect.objectContaining({ p_size: 20 }));
    expect(remainingOfflineNumbers('t1')).toBe(3);
    expect(takeOfflineNumber('t1')).toEqual({ block_id: 'b1', slot: 0, orderNumber: 1000, invoiceNumber: 500 });
    expect(takeOfflineNumber('t1')).toEqual({ block_id: 'b1', slot: 1, orderNumber: 1001, invoiceNumber: 501 });
    expect(takeOfflineNumber('t1')?.slot).toBe(2);
    expect(takeOfflineNumber('t1')).toBeNull(); // none left: the receipt is provisional
  });

  it('no new block while five or more are left; none at all when the server refuses', async () => {
    rpc.mockResolvedValue({ data: { block_id: 'b1', order_from: 1, invoice_from: 1, size: 20 }, error: null });
    await topUpOfflineNumbers('t1');
    await topUpOfflineNumbers('t1');
    expect(rpc).toHaveBeenCalledTimes(1);
    rpc.mockResolvedValue({ data: null, error: { message: 'forbidden' } });
    await topUpOfflineNumbers('t2');
    expect(remainingOfflineNumbers('t2')).toBe(0);
  });

  it("one shop's numbers are not another's", async () => {
    rpc.mockResolvedValue({ data: { block_id: 'b1', order_from: 1, invoice_from: 1, size: 20 }, error: null });
    await topUpOfflineNumbers('t1');
    expect(takeOfflineNumber('t2')).toBeNull();
  });
});

describe('the sale time', () => {
  it('is whole seconds in UTC, the way the server writes it into the QR', () => {
    expect(saleTimestamp(Date.parse('2026-11-22T10:15:30.789Z'))).toBe('2026-11-22T10:15:30.000Z');
  });
});
