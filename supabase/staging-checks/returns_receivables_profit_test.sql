-- seen-readiness-fixes-task.md P6 (20270108000002). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/returns_receivables_profit_test.sql
DO $test$
DECLARE
  st record;
  ord record;
  item record;
  sh uuid;
  r jsonb;
  s0 jsonb;
  s1 jsonb;
  ret record;
  n int;
  checks int := 0;
BEGIN
  -- An order with an item not yet returned, whose shop has a working account.
  SELECT o.id AS order_id, o.tenant_id, o.total_amount, o.tax_rate, o.order_date INTO ord
    FROM public.orders o JOIN public.tenants t ON t.id = o.tenant_id
   WHERE o.status::text <> 'cancelled' AND o.total_amount > 0 AND t.owner_uid IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id AND oi.quantity >= 1 AND oi.price > 0)
     AND NOT EXISTS (SELECT 1 FROM public.sales_returns sr WHERE sr.order_id = o.id)
     AND EXISTS (SELECT 1 FROM public.staff s WHERE s.tenant_id = o.tenant_id AND s.uid = t.owner_uid)
   ORDER BY o.order_date DESC LIMIT 1;
  IF ord.order_id IS NULL THEN RAISE EXCEPTION 'SKIP: need an order to return from'; END IF;
  SELECT s.id, s.uid, s.branch_id INTO st FROM public.staff s JOIN public.tenants t ON t.id = s.tenant_id
   WHERE s.tenant_id = ord.tenant_id AND s.uid = t.owner_uid LIMIT 1;
  SELECT oi.id, oi.price INTO item FROM public.order_items oi WHERE oi.order_id = ord.order_id AND oi.quantity >= 1 AND oi.price > 0 LIMIT 1;
  UPDATE public.tenants SET status = 'active', trashed_at = NULL, subscription_status = 'active', subscription_end_date = NULL WHERE id = ord.tenant_id;
  UPDATE public.shifts SET status = 'closed' WHERE staff_id = st.id AND status = 'open';
  INSERT INTO public.shifts (tenant_id, branch_id, staff_id, staff_name, status) VALUES (ord.tenant_id, st.branch_id, st.id, 'chk', 'open') RETURNING id INTO sh;
  -- Make it a credit sale: nothing paid yet.
  UPDATE public.orders SET paid_amount = 0 WHERE id = ord.order_id;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', st.uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', st.uid::text, true);
  SET LOCAL ROLE authenticated;
  s0 := public.get_tenant_financial_summary(ord.tenant_id, (now() AT TIME ZONE 'Asia/Riyadh')::date, (now() AT TIME ZONE 'Asia/Riyadh')::date);
  r := public.process_sales_return(gen_random_uuid(), ord.order_id, sh, jsonb_build_array(jsonb_build_object('order_item_id', item.id, 'quantity', 1)), 'chk');
  s1 := public.get_tenant_financial_summary(ord.tenant_id, (now() AT TIME ZONE 'Asia/Riyadh')::date, (now() AT TIME ZONE 'Asia/Riyadh')::date);
  RESET ROLE;
  SELECT * INTO ret FROM public.sales_returns WHERE id = (r->>'return_id')::uuid;

  -- 1. An unpaid sale's return: a credit note of the full value, no cash back.
  IF ret.total_amount <= 0 OR ret.refunded_amount <> 0 OR (r->>'credit_note_amount')::numeric <> ret.total_amount THEN
    RAISE EXCEPTION 'FAIL credit note % / refunded %', ret.total_amount, ret.refunded_amount;
  END IF;
  checks := checks + 1;
  -- 2. What the customer owes goes down by it.
  IF (SELECT credited_amount FROM public.orders WHERE id = ord.order_id) <> ret.total_amount
     OR (SELECT remaining_amount FROM public.orders WHERE id = ord.order_id) <> ord.total_amount - ret.total_amount THEN
    RAISE EXCEPTION 'FAIL receivable: remaining %, expected %', (SELECT remaining_amount FROM public.orders WHERE id = ord.order_id), ord.total_amount - ret.total_amount;
  END IF;
  checks := checks + 1;
  -- 3. Today's revenue drops by the return (when the summary is visible to this user).
  IF (s0->>'revenue') IS NOT NULL AND round((s0->>'revenue')::numeric - (s1->>'revenue')::numeric, 2) <> ret.total_amount THEN
    RAISE EXCEPTION 'FAIL revenue % -> %, return %', s0->>'revenue', s1->>'revenue', ret.total_amount;
  END IF;
  checks := checks + 1;
  -- 4. The browser cannot write credited_amount.
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.orders SET credited_amount = credited_amount + 1000 WHERE id = ord.order_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    RESET ROLE;
    RAISE EXCEPTION 'FAIL the browser wiped a debt (% rows, credited now %)', n, (SELECT credited_amount FROM public.orders WHERE id = ord.order_id);
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; checks := checks + 1;
  END;
  -- 5. Expenses count manual payouts only.
  INSERT INTO public.shift_entries (tenant_id, shift_id, entry_type, amount, reason) VALUES
    (ord.tenant_id, sh, 'payout', 70, 'سند صرف رقم 99 للمورد'),
    (ord.tenant_id, sh, 'payout', 30, 'رد مبلغ طلب ملغى #1: x'),
    (ord.tenant_id, sh, 'payout', 5, 'كهرباء');
  IF (SELECT count(*) FROM public.shift_entries WHERE shift_id = sh AND source = 'manual') <> 1 THEN RAISE EXCEPTION 'FAIL classification'; END IF;
  SET LOCAL ROLE authenticated;
  s0 := public.get_tenant_financial_summary(ord.tenant_id, (now() AT TIME ZONE 'Asia/Riyadh')::date, (now() AT TIME ZONE 'Asia/Riyadh')::date);
  s1 := public.get_tenant_financial_summary(ord.tenant_id, (now() AT TIME ZONE 'Asia/Riyadh')::date, (now() AT TIME ZONE 'Asia/Riyadh')::date, '00000000-0000-0000-0000-000000000000'::uuid);
  RESET ROLE;
  IF (s0->>'operating_expenses') IS NOT NULL THEN
    IF (SELECT COALESCE(SUM(amount), 0) FROM public.shift_entries se WHERE se.tenant_id = ord.tenant_id AND se.entry_type = 'payout' AND se.source = 'manual'
          AND se.occurred_at >= (((now() AT TIME ZONE 'Asia/Riyadh')::date)::timestamp AT TIME ZONE 'Asia/Riyadh')) <> (s0->>'operating_expenses')::numeric THEN
      RAISE EXCEPTION 'FAIL expenses %', s0->>'operating_expenses';
    END IF;
    -- 6. ...and follow the branch: none in a branch that does not exist.
    IF (s1->>'operating_expenses')::numeric <> 0 THEN RAISE EXCEPTION 'FAIL branch filter %', s1->>'operating_expenses'; END IF;
    checks := checks + 2;
  END IF;
  -- 7. The dashboard leaves out cancelled and test orders.
  SELECT count(*) INTO n FROM public.dashboard_order_rows(ord.tenant_id, NULL) x WHERE x.status = 'cancelled';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL cancelled orders on the dashboard'; END IF;
  checks := checks + 1;
  RAISE EXCEPTION 'PASS: % checks (return %)', checks, ret.total_amount;
END
$test$;
