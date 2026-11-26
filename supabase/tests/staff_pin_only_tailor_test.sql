-- seen-merchant-trial-test-2026-11-26.md, phase 2 item 1 (question 1's
-- default): a tailor may be a PIN-only employee, with no email or sign-in
-- account; every other role still needs an email. And the commission:
-- a tailor at 10%, two orders of 250 and 300 reaching "ready" -> 55.
--
--   CI:    supabase test db
--   Here:  npx tsx scripts/db/pgtap-linked.ts supabase/tests/staff_pin_only_tailor_test.sql   (staging, rolled back)
BEGIN;
SELECT plan(5);

SET session_replication_role = replica;
INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test)
VALUES ('a7000000-0000-4000-8000-000000000001', 'PIN Tailor Shop', 'pin-shop@example.invalid', '0500000701', 'active', true);
INSERT INTO public.branches (id, tenant_id, name, location, is_main)
VALUES ('b7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001', 'Main', 'x', true);
SET session_replication_role = DEFAULT;

SELECT lives_ok($$
  INSERT INTO public.staff (id, tenant_id, uid, name, email, role, status, branch_id, pin_hash, commission_type, commission_value)
  VALUES ('c7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001', NULL, 'رحيم', NULL, 'tailor', 'active',
          'b7000000-0000-4000-8000-000000000001', 'hash', 'percentage', 10)
$$, 'a tailor with no email (PIN only) is accepted');

-- (triggers off: the role-grant guard would refuse a manager first -- this is the constraint alone)
SET session_replication_role = replica;
SELECT throws_ok($$
  INSERT INTO public.staff (tenant_id, name, email, role, status, branch_id)
  VALUES ('a7000000-0000-4000-8000-000000000001', 'مدير', NULL, 'manager', 'active', 'b7000000-0000-4000-8000-000000000001')
$$, '23514', NULL, 'a manager still needs an email');
SET session_replication_role = DEFAULT;

SELECT throws_ok($$
  INSERT INTO public.staff (tenant_id, name, email, role, status, branch_id)
  VALUES ('a7000000-0000-4000-8000-000000000001', 'كاشير', NULL, 'cashier', 'active', 'b7000000-0000-4000-8000-000000000001')
$$, '23514', NULL, 'a cashier still needs an email');

-- The commission falls due at "ready", on the amount before VAT (none here).
SET session_replication_role = replica;
INSERT INTO public.orders (id, tenant_id, customer_name, order_number, delivery_date, total_amount, tax_amount, paid_amount, status, assigned_tailor_id) VALUES
  ('97000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001', 'A', 1, now() + interval '7 days', 250, 0, 0, 'sewing', 'c7000000-0000-4000-8000-000000000001'),
  ('97000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000001', 'B', 2, now() + interval '7 days', 300, 0, 0, 'sewing', 'c7000000-0000-4000-8000-000000000001');
SET session_replication_role = DEFAULT;

SELECT is((SELECT coalesce(sum(calculated_commission), 0) FROM public.orders WHERE tenant_id = 'a7000000-0000-4000-8000-000000000001'),
          0::numeric, 'nothing is due before the orders are ready');

UPDATE public.orders SET status = 'ready' WHERE tenant_id = 'a7000000-0000-4000-8000-000000000001';

SELECT is((SELECT sum(calculated_commission) FROM public.orders WHERE tenant_id = 'a7000000-0000-4000-8000-000000000001'),
          55::numeric, '10% of 250 and 300 is 55 once both are ready');

SELECT * FROM finish();
ROLLBACK;
