-- Security audit 2026-11-22, batch 3 (20270112000002). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/audit_batch3_money_test.sql
-- S-23 is replayed. The others need a whole sale, order or deletion to
-- replay; for those this checks that the guard is in the live function
-- (their behaviour is covered by the app's own staging checks and tests).
DO $test$
DECLARE
  referred uuid := gen_random_uuid();
  referrer uuid := gen_random_uuid();
  partner uuid := gen_random_uuid();
  partner_uid text := gen_random_uuid()::text;
  owner_r text := gen_random_uuid()::text;
  ok boolean;
  results text[] := '{}';
  failed int := 0;
  fn text;
BEGIN
  -- S-23: a shop referred by both a shop and a partner pays one reward.
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.users (id, email) VALUES (owner_r, 'r@x.test'), (partner_uid, 'p@x.test');
  INSERT INTO public.tenants (id, name, owner_email, phone, owner_uid, status, subscription_status) VALUES
    (referred, 'referred', 'r@x.test', '0500000009', owner_r, 'active', 'active'),
    (referrer, 'referrer', 'x@x.test', '0500000008', NULL, 'active', 'active');
  INSERT INTO public.referral_partners (id, uid, name, status) VALUES (partner, partner_uid::uuid, 'partner', 'active');
  INSERT INTO public.partner_referrals (partner_id, referred_tenant_id, reward_amount, status, qualified_until, created_at)
    VALUES (partner, referred, 300, 'pending', now() + interval '30 days', now() - interval '2 days');
  INSERT INTO public.referrals (referrer_tenant_id, referred_tenant_id, reward_amount, status, qualified_until, created_at)
    VALUES (referrer, referred, 300, 'pending', now() + interval '30 days', now() - interval '1 day');
  SET LOCAL session_replication_role = origin;
  PERFORM public.confirm_referral(referred);
  PERFORM public.confirm_partner_referral(referred);
  ok := (SELECT count(*) FROM public.referrals WHERE referred_tenant_id = referred AND status = 'credited')
      + (SELECT count(*) FROM public.partner_referrals WHERE referred_tenant_id = referred AND status = 'credited') = 1
    AND (SELECT status FROM public.partner_referrals WHERE referred_tenant_id = referred) = 'credited';
  results := results || format('S-23 one reward per referred shop (the first recorded): %s', CASE WHEN ok THEN 'ok' ELSE 'OPEN' END);
  IF NOT ok THEN failed := failed + 1; END IF;

  -- The rest: the guard is in the live function.
  fn := pg_get_functiondef('public.create_pos_sale(uuid, jsonb, jsonb, jsonb)'::regprocedure);
  ok := position(':line:'' || v_line_no' in fn) > 0;
  results := results || format('S-19 sale lines move stock each: %s', CASE WHEN ok THEN 'ok' ELSE 'OPEN' END);
  IF NOT ok THEN failed := failed + 1; END IF;

  fn := pg_get_functiondef('public.process_sales_return(uuid, uuid, uuid, jsonb, text, payment_method)'::regprocedure);
  ok := position('count(DISTINCT e->>''order_item_id'')' in fn) > 0;
  results := results || format('S-43 a return names each line once: %s', CASE WHEN ok THEN 'ok' ELSE 'OPEN' END);
  IF NOT ok THEN failed := failed + 1; END IF;

  fn := pg_get_functiondef('public.create_tailoring_order(uuid, jsonb, jsonb)'::regprocedure);
  ok := position('> 15 * v_qty' in fn) > 0;
  results := results || format('S-27 a new order''s fabric is capped: %s', CASE WHEN ok THEN 'ok' ELSE 'OPEN' END);
  IF NOT ok THEN failed := failed + 1; END IF;

  fn := pg_get_functiondef('public.update_order_status_with_fabric(uuid, text, text, jsonb, text, uuid, text)'::regprocedure);
  ok := position('GROUP BY 1' in fn) > 0;
  results := results || format('S-08 an older order''s fabric is capped per cloth: %s', CASE WHEN ok THEN 'ok' ELSE 'OPEN' END);
  IF NOT ok THEN failed := failed + 1; END IF;

  fn := pg_get_functiondef('public.issue_tax_invoice_for_order(uuid, uuid)'::regprocedure);
  ok := position('app_has_permission(''reports.tax'')' in fn) > 0;
  results := results || format('S-28 issuing by hand needs reports.tax: %s', CASE WHEN ok THEN 'ok' ELSE 'OPEN' END);
  IF NOT ok THEN failed := failed + 1; END IF;

  fn := pg_get_functiondef('public.permanently_delete_tenant(uuid, text)'::regprocedure);
  ok := position('DELETE FROM public.stock_operations' in fn) > 0 AND position('DELETE FROM public.tailor_requests' in fn) > 0;
  results := results || format('S-41 a deleted shop leaves no rows: %s', CASE WHEN ok THEN 'ok' ELSE 'OPEN' END);
  IF NOT ok THEN failed := failed + 1; END IF;

  RAISE EXCEPTION '% -- %', CASE WHEN failed = 0 THEN format('PASS: %s checks', array_length(results, 1)) ELSE format('FAIL: %s of %s', failed, array_length(results, 1)) END,
    array_to_string(results, ' | ');
END
$test$;
