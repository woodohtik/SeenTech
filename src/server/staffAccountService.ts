import type { SupabaseClient } from '@supabase/supabase-js';
import { authAdminErrorKind } from './userErrors';

export interface CreateOrUpdateStaffAccountInput {
  email: string;
  password: string;
  name?: string;
  /** The caller's own tenant (req.user.tenantId) -- the reset-existing-account path is only ever allowed within this tenant. */
  requesterTenantId: string;
  /** The caller's own role (req.user.role) -- only owner/admin may reset an existing account's password via this endpoint. */
  requesterRole: string;
}

export type CreateOrUpdateStaffAccountResult =
  | { ok: true; uid: string; alreadyExisted: boolean }
  | { ok: false; status: 400 | 409; error: string; detail?: string };

/**
 * Creates a Supabase Auth account for a new staff/SaaS-team member.
 *
 * SECURITY (status-review-2026-11-17/C-sprint2-4.md item 4, account
 * takeover -- second pass): an earlier fix here (see git history) tried
 * to scope the "already registered" password-reset path to "a staff row
 * for this email already exists in the caller's own tenant, with a
 * non-owner/admin role". That check is trivially bypassed: `staff` INSERT
 * had no role check at all until 20261127000000_staff_insert_owner_admin_only.sql
 * (same commit as this fix) -- any owner could insert a
 * role='cashier' staff row for the VICTIM's email into their OWN tenant
 * first, which made the "staff row exists in my own tenant, role is not
 * owner/admin" check pass for an email that was never actually theirs,
 * then call this endpoint to overwrite that account's real password.
 *
 * There is no way to make a same-tenant-staff-row check sound against a
 * caller who can freely create staff rows in their own tenant. The reset
 * path is removed entirely instead: an email that is already registered
 * always returns 409, full stop. A legitimate "staff member forgot their
 * password" flow must go through Supabase's own password-recovery email
 * (sent to the account's real inbox, which an attacker does not control)
 * or a future dedicated reset endpoint gated on `users.created_by_tenant_id`
 * (set below, at creation time, and NOT attacker-controlled since it is
 * the authenticated caller's own server-verified tenant) -- never through
 * "add as staff with a new password".
 */
export async function createOrUpdateStaffAccount(
  supabaseAdmin: SupabaseClient,
  { email, password, name, requesterTenantId }: CreateOrUpdateStaffAccountInput,
): Promise<CreateOrUpdateStaffAccountResult> {
  const normalizedEmail = email.toLowerCase();

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: name || '' },
  });

  if (error) {
    // seen-friendly-errors-everywhere-task.md: a reason word for the route,
    // never Supabase Auth's English text (it is logged by the route).
    const { reason } = authAdminErrorKind(error.message);
    if (reason === 'email_already_in_use') {
      return { ok: false, status: 409, error: 'email_already_in_use', detail: error.message };
    }
    return { ok: false, status: 400, error: reason, detail: error.message };
  }

  const uid = data.user!.id;

  // Provenance for a future tenant-scoped reset flow: which tenant's
  // create-account call actually provisioned this Auth account. The
  // client (Login.tsx/Onboarding.tsx/AddEmployeeModal.tsx) upserts its
  // own display_name/phone into `users` afterward -- this write only
  // claims the id/email/created_by_tenant_id, and since `uid` is a
  // brand-new Auth user here, there is no pre-existing row to clobber.
  const { error: usersError } = await supabaseAdmin
    .from('users')
    // seen-merchant-trial-test-2026-11-26.md: the display name here too -- the
    // browser can no longer write another person's users row (RLS, 403),
    // which is what made adding an employee fail for the shop owner.
    .upsert({ id: uid, email: normalizedEmail, display_name: name || null, created_by_tenant_id: requesterTenantId }, { onConflict: 'id' });
  if (usersError) {
    return { ok: false, status: 400, error: 'account_failed', detail: usersError.message };
  }

  return { ok: true, uid, alreadyExisted: false };
}

export type ResetStaffPasswordResult = { ok: true } | { ok: false; status: 400; error: string; detail?: string };

/** Resets an existing staff/SaaS-team member's password via the Admin API (super_admin-only caller, enforced by the route). */
export async function resetStaffPassword(
  supabaseAdmin: SupabaseClient,
  uid: string,
  password: string,
): Promise<ResetStaffPasswordResult> {
  const { error } = await supabaseAdmin.auth.admin.updateUserById(uid, { password });
  if (error) {
    return { ok: false, status: 400, error: authAdminErrorKind(error.message).reason, detail: error.message };
  }
  return { ok: true };
}
