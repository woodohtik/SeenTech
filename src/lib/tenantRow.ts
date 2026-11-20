/**
 * One read of the shop's tenants row for the burst of components that all
 * need it when the app opens (seen-performance-first-open-login-task.md
 * Phase 4.5): the header, the measurement unit, the setup checklist, the
 * vertical config and the dashboard used to read it separately, 5 requests
 * for one row. AuthContext seeds it from the identity response, so on a
 * normal open none of them reads it at all.
 *
 * Kept for 10 seconds only: long enough for the opening burst, short enough
 * that a change saved in Settings is read fresh by the next screen.
 * Returns the same `{ data, error }` shape a direct PostgREST read gives.
 */
import { supabase } from './supabase/client';

type TenantRead = { data: Record<string, any> | null; error: any };

const TTL_MS = 10_000;
const cache = new Map<string, { at: number; read: Promise<TenantRead> }>();

export function readTenantRow(tenantId: string): Promise<TenantRead> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.read;
  const read: Promise<TenantRead> = Promise.resolve(
    supabase.from('tenants').select('*').eq('id', tenantId).maybeSingle(),
  ).then(({ data, error }) => {
    if (error) cache.delete(tenantId); // never keep a failure
    return { data: (data as any) ?? null, error };
  });
  cache.set(tenantId, { at: Date.now(), read });
  return read;
}

/** The row already in hand (from get_session_identity): no request needed. */
export function primeTenantRow(tenantId: string | null | undefined, row: Record<string, any> | null | undefined): void {
  if (!tenantId || !row) return;
  cache.set(tenantId, { at: Date.now(), read: Promise.resolve({ data: row, error: null }) });
}

/** After a write to the tenants row. */
export function forgetTenantRow(tenantId: string): void {
  cache.delete(tenantId);
}
