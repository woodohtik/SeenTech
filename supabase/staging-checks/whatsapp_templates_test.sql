-- seen-whatsapp-templates-task.md (20270114000000). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/whatsapp_templates_test.sql
-- Ends with 'PASS: ...' or 'FAIL: ...'.
DO $test$
DECLARE
  ta uuid := gen_random_uuid();
  owner_a text := gen_random_uuid()::text;
  cashier text := gen_random_uuid()::text;
  settings jsonb;
  ok boolean;
  results text[] := '{}';
  failed int := 0;
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.users (id, email) VALUES (owner_a, 'wa-o@x.test'), (cashier, 'wa-c@x.test');
  INSERT INTO public.tenants (id, name, owner_email, phone, owner_uid, status, whatsapp_settings)
  VALUES (ta, 'WA', 'wa-o@x.test', '0500000009', owner_a, 'active', '{"enabled": true, "template": "قالبي القديم {customer_name}"}');
  INSERT INTO public.staff (tenant_id, uid, name, email, role, status) VALUES
    (ta, owner_a, 'owner', 'wa-o@x.test', 'owner', 'active'),
    (ta, cashier, 'cashier', 'wa-c@x.test', 'cashier', 'active');
  SET LOCAL session_replication_role = origin;

  -- 1. The owner saves two templates; the others stay; the switch is kept.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  settings := public.save_whatsapp_templates(NULL, '{"tracking_link": "تتبع {tracking_url}", "measurements_link": "مقاسات {measurements_url}"}');
  settings := public.save_whatsapp_templates(false, '{"invoice": "فاتورة {order_id}"}');
  RESET ROLE;
  ok := settings -> 'templates' ->> 'tracking_link' = 'تتبع {tracking_url}'
    AND settings -> 'templates' ->> 'invoice' = 'فاتورة {order_id}'
    AND (settings ->> 'enabled')::boolean = false
    AND settings ->> 'template' = 'قالبي القديم {customer_name}';
  results := results || format('owner saves, merged, old template kept: %s', ok); IF NOT ok THEN failed := failed + 1; END IF;

  -- 2-4. Refused: an empty template, one over 1000 characters, an unknown kind.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.save_whatsapp_templates(NULL, '{"invoice": "   "}'); ok := false;
  EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  results := results || format('empty refused: %s', ok); IF NOT ok THEN failed := failed + 1; END IF;
  BEGIN
    PERFORM public.save_whatsapp_templates(NULL, jsonb_build_object('invoice', repeat('س', 1001))); ok := false;
  EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  results := results || format('over 1000 refused: %s', ok); IF NOT ok THEN failed := failed + 1; END IF;
  BEGIN
    PERFORM public.save_whatsapp_templates(NULL, '{"ready": "x"}'); ok := false;
  EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  results := results || format('unknown kind refused: %s', ok); IF NOT ok THEN failed := failed + 1; END IF;
  RESET ROLE;

  -- 5. The cashier cannot change the templates.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', cashier, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.save_whatsapp_templates(NULL, '{"invoice": "x"}'); ok := false;
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  RESET ROLE;
  results := results || format('cashier refused: %s', ok); IF NOT ok THEN failed := failed + 1; END IF;

  -- 6. An old app flipping the switch keeps the four templates.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  settings := public.save_whatsapp_settings(true, 'قالبي القديم {customer_name}');
  RESET ROLE;
  ok := settings -> 'templates' ->> 'tracking_link' = 'تتبع {tracking_url}' AND (settings ->> 'enabled')::boolean = true;
  results := results || format('old save keeps templates: %s', ok); IF NOT ok THEN failed := failed + 1; END IF;

  -- 7. No shop is left with an old template and no templates (the one-time copy).
  ok := NOT EXISTS (
    SELECT 1 FROM public.tenants
     WHERE id <> ta AND COALESCE(btrim(whatsapp_settings ->> 'template'), '') <> '' AND (whatsapp_settings -> 'templates') IS NULL);
  results := results || format('old templates copied: %s', ok); IF NOT ok THEN failed := failed + 1; END IF;

  IF failed = 0 THEN
    RAISE EXCEPTION 'PASS: % checks -- %', array_length(results, 1), array_to_string(results, '; ');
  ELSE
    RAISE EXCEPTION 'FAIL: % of % -- %', failed, array_length(results, 1), array_to_string(results, '; ');
  END IF;
END $test$;
