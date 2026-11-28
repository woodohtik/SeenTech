import { describe, expect, test, vi } from 'vitest';

vi.mock('../supabase-admin.ts', () => ({ supabaseAdmin: {} }));

import { hasPermission, requirePermission, taxFingerprint } from './requirePermission';

// seen-permissions-fix-task.md Phase 3.
const req = (user: Record<string, unknown>) => ({ user } as any);
function res() {
  const r: any = { statusCode: 200, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  return r;
}
const maps: Record<string, Record<string, boolean>> = {
  manager: { 'settings.view': true, 'settings.edit': true, 'settings.tax': false, 'staff.create': true },
  accountant: { 'settings.tax': true },
  branch: { 'staff.create': true },
};
const load = async (staffId: string) => maps[staffId] ?? {};

describe('requirePermission', () => {
  test('the employee the request is for decides, by their own map', async () => {
    for (const [user, key, allowed] of [
      [{ role: 'manager', staffId: 'manager' }, 'settings.edit', true],
      [{ role: 'manager', staffId: 'manager' }, 'settings.tax', false],
      [{ role: 'accountant', staffId: 'accountant' }, 'settings.tax', true],
      [{ role: 'branch_manager', staffId: 'branch' }, 'staff.create', true],
      [{ role: 'cashier', staffId: 'nobody' }, 'settings.view', false],
    ] as const) {
      const r = res(); let passed = false;
      await requirePermission(key, { load })(req(user), r, () => { passed = true; });
      expect(passed, `${user.role} ${key}`).toBe(allowed);
      if (!allowed) expect(r.statusCode).toBe(403);
    }
  });

  test('the owner and the platform admin pass; no staff id is refused', async () => {
    expect(await hasPermission(req({ role: 'owner', staffId: 'x' }), 'settings.tax', load)).toBe(true);
    expect(await hasPermission(req({ role: 'super_admin' }), 'settings.tax', load)).toBe(true);
    expect(await hasPermission(req({ role: 'manager' }), 'settings.view', load)).toBe(false);
  });

  test('anyOf', async () => {
    const r = res(); let passed = false;
    await requirePermission(['settings.tax', 'staff.create'], { anyOf: true, load })(req({ role: 'x', staffId: 'branch' }), r, () => { passed = true; });
    expect(passed).toBe(true);
  });

  test('a failed lookup is a 500, never a pass', async () => {
    const r = res(); let passed = false;
    await requirePermission('settings.view', { load: async () => { throw new Error('db down'); } })(req({ role: 'manager', staffId: 'm' }), r, () => { passed = true; });
    expect(passed).toBe(false);
    expect(r.statusCode).toBe(500);
  });
});

describe('taxFingerprint (what counts as changing the tax settings)', () => {
  const stored = { vat_number: '300000000000003', is_tax_enabled: true, default_tax_rate: 15, tax_settings: { enabled: true, trn: '300000000000003', vatRate: 15, legalName: 'محل', notificationSettings: { lowStock: true } } };

  test('saving the profile with the tax fields as loaded is not a change', () => {
    const written = { vat_number: '300000000000003', is_tax_enabled: true, default_tax_rate: 15, tax_settings: { enabled: true, trn: '300000000000003', vatRate: 15, legalName: 'محل', tailoringTaxType: 'exclusive', notificationSettings: { lowStock: false } } };
    expect(taxFingerprint(written)).toBe(taxFingerprint(stored));
  });

  test('an empty TRN and a missing one are the same; missing JSON keys mirror the columns', () => {
    expect(taxFingerprint({ vat_number: null, is_tax_enabled: false, default_tax_rate: 15, tax_settings: {} }))
      .toBe(taxFingerprint({ vat_number: '', is_tax_enabled: false, default_tax_rate: 15, tax_settings: { enabled: false, trn: '', vatRate: 15 } }));
  });

  test('the number, the rate, enabling and the tax type are changes', () => {
    const base = taxFingerprint(stored);
    expect(taxFingerprint({ ...stored, vat_number: '300000000000011' })).not.toBe(base);
    expect(taxFingerprint({ ...stored, default_tax_rate: 5 })).not.toBe(base);
    expect(taxFingerprint({ ...stored, is_tax_enabled: false })).not.toBe(base);
    expect(taxFingerprint({ ...stored, tax_settings: { ...stored.tax_settings, tailoringTaxType: 'inclusive' } })).not.toBe(base);
  });
});

// Security audit 2026-11-22 S-09: the string "false" is a change to the tax switch, not "still on".
import { taxFingerprint as taxFingerprintS09 } from './requirePermission';
import { test as testS09, expect as expectS09 } from 'vitest';
testS09('a string "false" for the tax switch counts as a change', () => {
  const current = { is_tax_enabled: true, vat_number: '300000000000003', default_tax_rate: 15, tax_settings: { enabled: true } };
  const sneaky = { is_tax_enabled: true, vat_number: '300000000000003', default_tax_rate: 15, tax_settings: { enabled: 'false' } };
  expectS09(taxFingerprintS09(sneaky)).not.toBe(taxFingerprintS09(current));
  expectS09(taxFingerprintS09({ ...current })).toBe(taxFingerprintS09(current));
});

// Golden path 9 (seen-stability-guardrails-task.md): a refusal says so in the
// app's own terms -- a code and a kind the screens turn into a sentence
// (seen-friendly-errors-everywhere-task.md) -- not just "forbidden".
describe('a refusal', () => {
  test('carries the permission kind and its code', async () => {
    const r = res();
    await requirePermission('staff.create', { load })(req({ role: 'cashier', staffId: 'nobody' }), r, () => {});
    expect(r.statusCode).toBe(403);
    expect(r.body).toMatchObject({ kind: 'permission', code: 'PERM-01' });
  });
});
