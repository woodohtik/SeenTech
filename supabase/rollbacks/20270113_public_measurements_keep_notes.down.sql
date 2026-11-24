-- Rollback of 20270113000000_public_measurements_keep_notes.sql: the link's save
-- replaces the whole measurements object again (stored notes would be erased by
-- it). The Arabic text stays restored.
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
  VALUES (v_c.tenant_id, 'تحديث مقاسات',
          'سجّل العميل ' || COALESCE(v_c.name, '') || ' مقاساته عبر الرابط.',
          'order', 'unread', jsonb_build_object('customer_id', v_c.id, 'kind', 'measurements_from_link'));
  RETURN jsonb_build_object('customer_id', v_c.id);
END;
$function$;
