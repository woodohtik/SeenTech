import { test, expect, vi } from 'vitest';
import { createOrUpdateStaffAccount } from './staffAccountService';

function buildSupabaseAdmin(overrides: {
  createUser: (args: any) => Promise<{ data: any; error: any }>;
  usersLookup?: (email: string) => Promise<{ data: any }>;
  updateUserById?: (uid: string, attrs: any) => Promise<{ data: any; error: any }>;
}) {
  return {
    auth: {
      admin: {
        createUser: overrides.createUser,
        updateUserById: overrides.updateUserById || vi.fn().mockResolvedValue({ data: {}, error: null }),
      },
    },
    from: () => ({
      select: () => ({
        eq: (_col: string, email: string) => ({
          maybeSingle: () => (overrides.usersLookup ? overrides.usersLookup(email) : Promise.resolve({ data: null })),
        }),
      }),
    }),
  } as any;
}

test('creates a fresh account when the email is unused', async () => {
  const createUser = vi.fn().mockResolvedValue({ data: { user: { id: 'new-uid' } }, error: null });
  const updateUserById = vi.fn();
  const supabaseAdmin = buildSupabaseAdmin({ createUser, updateUserById });

  const result = await createOrUpdateStaffAccount(supabaseAdmin, { email: 'New@Example.com', password: 'secret123' });

  expect(result).toEqual({ ok: true, uid: 'new-uid', alreadyExisted: false });
  expect(createUser).toHaveBeenCalledWith(
    expect.objectContaining({ email: 'new@example.com', password: 'secret123', email_confirm: true })
  );
  expect(updateUserById).not.toHaveBeenCalled();
});

test('resets the password on the existing account when the email is already registered and a matching users row exists', async () => {
  const createUser = vi.fn().mockResolvedValue({ data: null, error: { message: 'A user with this email address has already been registered' } });
  const updateUserById = vi.fn().mockResolvedValue({ data: {}, error: null });
  const supabaseAdmin = buildSupabaseAdmin({
    createUser,
    updateUserById,
    usersLookup: () => Promise.resolve({ data: { id: 'existing-uid' } }),
  });

  const result = await createOrUpdateStaffAccount(supabaseAdmin, { email: 'existing@example.com', password: 'newpass123' });

  expect(updateUserById).toHaveBeenCalledWith('existing-uid', { password: 'newpass123' });
  expect(result).toEqual({ ok: true, uid: 'existing-uid', alreadyExisted: true });
});

test('fails with 409 when the email is registered in Auth but has no matching users row', async () => {
  const createUser = vi.fn().mockResolvedValue({ data: null, error: { message: 'already been registered' } });
  const updateUserById = vi.fn();
  const supabaseAdmin = buildSupabaseAdmin({
    createUser,
    updateUserById,
    usersLookup: () => Promise.resolve({ data: null }),
  });

  const result = await createOrUpdateStaffAccount(supabaseAdmin, { email: 'orphan@example.com', password: 'newpass123' });

  expect(result).toEqual({ ok: false, status: 409, error: 'email_already_in_use_no_match' });
  expect(updateUserById).not.toHaveBeenCalled();
});

test('passes through a non-"already registered" createUser error as a 400', async () => {
  const createUser = vi.fn().mockResolvedValue({ data: null, error: { message: 'Password should be at least 6 characters' } });
  const supabaseAdmin = buildSupabaseAdmin({ createUser });

  const result = await createOrUpdateStaffAccount(supabaseAdmin, { email: 'weak@example.com', password: 'abc' });

  expect(result).toEqual({ ok: false, status: 400, error: 'Password should be at least 6 characters' });
});

test('surfaces a failed password reset on the already-existed path as a 400', async () => {
  const createUser = vi.fn().mockResolvedValue({ data: null, error: { message: 'already been registered' } });
  const updateUserById = vi.fn().mockResolvedValue({ data: null, error: { message: 'update failed' } });
  const supabaseAdmin = buildSupabaseAdmin({
    createUser,
    updateUserById,
    usersLookup: () => Promise.resolve({ data: { id: 'existing-uid' } }),
  });

  const result = await createOrUpdateStaffAccount(supabaseAdmin, { email: 'existing@example.com', password: 'newpass123' });

  expect(result).toEqual({ ok: false, status: 400, error: 'update failed' });
});
