-- seen-readiness-fixes-task.md P1.1 (20270102000001/2): the sales charge what
-- the cart showed. Run on staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/one_tax_engine_sales_test.sql
DO $test$
DECLARE
  T uuid := gen_random_uuid();
  B uuid := gen_random_uuid();
  own text := gen_random_uuid()::text;
  s_own uuid := gen_random_uuid();
  sh uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  it_incl uuid := gen_random_uuid();
  it_excl uuid := gen_random_uuid();
  it_exempt uuid := gen_random_uuid();
  v jsonb;
  o record;
  checks int := 0;
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.tenants (id, name, owner_email, phone, status, owner_uid, is_test, vat_number, is_tax_enabled, default_tax_rate, tax_settings)
  VALUES (T, 'محل الضريبة', 'tax-engine@example.invalid', '0500000020', 'active', NULL, true, '300000000000003', true, 15,
          '{"enabled": true, "trn": "300000000000003", "vatRate": 15, "tailoringTaxType": "exclusive"}'::jsonb);
  INSERT INTO public.branches (id, tenant_id, name, location, is_main) VALUES (B, T, 'main', 'x', true);
  INSERT INTO public.staff (id, tenant_id, uid, name, email, role, branch_id, status, is_test)
  VALUES (s_own, T, own, 'owner', 'te-own@example.invalid', 'owner', B, 'active', true);
  INSERT INTO public.shifts (id, tenant_id, branch_id, staff_id, staff_name, opening_balance, status, start_time)
  VALUES (sh, T, B, s_own, 'owner', 0, 'open', now());
  INSERT INTO public.customers (id, tenant_id, name, phone, is_test) VALUES (c, T, 'c', '0500000021', true);
  SET LOCAL session_replication_role = origin;
  -- Items saved the way the item screen saves them (the tax type inside description).
  INSERT INTO public.inventory_items (id, tenant_id, name, sku, category, unit, conversion_rate, price_per_unit, description)
  VALUES (it_incl, T, 'شامل', 'TE-1', 'other', 'piece', 1, 115, '__INVENTORY_METADATA__:{"costPrice":0,"taxType":"inclusive","originalDescription":""}'),
         (it_excl, T, 'غير شامل', 'TE-2', 'other', 'piece', 1, 10.05, '__INVENTORY_METADATA__:{"costPrice":0,"taxType":"exclusive","originalDescription":""}'),
         (it_exempt, T, 'معفى', 'TE-3', 'other', 'piece', 1, 50, '__INVENTORY_METADATA__:{"costPrice":0,"taxType":"exempt","originalDescription":""}');
  IF (SELECT tax_type FROM public.inventory_items WHERE id = it_incl) <> 'inclusive'
     OR (SELECT tax_type FROM public.inventory_items WHERE id = it_exempt) <> 'exempt' THEN
    RAISE EXCEPTION 'FAIL the item''s tax type was not read from its description';
  END IF;
  checks := checks + 1;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1. MONEY-01: an inclusive item at 115 is charged 115 (tax 15), and paying 115 leaves nothing owed.
  v := public.create_pos_sale(gen_random_uuid(),
    jsonb_build_object('shift_id', sh, 'customer_name', 'W', 'status', 'delivered', 'payment_method', 'cash', 'paid_amount', 115, 'delivery_date', now()::text),
    jsonb_build_array(jsonb_build_object('type', 'ready_made', 'item_id', it_incl, 'name', 'شامل', 'quantity', 1, 'price', 115)), '{}'::jsonb);
  SELECT total_amount, tax_amount, paid_amount, tax_rate INTO o FROM public.orders WHERE id = (v->>'order_id')::uuid;
  IF o.total_amount <> 115 OR o.tax_amount <> 15 OR o.paid_amount <> 115 OR o.tax_rate <> 0.15 THEN
    RAISE EXCEPTION 'FAIL inclusive 115: total % tax % paid % rate %', o.total_amount, o.tax_amount, o.paid_amount, o.tax_rate;
  END IF;
  checks := checks + 1;

  -- 2. MONEY-04: 3 x 10.05 is accepted at the cart's 34.68 (was refused).
  v := public.create_pos_sale(gen_random_uuid(),
    jsonb_build_object('shift_id', sh, 'customer_name', 'W', 'status', 'delivered', 'payment_method', 'cash', 'paid_amount', 34.68, 'delivery_date', now()::text),
    jsonb_build_array(
      jsonb_build_object('type', 'ready_made', 'item_id', it_excl, 'name', 'x', 'quantity', 1, 'price', 10.05),
      jsonb_build_object('type', 'ready_made', 'item_id', it_excl, 'name', 'x', 'quantity', 1, 'price', 10.05),
      jsonb_build_object('type', 'ready_made', 'item_id', it_excl, 'name', 'x', 'quantity', 1, 'price', 10.05)), '{}'::jsonb);
  IF (SELECT total_amount FROM public.orders WHERE id = (v->>'order_id')::uuid) <> 34.68 THEN RAISE EXCEPTION 'FAIL 3 x 10.05'; END IF;
  checks := checks + 1;

  -- 3. A mixed sale with a fixed discount: the lines add up to the order and the invoice, to the halala.
  v := public.create_pos_sale(gen_random_uuid(),
    jsonb_build_object('shift_id', sh, 'customer_name', 'W', 'status', 'delivered', 'payment_method', 'cash', 'paid_amount', 0, 'delivery_date', now()::text),
    jsonb_build_array(
      jsonb_build_object('type', 'ready_made', 'item_id', it_incl, 'name', 'a', 'quantity', 2, 'price', 115),
      jsonb_build_object('type', 'ready_made', 'item_id', it_exempt, 'name', 'b', 'quantity', 1, 'price', 50),
      jsonb_build_object('type', 'custom', 'name', 'c', 'quantity', 1, 'price', 100, 'taxType', 'exclusive')),
    '{"discount_type": "fixed", "discount_value": 25}'::jsonb);
  SELECT o2.total_amount, o2.tax_amount, i.subtotal, i.tax_amount AS inv_tax, i.total_amount AS inv_total,
         (SELECT sum(line_net) FROM public.order_items WHERE order_id = o2.id) AS lines_net,
         (SELECT sum(line_tax) FROM public.order_items WHERE order_id = o2.id) AS lines_tax
    INTO o FROM public.orders o2 JOIN public.tax_invoices i ON i.order_id = o2.id WHERE o2.id = (v->>'order_id')::uuid;
  -- 230 (incl) + 50 (exempt) + 115 (100 excl + 15) = 395, minus 25 = 370.
  IF o.total_amount <> 370 OR o.inv_total <> 370 OR o.lines_net <> o.subtotal OR o.lines_tax <> o.tax_amount
     OR o.lines_tax <> o.inv_tax OR o.subtotal + o.tax_amount <> o.total_amount THEN
    RAISE EXCEPTION 'FAIL mixed sale: %', row_to_json(o);
  END IF;
  checks := checks + 1;

  -- 4. The tailoring order: a fixed discount comes off what the customer pays (exclusive shop: 100 + 15 - 10 = 105).
  v := public.create_tailoring_order(gen_random_uuid(),
    jsonb_build_object('customer_id', c, 'paid_amount', 0, 'status', 'measurements_taken', 'status_key', 'measurements_taken', 'discount_amount', 10),
    '[{"garment_type":"ثوب","quantity":1,"price":100}]'::jsonb);
  SELECT total_amount, tax_amount, tax_rate, (SELECT line_net FROM public.order_items WHERE order_id = x.id) AS ln
    INTO o FROM public.orders x WHERE x.id = (v->'order'->>'id')::uuid;
  IF o.total_amount <> 105 OR o.tax_amount <> 13.70 OR o.tax_rate <> 0.15 OR o.ln <> 91.30 THEN
    RAISE EXCEPTION 'FAIL tailoring: %', row_to_json(o);
  END IF;
  checks := checks + 1;
  RESET ROLE;

  -- 5. P1.2: a rate written as a percentage is kept as a fraction.
  SET LOCAL session_replication_role = origin;
  UPDATE public.orders SET tax_rate = 15 WHERE id = (v->'order'->>'id')::uuid;
  IF (SELECT tax_rate FROM public.orders WHERE id = (v->'order'->>'id')::uuid) <> 0.15 THEN RAISE EXCEPTION 'FAIL rate kept as 15'; END IF;
  checks := checks + 1;

  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
