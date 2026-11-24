-- 1. seen-measurements-basic-advanced-task.md, section 2 (question 6): a note
--    per measurement lives in customers.measurements->'fieldNotes' (staff
--    only). The customer's own link replaces the whole measurements object,
--    which would erase the tailor's notes. Now the link's save keeps the
--    stored notes and drops any notes it is sent. No table change (jsonb).
--
-- 2. 20270112000004 was saved with its Arabic text garbled (UTF-8 read as
--    cp1252): the shop's "measurements updated" notification and the
--    permission error of issue_measurements_link showed unreadable
--    characters. Both functions are recreated here with the text restored,
--    otherwise unchanged.

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
  v_c   record;
  v_new jsonb;
BEGIN
  SELECT id, tenant_id, name, measurements, measurements_token_expires_at INTO v_c
    FROM public.customers WHERE measurements_token = public.measurements_token_digest(p_token) FOR UPDATE;
  IF NOT FOUND OR v_c.measurements_token_expires_at IS NULL OR v_c.measurements_token_expires_at <= now() THEN
    RETURN NULL;
  END IF;
  -- The customer's link never writes the tailor's notes, and never erases
  -- them: whatever notes are stored stay, any sent are dropped.
  v_new := COALESCE(p_measurements, '{}'::jsonb) - 'fieldNotes';
  IF jsonb_typeof(v_c.measurements -> 'fieldNotes') = 'object' THEN
    v_new := v_new || jsonb_build_object('fieldNotes', v_c.measurements -> 'fieldNotes');
  END IF;
  INSERT INTO public.customer_measurement_changes (tenant_id, customer_id, previous, new)
  VALUES (v_c.tenant_id, v_c.id, v_c.measurements, v_new);
  UPDATE public.customers SET measurements = v_new WHERE id = v_c.id;
  INSERT INTO public.notifications (tenant_id, title, message, type, status, metadata)
  VALUES (v_c.tenant_id, 'تحديث مقاسات',
          'سجّل العميل ' || COALESCE(v_c.name, '') || ' مقاساته عبر الرابط.',
          'order', 'unread', jsonb_build_object('customer_id', v_c.id, 'kind', 'measurements_from_link'));
  RETURN jsonb_build_object('customer_id', v_c.id);
END;
$function$;
