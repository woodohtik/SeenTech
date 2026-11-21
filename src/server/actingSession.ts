/**
 * seen-permissions-fix-task.md Phase 2: the server side of a PIN switch.
 *
 * A matched PIN (POST /api/staff/verify-pin) creates a staff_acting_sessions
 * row -- 12 hours at most, bound to the device's account (auth_uid) and its
 * shop -- and hands the browser a random 32-byte token. Only the token's
 * SHA-256 is stored (the same hash the database's app_acting_staff_id()
 * computes), and the token itself is never logged.
 */
import crypto from 'node:crypto';

export const ACTING_HEADER = 'x-seen-acting-staff';
export const ACTING_SESSION_HOURS = 12;

type Admin = { from: (table: string) => any };

export function hashActingToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function createActingSession(
  admin: Admin,
  args: { tenantId: string; authUid: string; staffId: string; now?: Date },
): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const now = args.now ?? new Date();
  const { error } = await admin.from('staff_acting_sessions').insert({
    token_hash: hashActingToken(token),
    tenant_id: args.tenantId,
    auth_uid: args.authUid,
    staff_id: args.staffId,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ACTING_SESSION_HOURS * 3600 * 1000).toISOString(),
  });
  if (error) throw error;
  return token;
}

export type ActingStaff = { staffId: string; role: string; tenantId: string };

/** The employee a token names, or null when it is not valid for this account. */
export async function resolveActingSession(
  admin: Admin,
  args: { authUid: string; token: string; now?: Date },
): Promise<ActingStaff | null> {
  if (!args.token) return null;
  const { data, error } = await admin
    .from('staff_acting_sessions')
    .select('staff_id, tenant_id, expires_at, revoked_at, staff:staff_id (id, role, tenant_id, status)')
    .eq('token_hash', hashActingToken(args.token))
    .eq('auth_uid', args.authUid)
    .maybeSingle();
  if (error || !data) return null;
  const now = (args.now ?? new Date()).getTime();
  const staff = Array.isArray(data.staff) ? data.staff[0] : data.staff;
  if (data.revoked_at || new Date(data.expires_at).getTime() <= now) return null;
  if (!staff || staff.status !== 'active' || staff.tenant_id !== data.tenant_id) return null;
  return { staffId: staff.id, role: staff.role, tenantId: data.tenant_id };
}

/** Revoke one token of this account (logout, lock, idle, switching). */
export async function endActingSession(admin: Admin, args: { authUid: string; token: string }): Promise<void> {
  if (!args.token) return;
  await admin
    .from('staff_acting_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('token_hash', hashActingToken(args.token))
    .eq('auth_uid', args.authUid)
    .is('revoked_at', null);
}
