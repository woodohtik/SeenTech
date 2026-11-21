/**
 * seen-permissions-fix-task.md Phase 2: who the server sees after a PIN switch.
 *
 * POST /api/staff/verify-pin answers a matched PIN with `actingToken`, a
 * random token for a server-side session (staff_acting_sessions, 12 hours
 * at most, bound to this device's account). From then on every request to
 * Supabase (PostgREST/RPC) and to this app's /api carries it as
 * `x-seen-acting-staff`, so the database and server.ts resolve the employee
 * who switched in -- their permissions apply and their name goes on the
 * sale, the payment, the shift and the history.
 *
 * The token lives in memory and sessionStorage (not localStorage: it ends
 * with the tab, like the PIN switch itself). It is never logged.
 *
 * Offline replays (lib/offline/outbox.ts) send `x-seen-offline-actor`
 * instead -- attribution only -- and this wrapper then leaves the session
 * header off that request.
 */

export const ACTING_HEADER = 'x-seen-acting-staff';
export const OFFLINE_ACTOR_HEADER = 'x-seen-offline-actor';
export const ACTING_SESSION_INVALID_EVENT = 'seen:acting-session-invalid';
const STORAGE_KEY = 'seen_acting_session';
/** These two must work without (or with an expired) session header. */
const NO_SESSION_PATHS = ['/api/staff/verify-pin', '/api/staff/acting-session/end'];

type ActingSession = { token: string; staffId: string };

let current: ActingSession | null = readStored();
/** The staff member currently using the device (set by StaffContext), for queued offline work. */
let actorStaffId: string | null = null;

function readStored(): ActingSession | null {
  try {
    const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(STORAGE_KEY) : null;
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed.token === 'string' && typeof parsed.staffId === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function store(next: ActingSession | null): void {
  current = next;
  try {
    if (next) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: memory only */
  }
}

export function getActingSession(): ActingSession | null {
  return current;
}

export function setActingSession(token: string, staffId: string): void {
  const previous = current;
  store({ token, staffId });
  if (previous && previous.token !== token) void revoke(previous.token);
}

/** Ends the PIN session on the server (logout, lock, switching to someone else). */
export async function endActingSession(): Promise<void> {
  const previous = current;
  store(null);
  if (previous) await revoke(previous.token);
}

/** Forget the session without calling the server (it already said it is gone). */
export function forgetActingSession(): void {
  store(null);
}

export function setActorStaffId(id: string | null): void {
  actorStaffId = id;
}

/** Who made a piece of work queued offline: the PIN session's employee, else whoever is on the device. */
export function getActorStaffId(): string | null {
  return current?.staffId ?? actorStaffId;
}

async function authHeader(): Promise<Record<string, string>> {
  try {
    const { supabase } = await import('../services/supabase/client');
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {};
  } catch {
    return {};
  }
}

async function revoke(token: string): Promise<void> {
  try {
    await fetch('/api/staff/acting-session/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ token }),
      keepalive: true,
    });
  } catch {
    /* offline: the session expires on its own (12 hours at most) */
  }
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url;
}

/** Does this request go to the database API (PostgREST/RPC) or to this app's /api? Not auth/storage. */
export function isSeenBackend(url: string, supabaseUrl: string, origin: string): boolean {
  if (supabaseUrl && url.startsWith(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/`)) return true;
  if (url.startsWith('/api/')) return true;
  return !!origin && url.startsWith(`${origin}/api/`);
}

function pathOf(url: string, origin: string): string {
  try {
    return new URL(url, origin || 'http://localhost').pathname;
  } catch {
    return url;
  }
}

let installed = false;

/**
 * Wrap fetch once, at startup: add the session header to backend requests,
 * keep the token a verify-pin answer carries, and notice when the server
 * says the session is over.
 */
export function installActingSessionFetch(supabaseUrl: string): void {
  if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  installed = true;
  const base = window.fetch.bind(window);
  const origin = window.location?.origin ?? '';

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlOf(input);
    if (!isSeenBackend(url, supabaseUrl, origin)) return base(input, init);
    const path = pathOf(url, origin);
    const sessionFree = NO_SESSION_PATHS.includes(path);

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (current && !sessionFree && !headers.has(OFFLINE_ACTOR_HEADER)) headers.set(ACTING_HEADER, current.token);
    const res = await base(input, { ...init, headers });

    if (path === '/api/staff/verify-pin' && res.ok) {
      try {
        const body = await res.clone().json();
        if (body?.matched && typeof body.actingToken === 'string' && body.staff?.id) {
          setActingSession(body.actingToken, body.staff.id);
        }
      } catch { /* not JSON: nothing to keep */ }
    } else if (current && !sessionFree && res.status === 401) {
      try {
        const body = await res.clone().json();
        if (body?.error === 'acting_session_invalid') {
          forgetActingSession();
          window.dispatchEvent(new CustomEvent(ACTING_SESSION_INVALID_EVENT));
        }
      } catch { /* not ours */ }
    }
    return res;
  };
}
