import { describe, it, expect, beforeEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import type { Response } from 'express';

const JWT_SECRET = 'test-legacy-secret';

// jose's createRemoteJWKSet does a real network fetch the first time
// jwtVerify is called against it -- mocked entirely so tests control the
// "does this look like a Supabase-issued token" outcome directly instead
// of hitting a real (or fake) JWKS endpoint.
const jwtVerifyMock = vi.fn();
vi.mock('jose', () => ({
  createRemoteJWKSet: () => ({}),
  jwtVerify: (...args: any[]) => jwtVerifyMock(...args),
}));

// supabaseAdmin.from(table).select(...).eq(...).maybeSingle() and
// .from(table).insert(...) -- a minimal chainable stand-in rather than a
// full Supabase client mock.
const maybeSingleMock = vi.fn();
const insertMock = vi.fn().mockResolvedValue({ error: null });
const supabaseAdminMock = {
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: maybeSingleMock,
      })),
    })),
    insert: insertMock,
  })),
};
vi.mock('../supabase-admin.ts', () => ({ supabaseAdmin: supabaseAdminMock }));

const verifyIdTokenMock = vi.fn();
let adminAuthMock: { verifyIdToken: typeof verifyIdTokenMock } | null = { verifyIdToken: verifyIdTokenMock };
vi.mock('../firebase-admin.ts', () => ({
  get adminAuth() { return adminAuthMock; },
}));

process.env.VITE_SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_JWT_SECRET = JWT_SECRET;

const { authenticate, authorize } = await import('./authMiddleware.ts');
import type { AuthRequest } from './authMiddleware.ts';

function makeReq(authHeader?: string): AuthRequest {
  return { headers: { authorization: authHeader }, path: '/api/test', method: 'GET' } as AuthRequest;
}

function makeRes(): Response {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  adminAuthMock = { verifyIdToken: verifyIdTokenMock };
  maybeSingleMock.mockResolvedValue({ data: null, error: null });
});

describe('authenticate', () => {
  it('rejects a request with no Authorization header', async () => {
    const req = makeReq(undefined);
    const res = makeRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: No token provided' });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a header that is not a Bearer token', async () => {
    const req = makeReq('Basic sometoken');
    const res = makeRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a token that fails every verification path (Supabase JWKS, legacy HS256, Firebase)', async () => {
    jwtVerifyMock.mockRejectedValue(new Error('bad signature'));
    verifyIdTokenMock.mockRejectedValue(new Error('invalid firebase token'));

    const req = makeReq('Bearer not-a-real-token');
    const res = makeRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: Invalid token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('grants super_admin role and tenantId=saas_management from a saas_users row (Supabase JWKS path)', async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { sub: 'uid-1', email: 'admin@seen.test' } });
    maybeSingleMock.mockResolvedValueOnce({ data: { role: 'super_admin' }, error: null }); // saas_users

    const req = makeReq('Bearer valid-supabase-token');
    const res = makeRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toEqual(expect.objectContaining({
      uid: 'uid-1',
      role: 'super_admin',
      tenantId: 'saas_management',
    }));
    expect(res.status).not.toHaveBeenCalled();
  });

  // seen-cto-code-review-2026-11-13.md SA-C4/AUTH-06: a deactivated
  // saas_users row used to still pass straight through -- every
  // /api/admin/* route runs through the service-role client (bypasses
  // RLS), so app_is_super_admin()'s own is_active check never applied.
  it('rejects a deactivated saas_users row (is_active=false) with 403, even with a valid token', async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { sub: 'uid-deactivated', email: 'exadmin@seen.test' } });
    maybeSingleMock.mockResolvedValueOnce({ data: { role: 'super_admin', is_active: false }, error: null });

    const req = makeReq('Bearer valid-supabase-token');
    const res = makeRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden: Account deactivated' });
    expect(next).not.toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'inactive_saas_user_access_attempt', uid: 'uid-deactivated' }));
  });

  // seen-cto-code-review-2026-11-13.md AUTH-05: 2FA was a UI gate only --
  // nothing server-side ever checked the session's AAL, so a password-only
  // (aal1) session fully impersonated an account that had enrolled TOTP.
  it('rejects an aal1 session for a saas_users row with mfa_enabled=true', async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { sub: 'uid-mfa', email: 'mfa-admin@seen.test', aal: 'aal1' } });
    maybeSingleMock.mockResolvedValueOnce({ data: { role: 'super_admin', is_active: true, mfa_enabled: true }, error: null });

    const req = makeReq('Bearer valid-supabase-token');
    const res = makeRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden: MFA verification required', code: 'mfa_required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows an aal2 session for a saas_users row with mfa_enabled=true', async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { sub: 'uid-mfa-2', email: 'mfa-admin2@seen.test', aal: 'aal2' } });
    maybeSingleMock.mockResolvedValueOnce({ data: { role: 'super_admin', is_active: true, mfa_enabled: true }, error: null });

    const req = makeReq('Bearer valid-supabase-token');
    const res = makeRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('does not require aal2 for a saas_users row that has never enrolled MFA (mfa_enabled=false)', async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { sub: 'uid-no-mfa', email: 'no-mfa-admin@seen.test', aal: 'aal1' } });
    maybeSingleMock.mockResolvedValueOnce({ data: { role: 'super_admin', is_active: true, mfa_enabled: false }, error: null });

    const req = makeReq('Bearer valid-supabase-token');
    const res = makeRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  // P6 (SECURITY-12, PLATFORM-04): the shop's own state closes the server too.
  it.each([
    [{ status: 'inactive' }, 403, 'tenant_inactive'],
    [{ status: 'active', trashed_at: '2026-11-01T00:00:00Z' }, 403, 'tenant_deleted'],
    [{ status: 'active', subscription_status: 'locked' }, 402, 'subscription_locked'],
    [{ status: 'active', subscription_status: 'active', subscription_end_date: '2020-01-01T00:00:00Z' }, 402, 'subscription_locked'],
  ])('refuses staff of a closed shop (%j)', async (tenant, http, code) => {
    jwtVerifyMock.mockResolvedValue({ payload: { sub: 'uid-9', email: 'cashier@shop.test' } });
    maybeSingleMock
      .mockResolvedValueOnce({ data: null, error: null }) // saas_users
      .mockResolvedValueOnce({ data: { id: 'staff-9', role: 'cashier', tenant_id: 'tenant-9' }, error: null }) // staff
      .mockResolvedValueOnce({ data: tenant, error: null }); // tenants
    const req = makeReq('Bearer valid-supabase-token');
    const res = makeRes();
    const next = vi.fn();
    await authenticate(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(http);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code }));
  });

  it('lets staff of a shop in its grace days through', async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { sub: 'uid-8', email: 'cashier@shop.test' } });
    maybeSingleMock
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { id: 'staff-8', role: 'cashier', tenant_id: 'tenant-8' }, error: null })
      .mockResolvedValueOnce({ data: { status: 'active', subscription_status: 'active', subscription_end_date: new Date(Date.now() - 86_400_000).toISOString() }, error: null });
    const req = makeReq('Bearer valid-supabase-token');
    const res = makeRes();
    const next = vi.fn();
    await authenticate(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('a failed shop lookup refuses rather than lets through', async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { sub: 'uid-7', email: 'cashier@shop.test' } });
    maybeSingleMock
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { id: 'staff-7', role: 'cashier', tenant_id: 'tenant-7' }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    const req = makeReq('Bearer valid-supabase-token');
    const res = makeRes();
    const next = vi.fn();
    await authenticate(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('grants tenant staff role/tenantId/staffId from the staff table when not a saas_user', async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { sub: 'uid-2', email: 'cashier@shop.test' } });
    maybeSingleMock
      .mockResolvedValueOnce({ data: null, error: null }) // saas_users: not found
      .mockResolvedValueOnce({ data: { id: 'staff-1', role: 'cashier', tenant_id: 'tenant-1' }, error: null }); // staff

    const req = makeReq('Bearer valid-supabase-token');
    const res = makeRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toEqual(expect.objectContaining({
      uid: 'uid-2',
      role: 'cashier',
      tenantId: 'tenant-1',
      staffId: 'staff-1',
    }));
  });

  it('rejects with 403 and logs a security event when the token is valid but no role is assigned anywhere', async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { sub: 'uid-3', email: 'nobody@shop.test' } });
    maybeSingleMock
      .mockResolvedValueOnce({ data: null, error: null }) // saas_users
      .mockResolvedValueOnce({ data: null, error: null }); // staff

    const req = makeReq('Bearer valid-supabase-token');
    const res = makeRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden: No role assigned' });
    expect(next).not.toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'unauthorized_access', uid: 'uid-3' }));
  });

  it('falls back to the legacy HS256 secret when the Supabase JWKS path fails', async () => {
    jwtVerifyMock.mockRejectedValue(new Error('not an asymmetric-key token'));
    const legacyToken = jwt.sign({ sub: 'uid-legacy', email: 'legacy@shop.test', aud: 'authenticated' }, JWT_SECRET, { algorithm: 'HS256' });
    maybeSingleMock
      .mockResolvedValueOnce({ data: null, error: null }) // saas_users
      .mockResolvedValueOnce({ data: { id: 'staff-2', role: 'owner', tenant_id: 'tenant-2' }, error: null }); // staff

    const req = makeReq(`Bearer ${legacyToken}`);
    const res = makeRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toEqual(expect.objectContaining({ uid: 'uid-legacy', role: 'owner' }));
  });

  it('falls back to Firebase verification when both Supabase paths fail (transition window)', async () => {
    jwtVerifyMock.mockRejectedValue(new Error('not a supabase token'));
    verifyIdTokenMock.mockResolvedValue({ uid: 'firebase-uid', email: 'legacyuser@shop.test' });
    maybeSingleMock
      .mockResolvedValueOnce({ data: null, error: null }) // saas_users
      .mockResolvedValueOnce({ data: { id: 'staff-3', role: 'tailor', tenant_id: 'tenant-3' }, error: null }); // staff

    const req = makeReq('Bearer some-firebase-id-token');
    const res = makeRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toEqual(expect.objectContaining({ uid: 'firebase-uid', role: 'tailor' }));
  });

  it('does not fall back to Firebase when adminAuth is not configured (no Firebase app initialized)', async () => {
    jwtVerifyMock.mockRejectedValue(new Error('not a supabase token'));
    adminAuthMock = null;

    const req = makeReq('Bearer some-token');
    const res = makeRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('authorize', () => {
  it('rejects when req.user has no role at all', async () => {
    const req = makeReq() as AuthRequest;
    const res = makeRes();
    const next = vi.fn();

    await authorize(['owner', 'admin'])(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('lets super_admin through regardless of the allowed-roles list', async () => {
    const req = { ...makeReq(), user: { uid: 'u', role: 'super_admin' } } as AuthRequest;
    const res = makeRes();
    const next = vi.fn();

    await authorize(['owner']) (req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows a role that is in the allowed list', async () => {
    const req = { ...makeReq(), user: { uid: 'u', role: 'cashier' } } as AuthRequest;
    const res = makeRes();
    const next = vi.fn();

    await authorize(['owner', 'cashier'])(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects a role that is not in the allowed list and logs the attempt', async () => {
    const req = { ...makeReq(), user: { uid: 'u', role: 'tailor' } } as AuthRequest;
    const res = makeRes();
    const next = vi.fn();

    await authorize(['owner', 'admin'])(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden: Insufficient permissions' });
    expect(next).not.toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'insufficient_permissions', role: 'tailor' }));
  });
});
