import { describe, expect, test, vi } from 'vitest';
import fs from 'node:fs';

vi.mock('../lib/supabase/client', () => ({ supabase: {} }));

import matrix from './permissionsMatrix.json';
import { buildRoleDefaultsSql, blockInMigration, MIGRATION } from '../../scripts/permissions/gen-sql';
import { DEFAULT_ROLES, MERCHANT_ROLE_KEYS, staffRoleForSave } from '../services/permissionService';
import { SYSTEM_PERMISSIONS } from '../constants/permissions';

// seen-permissions-fix-task.md Phase 1: one source for the defaults.
describe('permissionsMatrix.json is the one source', () => {
  test('its keys are exactly the permission keys the app defines', () => {
    expect([...matrix.keys].sort()).toEqual(SYSTEM_PERMISSIONS.map((p) => p.id).sort());
    expect(Object.keys(matrix.roles).sort()).toEqual([...MERCHANT_ROLE_KEYS].sort());
  });

  test("the UI's DEFAULT_ROLES are built from it", () => {
    for (const role of MERCHANT_ROLE_KEYS) {
      const allowed = Object.entries(DEFAULT_ROLES[role].permissions).filter(([, v]) => v).map(([k]) => k).sort();
      expect(allowed, role).toEqual([...(matrix.roles as Record<string, string[]>)[role]].sort());
    }
  });

  test('the SQL in the migration is the one generated from it (run gen-sql.ts --write after editing the JSON)', () => {
    const sql = fs.readFileSync(MIGRATION, 'utf-8');
    expect(blockInMigration(sql)).toBe(buildRoleDefaultsSql());
  });

  test('every role key in the JSON is a known key', () => {
    const known = new Set(matrix.keys);
    for (const [role, keys] of Object.entries(matrix.roles as Record<string, string[]>)) {
      for (const k of keys) expect(known.has(k), `${role}: ${k}`).toBe(true);
    }
  });
});

describe('staffRoleForSave (custom roles keep their base role)', () => {
  test('a built-in role is saved as itself', () => {
    expect(staffRoleForSave('cashier')).toBe('cashier');
    expect(staffRoleForSave('branch_manager', { base_role: 'tailor' })).toBe('branch_manager');
  });
  test("a custom role is saved as its base role, 'tailor' only when it has none", () => {
    expect(staffRoleForSave('custom_senior_1', { base_role: 'cashier' })).toBe('cashier');
    expect(staffRoleForSave('custom_old_1', { base_role: null })).toBe('tailor');
    expect(staffRoleForSave('custom_x', { base_role: 'owner' })).toBe('tailor');
  });
});
