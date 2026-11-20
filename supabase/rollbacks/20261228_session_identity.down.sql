-- Rollback for 20261228000000_get_session_identity.sql and
-- 20261228000001_users_realtime.sql (seen-performance-first-open-login-task.md
-- Phase 3). The client falls back to its separate reads when the function is
-- missing, so this is safe to run while the new client code is live.
DROP FUNCTION IF EXISTS public.get_session_identity();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'users'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.users;
  END IF;
END
$$;

DELETE FROM supabase_migrations.schema_migrations WHERE version IN ('20261228000000', '20261228000001');
