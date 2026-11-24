-- Rollback of 20270112000003_offline_actor_bound_to_device.sql: the definition as it was.
CREATE OR REPLACE FUNCTION public.app_offline_actor_staff_id()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_raw   text;
  v_staff uuid;
BEGIN
  v_raw := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-seen-offline-actor';
  IF v_raw IS NULL OR v_raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN NULL; END IF;
  SELECT id INTO v_staff FROM public.staff
   WHERE id = v_raw::uuid AND status = 'active' AND tenant_id = public.app_current_tenant_id();
  RETURN v_staff;
END;
$function$;
