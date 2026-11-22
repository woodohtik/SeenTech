-- seen-readiness-fixes-task.md P4 (20270105000003). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/stock_transfers_atomic_test.sql
DO $test$
DECLARE
  T uuid := gen_random_uuid();
  B1 uuid := gen_random_uuid();
  B2 uuid := gen_random_uuid();
  own text := gen_random_uuid()::text;
  cas text := gen_random_uuid()::text;
  s_own uuid := gen_random_uuid();
  i1 uuid := gen_random_uuid();
  i2 uuid := gen_random_uuid();
  tr uuid := gen_random_uuid();
  tr2 uuid := gen_random_uuid();
  tr3 uuid := gen_random_uuid();
  v jsonb;
  checks int := 0;
  qty numeric;
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test) VALUES (T, 'نقل', 'tr@example.invalid', '0500000016', 'active', true);
  INSERT INTO public.branches (id, tenant_id, name, location, is_main) VALUES (B1, T, 'أ', 'x', true), (B2, T, 'ب', 'y', false);
  INSERT INTO public.staff (id, tenant_id, uid, name, email, role, branch_id, status, is_test) VALUES
    (s_own, T, own, 'owner', 'tr-own@example.invalid', 'owner', B1, 'active', true),
    (gen_random_uuid(), T, cas, 'cashier', 'tr-cas@example.invalid', 'cashier', B1, 'active', true);
  INSERT INTO public.inventory_items (id, tenant_id, name, sku, category, category_key, unit, base_unit, conversion_rate, price_per_unit, min_threshold) VALUES
    (i1, T, 'قماش', 'TR-1-' || left(i1::text, 6), 'other', 'cotton', 'meter', 'meter', 1, 10, 0),
    (i2, T, 'أزرار', 'TR-2-' || left(i2::text, 6), 'other', 'cotton', 'piece', 'piece', 1, 1, 0);
  INSERT INTO public.branch_inventory (tenant_id, branch_id, item_id, quantity) VALUES (T, B1, i1, 50), (T, B1, i2, 5);
  INSERT INTO public.stock_transfers (id, tenant_id, from_branch_id, to_branch_id, status) VALUES
    (tr, T, B1, B2, 'pending'), (tr2, T, B1, B2, 'pending'), (tr3, T, B1, B2, 'pending');
  INSERT INTO public.stock_transfer_items (tenant_id, transfer_id, item_id, item_name, requested_quantity) VALUES
    (T, tr, i1, 'قماش', 20), (T, tr, i2, 'أزرار', 3),
    (T, tr2, i1, 'قماش', 10), (T, tr2, i2, 'أزرار', 9),   -- buttons short: nothing should move
    (T, tr3, i1, 'قماش', 5);
  SET LOCAL session_replication_role = origin;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1. Shipping moves every line at once; a second call moves nothing more.
  v := public.ship_stock_transfer(tr);
  v := public.ship_stock_transfer(tr);
  IF NOT (v->>'replayed')::boolean OR (SELECT quantity FROM public.branch_inventory WHERE branch_id = B1 AND item_id = i1) <> 30
     OR (SELECT quantity FROM public.branch_inventory WHERE branch_id = B1 AND item_id = i2) <> 2
     OR (SELECT status FROM public.stock_transfers WHERE id = tr) <> 'in_transit' THEN
    RAISE EXCEPTION 'FAIL ship';
  END IF;
  checks := checks + 2;

  -- 2. One line short of stock: nothing moves at all.
  BEGIN
    PERFORM public.ship_stock_transfer(tr2);
    RAISE EXCEPTION 'FAIL shipped without stock';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
  END;
  IF (SELECT quantity FROM public.branch_inventory WHERE branch_id = B1 AND item_id = i1) <> 30
     OR (SELECT status FROM public.stock_transfers WHERE id = tr2) <> 'pending' THEN
    RAISE EXCEPTION 'FAIL a half-shipped voucher';
  END IF;
  checks := checks + 1;

  -- 3. Receiving more than shipped is refused; a shortfall is kept.
  BEGIN
    PERFORM public.receive_stock_transfer(tr, jsonb_build_object(i1::text, 25), NULL);
    RAISE EXCEPTION 'FAIL received more than shipped';
  EXCEPTION WHEN invalid_parameter_value THEN checks := checks + 1;
  END;
  v := public.receive_stock_transfer(tr, jsonb_build_object(i1::text, 18), 'وصل');
  SELECT quantity INTO qty FROM public.branch_inventory WHERE branch_id = B2 AND item_id = i1;
  IF qty <> 18 OR (SELECT quantity FROM public.branch_inventory WHERE branch_id = B2 AND item_id = i2) <> 3
     OR (SELECT status FROM public.stock_transfers WHERE id = tr) <> 'completed'
     OR (SELECT remarks FROM public.stock_transfers WHERE id = tr) NOT LIKE '%نقص في الاستلام%' THEN
    RAISE EXCEPTION 'FAIL receive: %', qty;
  END IF;
  checks := checks + 1;

  -- 4. A shipped voucher cancelled puts the stock back; a pending one is rejected.
  v := public.ship_stock_transfer(tr3);
  v := public.reject_stock_transfer(tr3, 'الفرع لا يحتاجه');
  IF v->>'status' <> 'cancelled' OR (SELECT quantity FROM public.branch_inventory WHERE branch_id = B1 AND item_id = i1) <> 30 THEN
    RAISE EXCEPTION 'FAIL cancel in transit';
  END IF;
  v := public.reject_stock_transfer(tr2, 'غير مطلوب');
  IF v->>'status' <> 'rejected' THEN RAISE EXCEPTION 'FAIL reject'; END IF;
  checks := checks + 2;

  -- 5. A cashier cannot move stock, and the old per-line functions are closed.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', cas, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.reject_stock_transfer(tr, 'xxx');
    RAISE EXCEPTION 'FAIL a cashier touched a transfer';
  EXCEPTION WHEN insufficient_privilege THEN checks := checks + 1;
  END;
  BEGIN
    PERFORM public.transfer_ship_item('x', tr, B1, i1, 1);
    RAISE EXCEPTION 'FAIL the old function is open';
  EXCEPTION WHEN insufficient_privilege THEN checks := checks + 1;
  END;
  RESET ROLE;

  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
