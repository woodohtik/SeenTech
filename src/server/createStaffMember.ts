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
  /** Phase 2 item 1 / question 3: the tailor's commission, per piece or as a share. */
  commissionType?: 'percentage' | 'fixed_amount' | null;
  commissionValue?: number | null;
}

/** The only role that may be a PIN-only employee, with no email or sign-in account. */
export const PIN_ONLY_ROLES = ['tailor'];

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
  | { ok: true; uid: string | null; staffId: string }
  | { ok: false; status: 400 | 403 | 409 | 500; kind: ServerErrorKind; reason: string };

/** Never made through this route (the database's guard refuses them too). */
export const RESERVED_ROLES = ['owner', 'super_admin', 'support_tech', 'billing_admin'];

export async function createStaffMember(deps: CreateStaffMemberDeps, input: StaffMemberInput, requester: Requester): Promise<CreateStaffMemberResult> {
  const email = String(input.email || '').trim().toLowerCase();
  const name = String(input.name || '').trim();
  const role = String(input.role || 'cashier');
  if (!name) return { ok: false, status: 400, kind: 'validation', reason: 'missing_fields' };
  if (RESERVED_ROLES.includes(role)) return { ok: false, status: 403, kind: 'permission', reason: 'role_not_allowed' };

  // No email: a PIN-only tailor (question 1's default) -- no sign-in account.
  const pinOnly = !email;
  if (pinOnly && !PIN_ONLY_ROLES.includes(role)) return { ok: false, status: 400, kind: 'validation', reason: 'email_required' };
  if (pinOnly && !input.pinHash) return { ok: false, status: 400, kind: 'validation', reason: 'pin_required' };
  if (!pinOnly && !input.password) return { ok: false, status: 400, kind: 'validation', reason: 'missing_fields' };

  const commissionType = input.commissionType || null;
  const commissionValue = input.commissionValue === undefined || input.commissionValue === null || (input.commissionValue as unknown) === '' ? null : Number(input.commissionValue);
  if (commissionType && !['percentage', 'fixed_amount'].includes(commissionType)) return { ok: false, status: 400, kind: 'validation', reason: 'commission_invalid' };
  if (commissionValue !== null && (!Number.isFinite(commissionValue) || commissionValue < 0 || (commissionType === 'percentage' && commissionValue > 100))) {
    return { ok: false, status: 400, kind: 'validation', reason: 'commission_invalid' };
  }

  let uid: string | null = null;
  if (!pinOnly) {
    const account = await deps.createAccount({
      email, password: input.password, name, requesterTenantId: requester.tenantId, requesterRole: requester.role,
    });
    if (account.ok === false) {
      const kind: ServerErrorKind = account.error === 'email_already_in_use' ? 'duplicate_email' : 'validation';
      return { ok: false, status: account.status, kind, reason: account.error };
    }
    uid = account.uid;
  }

  const rollback = async () => {
    if (!uid) return;
    await deps.deleteAuthUser(uid).catch(() => undefined);
    await deps.deleteUsersRow(uid).catch(() => undefined);
  };

  try {
    const { data, error } = await deps.staffInsert({
      uid,
      tenant_id: requester.tenantId,
      name,
      email: email || null,
      phone: input.phone ? String(input.phone) : null,
      role,
      role_id: input.roleId || null,
      branch_id: input.branchId || null,
      status: 'active',
      is_test: false,
      pin_hash: input.pinHash || null,
      must_change_pin: false,
      ...(commissionType ? { commission_type: commissionType, commission_value: commissionValue ?? 0 } : {}),
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
