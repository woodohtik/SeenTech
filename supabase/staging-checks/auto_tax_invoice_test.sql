-- seen-readiness-fixes-task.md P4 (20270105000001). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/auto_tax_invoice_test.sql
DO $test$
DECLARE
  T uuid := gen_random_uuid();
  BR uuid := gen_random_uuid();
  cas text := gen_random_uuid()::text;
  s_cas uuid := gen_random_uuid();
  sh uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  v jsonb;
  o uuid;
  o2 uuid;
  checks int := 0;
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test, vat_number, is_tax_enabled, default_tax_rate)
  VALUES (T, 'فاتورة تلقائية', 'auto@example.invalid', '0500000011', 'active', true, '300000000000003', true, 15);
  INSERT INTO public.branches (id, tenant_id, name, location, is_main) VALUES (BR, T, 'main', 'x', true);
  INSERT INTO public.staff (id, tenant_id, uid, name, email, role, branch_id, status, is_test)
  VALUES (s_cas, T, cas, 'cashier', 'auto-cas@example.invalid', 'cashier', BR, 'active', true);
  INSERT INTO public.shifts (id, tenant_id, branch_id, staff_id, staff_name, opening_balance, status, start_time)
  VALUES (sh, T, BR, s_cas, 'cashier', 0, 'open', now());
  INSERT INTO public.customers (id, tenant_id, name, phone, is_test) VALUES (c, T, 'c', '0500000012', true);
  SET LOCAL session_replication_role = origin;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', cas, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v := public.create_tailoring_order(gen_random_uuid(),
    jsonb_build_object('customer_id', c, 'paid_amount', 50, 'payment_method', 'cash', 'status', 'measurements_taken', 'status_key', 'measurements_taken'),
    '[{"garment_type":"ثوب","quantity":1,"price":200}]'::jsonb);
  o := (v->'order'->>'id')::uuid;
  IF EXISTS (SELECT 1 FROM public.tax_invoices WHERE order_id = o) THEN RAISE EXCEPTION 'FAIL an invoice on the deposit alone'; END IF;
  checks := checks + 1;

  -- 1. The rest is paid: the invoice is issued by itself, once, and queued for ZATCA.
  PERFORM public.record_order_payment(gen_random_uuid(), o,
    (SELECT total_amount - paid_amount FROM public.orders WHERE id = o), 'cash', NULL, NULL, NULL, NULL);
  RESET ROLE;
  IF (SELECT count(*) FROM public.tax_invoices WHERE order_id = o) <> 1 THEN
    RAISE EXCEPTION 'FAIL no invoice on full payment: %', (SELECT string_agg(notes, ' | ') FROM public.order_history WHERE order_id = o);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.zatca_submissions WHERE kind = 'invoice' AND ref_id = o) THEN RAISE EXCEPTION 'FAIL not queued for ZATCA'; END IF;
  checks := checks + 2;

  -- 2. Delivered afterwards: still one invoice.
  SET LOCAL ROLE authenticated;
  PERFORM public.update_order_status(o, 'delivered', 'delivered', NULL, gen_random_uuid());
  RESET ROLE;
  IF (SELECT count(*) FROM public.tax_invoices WHERE order_id = o) <> 1 THEN RAISE EXCEPTION 'FAIL a second invoice on delivery'; END IF;
  checks := checks + 1;

  -- 3. A shop that is not tax-registered gets no automatic invoice.
  UPDATE public.tenants SET is_tax_enabled = false WHERE id = T;
  SET LOCAL ROLE authenticated;
  v := public.create_tailoring_order(gen_random_uuid(),
    jsonb_build_object('customer_id', c, 'paid_amount', 0, 'payment_method', 'cash', 'status', 'measurements_taken', 'status_key', 'measurements_taken'),
    '[{"garment_type":"ثوب","quantity":1,"price":100}]'::jsonb);
  o2 := (v->'order'->>'id')::uuid;
  PERFORM public.record_order_payment(gen_random_uuid(), o2,
    (SELECT total_amount FROM public.orders WHERE id = o2), 'cash', NULL, NULL, NULL, NULL);
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM public.tax_invoices WHERE order_id = o2) THEN RAISE EXCEPTION 'FAIL an invoice for a shop without tax'; END IF;
  checks := checks + 1;

  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
