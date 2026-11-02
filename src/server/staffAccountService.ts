import type { SupabaseClient } from '@supabase/supabase-js';

export interface CreateOrUpdateStaffAccountInput {
  email: string;
  password: string;
  name?: string;
}

export type CreateOrUpdateStaffAccountResult =
  | { ok: true; uid: string; alreadyExisted: boolean }
  | { ok: false; status: 400 | 409; error: string };

/**
 * Creates a Supabase Auth account for a new staff/SaaS-team member -- or,
 * if an account with this email already exists on the project, resets its
 * password to the one just entered instead of silently reusing whatever
 * password the account already had.
 *
 * Without the reset: re-adding (or retrying) an email that already had an
 * Auth account -- e.g. a previous attempt that created the Auth user but
 * failed on a later step -- reported the same "account added with a
 * temporary password" success the admin would get for a brand-new account,
 * while the account's real, active password stayed whatever it was from
 * before. The password handed to the new team member then never worked --
 * this is the root cause of "username or password incorrect" right after
 * being told an account with that password was just created.
 */
export async function createOrUpdateStaffAccount(
  supabaseAdmin: SupabaseClient,
  { email, password, name }: CreateOrUpdateStaffAccountInput,
): Promise<CreateOrUpdateStaffAccountResult> {
  const normalizedEmail = email.toLowerCase();

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: name || '' },
  });

  if (!error) {
    return { ok: true, uid: data.user!.id, alreadyExisted: false };
  }

  const alreadyRegistered = /already been registered|already registered/i.test(error.message || '');
  if (!alreadyRegistered) {
    return { ok: false, status: 400, error: error.message };
  }

  // SECURITY: do NOT use auth.admin.listUsers() here -- it would let any
  // caller enumerate every registered email on the whole platform (and
  // learn other tenants'/SaaS staff's raw Auth UIDs). Only resolve via this
  // app's own `users` mirror table.
  const { data: match } = await supabaseAdmin.from('users').select('id').eq('email', normalizedEmail).maybeSingle();
  if (!match) {
    return { ok: false, status: 409, error: 'email_already_in_use_no_match' };
  }

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(match.id, { password });
  if (updateError) {
    return { ok: false, status: 400, error: updateError.message };
  }

  return { ok: true, uid: match.id, alreadyExisted: true };
}

export type ResetStaffPasswordResult = { ok: true } | { ok: false; status: 400; error: string };

/** Resets an existing staff/SaaS-team member's password via the Admin API (super_admin-only caller, enforced by the route). */
export async function resetStaffPassword(
  supabaseAdmin: SupabaseClient,
  uid: string,
  password: string,
): Promise<ResetStaffPasswordResult> {
  const { error } = await supabaseAdmin.auth.admin.updateUserById(uid, { password });
  if (error) {
    return { ok: false, status: 400, error: error.message };
  }
  return { ok: true };
}
