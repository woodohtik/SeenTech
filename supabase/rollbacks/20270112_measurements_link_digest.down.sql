-- Rollback of 20270112000004_measurements_link_digest.sql.
-- Links issued while it was in place are lost (only their digest was kept):
-- the shop sends a new one. Links sent before it are lost too, for the same reason.
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
    RAISE EXCEPTION 'Ù„Ø§ ØªÙ…Ù„Ùƒ ØµÙ„Ø§Ø­ÙŠØ© ØªØ¹Ø¯ÙŠÙ„ Ø§Ù„Ø¹Ù…Ù„Ø§Ø¡' USING ERRCODE = '42501';
  END IF;
  UPDATE public.customers SET measurements_token = v_token, measurements_token_expires_at = v_until
   WHERE id = p_customer_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('token', v_token, 'expires_at', v_until);
END;
$function$;

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
  VALUES (v_c.tenant_id, 'ØªØ­Ø¯ÙŠØ« Ù…Ù‚Ø§Ø³Ø§Øª',
          'Ø³Ø¬Ù‘Ù„ Ø§Ù„Ø¹Ù…ÙŠÙ„ ' || COALESCE(v_c.name, '') || ' Ù…Ù‚Ø§Ø³Ø§ØªÙ‡ Ø¹Ø¨Ø± Ø§Ù„Ø±Ø§Ø¨Ø·.',
          'order', 'unread', jsonb_build_object('customer_id', v_c.id, 'kind', 'measurements_from_link'));
  RETURN jsonb_build_object('customer_id', v_c.id);
END;
$function$;

DROP FUNCTION IF EXISTS public.measurements_token_digest(uuid);
