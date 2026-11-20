import { beforeEach, expect, test, vi } from 'vitest';

const rpc = vi.fn();
const counts: Record<string, number> = {};
const from = vi.fn((table: string) => ({
  select: () => ({ eq: () => Promise.resolve({ count: counts[table] ?? 0, error: null }) }),
}));
vi.mock('../lib/supabase/client', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: (t: string) => from(t) } }));
vi.mock('../lib/tenantRow', () => ({ readTenantRow: vi.fn() }));
vi.mock('./useRealtimeSync', () => ({ useRealtimeSync: vi.fn() }));

import { readSetupProgress } from './useSetupChecklist';

beforeEach(() => {
  rpc.mockReset();
  from.mockClear();
  for (const k of Object.keys(counts)) delete counts[k];
});

test('one request answers all four questions', async () => {
  rpc.mockResolvedValue({ data: { has_stock: true, has_customers: true, has_orders: false, has_invoices: false }, error: null });
  expect(await readSetupProgress('t1')).toEqual({ has_stock: true, has_customers: true, has_orders: false, has_invoices: false });
  expect(rpc).toHaveBeenCalledWith('get_setup_progress', { p_tenant_id: 't1' });
  expect(from).not.toHaveBeenCalled();
});

test('where the function is not deployed, the four counts give the same answers', async () => {
  rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'not found' } });
  counts.inventory_items = 3;
  counts.orders = 1;
  expect(await readSetupProgress('t1')).toEqual({ has_stock: true, has_customers: false, has_orders: true, has_invoices: false });
  expect(from).toHaveBeenCalledTimes(4);
});

test('any other error is reported, not read as "nothing done yet"', async () => {
  rpc.mockResolvedValue({ data: null, error: { code: '08006', message: 'network' } });
  await expect(readSetupProgress('t1')).rejects.toMatchObject({ code: '08006' });
  expect(from).not.toHaveBeenCalled();
});
