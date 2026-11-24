-- Security audit of 22 Nov 2026 (docs/security/audit-2026-11-22), batch 4:
--
-- S-16  The x-seen-offline-actor header named whoever the sender chose
--       among the shop's active staff, and a sale replayed with it was
--       recorded in that person's shift and under their name. A cashier
--       could put sales and cash into a colleague's shift.
--
-- The header now names someone only if they are the signed-in device
-- account's own staff row, or they have unlocked this same device account
-- with their PIN (a staff_acting_sessions row for this auth uid) in the last
-- 30 days -- the people who can have made an offline sale on this device.
-- Anyone else is ignored, and the sale is attributed to the device account,
-- as it was before offline attribution existed.

CREATE OR REPLACE FUNCTION public.app_offline_actor_staff_id()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_raw   text;
  v_staff uuid;
  v_uid   text := public.app_current_uid();
BEGIN
  v_raw := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-seen-offline-actor';
  IF v_raw IS NULL OR v_raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN NULL; END IF;
  SELECT s.id INTO v_staff FROM public.staff s
   WHERE s.id = v_raw::uuid AND s.status = 'active' AND s.tenant_id = public.app_current_tenant_id()
     AND (
       s.uid = v_uid
       OR EXISTS (SELECT 1 FROM public.staff_acting_sessions a
                   WHERE a.staff_id = s.id AND a.auth_uid = v_uid AND a.tenant_id = s.tenant_id
                     AND a.created_at > now() - interval '30 days')
     );
  RETURN v_staff;
END;
$function$;
