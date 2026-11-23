import { describe, expect, it } from 'vitest';
import matrix from './permissionsMatrix.json';
import { isPermissionKey, PERMISSION_KEYS } from './permissionKeys';

// seen-readiness-fixes-task.md P6 (CODEHEALTH-07).
describe('permission keys', () => {
  it("the type's list is the matrix's keys, in order -- regenerate permissionKeys.ts when the matrix changes", () => {
    expect([...PERMISSION_KEYS]).toEqual(matrix.keys);
  });

  it('every key a role is given in the matrix is a known key', () => {
    const unknown = Object.entries(matrix.roles as Record<string, string[]>)
      .flatMap(([role, keys]) => keys.filter((k) => !isPermissionKey(k)).map((k) => `${role}: ${k}`));
    expect(unknown).toEqual([]);
  });

  it('no key is listed twice', () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });
});
