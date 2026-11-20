-- =============================================================================
-- seen-performance-first-open-login-task.md Phase 3.5: the "account open on
-- another device" check used to read users.photo_url every 5 seconds from
-- every open tab. The client now listens to its own users row through
-- Realtime instead (plus a check when the tab comes back and a 60-second
-- fallback while it is visible).
--
-- Realtime's postgres_changes delivers a change only to subscribers whose
-- RLS lets them SELECT that row, so this exposes nothing a client could
-- not already read with a plain query.
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'users'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.users;
  END IF;
END
$$;
