/**
 * The golden paths check the database, not only the screen
 * (seen-stability-guardrails-task.md, phase 1). A service-role client on the
 * local test database -- GOLDEN_SUPABASE_URL / GOLDEN_SERVICE_ROLE_KEY, set by
 * CI from `supabase status`.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.GOLDEN_SUPABASE_URL;
  const key = process.env.GOLDEN_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('GOLDEN_SUPABASE_URL and GOLDEN_SERVICE_ROLE_KEY are needed (the local test database).');
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url.replace(/\/$/, ''))) {
    // Never anything but the local throw-away database.
    throw new Error(`golden paths run only against a local database, not ${url}`);
  }
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

/** One row, or a clear failure (never a silent undefined). */
export async function one<T = Record<string, unknown>>(query: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(`query failed: ${JSON.stringify(error)}`);
  if (!data || data.length !== 1) throw new Error(`expected one row, got ${data?.length ?? 0}`);
  return data[0];
}
