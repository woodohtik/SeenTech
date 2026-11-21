// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { offlineDb } from '../lib/offline/db';

// Team review M-9: an operation that failed for good shows what it was and
// why, and can be sent again (never deleted). No network in the test: the
// drain after a retry is a stub.
const drain = vi.hoisted(() => vi.fn(async () => ({ synced: 0, failed: 0 })));
vi.mock('../lib/offline/outbox', async (orig) => ({ ...(await orig<any>()), drainOutbox: drain }));
vi.mock('../lib/offline/stockConflicts', () => ({ getStockConflictCount: async () => 0 }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, d?: string, o?: any) => (d || _k).replace('{{count}}', String(o?.count ?? '')),
    i18n: { language: 'ar' },
  }),
}));
vi.mock('./PriceDisplay', () => ({ PriceDisplay: ({ amount }: { amount: number }) => <span>{amount.toFixed(2)}</span> }));

import OfflineStatusIndicator from './OfflineStatusIndicator';

const REASON = 'المبلغ المدفوع (200) أكبر من إجمالي الطلب (115)';

beforeEach(async () => {
  await offlineDb.outbox.clear();
  await offlineDb.cachedCustomers.clear();
  await offlineDb.cachedCustomers.put({ id: 'c1', name: 'سالم', cachedAt: Date.now() } as any);
  await offlineDb.outbox.put({
    id: 'op-1', type: 'tailoring_order', createdAt: Date.now(), status: 'failed', retries: 5, lastError: REASON,
    payload: { p_operation_id: 'op-1', p_order: { customer_id: 'c1', paid_amount: 200 }, p_items: [] },
  });
});

afterEach(() => {
  cleanup();
  drain.mockClear();
});

test('a failed operation shows its customer, the amount collected and the reason; it can be sent again', async () => {
  render(<OfflineStatusIndicator tenantId="t1" />);
  fireEvent.click(await screen.findByRole('button', { name: /قيد المزامنة/ }));

  expect(await screen.findByText(new RegExp(REASON.replace(/[()]/g, '\\$&')))).toBeTruthy();
  expect(screen.getByText(/سالم/)).toBeTruthy();
  expect(screen.getByText('200.00')).toBeTruthy();
  expect(screen.getByText('طلب تفصيل')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: /إعادة الإرسال/ }));
  await waitFor(() => expect(drain).toHaveBeenCalled());
  expect(await offlineDb.outbox.get('op-1')).toMatchObject({ status: 'pending', retries: 0 });
});
