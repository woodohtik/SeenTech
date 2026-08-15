-- ==========================================
-- DISABLED — this script used to open every table in `public` to
-- unrestricted read/write/delete (`FOR ALL USING (true) WITH CHECK (true)`
-- on every table, for every role), completely destroying the multi-tenant
-- RLS isolation implemented in wdooh-database-schema.sql/fix-rls.sql. It was
-- flagged in a security audit as a live risk-in-waiting: if it were ever
-- pasted into the wrong Supabase SQL Editor tab or picked up by an
-- automated migration runner, any authenticated (or anon) client could read
-- and write every other tenant's orders, customers, staff PIN hashes,
-- financial records, etc.
--
-- It is neutralized below so it can never be executed by accident. If you
-- genuinely need a "wide open" local dev database, run this by hand against
-- a local/throwaway Postgres instance only — never against a shared or
-- production Supabase project.
-- ==========================================

DO $$
BEGIN
  RAISE EXCEPTION 'allow-all-rls.sql is disabled: it would remove all tenant isolation. See the comment at the top of this file.';
END
$$;
