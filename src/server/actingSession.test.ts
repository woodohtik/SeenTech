import { describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import { createActingSession, endActingSession, hashActingToken, resolveActingSession } from './actingSession';

// seen-permissions-fix-task.md Phase 2: the server half of the PIN session,
// against an in-memory staff_acting_sessions.
function fakeAdmin() {
  const rows: Array<Record<string, any>> = [];
  const staff: Record<string, any> = {
    cashier: { id: 'cashier', role: 'cashier', tenant_id: 'A', status: 'active' },
    gone: { id: 'gone', role: 'cashier', tenant_id: 'A', status: 'inactive' },
  };
  const admin = {
    rows,
    from: (_table: string) => {
      const filters: Array<(r: any) => boolean> = [];
      let patch: Record<string, any> | null = null;
      const q: any = {
        insert: async (row: any) => { rows.push({ ...row }); return { error: null }; },
        select: () => q,
        update: (p: any) => { patch = p; return q; },
        eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return q; },
        is: (c: string, v: any) => { filters.push((r) => (r[c] ?? null) === v); if (patch) return q.then(); return q; },
        maybeSingle: async () => {
          const r = rows.find((x) => filters.every((f) => f(x)));
          return { data: r ? { ...r, staff: staff[r.staff_id] } : null, error: null };
        },
        then: (resolve?: any) => {
          for (const r of rows) if (filters.every((f) => f(r))) Object.assign(r, patch);
          const out = { error: null };
          return resolve ? Promise.resolve(resolve(out)) : Promise.resolve(out);
        },
      };
      return q;
    },
  };
  return admin;
}

describe('PIN sessions on the server', () => {
  test('only the hash is stored, and it is the SHA-256 the database computes', async () => {
    const admin = fakeAdmin();
    const token = await createActingSession(admin, { tenantId: 'A', authUid: 'owner', staffId: 'cashier' });
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(admin.rows[0].token_hash).toBe(crypto.createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(admin.rows)).not.toContain(token);
    expect(hashActingToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  test('lasts 12 hours at most', async () => {
    const admin = fakeAdmin();
    const now = new Date('2026-11-21T08:00:00Z');
    await createActingSession(admin, { tenantId: 'A', authUid: 'owner', staffId: 'cashier', now });
    expect(new Date(admin.rows[0].expires_at).getTime() - now.getTime()).toBe(12 * 3600 * 1000);
  });

  test('resolves for the same account; refused for another account, after expiry, after revoking, for an inactive employee', async () => {
    const admin = fakeAdmin();
    const now = new Date('2026-11-21T08:00:00Z');
    const token = await createActingSession(admin, { tenantId: 'A', authUid: 'owner', staffId: 'cashier', now });
    expect(await resolveActingSession(admin, { authUid: 'owner', token, now })).toEqual({ staffId: 'cashier', role: 'cashier', tenantId: 'A' });
    expect(await resolveActingSession(admin, { authUid: 'someone-else', token, now })).toBeNull();
    expect(await resolveActingSession(admin, { authUid: 'owner', token, now: new Date(now.getTime() + 13 * 3600 * 1000) })).toBeNull();
    const inactive = await createActingSession(admin, { tenantId: 'A', authUid: 'owner', staffId: 'gone', now });
    expect(await resolveActingSession(admin, { authUid: 'owner', token: inactive, now })).toBeNull();
    await endActingSession(admin, { authUid: 'owner', token });
    expect(await resolveActingSession(admin, { authUid: 'owner', token, now })).toBeNull();
  });
});
