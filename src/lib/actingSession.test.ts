// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';

// seen-permissions-fix-task.md Phase 2: the browser half of the PIN session.
const SUPA = 'https://proj.supabase.co';
const calls: Array<{ url: string; headers: Headers }> = [];
let nextResponse: () => Response = () => new Response('{}', { status: 200 });

vi.stubGlobal('fetch', vi.fn());
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  calls.push({ url: String(input), headers: new Headers(init?.headers) });
  return nextResponse();
}) as typeof fetch;

vi.mock('../services/supabase/client', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) } },
}));

const mod = await import('./actingSession');
mod.installActingSessionFetch(SUPA);

beforeEach(() => {
  calls.length = 0;
  mod.forgetActingSession();
  nextResponse = () => new Response('{}', { status: 200 });
});

describe('the session header', () => {
  test('a matched PIN keeps the token the server returns', async () => {
    nextResponse = () => new Response(JSON.stringify({ matched: true, actingToken: 'tok-1', staff: { id: 'cashier-1' } }), { status: 200 });
    await window.fetch('/api/staff/verify-pin', { method: 'POST' });
    expect(mod.getActingSession()).toEqual({ token: 'tok-1', staffId: 'cashier-1' });
    expect(calls[0].headers.has(mod.ACTING_HEADER)).toBe(false);
  });

  test('database and /api requests carry it; auth, storage and other sites do not', async () => {
    mod.setActingSession('tok-2', 'cashier-2');
    calls.length = 0;
    await window.fetch(`${SUPA}/rest/v1/rpc/create_pos_sale`, { method: 'POST' });
    await window.fetch('/api/tenant/settings');
    await window.fetch(`${SUPA}/auth/v1/token`);
    await window.fetch('https://example.com/x');
    expect(calls.map((c) => c.headers.get(mod.ACTING_HEADER))).toEqual(['tok-2', 'tok-2', null, null]);
  });

  test('an offline replay names its actor and leaves the session header off', async () => {
    mod.setActingSession('tok-3', 'cashier-3');
    calls.length = 0;
    await window.fetch(`${SUPA}/rest/v1/rpc/create_pos_sale`, { headers: { [mod.OFFLINE_ACTOR_HEADER]: 'cashier-9' } });
    expect(calls[0].headers.get(mod.ACTING_HEADER)).toBeNull();
    expect(calls[0].headers.get(mod.OFFLINE_ACTOR_HEADER)).toBe('cashier-9');
  });

  test('the server saying the session is over clears it and tells the app', async () => {
    mod.setActingSession('tok-4', 'cashier-4');
    let told = false;
    window.addEventListener(mod.ACTING_SESSION_INVALID_EVENT, () => { told = true; }, { once: true });
    nextResponse = () => new Response(JSON.stringify({ error: 'acting_session_invalid' }), { status: 401 });
    await window.fetch('/api/tenant/settings');
    expect(mod.getActingSession()).toBeNull();
    expect(told).toBe(true);
  });

  test('ending a session asks the server to revoke it, without the session header', async () => {
    mod.setActingSession('tok-5', 'cashier-5');
    calls.length = 0;
    await mod.endActingSession();
    expect(mod.getActingSession()).toBeNull();
    const end = calls.find((c) => c.url.endsWith('/api/staff/acting-session/end'));
    expect(end).toBeTruthy();
    expect(end!.headers.has(mod.ACTING_HEADER)).toBe(false);
  });

  test('queued offline work is attributed to whoever is on the device', () => {
    mod.setActorStaffId('cashier-6');
    expect(mod.getActorStaffId()).toBe('cashier-6');
    mod.setActingSession('tok-7', 'cashier-7');
    expect(mod.getActorStaffId()).toBe('cashier-7');
  });
});
