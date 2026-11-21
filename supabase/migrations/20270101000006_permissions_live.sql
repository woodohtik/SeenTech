-- seen-permissions-fix-task.md Phase 6: a change reaches every open device.
--
--  * roles and user_permission_overrides on Realtime: the app re-reads its
--    permissions when a row of its shop changes (usePermissionsLiveRefresh).
--    Their SELECT policies already limit each subscriber to its own shop.
--    staff stays OFF Realtime: it carries pin_hash.
--  * Deactivating an employee ends every PIN session of theirs at once; the
--    device learns it on its next re-read (60 seconds at most) and returns
--    to the PIN screen.
-- Rollback: supabase/rollbacks/20270101_permissions_live.down.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'roles') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.roles;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'user_permission_overrides') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_permission_overrides;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.staff_deactivation_ends_sessions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.staff_acting_sessions
     SET revoked_at = now()
   WHERE staff_id = NEW.id AND revoked_at IS NULL;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS staff_deactivation_ends_sessions ON public.staff;
CREATE TRIGGER staff_deactivation_ends_sessions
AFTER UPDATE OF status ON public.staff
FOR EACH ROW
WHEN (NEW.status = 'inactive' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.staff_deactivation_ends_sessions();
