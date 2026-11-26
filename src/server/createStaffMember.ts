import type { CreateOrUpdateStaffAccountInput, CreateOrUpdateStaffAccountResult } from './staffAccountService';
import type { ServerErrorKind } from './userErrors';

/**
 * Makes an employee in one place, on the server
 * (seen-merchant-trial-test-2026-11-26.md, phase 1): the sign-in account and
 * its users row (service role), then the staff row AS THE REQUESTER (their
 * token, so the database's row rules and owner/admin guard still decide).
 * Any step failing after the account removes it again, so a refused or
 * broken attempt never leaves an email taken.
 */

export interface StaffMemberInput {
  email: string;
  password: string;
  name: string;
  phone?: string | null;
  role: string;
  roleId?: string | null;
  branchId?: string | null;
  pinHash?: string | null;
}

export interface Requester { uid: string; tenantId: string; role: string; email?: string | null }

export interface CreateStaffMemberDeps {
  createAccount: (input: CreateOrUpdateStaffAccountInput) => Promise<CreateOrUpdateStaffAccountResult>;
  /** Inserts the staff row with the requester's own client; returns the new id. */
  staffInsert: (row: Record<string, unknown>) => Promise<{ data: { id: string } | null; error: { code?: string; message?: string } | null }>;
  auditInsert: (row: Record<string, unknown>) => Promise<unknown>;
  deleteAuthUser: (uid: string) => Promise<unknown>;
  deleteUsersRow: (uid: string) => Promise<unknown>;
}

export type CreateStaffMemberResult =
  | { ok: true; uid: string; staffId: string }
  | { ok: false; status: 400 | 403 | 409 | 500; kind: ServerErrorKind; reason: string };

/** Never made through this route (the database's guard refuses them too). */
export const RESERVED_ROLES = ['owner', 'super_admin', 'support_tech', 'billing_admin'];

export async function createStaffMember(deps: CreateStaffMemberDeps, input: StaffMemberInput, requester: Requester): Promise<CreateStaffMemberResult> {
  const email = String(input.email || '').trim().toLowerCase();
  const name = String(input.name || '').trim();
  if (!email || !input.password || !name) return { ok: false, status: 400, kind: 'validation', reason: 'missing_fields' };
  if (RESERVED_ROLES.includes(String(input.role))) return { ok: false, status: 403, kind: 'permission', reason: 'role_not_allowed' };

  const account = await deps.createAccount({
    email, password: input.password, name, requesterTenantId: requester.tenantId, requesterRole: requester.role,
  });
  if (account.ok === false) {
    const kind: ServerErrorKind = account.error === 'email_already_in_use' ? 'duplicate_email' : 'validation';
    return { ok: false, status: account.status, kind, reason: account.error };
  }
  const uid = account.uid;

  const rollback = async () => {
    await deps.deleteAuthUser(uid).catch(() => undefined);
    await deps.deleteUsersRow(uid).catch(() => undefined);
  };

  try {
    const { data, error } = await deps.staffInsert({
      uid,
      tenant_id: requester.tenantId,
      name,
      email,
      phone: input.phone ? String(input.phone) : null,
      role: String(input.role || 'cashier'),
      role_id: input.roleId || null,
      branch_id: input.branchId || null,
      status: 'active',
      is_test: false,
      pin_hash: input.pinHash || null,
      must_change_pin: false,
    });
    if (error || !data) {
      await rollback();
      if (error?.code === '42501') return { ok: false, status: 403, kind: 'permission', reason: 'staff_insert_denied' };
      if (error?.code === '23505') return { ok: false, status: 409, kind: 'duplicate_email', reason: 'staff_exists' };
      return { ok: false, status: 500, kind: 'server', reason: 'staff_insert_failed' };
    }

    await deps.auditInsert({
      action: 'إضافة موظف',
      performed_by: requester.uid,
      performed_by_email: requester.email || 'unknown',
      target_tenant_id: requester.tenantId,
      details: `تم إضافة الموظف ${name} بنجاح`,
      occurred_at: new Date().toISOString(),
      type: 'security',
    }).catch(() => undefined);

    return { ok: true, uid, staffId: data.id };
  } catch {
    await rollback();
    return { ok: false, status: 500, kind: 'server', reason: 'staff_insert_failed' };
  }
}
