import { test, expect, vi } from 'vitest';
import { createStaffMember, type CreateStaffMemberDeps } from './createStaffMember';

// seen-merchant-trial-test-2026-11-26.md, phase 1: adding an employee failed
// for the shop owner (the browser's users write got a 403) and left a
// half-made sign-in account, so the next try said "email already used".

const INPUT = {
  email: 'Tailor@Shop.test', password: 'secret123', name: 'خياط', phone: '0500000000',
  role: 'tailor', roleId: null, branchId: 'branch-1', pinHash: null,
};
const REQUESTER = { uid: 'owner-uid', tenantId: 'tenant-1', role: 'owner', email: 'owner@shop.test' };

function deps(over: Partial<{ account: any; staffInsert: any }> = {}) {
  const createAccount = vi.fn().mockResolvedValue(over.account ?? { ok: true, uid: 'new-uid', alreadyExisted: false });
  const staffInsert = vi.fn().mockResolvedValue(over.staffInsert ?? { data: { id: 'staff-1' }, error: null });
  const auditInsert = vi.fn().mockResolvedValue({ error: null });
  const deleteAuthUser = vi.fn().mockResolvedValue({ error: null });
  const deleteUsersRow = vi.fn().mockResolvedValue({ error: null });
  const d: CreateStaffMemberDeps = { createAccount, staffInsert, auditInsert, deleteAuthUser, deleteUsersRow };
  return { d, createAccount, staffInsert, auditInsert, deleteAuthUser, deleteUsersRow };
}

test('the owner adds a tailor: one account, one staff row, the email lower-cased', async () => {
  const m = deps();
  const r = await createStaffMember(m.d, INPUT, REQUESTER);
  expect(r).toEqual({ ok: true, uid: 'new-uid', staffId: 'staff-1' });
  expect(m.createAccount).toHaveBeenCalledWith(expect.objectContaining({ email: 'tailor@shop.test', name: 'خياط', requesterTenantId: 'tenant-1' }));
  expect(m.staffInsert).toHaveBeenCalledWith(expect.objectContaining({ uid: 'new-uid', tenant_id: 'tenant-1', role: 'tailor', email: 'tailor@shop.test', status: 'active' }));
  expect(m.deleteAuthUser).not.toHaveBeenCalled();
});

test('a refused staff row (no permission) removes the sign-in account just made -- no email is left taken', async () => {
  const m = deps({ staffInsert: { data: null, error: { code: '42501', message: 'permission denied' } } });
  const r = await createStaffMember(m.d, INPUT, REQUESTER);
  expect(r).toEqual({ ok: false, status: 403, kind: 'permission', reason: 'staff_insert_denied' });
  expect(m.deleteAuthUser).toHaveBeenCalledWith('new-uid');
  expect(m.deleteUsersRow).toHaveBeenCalledWith('new-uid');
});

test('any other failure after the account also rolls it back', async () => {
  const m = deps();
  m.staffInsert.mockRejectedValue(new Error('network'));
  const r = await createStaffMember(m.d, INPUT, REQUESTER);
  expect(r.ok).toBe(false);
  expect(m.deleteAuthUser).toHaveBeenCalledWith('new-uid');
});

test('an email already registered is refused before anything is made, and nothing is deleted', async () => {
  const m = deps({ account: { ok: false, status: 409, error: 'email_already_in_use' } });
  const r = await createStaffMember(m.d, INPUT, REQUESTER);
  expect(r).toMatchObject({ ok: false, status: 409 });
  expect(m.staffInsert).not.toHaveBeenCalled();
  expect(m.deleteAuthUser).not.toHaveBeenCalled();
});

test('the reserved roles are never made here', async () => {
  for (const role of ['owner', 'super_admin', 'support_tech', 'billing_admin']) {
    const m = deps();
    const r = await createStaffMember(m.d, { ...INPUT, role }, REQUESTER);
    expect(r).toMatchObject({ ok: false, status: 403, kind: 'permission' });
    expect(m.createAccount).not.toHaveBeenCalled();
  }
});

test('missing name, email or password is a validation refusal', async () => {
  const m = deps();
  expect(await createStaffMember(m.d, { ...INPUT, name: ' ' }, REQUESTER)).toMatchObject({ ok: false, status: 400, kind: 'validation' });
  expect(m.createAccount).not.toHaveBeenCalled();
});

// Phase 2 item 1 (question 1's default): a PIN-only tailor -- no email, no
// sign-in account; the commission is saved with them.
test('a tailor with no email gets no sign-in account, only a staff row with their PIN and commission', async () => {
  const m = deps();
  const r = await createStaffMember(m.d, { ...INPUT, email: '', password: '', pinHash: 'pin-hash', commissionType: 'percentage', commissionValue: 10 }, REQUESTER);
  expect(r).toEqual({ ok: true, uid: null, staffId: 'staff-1' });
  expect(m.createAccount).not.toHaveBeenCalled();
  expect(m.staffInsert).toHaveBeenCalledWith(expect.objectContaining({ uid: null, email: null, role: 'tailor', pin_hash: 'pin-hash', commission_type: 'percentage', commission_value: 10 }));
});

test('a PIN-only employee needs a PIN, and only a tailor may be one', async () => {
  const noPin = deps();
  expect(await createStaffMember(noPin.d, { ...INPUT, email: '', password: '', pinHash: null }, REQUESTER)).toMatchObject({ ok: false, status: 400, reason: 'pin_required' });
  const cashier = deps();
  expect(await createStaffMember(cashier.d, { ...INPUT, role: 'cashier', email: '', password: '', pinHash: 'h' }, REQUESTER)).toMatchObject({ ok: false, status: 400, reason: 'email_required' });
  expect(noPin.staffInsert).not.toHaveBeenCalled();
  expect(cashier.staffInsert).not.toHaveBeenCalled();
});

test('a bad commission is refused', async () => {
  const m = deps();
  expect(await createStaffMember(m.d, { ...INPUT, commissionType: 'percentage', commissionValue: 150 }, REQUESTER)).toMatchObject({ ok: false, status: 400, reason: 'commission_invalid' });
  expect(await createStaffMember(m.d, { ...INPUT, commissionType: 'fixed_amount', commissionValue: -5 }, REQUESTER)).toMatchObject({ ok: false, status: 400, reason: 'commission_invalid' });
});
