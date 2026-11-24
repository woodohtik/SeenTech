-- Security audit of 22 Nov 2026 (docs/security/audit-2026-11-22), batch 4:
--
-- S-33  The customer's measurements link was stored as is in
--       customers.measurements_token, which every staff member reads. A
--       tailor or an accountant without customers.edit could read it and
--       edit the customer's measurements through the public form.
--
-- The row now keeps a digest of the link (sha256, first 128 bits, as a uuid
-- so the column, its default and its unique index stay as they are).
-- issue_measurements_link returns the link to the person who issued it --
-- they need customers.edit -- and stores the digest; the public form's
-- lookups digest what they are given. Links already sent are digested here,
-- so they keep working until they expire.

CREATE OR REPLACE FUNCTION public.measurements_token_digest(p_token uuid)
 RETURNS uuid
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT substring(encode(extensions.digest(p_token::text, 'sha256'), 'hex') FROM 1 FOR 32)::uuid;
$function$;

REVOKE ALL ON FUNCTION public.measurements_token_digest(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.measurements_token_digest(uuid) TO authenticated, service_role;

UPDATE public.customers SET measurements_token = public.measurements_token_digest(measurements_token);

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
  -- S-33: the row keeps a digest; only the person who issued the link holds the link itself.
  UPDATE public.customers SET measurements_token = public.measurements_token_digest(v_token), measurements_token_expires_at = v_until
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
    FROM public.customers WHERE measurements_token = public.measurements_token_digest(p_token) FOR UPDATE;
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
