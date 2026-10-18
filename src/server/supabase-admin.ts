import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { logger } from './logger.ts';

// { path: [...] }, not bare dotenv.config() -- this repo has no .env file,
// only .env.local (written by `vercel env pull`); bare dotenv.config() only
// looks for .env and silently loads nothing (verified directly). See
// src/server/rateLimiter.ts's longer comment on this -- same fix applied
// here and in firebase-admin.ts/server.ts.
dotenv.config({ path: ['.env.local', '.env'] });

let supabaseUrl = (process.env.VITE_SUPABASE_URL || '').trim();
if (supabaseUrl && supabaseUrl.endsWith('/')) {
  supabaseUrl = supabaseUrl.slice(0, -1);
}
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!supabaseUrl || !supabaseServiceKey || !supabaseUrl.startsWith('http')) {
  logger.warn(
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
