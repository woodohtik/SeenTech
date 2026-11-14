import { test, expect, vi } from 'vitest';
import { createOrUpdateStaffAccount, resetStaffPassword } from './staffAccountService';

function buildSupabaseAdmin(overrides: {
  createUser: (args: any) => Promise<{ data: any; error: any }>;
  usersLookup?: (email: string) => Promise<{ data: any }>;
  staffLookup?: (tenantId: string, email: string) => Promise<{ data: any }>;
  saasUsersLookup?: (uid: string) => Promise<{ data: any }>;
  updateUserById?: (uid: string, attrs: any) => Promise<{ data: any; error: any }>;
}) {
  return {
    auth: {
      admin: {
        createUser: overrides.createUser,
        updateUserById: overrides.updateUserById || vi.fn().mockResolvedValue({ data: {}, error: null }),
      },
    },
    from: (table: string) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: (_col: string, email: string) => ({
              maybeSingle: () => (overrides.usersLookup ? overrides.usersLookup(email) : Promise.resolve({ data: null })),
            }),
          }),
        };
      }
      if (table === 'staff') {
        return {
          select: () => ({
            eq: (_col1: string, tenantId: string) => ({
              eq: (_col2: string, email: string) => ({
                maybeSingle: () => (overrides.staffLookup ? overrides.staffLookup(tenantId, email) : Promise.resolve({ data: null })),
              }),
            }),
          }),
        };
      }
      if (table === 'saas_users') {
        return {
          select: () => ({
            eq: (_col: string, uid: string) => ({
              maybeSingle: () => (overrides.saasUsersLookup ? overrides.saasUsersLookup(uid) : Promise.resolve({ data: null })),
            }),
          }),
        };
      }
      throw new Error(`buildSupabaseAdmin mock: unexpected table "${table}"`);
    },
  } as any;
}

const REQUESTER = { requesterTenantId: 'tenant-caller', requesterRole: 'owner' };

test('creates a fresh account when the email is unused', async () => {
  const createUser = vi.fn().mockResolvedValue({ data: { user: { id: 'new-uid' } }, error: null });
  const updateUserById = vi.fn();
  const supabaseAdmin = buildSupabaseAdmin({ createUser, updateUserById });

  const result = await createOrUpdateStaffAccount(supabaseAdmin, { email: 'New@Example.com', password: 'secret123', ...REQUESTER });

  expect(result).toEqual({ ok: true, uid: 'new-uid', alreadyExisted: false });
  expect(createUser).toHaveBeenCalledWith(
    expect.objectContaining({ email: 'new@example.com', password: 'secret123', email_confirm: true })
  );
  expect(updateUserById).not.toHaveBeenCalled();
});

test('resets the password when a non-owner/admin staff row for this email exists in the caller\'s own tenant and the caller is owner/admin', async () => {
  const createUser = vi.fn().mockResolvedValue({ data: null, error: { message: 'A user with this email address has already been registered' } });
  const updateUserById = vi.fn().mockResolvedValue({ data: {}, error: null });
  const supabaseAdmin = buildSupabaseAdmin({
    createUser,
    updateUserById,
    usersLookup: () => Promise.resolve({ data: { id: 'existing-uid' } }),
    staffLookup: () => Promise.resolve({ data: { role: 'cashier' } }),
    saasUsersLookup: () => Promise.resolve({ data: null }),
  });

  const result = await createOrUpdateStaffAccount(supabaseAdmin, { email: 'existing@example.com', password: 'newpass123', ...REQUESTER });

  expect(updateUserById).toHaveBeenCalledWith('existing-uid', { password: 'newpass123' });
  expect(result).toEqual({ ok: true, uid: 'existing-uid', alreadyExisted: true });
});

test('SECURITY: refuses to reset the password of another tenant\'s owner (no staff row for this email in the caller\'s own tenant)', async () => {
  const createUser = vi.fn().mockResolvedValue({ data: null, error: { message: 'already been registered' } });
  const updateUserById = vi.fn();
  const supabaseAdmin = buildSupabaseAdmin({
    createUser,
    updateUserById,
    usersLookup: () => Promise.resolve({ data: { id: 'other-tenant-owner-uid' } }),
    staffLookup: () => Promise.resolve({ data: null }), // no staff row for this email in the caller's tenant
    saasUsersLookup: () => Promise.resolve({ data: null }),
  });

  const result = await createOrUpdateStaffAccount(supabaseAdmin, { email: 'owner@othershop.example', password: 'attackerpass', ...REQUESTER });

  expect(result).toEqual({ ok: false, status: 409, error: 'email_belongs_to_another_account' });
  expect(updateUserById).not.toHaveBeenCalled();
});

test('SECURITY: refuses to reset the password of a super_admin / saas_users account, even with a matching staff row', async () => {
  const createUser = vi.fn().mockResolvedValue({ data: null, error: { message: 'already been registered' } });
  const updateUserById = vi.fn();
  const supabaseAdmin = buildSupabaseAdmin({
    createUser,
    updateUserById,
    usersLookup: () => Promise.resolve({ data: { id: 'super-admin-uid' } }),
    staffLookup: () => Promise.resolve({ data: { role: 'cashier' } }),
    saasUsersLookup: () => Promise.resolve({ data: { uid: 'super-admin-uid' } }),
  });

  const result = await createOrUpdateStaffAccount(supabaseAdmin, { email: 'superadmin@seentech.io', password: 'attackerpass', ...REQUESTER });

  expect(result).toEqual({ ok: false, status: 409, error: 'email_belongs_to_another_account' });
  expect(updateUserById).not.toHaveBeenCalled();
});

test('SECURITY: refuses to reset another owner/admin\'s password even within the same tenant', async () => {
  const createUser = vi.fn().mockResolvedValue({ data: null, error: { message: 'already been registered' } });
  const updateUserById = vi.fn();
  const supabaseAdmin = buildSupabaseAdmin({
    createUser,
    updateUserById,
    usersLookup: () => Promise.resolve({ data: { id: 'co-owner-uid' } }),
    staffLookup: () => Promise.resolve({ data: { role: 'owner' } }),
    saasUsersLookup: () => Promise.resolve({ data: null }),
  });

  const result = await createOrUpdateStaffAccount(supabaseAdmin, { email: 'coowner@sameshop.example', password: 'attackerpass', ...REQUESTER });

  expect(result).toEqual({ ok: false, status: 409, error: 'email_belongs_to_another_account' });
  expect(updateUserById).not.toHaveBeenCalled();
});

test('SECURITY: a manager caller cannot reset an existing account\'s password, even for a same-tenant cashier', async () => {
  const createUser = vi.fn().mockResolvedValue({ data: null, error: { message: 'already been registered' } });
  const updateUserById = vi.fn();
  const supabaseAdmin = buildSupabaseAdmin({
    createUser,
    updateUserById,
    usersLookup: () => Promise.resolve({ data: { id: 'existing-uid' } }),
    staffLookup: () => Promise.resolve({ data: { role: 'cashier' } }),
    saasUsersLookup: () => Promise.resolve({ data: null }),
  });

  const result = await createOrUpdateStaffAccount(supabaseAdmin, {
    email: 'existing@example.com',
    password: 'newpass123',
    requesterTenantId: 'tenant-caller',
    requesterRole: 'manager',
  });

  expect(result).toEqual({ ok: false, status: 409, error: 'email_belongs_to_another_account' });
  expect(updateUserById).not.toHaveBeenCalled();
});

test('fails with 409 when the email is registered in Auth but has no matching users row', async () => {
  const createUser = vi.fn().mockResolvedValue({ data: null, error: { message: 'already been registered' } });
  const updateUserById = vi.fn();
  const supabaseAdmin = buildSupabaseAdmin({
    createUser,
    updateUserById,
    usersLookup: () => Promise.resolve({ data: null }),
  });

  const result = await createOrUpdateStaffAccount(supabaseAdmin, { email: 'orphan@example.com', password: 'newpass123', ...REQUESTER });

  expect(result).toEqual({ ok: false, status: 409, error: 'email_already_in_use_no_match' });
  expect(updateUserById).not.toHaveBeenCalled();
});

test('passes through a non-"already registered" createUser error as a 400', async () => {
  const createUser = vi.fn().mockResolvedValue({ data: null, error: { message: 'Password should be at least 6 characters' } });
  const supabaseAdmin = buildSupabaseAdmin({ createUser });

  const result = await createOrUpdateStaffAccount(supabaseAdmin, { email: 'weak@example.com', password: 'abc', ...REQUESTER });

  expect(result).toEqual({ ok: false, status: 400, error: 'Password should be at least 6 characters' });
});

test('surfaces a failed password reset on the already-existed path as a 400', async () => {
  const createUser = vi.fn().mockResolvedValue({ data: null, error: { message: 'already been registered' } });
  const updateUserById = vi.fn().mockResolvedValue({ data: null, error: { message: 'update failed' } });
  const supabaseAdmin = buildSupabaseAdmin({
    createUser,
    updateUserById,
    usersLookup: () => Promise.resolve({ data: { id: 'existing-uid' } }),
    staffLookup: () => Promise.resolve({ data: { role: 'cashier' } }),
    saasUsersLookup: () => Promise.resolve({ data: null }),
  });

  const result = await createOrUpdateStaffAccount(supabaseAdmin, { email: 'existing@example.com', password: 'newpass123', ...REQUESTER });

  expect(result).toEqual({ ok: false, status: 400, error: 'update failed' });
});

test('resetStaffPassword updates the account password and returns ok', async () => {
  const updateUserById = vi.fn().mockResolvedValue({ data: {}, error: null });
  const supabaseAdmin = buildSupabaseAdmin({ createUser: vi.fn(), updateUserById });

  const result = await resetStaffPassword(supabaseAdmin, 'member-uid', 'brandnewpass');

  expect(updateUserById).toHaveBeenCalledWith('member-uid', { password: 'brandnewpass' });
  expect(result).toEqual({ ok: true });
});

test('resetStaffPassword surfaces an Admin API failure as a 400', async () => {
  const updateUserById = vi.fn().mockResolvedValue({ data: null, error: { message: 'user not found' } });
  const supabaseAdmin = buildSupabaseAdmin({ createUser: vi.fn(), updateUserById });

  const result = await resetStaffPassword(supabaseAdmin, 'missing-uid', 'brandnewpass');

  expect(result).toEqual({ ok: false, status: 400, error: 'user not found' });
});
