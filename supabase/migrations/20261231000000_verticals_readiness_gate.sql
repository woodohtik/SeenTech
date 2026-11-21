-- =============================================================================
-- seen-verticals-readiness-task.md Phase 0: a safety gate.
--
-- The five verticals are all selectable at sign-up today, but only
-- mens_tailoring is ready for real use (the others save wrong statuses, hide
-- order specs, cannot sell by the metre -- see the task file). Until each is
-- ready:
--  - verticals.readiness: ready | beta | coming_soon. mens_tailoring is
--    ready, the rest coming_soon.
--  - A shop may move to (or be created on) a vertical only when it is ready;
--    beta and coming_soon only by the platform admin or the system (seeding,
--    scheduled jobs). A shop already on another vertical keeps it: the check
--    runs only when the vertical changes.
-- No shop's vertical is changed here.
-- Rollback: supabase/rollbacks/20261231_verticals_readiness_gate.down.sql.
-- =============================================================================

ALTER TABLE public.verticals ADD COLUMN IF NOT EXISTS readiness text NOT NULL DEFAULT 'coming_soon';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'verticals_readiness_check') THEN
    ALTER TABLE public.verticals
      ADD CONSTRAINT verticals_readiness_check CHECK (readiness IN ('ready', 'beta', 'coming_soon'));
  END IF;
END
$$;

UPDATE public.verticals
   SET readiness = CASE WHEN key = 'mens_tailoring' THEN 'ready' ELSE 'coming_soon' END;

-- Not SECURITY DEFINER, for the same reason as the tenants allowlist
-- trigger: current_user must be the real caller.
CREATE OR REPLACE FUNCTION public.tenants_vertical_readiness_gate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_readiness text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.vertical IS NOT DISTINCT FROM OLD.vertical THEN
    RETURN NEW;
  END IF;
  IF current_user IN ('postgres', 'service_role') OR app_is_super_admin() THEN
    RETURN NEW;
  END IF;
  SELECT readiness INTO v_readiness FROM public.verticals WHERE key = NEW.vertical;
  IF v_readiness IS DISTINCT FROM 'ready' THEN
    RAISE EXCEPTION 'هذا النشاط غير متاح بعد -- قريباً'
      USING ERRCODE = '42501', HINT = 'vertical_not_ready';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tenants_vertical_readiness_gate ON public.tenants;
CREATE TRIGGER tenants_vertical_readiness_gate
BEFORE INSERT OR UPDATE OF vertical ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.tenants_vertical_readiness_gate();
