import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ACTING_HEADER } from './actingSession';

/**
 * A Supabase client that acts as the person who made the request: their
 * token (and, when an employee is acting under a PIN, the acting header the
 * browser sent), so the database's row rules and guard triggers apply to
 * what the server writes on their behalf -- unlike the service role, which
 * would skip them (seen-merchant-trial-test-2026-11-26.md, phase 1).
 */
export function userScopedClient(req: { headers: Record<string, unknown> }): SupabaseClient {
  const url = (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
  const anon = (process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  const authorization = String(req.headers.authorization || '');
  if (!url || !anon || !authorization.startsWith('Bearer ')) throw new Error('user-scoped client: missing URL, anon key or token');
  const headers: Record<string, string> = { Authorization: authorization };
  const acting = req.headers[ACTING_HEADER];
  if (typeof acting === 'string' && acting) headers[ACTING_HEADER] = acting;
  return createClient(url, anon, {
    global: { headers },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
