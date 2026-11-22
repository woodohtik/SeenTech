// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// seen-readiness-fixes-task.md P4 (OPERATIONS-06; founder question 5).
const db = vi.hoisted(() => ({ tables: {} as Record<string, any>, rpc: vi.fn() }));
vi.mock('../lib/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const result = { data: db.tables[table] ?? null, error: null };
      const q: any = {
        select: () => q, eq: () => q, order: () => q,
        maybeSingle: async () => ({ data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: null }),
        then: (ok: any, ko: any) => Promise.resolve(result).then(ok, ko),
      };
      return q;
    },
    rpc: db.rpc,
  },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'ar' } }) }));
const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => toasts }));

import OrderEditDialog from './OrderEditDialog';

const order = (over: any = {}) => ({
  id: 'o1', kind: 'tailoring', status: 'measurements_taken', notes: 'قديم', delivery_date: '2026-12-01T09:00:00Z',
  assigned_tailor_id: null, fabric_deducted_at: null, total_amount: 230, paid_amount: 50, ...over,
});
const line = { id: 'l1', garment_type: 'ثوب', quantity: 1, price: 200, fabric_id: 'f1', consumed_meters: 3, measurements: { length: 140 } };

beforeEach(() => {
  db.tables = { orders: order(), order_items: [line], tax_invoices: null, staff: [{ id: 's1', name: 'خياط' }] };
  db.rpc.mockReset().mockResolvedValue({ data: { changed: ['x'] }, error: null });
  toasts.error.mockReset(); toasts.success.mockReset();
});
afterEach(cleanup);

test('before cutting: a new quantity and price go to the server with the reason, the cloth follows the quantity', async () => {
  render(<OrderEditDialog orderId="o1" tenantId="t1" onClose={() => {}} onSaved={() => {}} />);
  const qty = await screen.findByLabelText('orders.edit_quantity');
  fireEvent.change(qty, { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('orders.edit_price'), { target: { value: '150' } });
  fireEvent.click(screen.getByText('orders.edit_save'));
  expect(toasts.error).toHaveBeenCalledWith('orders.edit_reason_required'); // no reason yet
  fireEvent.change(screen.getByPlaceholderText('orders.edit_reason_placeholder'), { target: { value: 'أضاف ثوباً' } });
  fireEvent.click(screen.getByText('orders.edit_save'));
  await waitFor(() => expect(db.rpc).toHaveBeenCalled());
  const [fn, args] = db.rpc.mock.calls[0];
  expect(fn).toBe('update_tailoring_order');
  expect(args.p_reason).toBe('أضاف ثوباً');
  expect(args.p_items).toEqual([expect.objectContaining({ garment_type: 'ثوب', quantity: 2, price: 150, consumed_meters: 6, fabric_id: 'f1', measurements: { length: 140 } })]);
});

test('after cutting the lines are locked; the notes still change, with no items sent', async () => {
  db.tables.orders = order({ fabric_deducted_at: '2026-11-22T08:00:00Z' });
  render(<OrderEditDialog orderId="o1" tenantId="t1" onClose={() => {}} onSaved={() => {}} />);
  expect(await screen.findByText('orders.edit_lines_locked_cut')).toBeTruthy();
  expect((screen.getByLabelText('orders.edit_quantity') as HTMLInputElement).disabled).toBe(true);
  fireEvent.change(screen.getByDisplayValue('قديم'), { target: { value: 'جديد' } });
  fireEvent.click(screen.getByText('orders.edit_save'));
  await waitFor(() => expect(db.rpc).toHaveBeenCalled());
  expect(db.rpc.mock.calls[0][1]).toMatchObject({ p_items: null, p_changes: { notes: 'جديد' } });
});

test('an order with a tax invoice says its amount changes by a credit note', async () => {
  db.tables.tax_invoices = { id: 'inv1' };
  render(<OrderEditDialog orderId="o1" tenantId="t1" onClose={() => {}} onSaved={() => {}} />);
  expect(await screen.findByText('orders.edit_lines_locked_invoice')).toBeTruthy();
});
