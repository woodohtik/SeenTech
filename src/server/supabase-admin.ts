import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

let supabaseUrl = (process.env.VITE_SUPABASE_URL || '').trim();
if (supabaseUrl && supabaseUrl.endsWith('/')) {
  supabaseUrl = supabaseUrl.slice(0, -1);
}
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!supabaseUrl || !supabaseServiceKey || !supabaseUrl.startsWith('http')) {
  console.warn(
    '[supabase-admin] Missing or invalid VITE_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY. ' +
      'Server-side Supabase queries (role/tenant lookups) will fail. ' +
      'SUPABASE_SERVICE_ROLE_KEY must be server-side only — never expose it with a VITE_ prefix.'
  );
}

/**
 * Server-side Supabase client using the service role key.
 * Bypasses RLS — use ONLY in trusted server code, never ship to the browser.
 */
export const supabaseAdmin = createClient(
  supabaseUrl || 'https://missing-supabase-url.local',
  supabaseServiceKey || 'missing-key',
  { auth: { persistSession: false } }
);
