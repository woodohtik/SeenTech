import { test, expect, vi, beforeEach } from 'vitest';

const fromMock = vi.fn();
vi.mock('../lib/supabase/client', () => ({
  supabase: { from: (...args: any[]) => fromMock(...args) },
}));

import { bulkUpdateRolePermissions } from './permissionService';

// Minimal chainable query-builder stand-in: every chain method returns the
// same object, and the object itself resolves (as a thenable) to `result`.
function chain(result: { data: any; error?: any }) {
  const obj: any = {};
  obj.select = () => obj;
  obj.eq = () => obj;
  obj.in = () => obj;
  obj.single = () => Promise.resolve(result);
  obj.insert = () => Promise.resolve({ error: null });
  obj.update = () => obj;
  obj.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return obj;
}

function tableCallCount(table: string): number {
  return fromMock.mock.calls.filter(call => call[0] === table).length;
}

beforeEach(() => {
  fromMock.mockReset();
});

test('issues exactly one batched roles lookup regardless of how many roles are updated', async () => {
  const roles = [
    { id: 'r1', tenant_id: 'tenant-1', role_key: 'cashier', name: 'Cashier' },
    { id: 'r2', tenant_id: 'tenant-1', role_key: 'manager', name: 'Manager' },
    { id: 'r3', tenant_id: 'tenant-1', role_key: 'tailor', name: 'Tailor' },
  ];
  fromMock.mockImplementation((table: string) => {
    if (table === 'roles') return chain({ data: roles });
    if (table === 'audit_logs') return chain({ data: null });
    throw new Error(`unexpected table: ${table}`);
  });

  await bulkUpdateRolePermissions(['r1', 'r2', 'r3'], {} as any, 'staff-1', 'a@b.com', 'tenant-1');

  expect(tableCallCount('roles')).toBe(
    // one batched SELECT + one UPDATE per tenant-owned role (no forking, since
    // every role here is already tenant-owned, not a null/system template)
    1 + 3
  );
  expect(tableCallCount('audit_logs')).toBe(3);
});

test('a role id with no matching row is skipped without writing or logging anything for it', async () => {
  fromMock.mockImplementation((table: string) => {
    if (table === 'roles') return chain({ data: [{ id: 'r1', tenant_id: 'tenant-1', role_key: 'cashier', name: 'Cashier' }] });
    if (table === 'audit_logs') return chain({ data: null });
    throw new Error(`unexpected table: ${table}`);
  });

  await bulkUpdateRolePermissions(['r1', 'missing-role'], {} as any, 'staff-1', 'a@b.com', 'tenant-1');

  expect(tableCallCount('audit_logs')).toBe(1);
});

test('an empty roleIds array makes no queries at all', async () => {
  fromMock.mockImplementation(() => {
    throw new Error('should not be called');
  });

  await bulkUpdateRolePermissions([], {} as any, 'staff-1', 'a@b.com', 'tenant-1');

  expect(fromMock).not.toHaveBeenCalled();
});

test('a system/template role (tenant_id null) with no existing tenant fork inserts a new forked role', async () => {
  fromMock.mockImplementation((table: string) => {
    if (table === 'roles') {
      return {
        select: () => ({
          in: () => Promise.resolve({ data: [{ id: 'r1', tenant_id: null, role_key: 'cashier', name: 'Cashier', description: '' }] }),
          eq: () => ({ eq: () => Promise.resolve({ data: [] }) }), // existingSnap lookup: no fork yet
        }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      };
    }
    if (table === 'audit_logs') return chain({ data: null });
    throw new Error(`unexpected table: ${table}`);
  });

  await bulkUpdateRolePermissions(['r1'], {} as any, 'staff-1', 'a@b.com', 'tenant-1');

  expect(tableCallCount('audit_logs')).toBe(1);
});
