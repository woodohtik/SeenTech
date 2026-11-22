-- seen-readiness-fixes-task.md P5 (PLATFORM-07) -- "تمديد التجربة" extends
-- the trial for real.
--
-- Before: the super admin's button set tenants.created_at to today. Nothing
-- reads created_at for the trial any more (trial_ends_at drives the lock
-- sweep and the app), so the trial was not extended -- and the shop's real
-- creation date was lost.
--
-- Now admin_extend_trial(p_tenant, p_days): trial_ends_at moves to
-- max(now, trial_ends_at) + p_days, the shop is a trial again and unlocked
-- (locked_at / purge_at cleared), and the action is logged. Only for a shop
-- that is not on a paid subscription. created_at no longer changes after
-- insert, from anywhere.
-- Rollback: supabase/rollbacks/20270106_admin_extend_trial.down.sql

CREATE OR REPLACE FUNCTION public.admin_extend_trial(p_tenant_id uuid, p_days integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_t     record;
  v_end   timestamptz;
  v_email text;
BEGIN
  IF NOT app_is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 90 THEN
    RAISE EXCEPTION 'عدد أيام التمديد من 1 إلى 90' USING ERRCODE = '22023';
  END IF;
  SELECT id, name, subscription_status, trial_ends_at, is_trial INTO v_t FROM public.tenants WHERE id = p_tenant_id FOR UPDATE;
  IF v_t.id IS NULL THEN
    RAISE EXCEPTION 'المحل غير موجود' USING ERRCODE = '02000';
  END IF;
  IF v_t.subscription_status = 'active' AND v_t.is_trial IS NOT TRUE THEN
    RAISE EXCEPTION 'المحل مشترك في باقة مدفوعة؛ لا تجربة لتمديدها' USING ERRCODE = '22023';
  END IF;

  v_end := GREATEST(now(), COALESCE(v_t.trial_ends_at, now())) + make_interval(days => p_days);
  UPDATE public.tenants
     SET trial_ends_at = v_end,
         subscription_status = 'trial',
         is_trial = true,
         locked_at = NULL,
         purge_at = NULL,
         updated_at = now()
   WHERE id = p_tenant_id;

  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  INSERT INTO public.saas_security_logs (user_id, user_email, action, details, occurred_at)
  VALUES (auth.uid()::text, v_email, 'extend_trial',
          format('tenant %s (%s): +%s days, trial ends %s (was %s)', p_tenant_id, v_t.name, p_days, v_end, v_t.trial_ends_at), now());

  RETURN jsonb_build_object('trial_ends_at', v_end);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_extend_trial(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_extend_trial(uuid, integer) TO authenticated;

-- A shop's creation date is history: nobody rewrites it.
CREATE OR REPLACE FUNCTION public.tenants_keep_created_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS tenants_keep_created_at ON public.tenants;
CREATE TRIGGER tenants_keep_created_at BEFORE UPDATE OF created_at ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.tenants_keep_created_at();
