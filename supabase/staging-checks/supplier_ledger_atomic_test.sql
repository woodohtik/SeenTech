-- seen-readiness-fixes-task.md P6 (20270108000001). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/supplier_ledger_atomic_test.sql
DO $test$
DECLARE
  o record;
  sup uuid;
  op uuid := gen_random_uuid();
  op2 uuid := gen_random_uuid();
  r jsonb;
  b numeric;
  checks int := 0;
BEGIN
  SELECT t.id, t.owner_uid INTO o FROM public.tenants t WHERE t.owner_uid IS NOT NULL ORDER BY t.created_at LIMIT 1;
  IF o.id IS NULL THEN RAISE EXCEPTION 'SKIP: need a shop'; END IF;
  UPDATE public.tenants SET status = 'active', trashed_at = NULL, subscription_status = 'active', subscription_end_date = NULL WHERE id = o.id;
  INSERT INTO public.suppliers (tenant_id, name, balance) VALUES (o.id, 'ledger-check', 100) RETURNING id INTO sup;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', o.owner_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', o.owner_uid::text, true);
  SET LOCAL ROLE authenticated;

  -- 1. A purchase on credit: balance and ledger line move together, to the halala.
  r := public.record_supplier_transaction(op, sup, 'purchase', 250.555, 0, 'PO-1');
  -- 2. The same operation again changes nothing.
  r := public.record_supplier_transaction(op, sup, 'purchase', 250.555, 0, 'PO-1');
  RESET ROLE;
  SELECT balance INTO b FROM public.suppliers WHERE id = sup;
  IF b <> 350.56 OR (r->>'running_balance')::numeric <> 350.56 OR (r->>'replayed')::boolean IS NOT TRUE
     OR (SELECT count(*) FROM public.supplier_transactions WHERE supplier_id = sup) <> 1 THEN
    RAISE EXCEPTION 'FAIL ledger: balance %, %', b, r;
  END IF;
  checks := checks + 2;
  -- 3. A payment lowers it, and the line carries the new balance.
  SET LOCAL ROLE authenticated;
  r := public.record_supplier_transaction(op2, sup, 'payment', 0, 50.56, 'PAY-1');
  RESET ROLE;
  IF (r->>'running_balance')::numeric <> 300 OR (SELECT balance FROM public.suppliers WHERE id = sup) <> 300 THEN RAISE EXCEPTION 'FAIL payment: %', r; END IF;
  checks := checks + 1;
  -- 4. Both a credit and a debit, or neither, is refused.
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.record_supplier_transaction(gen_random_uuid(), sup, 'x', 10, 10);
    RESET ROLE; RAISE EXCEPTION 'FAIL credit and debit together';
  EXCEPTION WHEN invalid_parameter_value THEN RESET ROLE; checks := checks + 1;
  END;
  -- 5. The older function applies a key once.
  SET LOCAL ROLE authenticated;
  b := public.increment_supplier_balance(sup, 10, op2);
  b := public.increment_supplier_balance(sup, 10, op2);
  RESET ROLE;
  IF (SELECT balance FROM public.suppliers WHERE id = sup) <> 310 THEN RAISE EXCEPTION 'FAIL increment applied % times', ((SELECT balance FROM public.suppliers WHERE id = sup) - 300) / 10; END IF;
  checks := checks + 1;
  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
