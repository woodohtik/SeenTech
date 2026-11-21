import { beforeEach, describe, expect, test, vi } from 'vitest';

// A tiny stand-in for the Supabase query builder: rows per table, filtered by eq/is.
const db: Record<string, Array<Record<string, any>>> = { roles: [], user_permission_overrides: [], saas_users: [] };
function builder(table: string) {
  const filters: Array<(r: Record<string, any>) => boolean> = [];
  const b: any = {
    select: () => b,
    eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return b; },
    is: (col: string, val: unknown) => { filters.push((r) => (r[col] ?? null) === val); return b; },
    maybeSingle: async () => ({ data: db[table].filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null }),
    single: async () => ({ data: db[table].filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null }),
  };
  return b;
}
vi.mock('../lib/supabase/client', () => ({ supabase: { from: (t: string) => builder(t) } }));

import { getEffectivePermissions } from './permissionService';
import type { Staff } from '../types';

const staff = (extra: Partial<Staff> & Record<string, any>): Staff =>
  ({ id: 's1', name: 'x', email: 'x@example.invalid', phone: '', role: 'cashier', status: 'active', tenantId: 't1', createdAt: '', ...extra }) as Staff;

beforeEach(() => {
  db.roles = []; db.user_permission_overrides = [];
  try { localStorage.clear(); } catch { /* no storage in this environment */ }
});

// seen-permissions-fix-task.md Phase 1: the UI decides in the server's order.
describe('getEffectivePermissions', () => {
  test("a custom role (role_id) decides, not the base role's row", async () => {
    db.roles = [
      { id: 'r-custom', tenant_id: 't1', role_key: 'custom_senior', permissions: { 'action.refund': true } },
      { id: 'r-cashier', tenant_id: 't1', role_key: 'cashier', permissions: { 'action.refund': false, 'action.discount': false } },
    ];
    const p = await getEffectivePermissions(staff({ role: 'cashier' as any, roleId: 'r-custom' }));
    expect(p['action.refund']).toBe(true);
    // Keys the custom role does not mention keep the base role's defaults.
    expect(p['action.discount']).toBe(true);
    expect(p['payments.collect']).toBe(true);
  });

  test("without role_id, the shop's row for the role is used (the settings screen's edit)", async () => {
    db.roles = [{ id: 'r-cashier', tenant_id: 't1', role_key: 'cashier', permissions: { 'action.refund': true } }];
    const p = await getEffectivePermissions(staff({ role: 'cashier' as any }));
    expect(p['action.refund']).toBe(true);
    expect(p['orders.create']).toBe(true);
  });

  test('a personal override wins', async () => {
    db.user_permission_overrides = [{ staff_id: 's1', overrides: { 'payments.collect': false } }];
    const p = await getEffectivePermissions(staff({ role: 'cashier' as any }));
    expect(p['payments.collect']).toBe(false);
  });

  test('the owner gets everything', async () => {
    const p = await getEffectivePermissions(staff({ role: 'owner' as any }));
    expect(Object.values(p).every(Boolean)).toBe(true);
  });
});
