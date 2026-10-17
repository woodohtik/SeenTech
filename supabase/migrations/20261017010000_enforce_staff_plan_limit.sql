-- =============================================================================
--  seen-deep-technical-audit.md High #8: plan limits seeded but never enforced
--  ------------------------------------------------------------------------
--  plans.max_staff has existed since the base schema and is seeded for
--  'free' (2) and 'basic' (5), but nothing anywhere ever read it back --
--  Staff.tsx's add-staff flow is a plain supabase.from('staff').insert()
--  with no limit check client- or server-side. A tenant on the free plan
--  could add unlimited staff.
--
--  Verified live on staging before writing this: every tenant with a
--  plan_id assigned is currently well under their plan's max_staff, so this
--  doesn't retroactively break anyone -- it only stops the count from
--  growing past the limit from here on.
--
--  Deliberately NOT touching branch counts: the audit also mentioned a
--  "branch limit", but no max_branches column (or equivalent) exists
--  anywhere in the schema -- same kind of audit claim that didn't match
--  reality as the roles_permissions/expenses one. Enforcing a limit that
--  has no actual column to enforce would mean inventing new product
--  behavior, not fixing a gap; left alone.
--
--  No plan assigned (plan_id IS NULL) or the referenced plan row missing ->
--  no limit applied, same as today's behavior.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enforce_staff_plan_limit() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_id   text;
  v_max_staff int;
  v_current   int;
BEGIN
  -- Only activating/staying active counts against the limit; deactivating
  -- always proceeds freely.
  IF NEW.status IS DISTINCT FROM 'active' THEN
    RETURN NEW;
  END IF;

  SELECT plan_id INTO v_plan_id FROM public.tenants WHERE id = NEW.tenant_id;
  IF v_plan_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT max_staff INTO v_max_staff FROM public.plans WHERE id = v_plan_id;
  IF v_max_staff IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_current
    FROM public.staff
   WHERE tenant_id = NEW.tenant_id
     AND status = 'active'
     AND id IS DISTINCT FROM NEW.id;

  IF v_current >= v_max_staff THEN
    -- Kept short (<100 chars) on purpose: getFriendlyErrorMessage
    -- (src/lib/firebase.ts) passes a Postgres error message straight
    -- through to the toast only below that length, else it falls back
    -- to a fully generic message.
    RAISE EXCEPTION 'تجاوزت باقتك الحد الأقصى لعدد الموظفين النشطين (%)', v_max_staff
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_staff_plan_limit_insert ON public.staff;
CREATE TRIGGER enforce_staff_plan_limit_insert
BEFORE INSERT ON public.staff
FOR EACH ROW EXECUTE FUNCTION public.enforce_staff_plan_limit();

DROP TRIGGER IF EXISTS enforce_staff_plan_limit_update ON public.staff;
CREATE TRIGGER enforce_staff_plan_limit_update
BEFORE UPDATE OF status, tenant_id ON public.staff
FOR EACH ROW EXECUTE FUNCTION public.enforce_staff_plan_limit();
