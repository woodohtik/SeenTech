import { getLastKnown, saveLastKnown } from './lastKnownCache';

/**
 * seen-readiness-fixes-task.md P3.1 (RELIABILITY-01, RELIABILITY-11): what the
 * POS needs to open again after a reload with no network -- the employee's
 * open shift and the shop's tax settings -- kept on the device the last time
 * they were read online.
 *
 * Only a reading aid: every sale still goes through create_pos_sale, which
 * checks the shift on the server when it syncs.
 */

export type CachedShift = {
  id: string;
  tenantId: string;
  branchId?: string | null;
  staffId: string;
  staffName?: string;
  openingBalance: number;
  startTime: string;
  status: 'open';
};

const shiftKey = (staffId: string) => `pos_open_shift:${staffId}`;

export function rememberOpenShift(tenantId: string, staffId: string, shift: CachedShift | null): void {
  saveLastKnown(tenantId, shiftKey(staffId), shift);
}

export function cachedOpenShift(tenantId: string, staffId: string): CachedShift | null {
  const hit = getLastKnown<CachedShift | null>(tenantId, shiftKey(staffId))?.data;
  return hit && hit.id && hit.staffId === staffId && hit.tenantId === tenantId ? hit : null;
}

/** The shop's tax settings as resolveTaxSettings() returns them. */
export function rememberTaxSettings(tenantId: string, settings: unknown): void {
  saveLastKnown(tenantId, 'pos_tax_settings', settings);
}

export function cachedTaxSettings<T = any>(tenantId: string): T | null {
  return getLastKnown<T>(tenantId, 'pos_tax_settings')?.data ?? null;
}
