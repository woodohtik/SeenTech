import { staffRoleForSave } from '../../services/permissionService';

/**
 * Whether the chosen role is saved as a tailor (staff.role = 'tailor') -- the
 * one role that may be a PIN-only employee, with no email or sign-in account
 * (seen-merchant-trial-test-2026-11-26.md, phase 2 item 1).
 */
export function isTailorRole(roleKey: string | null | undefined, roles: { roleKey: string; baseRole?: string | null; base_role?: string | null }[]): boolean {
  if (!roleKey) return false;
  const role = roles.find((r) => r.roleKey === roleKey);
  return staffRoleForSave(roleKey, role ?? null) === 'tailor';
}
