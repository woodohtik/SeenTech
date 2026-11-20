/**
 * The signed-in person's identity rows in one request
 * (seen-performance-first-open-login-task.md Phase 3): users, staff + its
 * tenant, saas_users, tailor_requests, referral_partners, the custom role
 * key and whether the shop uses PINs -- from public.get_session_identity()
 * (migration 20261228000000), which reads them under the caller's own RLS.
 *
 * If that function is not deployed yet (a database the migration has not
 * reached), the same rows are read the old way, in two parallel rounds,
 * so AuthContext works against either.
 */
import { supabase } from './supabase/client';

export const STAFF_IDENTITY_COLUMNS =
  'id, uid, name, email, phone, role, role_id, branch_id, status, must_change_pin, is_test, tenant_id, created_at, updated_at, commission_type, commission_value, has_seen_onboarding, commission_balance, has_pin';

export interface SessionIdentity {
  user: Record<string, any> | null;
  staff: Record<string, any> | null;
  tenant: Record<string, any> | null;
  saas_user: { role: string; is_active: boolean | null } | null;
  tailor_request: Record<string, any> | null;
  referral_partner: { id: string; status: string } | null;
  role_key: string | null;
  has_staff_with_pin: boolean;
}

/** PostgREST's answer when the function does not exist (PGRST202) or Postgres' (42883). */
function isMissingFunction(error: any): boolean {
  const code = String(error?.code || '');
  return code === 'PGRST202' || code === '42883' || /get_session_identity/.test(String(error?.message || '')) && /not find|does not exist/i.test(String(error?.message || ''));
}

export async function fetchSessionIdentity(uid: string): Promise<SessionIdentity> {
  const { data, error } = await supabase.rpc('get_session_identity' as any);
  if (!error && data && typeof data === 'object' && !Array.isArray(data)) {
    const d = data as any;
    return {
      user: d.user ?? null,
      staff: d.staff ?? null,
      tenant: d.tenant ?? null,
      saas_user: d.saas_user ?? null,
      tailor_request: d.tailor_request ?? null,
      referral_partner: d.referral_partner ?? null,
      role_key: d.role_key ?? null,
      has_staff_with_pin: Boolean(d.has_staff_with_pin),
    };
  }
  if (error && !isMissingFunction(error)) throw error;
  // No function, or an unexpected answer shape: read the rows the old way.
  return fetchSessionIdentityLegacy(uid);
}

async function fetchSessionIdentityLegacy(uid: string): Promise<SessionIdentity> {
  const [userRes, staffRes, saasRes, requestRes, partnerRes] = await Promise.all([
    supabase.from('users').select('*').eq('id', uid).maybeSingle(),
    supabase.from('staff').select(`${STAFF_IDENTITY_COLUMNS}, tenant:tenants(*)`).eq('uid', uid)
      .order('status', { ascending: true }).order('created_at', { ascending: true }).limit(1).maybeSingle(),
    supabase.from('saas_users').select('role, is_active').eq('uid', uid).maybeSingle(),
    supabase.from('tailor_requests').select('*').eq('uid', uid).maybeSingle(),
    supabase.from('referral_partners').select('id, status').eq('uid', uid).maybeSingle(),
  ]);
  if (userRes.error) throw userRes.error;
  if (staffRes.error) throw staffRes.error;
  if (saasRes.error) throw saasRes.error;

  const staffRow: any = staffRes.data ?? null;
  const tenant = staffRow?.tenant ?? null;
  const staff = staffRow ? { ...staffRow } : null;
  if (staff) delete staff.tenant;

  const [roleRes, pinRes] = await Promise.all([
    staff?.role_id
      ? supabase.from('roles').select('role_key').eq('id', staff.role_id).maybeSingle()
      : Promise.resolve({ data: null }),
    staff?.tenant_id
      ? supabase.rpc('staff_ids_with_pin_set', { p_tenant_id: staff.tenant_id }).then((r) => r, () => ({ data: null }))
      : Promise.resolve({ data: null }),
  ]);

  return {
    user: userRes.data ?? null,
    staff,
    tenant,
    saas_user: (saasRes.data as any) ?? null,
    tailor_request: requestRes.data ?? null,
    referral_partner: (partnerRes.data as any) ?? null,
    role_key: (roleRes as any)?.data?.role_key ?? null,
    has_staff_with_pin: Array.isArray((pinRes as any)?.data) && (pinRes as any).data.length > 0,
  };
}
