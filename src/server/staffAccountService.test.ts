import { test, expect, vi } from 'vitest';
import { createOrUpdateStaffAccount, resetStaffPassword } from './staffAccountService';

function buildSupabaseAdmin(overrides: {
  createUser: (args: any) => Promise<{ data: any; error: any }>;
  usersUpsert?: (row: any, opts?: any) => Promise<{ data: any; error: any }>;
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
          upsert: (row: any, opts: any) => (overrides.usersUpsert ? overrides.usersUpsert(row, opts) : Promise.resolve({ data: row, error: null })),
        };
      }
      throw new Error(`buildSupabaseAdmin mock: unexpected table "${table}"`);
    },
  } as any;
}

const REQUESTER = { requesterTenantId: 'tenant-caller', requesterRole: 'owner' };

test('creates a fresh account when the email is unused, and records created_by_tenant_id', async () => {
  const createUser = vi.fn().mockResolvedValue({ data: { user: { id: 'new-uid' } }, error: null });
  const usersUpsert = vi.fn().mockResolvedValue({ data: {}, error: null });
  const supabaseAdmin = buildSupabaseAdmin({ createUser, usersUpsert });

  const result = await createOrUpdateStaffAccount(supabaseAdmin, { email: 'New@Example.com', password: 'secret123', ...REQUESTER });

  expect(result).toEqual({ ok: true, uid: 'new-uid', alreadyExisted: false });
  expect(createUser).toHaveBeenCalledWith(
    expect.objectContaining({ email: 'new@example.com', password: 'secret123', email_confirm: true })
  );
  expect(usersUpsert).toHaveBeenCalledWith(
    { id: 'new-uid', email: 'new@example.com', created_by_tenant_id: 'tenant-caller' },
    { onConflict: 'id' }
  );
});

// SECURITY (status-review-2026-11-17/C-sprint2-4.md item 4, second pass):
// a prior version of this function allowed resetting an already-registered
// account's password when a staff row for that email existed in the
// caller's own tenant with a non-owner/admin role -- which an attacker
// could satisfy themselves, since nothing stopped them from inserting that
// very staff row first (staff INSERT had no role check until this same
// fix's migration). The reset path is removed entirely: every
// already-registered email is now a flat 409, regardless of any staff row,
// role, or caller privilege.
test('SECURITY: an already-registered email always returns 409, never resets the password', async () => {
  const createUser = vi.fn().mockResolvedValue({ data: null, error: { message: 'A user with this email address has already been registered' } });
  const updateUserById = vi.fn();
  const usersUpsert = vi.fn();
  const supabaseAdmin = buildSupabaseAdmin({ createUser, updateUserById, usersUpsert });

  const result = await createOrUpdateStaffAccount(supabaseAdmin, { email: 'existing@example.com', password: 'newpass123', ...REQUESTER });

  expect(result).toMatchObject({ ok: false, status: 409, error: 'email_already_in_use' });
  expect(updateUserById).not.toHaveBeenCalled();
  expect(usersUpsert).not.toHaveBeenCalled();
});

test('SECURITY: 409 holds even when the caller is owner/admin and could otherwise insert a matching staff row themselves', async () => {
  const createUser = vi.fn().mockResolvedValue({ data: null, error: { message: 'already registered' } });
  const updateUserById = vi.fn();
  const supabaseAdmin = buildSupabaseAdmin({ createUser, updateUserById });

  const result = await createOrUpdateStaffAccount(supabaseAdmin, { email: 'owner@othershop.example', password: 'attackerpass', ...REQUESTER });

  expect(result).toMatchObject({ ok: false, status: 409, error: 'email_already_in_use' });
  expect(updateUserById).not.toHaveBeenCalled();
});

test('passes through a non-"already registered" createUser error as a 400', async () => {
  const createUser = vi.fn().mockResolvedValue({ data: null, error: { message: 'Password should be at least 6 characters' } });
  const supabaseAdmin = buildSupabaseAdmin({ createUser });

  const result = await createOrUpdateStaffAccount(supabaseAdmin, { email: 'weak@example.com', password: 'abc', ...REQUESTER });

  // A reason word for the screen; Supabase's own text only in `detail` (for the log).
  expect(result).toEqual({ ok: false, status: 400, error: 'weak_password', detail: 'Password should be at least 6 characters' });
});

test('surfaces a failed users upsert as a 400', async () => {
  const createUser = vi.fn().mockResolvedValue({ data: { user: { id: 'new-uid' } }, error: null });
  const usersUpsert = vi.fn().mockResolvedValue({ data: null, error: { message: 'upsert failed' } });
  const supabaseAdmin = buildSupabaseAdmin({ createUser, usersUpsert });

  const result = await createOrUpdateStaffAccount(supabaseAdmin, { email: 'new2@example.com', password: 'secret123', ...REQUESTER });

  expect(result).toEqual({ ok: false, status: 400, error: 'account_failed', detail: 'upsert failed' });
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

  expect(result).toEqual({ ok: false, status: 400, error: 'account_failed', detail: 'user not found' });
});
