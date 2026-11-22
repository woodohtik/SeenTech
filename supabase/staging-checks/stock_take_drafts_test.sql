-- seen-readiness-fixes-task.md P4 (20270105000004). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/stock_take_drafts_test.sql
DO $test$
DECLARE
  T uuid := gen_random_uuid();
  B1 uuid := gen_random_uuid();
  own text := gen_random_uuid()::text;
  cas text := gen_random_uuid()::text;
  i1 uuid := gen_random_uuid();
  v jsonb;
  adj uuid;
  checks int := 0;
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test) VALUES (T, 'جرد', 'st@example.invalid', '0500000017', 'active', true);
  INSERT INTO public.branches (id, tenant_id, name, location, is_main) VALUES (B1, T, 'أ', 'x', true);
  INSERT INTO public.staff (id, tenant_id, uid, name, email, role, branch_id, status, is_test) VALUES
    (gen_random_uuid(), T, own, 'owner', 'st-own@example.invalid', 'owner', B1, 'active', true),
    (gen_random_uuid(), T, cas, 'cashier', 'st-cas@example.invalid', 'cashier', B1, 'active', true);
  INSERT INTO public.inventory_items (id, tenant_id, name, sku, category, category_key, unit, base_unit, conversion_rate, price_per_unit, min_threshold)
  VALUES (i1, T, 'قماش', 'ST-1-' || left(i1::text, 6), 'other', 'cotton', 'meter', 'meter', 1, 10, 0);
  INSERT INTO public.branch_inventory (tenant_id, branch_id, item_id, quantity) VALUES (T, B1, i1, 40);
  SET LOCAL session_replication_role = origin;

  -- 1. A count saved as a draft (counted 35 of 40) moves nothing.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v := public.approve_stock_take(gen_random_uuid(), B1, 'Physical Count', 'جرد', jsonb_build_array(jsonb_build_object('item_id', i1, 'physical_qty', 35, 'unit_cost', 10)), 'Draft');
  adj := COALESCE((v->>'adjustment_id')::uuid, (SELECT id FROM public.inventory_adjustments WHERE tenant_id = T::text LIMIT 1));
  IF (SELECT quantity FROM public.branch_inventory WHERE branch_id = B1 AND item_id = i1) <> 40 THEN RAISE EXCEPTION 'FAIL a draft moved stock'; END IF;
  checks := checks + 1;
  RESET ROLE;

  -- Stock moves before approval (a sale): 40 -> 38.
  UPDATE public.branch_inventory SET quantity = 38 WHERE branch_id = B1 AND item_id = i1;

  -- 2. A cashier cannot approve it.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', cas, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.approve_stock_take_draft(gen_random_uuid(), adj);
    RAISE EXCEPTION 'FAIL a cashier approved a count';
  EXCEPTION WHEN insufficient_privilege THEN checks := checks + 1;
  END;

  -- 3. Approved: the stock is the counted 35 (difference taken from the live 38), once.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  v := public.approve_stock_take_draft('00000000-0000-0000-0000-0000000000b1', adj);
  v := public.approve_stock_take_draft('00000000-0000-0000-0000-0000000000b1', adj);
  RESET ROLE;
  IF NOT (v->>'replayed')::boolean
     OR (SELECT quantity FROM public.branch_inventory WHERE branch_id = B1 AND item_id = i1) <> 35
     OR (SELECT status::text FROM public.inventory_adjustments WHERE id = adj) <> 'Approved'
     OR (SELECT variance_qty FROM public.adjustment_items WHERE adjustment_id = adj) <> -3 THEN
    RAISE EXCEPTION 'FAIL approve: stock %, variance %', (SELECT quantity FROM public.branch_inventory WHERE branch_id = B1 AND item_id = i1),
      (SELECT variance_qty FROM public.adjustment_items WHERE adjustment_id = adj);
  END IF;
  checks := checks + 2;

  -- 4. An approved count is not approved again.
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.approve_stock_take_draft(gen_random_uuid(), adj);
    RAISE EXCEPTION 'FAIL approved twice';
  EXCEPTION WHEN invalid_parameter_value THEN checks := checks + 1;
  END;
  RESET ROLE;

  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
