-- seen-readiness-fixes-task.md P4 (OPERATIONS-16; SECURITY-10) -- the
-- customer's measurements link expires, is used once, and leaves a record.
--
-- Before: customers.measurements_token was fixed forever. Anyone holding a
-- link sent months ago could read the customer's measurements and replace
-- them whole, with no record and no word to the shop.
--
-- Now:
--  * a link lasts 7 days (measurements_token_expires_at); a link already
--    sent gets 7 days from today;
--  * issue_measurements_link(customer) (customers.edit) makes a fresh link
--    -- the previous one stops working; revoke_measurements_link(customer)
--    ends it at once;
--  * save_public_measurements(token, measurements) (server only): refused
--    after expiry; keeps the previous measurements in
--    customer_measurement_changes, saves the new ones and tells the shop
--    (notifications). The link stays valid until it expires, so a customer
--    can correct a value right after saving (the task allows a time limit
--    or a single use; this is the time limit).
-- Rollback: supabase/rollbacks/20270105_measurement_links.down.sql

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS measurements_token_expires_at timestamptz;
UPDATE public.customers SET measurements_token_expires_at = now() + interval '7 days'
 WHERE measurements_token_expires_at IS NULL;
ALTER TABLE public.customers ALTER COLUMN measurements_token_expires_at SET DEFAULT now() + interval '7 days';

CREATE TABLE IF NOT EXISTS public.customer_measurement_changes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid        NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  previous    jsonb,
  new         jsonb,
  source      text        NOT NULL DEFAULT 'public_link',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_measurement_changes_customer ON public.customer_measurement_changes (customer_id, created_at DESC);
ALTER TABLE public.customer_measurement_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_measurement_changes_read ON public.customer_measurement_changes;
CREATE POLICY customer_measurement_changes_read ON public.customer_measurement_changes FOR SELECT TO authenticated
  USING (tenant_id = app_current_tenant_id() AND app_has_permission('customers.view'::text));
REVOKE INSERT, UPDATE, DELETE ON public.customer_measurement_changes FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.issue_measurements_link(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.app_current_tenant_id();
  v_token  uuid := gen_random_uuid();
  v_until  timestamptz := now() + interval '7 days';
BEGIN
  IF v_tenant IS NULL OR NOT public.app_has_permission('customers.edit') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل العملاء' USING ERRCODE = '42501';
  END IF;
  UPDATE public.customers SET measurements_token = v_token, measurements_token_expires_at = v_until
   WHERE id = p_customer_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('token', v_token, 'expires_at', v_until);
END;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_measurements_link(p_customer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.app_current_tenant_id();
BEGIN
  IF v_tenant IS NULL OR NOT public.app_has_permission('customers.edit') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل العملاء' USING ERRCODE = '42501';
  END IF;
  UPDATE public.customers SET measurements_token = gen_random_uuid(), measurements_token_expires_at = now()
   WHERE id = p_customer_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
END;
$function$;

-- The public form's save (server.ts, service_role). Returns null when the
-- link is unknown or has expired.
CREATE OR REPLACE FUNCTION public.save_public_measurements(p_token uuid, p_measurements jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_c record;
BEGIN
  SELECT id, tenant_id, name, measurements, measurements_token_expires_at INTO v_c
    FROM public.customers WHERE measurements_token = p_token FOR UPDATE;
  IF NOT FOUND OR v_c.measurements_token_expires_at IS NULL OR v_c.measurements_token_expires_at <= now() THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.customer_measurement_changes (tenant_id, customer_id, previous, new)
  VALUES (v_c.tenant_id, v_c.id, v_c.measurements, p_measurements);
  UPDATE public.customers SET measurements = p_measurements WHERE id = v_c.id;
  INSERT INTO public.notifications (tenant_id, title, message, type, status, metadata)
  VALUES (v_c.tenant_id, 'تحديث مقاسات',
          'سجّل العميل ' || COALESCE(v_c.name, '') || ' مقاساته عبر الرابط.',
          'order', 'unread', jsonb_build_object('customer_id', v_c.id, 'kind', 'measurements_from_link'));
  RETURN jsonb_build_object('customer_id', v_c.id);
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_measurements_link(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_measurements_link(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_public_measurements(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_measurements_link(uuid), public.revoke_measurements_link(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_public_measurements(uuid, jsonb) TO service_role;
