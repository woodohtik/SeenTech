-- seen-readiness-fixes-task.md P4 (20270105000000). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/edit_tailoring_order_test.sql
DO $test$
DECLARE
  T uuid := gen_random_uuid();
  BR uuid := gen_random_uuid();
  own text := gen_random_uuid()::text;
  cas text := gen_random_uuid()::text;
  s_own uuid := gen_random_uuid();
  s_cas uuid := gen_random_uuid();
  s_tailor uuid := gen_random_uuid();
  sh uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  v jsonb;
  o uuid;
  ord record;
  checks int := 0;
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test, vat_number, is_tax_enabled, default_tax_rate)
  VALUES (T, 'تعديل', 'edit@example.invalid', '0500000009', 'active', true, '300000000000003', true, 15);
  INSERT INTO public.branches (id, tenant_id, name, location, is_main) VALUES (BR, T, 'main', 'x', true);
  INSERT INTO public.staff (id, tenant_id, uid, name, email, role, branch_id, status, is_test) VALUES
    (s_own, T, own, 'owner', 'edit-own@example.invalid', 'owner', BR, 'active', true),
    (s_cas, T, cas, 'cashier', 'edit-cas@example.invalid', 'cashier', BR, 'active', true),
    (s_tailor, T, gen_random_uuid()::text, 'خياط', 'edit-t@example.invalid', 'tailor', BR, 'active', true);
  INSERT INTO public.shifts (id, tenant_id, branch_id, staff_id, staff_name, opening_balance, status, start_time)
  VALUES (sh, T, BR, s_own, 'owner', 0, 'open', now());
  INSERT INTO public.customers (id, tenant_id, name, phone, is_test) VALUES (c, T, 'c', '0500000010', true);
  SET LOCAL session_replication_role = origin;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v := public.create_tailoring_order(gen_random_uuid(),
    jsonb_build_object('customer_id', c, 'paid_amount', 50, 'payment_method', 'cash', 'status', 'measurements_taken', 'status_key', 'measurements_taken', 'notes', 'قديم'),
    '[{"garment_type":"ثوب","quantity":1,"price":200}]'::jsonb);
  o := (v->'order'->>'id')::uuid;

  -- 1. Before cutting: lines, price (with a reason), date, tailor, notes.
  --    (This shop adds 15% on top: 2 x 150 = 300 + 45 = 345.)
  v := public.update_tailoring_order(gen_random_uuid(), o,
    jsonb_build_object('delivery_date', (now() + interval '10 days')::text, 'assigned_tailor_id', s_tailor, 'notes', 'جديد'),
    '[{"garment_type":"ثوب","quantity":2,"price":150}]'::jsonb, 'العميل أضاف ثوباً');
  SELECT * INTO ord FROM public.orders WHERE id = o;
  IF ord.total_amount <> 345 OR ord.assigned_tailor_id <> s_tailor OR ord.notes <> 'جديد'
     OR (SELECT count(*) FROM public.order_items WHERE order_id = o) <> 1
     OR (SELECT quantity FROM public.order_items WHERE order_id = o) <> 2
     OR NOT EXISTS (SELECT 1 FROM public.order_history WHERE order_id = o AND notes LIKE 'تعديل:%العميل أضاف ثوباً%') THEN
    RAISE EXCEPTION 'FAIL edit before cutting: total % tailor % notes %', ord.total_amount, ord.assigned_tailor_id, ord.notes;
  END IF;
  checks := checks + 1;

  -- 2. A price change without a reason, or below what was paid, is refused.
  BEGIN
    PERFORM public.update_tailoring_order(gen_random_uuid(), o, '{}'::jsonb, '[{"garment_type":"ثوب","quantity":1,"price":250}]'::jsonb, NULL);
    RAISE EXCEPTION 'FAIL price changed with no reason';
  EXCEPTION WHEN invalid_parameter_value THEN checks := checks + 1;
  END;
  BEGIN
    PERFORM public.update_tailoring_order(gen_random_uuid(), o, '{}'::jsonb, '[{"garment_type":"ثوب","quantity":1,"price":20}]'::jsonb, 'تخفيض');
    RAISE EXCEPTION 'FAIL total below what was paid';
  EXCEPTION WHEN invalid_parameter_value THEN checks := checks + 1;
  END;

  -- 3. A cashier (no orders.edit) cannot edit.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', cas, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.update_tailoring_order(gen_random_uuid(), o, '{"notes":"x"}'::jsonb, NULL, NULL);
    RAISE EXCEPTION 'FAIL a cashier edited an order';
  EXCEPTION WHEN insufficient_privilege THEN checks := checks + 1;
  END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  RESET ROLE;

  -- 4. After cutting: date, tailor and notes yes; lines no.
  UPDATE public.orders SET fabric_deducted_at = now() WHERE id = o;
  SET LOCAL ROLE authenticated;
  v := public.update_tailoring_order(gen_random_uuid(), o, '{"notes":"بعد القص"}'::jsonb, NULL, NULL);
  IF (SELECT notes FROM public.orders WHERE id = o) <> 'بعد القص' THEN RAISE EXCEPTION 'FAIL notes after cutting'; END IF;
  BEGIN
    PERFORM public.update_tailoring_order(gen_random_uuid(), o, '{}'::jsonb, '[{"garment_type":"ثوب","quantity":3,"price":150}]'::jsonb, 'زيادة');
    RAISE EXCEPTION 'FAIL lines changed after cutting';
  EXCEPTION WHEN invalid_parameter_value THEN checks := checks + 2;
  END;

  -- 5. The same operation twice changes nothing more.
  v := public.update_tailoring_order('00000000-0000-0000-0000-0000000000a1', o, '{"notes":"مرة"}'::jsonb, NULL, NULL);
  v := public.update_tailoring_order('00000000-0000-0000-0000-0000000000a1', o, '{"notes":"مرتان"}'::jsonb, NULL, NULL);
  IF NOT (v->>'replayed')::boolean OR (SELECT notes FROM public.orders WHERE id = o) <> 'مرة' THEN RAISE EXCEPTION 'FAIL replay'; END IF;
  checks := checks + 1;
  RESET ROLE;

  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
