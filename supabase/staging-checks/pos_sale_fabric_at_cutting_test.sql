-- seen-cutting-fabric-pos-orders-fix-task.md (20270115000000). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/pos_sale_fabric_at_cutting_test.sql
-- Ends with 'PASS: ...' or 'FAIL ...'. The cloth's stock is compared before and after every step.
DO $test$
DECLARE
  T uuid := gen_random_uuid();
  B uuid := gen_random_uuid();
  own text := gen_random_uuid()::text;
  s_own uuid := gen_random_uuid();
  sh uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  fab uuid := gen_random_uuid();
  o_a uuid; o_b uuid; o_c uuid; o_d uuid; o_b2b uuid; o_tail uuid; o_old uuid;
  l_a uuid; l_b uuid; l_c uuid; l_d uuid; l_tail uuid;
  v jsonb;
  before numeric;
  op uuid;
  hint text;
  checks int := 0;
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test)
  VALUES (T, 'قص نقطة البيع', 'pos-cut@example.invalid', '0500000011', 'active', true);
  INSERT INTO public.branches (id, tenant_id, name, location, is_main) VALUES (B, T, 'main', 'x', true);
  INSERT INTO public.staff (id, tenant_id, uid, name, email, role, branch_id, status, is_test)
  VALUES (s_own, T, own, 'owner', 'pos-cut-own@example.invalid', 'owner', B, 'active', true);
  INSERT INTO public.shifts (id, tenant_id, branch_id, staff_id, staff_name, opening_balance, status, start_time)
  VALUES (sh, T, B, s_own, 'owner', 0, 'open', now());
  INSERT INTO public.customers (id, tenant_id, name, phone, is_test) VALUES (c, T, 'c', '0500000012', true);
  INSERT INTO public.inventory_items (id, tenant_id, name, sku, category, category_key, unit, base_unit, conversion_rate, price_per_unit, min_threshold)
  VALUES (fab, T, 'قطن', 'PC-' || left(fab::text, 6), 'fabric', 'cotton', 'meter', 'meter', 1, 20, 0);
  INSERT INTO public.branch_inventory (tenant_id, branch_id, item_id, quantity) VALUES (T, B, fab, 100);
  SET LOCAL session_replication_role = origin;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- Four thobes sold from the POS: three take 3.5 m at the sale, one carries no figure.
  v := public.create_pos_sale(gen_random_uuid(),
    jsonb_build_object('shift_id', sh, 'customer_name', 'A', 'status', 'measurements_taken', 'payment_method', 'cash', 'paid_amount', 0, 'delivery_date', now()::text),
    jsonb_build_array(jsonb_build_object('type', 'custom', 'name', 'ثوب', 'price', 100, 'quantity', 1, 'fabric_id', fab, 'fabric', 'قطن', 'consumed_meters', 3.5)), '{}'::jsonb);
  o_a := (v->>'order_id')::uuid;
  v := public.create_pos_sale(gen_random_uuid(),
    jsonb_build_object('shift_id', sh, 'customer_name', 'B', 'status', 'measurements_taken', 'payment_method', 'cash', 'paid_amount', 0, 'delivery_date', now()::text),
    jsonb_build_array(jsonb_build_object('type', 'custom', 'name', 'ثوب', 'price', 100, 'quantity', 1, 'fabric_id', fab, 'fabric', 'قطن', 'consumed_meters', 3.5)), '{}'::jsonb);
  o_b := (v->>'order_id')::uuid;
  v := public.create_pos_sale(gen_random_uuid(),
    jsonb_build_object('shift_id', sh, 'customer_name', 'C', 'status', 'measurements_taken', 'payment_method', 'cash', 'paid_amount', 0, 'delivery_date', now()::text),
    jsonb_build_array(jsonb_build_object('type', 'custom', 'name', 'ثوب', 'price', 100, 'quantity', 1, 'fabric_id', fab, 'fabric', 'قطن', 'consumed_meters', 3.5)), '{}'::jsonb);
  o_c := (v->>'order_id')::uuid;
  v := public.create_pos_sale(gen_random_uuid(),
    jsonb_build_object('shift_id', sh, 'customer_name', 'D', 'status', 'measurements_taken', 'payment_method', 'cash', 'paid_amount', 0, 'delivery_date', now()::text,
                       'notes', '__B2B_METADATA__:{"companyName":"شركة","buyerTrn":"300000000000003"}'),
    jsonb_build_array(jsonb_build_object('type', 'custom', 'name', 'ثوب', 'price', 100, 'quantity', 1, 'fabric_id', fab, 'fabric', 'قطن')), '{}'::jsonb);
  o_d := (v->>'order_id')::uuid;
  SELECT id INTO l_a FROM public.order_items WHERE order_id = o_a;
  SELECT id INTO l_b FROM public.order_items WHERE order_id = o_b;
  SELECT id INTO l_c FROM public.order_items WHERE order_id = o_c;
  SELECT id INTO l_d FROM public.order_items WHERE order_id = o_d;

  -- 1. The sale marks itself and records what it took.
  IF (SELECT quantity FROM public.branch_inventory WHERE item_id = fab AND branch_id = B) <> 89.5 THEN
    RAISE EXCEPTION 'FAIL the three sales should take 10.5 m (stock %)', (SELECT quantity FROM public.branch_inventory WHERE item_id = fab AND branch_id = B);
  END IF;
  IF (SELECT kind FROM public.orders WHERE id = o_a) IS DISTINCT FROM 'pos_sale'
     OR (SELECT fabric_deducted_at FROM public.orders WHERE id = o_a) IS NULL
     OR (SELECT fabric_taken_meters FROM public.order_items WHERE id = l_a) <> 3.5 THEN
    RAISE EXCEPTION 'FAIL the sale did not mark kind / stamp / taken meters';
  END IF;
  IF (SELECT fabric_deducted_at FROM public.orders WHERE id = o_d) IS NOT NULL
     OR (SELECT fabric_taken_meters FROM public.order_items WHERE id = l_d) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL a sale with no figure was stamped';
  END IF;
  checks := checks + 1;

  -- 2. Cut at the same 3.5 m: the stock does not move.
  before := (SELECT quantity FROM public.branch_inventory WHERE item_id = fab AND branch_id = B);
  PERFORM public.update_order_status_with_fabric(o_a, 'cutting', 'cutting',
    jsonb_build_array(jsonb_build_object('line_key', l_a, 'fabric_id', fab, 'meters', 3.5)), 'x', gen_random_uuid(), 'قص');
  IF (SELECT quantity FROM public.branch_inventory WHERE item_id = fab AND branch_id = B) <> before THEN
    RAISE EXCEPTION 'FAIL cutting at the sale figure moved stock (double deduction)';
  END IF;
  checks := checks + 1;

  -- 3. Cut at 4 m: only 0.5 m more comes out; the change is in the history.
  before := (SELECT quantity FROM public.branch_inventory WHERE item_id = fab AND branch_id = B);
  op := gen_random_uuid();
  PERFORM public.update_order_status_with_fabric(o_b, 'cutting', 'cutting',
    jsonb_build_array(jsonb_build_object('line_key', l_b, 'fabric_id', fab, 'meters', 4)), 'x', op, 'قص');
  IF (SELECT quantity FROM public.branch_inventory WHERE item_id = fab AND branch_id = B) <> before - 0.5 THEN
    RAISE EXCEPTION 'FAIL cutting at 4 m should take 0.5 m';
  END IF;
  IF (SELECT fabric_taken_meters FROM public.order_items WHERE id = l_b) <> 4
     OR NOT EXISTS (SELECT 1 FROM public.order_history WHERE order_id = o_b AND notes LIKE '%3.5 ← 4 م%') THEN
    RAISE EXCEPTION 'FAIL the line or the history does not show 3.5 → 4';
  END IF;
  checks := checks + 1;

  -- 4. The same request again (same p_op_id): nothing moves twice.
  before := (SELECT quantity FROM public.branch_inventory WHERE item_id = fab AND branch_id = B);
  PERFORM public.update_order_status_with_fabric(o_b, 'cutting', 'cutting',
    jsonb_build_array(jsonb_build_object('line_key', l_b, 'fabric_id', fab, 'meters', 4)), 'x', op, 'قص');
  IF (SELECT quantity FROM public.branch_inventory WHERE item_id = fab AND branch_id = B) <> before THEN
    RAISE EXCEPTION 'FAIL a replayed request moved stock again';
  END IF;
  checks := checks + 1;

  -- 5. Cut at 3 m: 0.5 m goes back to stock.
  before := (SELECT quantity FROM public.branch_inventory WHERE item_id = fab AND branch_id = B);
  PERFORM public.update_order_status_with_fabric(o_c, 'cutting', 'cutting',
    jsonb_build_array(jsonb_build_object('line_key', l_c, 'fabric_id', fab, 'meters', 3)), 'x', gen_random_uuid(), 'قص');
  IF (SELECT quantity FROM public.branch_inventory WHERE item_id = fab AND branch_id = B) <> before + 0.5 THEN
    RAISE EXCEPTION 'FAIL cutting at 3 m should give 0.5 m back';
  END IF;
  checks := checks + 1;

  -- 6. A sale with no figure: the whole amount comes out at cutting; its company stays in notes.
  before := (SELECT quantity FROM public.branch_inventory WHERE item_id = fab AND branch_id = B);
  PERFORM public.update_order_status_with_fabric(o_d, 'cutting', 'cutting',
    jsonb_build_array(jsonb_build_object('line_key', l_d, 'fabric_id', fab, 'meters', 3)), '__ORDER_METADATA_V2__:{"items":[]}', gen_random_uuid(), 'قص');
  IF (SELECT quantity FROM public.branch_inventory WHERE item_id = fab AND branch_id = B) <> before - 3
     OR (SELECT fabric_deducted_at FROM public.orders WHERE id = o_d) IS NULL THEN
    RAISE EXCEPTION 'FAIL a sale with no figure was not deducted in full at cutting';
  END IF;
  IF (SELECT notes FROM public.orders WHERE id = o_d) NOT LIKE '__B2B_METADATA__:%' THEN
    RAISE EXCEPTION 'FAIL the status change replaced the buyer''s company and tax number';
  END IF;
  checks := checks + 1;

  -- 7. A line from another order: a clear refusal, not a permission error.
  BEGIN
    PERFORM public.update_order_status_with_fabric(o_a, 'sewing', 'sewing',
      jsonb_build_array(jsonb_build_object('line_key', l_c, 'fabric_id', fab, 'meters', 3)), 'x', gen_random_uuid(), 'x');
    RAISE EXCEPTION 'FAIL a line of another order was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT;
    IF hint IS DISTINCT FROM 'fabric_line_mismatch' THEN RAISE EXCEPTION 'FAIL wrong refusal %', hint; END IF;
  END;
  checks := checks + 1;

  -- 8. A tailoring order: as before (the figure is deducted in full at cutting).
  v := public.create_tailoring_order(gen_random_uuid(),
    jsonb_build_object('customer_id', c, 'paid_amount', 0, 'payment_method', 'cash', 'status', 'measurements_taken', 'status_key', 'measurements_taken'),
    jsonb_build_array(jsonb_build_object('garment_type', 'ثوب', 'quantity', 1, 'price', 200, 'fabric_id', fab, 'consumed_meters', 2)));
  o_tail := (v->'order'->>'id')::uuid;
  SELECT id INTO l_tail FROM public.order_items WHERE order_id = o_tail;
  before := (SELECT quantity FROM public.branch_inventory WHERE item_id = fab AND branch_id = B);
  PERFORM public.update_order_status_with_fabric(o_tail, 'cutting', 'cutting',
    jsonb_build_array(jsonb_build_object('line_key', l_tail, 'fabric_id', fab, 'meters', 2)), NULL, gen_random_uuid(), 'قص');
  IF (SELECT quantity FROM public.branch_inventory WHERE item_id = fab AND branch_id = B) <> before - 2
     OR (SELECT kind FROM public.orders WHERE id = o_tail) <> 'tailoring' THEN
    RAISE EXCEPTION 'FAIL a tailoring order no longer deducts at cutting as before';
  END IF;
  checks := checks + 1;

  -- 9. An older order with its lines in notes: as before.
  RESET ROLE;
  SET LOCAL session_replication_role = replica;
  o_old := gen_random_uuid();
  INSERT INTO public.orders (id, tenant_id, branch_id, customer_name, order_number, status, total_amount, paid_amount, delivery_date, notes)
  VALUES (o_old, T, B, 'قديم', 990001, 'measurements_taken', 100, 0, now(),
          '__ORDER_METADATA_V2__:{"items":[{"fabricId":"' || fab || '","quantity":1}]}');
  SET LOCAL session_replication_role = origin;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  before := (SELECT quantity FROM public.branch_inventory WHERE item_id = fab AND branch_id = B);
  PERFORM public.update_order_status_with_fabric(o_old, 'cutting', 'cutting',
    jsonb_build_array(jsonb_build_object('line_key', 'idx-0', 'fabric_id', fab, 'meters', 1)), NULL, gen_random_uuid(), 'قص');
  IF (SELECT quantity FROM public.branch_inventory WHERE item_id = fab AND branch_id = B) <> before - 1 THEN
    RAISE EXCEPTION 'FAIL an older order no longer deducts from its notes as before';
  END IF;
  checks := checks + 1;

  -- 10. The browser cannot set what a line took.
  BEGIN
    UPDATE public.order_items SET fabric_taken_meters = 50 WHERE id = l_a;
    IF (SELECT fabric_taken_meters FROM public.order_items WHERE id = l_a) = 50 THEN
      RAISE EXCEPTION 'FAIL fabric_taken_meters written directly';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  checks := checks + 1;

  RESET ROLE;
  RAISE EXCEPTION 'PASS: % checks (stock ends at % m)', checks,
    (SELECT quantity FROM public.branch_inventory WHERE item_id = fab AND branch_id = B);
END $test$;
