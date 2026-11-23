-- seen-readiness-fixes-task.md P6 (20270108000005). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/tailor_commission_date_test.sql
DO $test$
DECLARE
  o record;
  t1 uuid;
  t2 uuid;
  at0 timestamptz;
  checks int := 0;
BEGIN
  SELECT ord.id, ord.tenant_id, ord.total_amount, ord.tax_amount INTO o FROM public.orders ord
   WHERE ord.status::text NOT IN ('cancelled', 'ready', 'ironing_packaging', 'delivered') AND ord.total_amount > 0 ORDER BY ord.order_date DESC LIMIT 1;
  IF o.id IS NULL THEN RAISE EXCEPTION 'SKIP: need an open order'; END IF;
  SELECT s.id INTO t1 FROM public.staff s WHERE s.tenant_id = o.tenant_id LIMIT 1;
  INSERT INTO public.staff (tenant_id, branch_id, name, email, role, status, commission_type, commission_value)
  SELECT o.tenant_id, s.branch_id, 'comm-check', 'comm-check-' || left(gen_random_uuid()::text, 8) || '@example.invalid', 'tailor', 'active', 'fixed_amount', 25
    FROM public.staff s WHERE s.id = t1 RETURNING id INTO t2;
  UPDATE public.staff SET commission_type = 'percentage', commission_value = 10 WHERE id = t1;
  UPDATE public.orders SET assigned_tailor_id = t1, calculated_commission = NULL, commission_at = NULL, credited_amount = 0 WHERE id = o.id;

  -- 1. Ready: 10% of the sale before VAT, dated now.
  UPDATE public.orders SET status = 'ready' WHERE id = o.id;
  IF (SELECT calculated_commission FROM public.orders WHERE id = o.id) <> round((o.total_amount - COALESCE(o.tax_amount, 0)) * 0.10, 2)
     OR (SELECT commission_at FROM public.orders WHERE id = o.id) IS NULL THEN
    RAISE EXCEPTION 'FAIL at ready: %', (SELECT calculated_commission FROM public.orders WHERE id = o.id);
  END IF;
  SELECT commission_at INTO at0 FROM public.orders WHERE id = o.id;
  checks := checks + 1;
  -- 2. A later edit does not move the date.
  UPDATE public.orders SET notes = COALESCE(notes, '') || ' ' WHERE id = o.id;
  IF (SELECT commission_at FROM public.orders WHERE id = o.id) <> at0 THEN RAISE EXCEPTION 'FAIL an edit moved the date'; END IF;
  checks := checks + 1;
  -- 3. Half the order credited back: half the commission.
  UPDATE public.orders SET credited_amount = round(o.total_amount / 2, 2) WHERE id = o.id;
  IF abs((SELECT calculated_commission FROM public.orders WHERE id = o.id) - round((o.total_amount - COALESCE(o.tax_amount, 0)) * 0.10 / 2, 2)) > 0.02 THEN
    RAISE EXCEPTION 'FAIL after a credit note: %', (SELECT calculated_commission FROM public.orders WHERE id = o.id);
  END IF;
  checks := checks + 1;
  -- 4. Another tailor takes it: their commission (a fixed 25), dated anew.
  UPDATE public.orders SET assigned_tailor_id = t2 WHERE id = o.id;
  IF (SELECT calculated_commission FROM public.orders WHERE id = o.id) <> 25 THEN RAISE EXCEPTION 'FAIL new tailor: %', (SELECT calculated_commission FROM public.orders WHERE id = o.id); END IF;
  checks := checks + 1;
  -- 5. Everything credited back: the fixed commission goes to zero.
  UPDATE public.orders SET credited_amount = o.total_amount WHERE id = o.id;
  IF (SELECT calculated_commission FROM public.orders WHERE id = o.id) <> 0 THEN RAISE EXCEPTION 'FAIL fully returned: %', (SELECT calculated_commission FROM public.orders WHERE id = o.id); END IF;
  checks := checks + 1;
  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
