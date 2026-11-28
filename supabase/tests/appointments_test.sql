-- seen-open-verticals-task.md, wave 1 (shared item 2): appointments -- a
-- fitting, a measurement visit, a pickup, a delivery, an installation -- for
-- a shop's customer and (optionally) one of its orders. Each shop sees only
-- its own; reading needs orders.view, booking orders.create or orders.edit.
--
--   CI:    supabase test db
--   Here:  npx tsx scripts/db/pgtap-linked.ts supabase/tests/appointments_test.sql   (staging, rolled back)
BEGIN;
SELECT plan(6);

SET session_replication_role = replica;
INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test, vertical) VALUES
  ('a1000000-0000-4000-8000-0000000000d1', 'Fitting Shop', 'fit-shop@example.invalid', '0500000d01', 'active', true, 'womens_tailoring'),
  ('a1000000-0000-4000-8000-0000000000d2', 'Other Shop', 'fit-other@example.invalid', '0500000d02', 'active', true, 'womens_tailoring');
INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status) VALUES
  ('c1000000-0000-4000-8000-0000000000d1', 'a1000000-0000-4000-8000-0000000000d1', 'd1000000-0000-4000-8000-0000000000d1', 'Owner', 'fit-own@example.invalid', 'owner', NULL, 'active'),
  ('c1000000-0000-4000-8000-0000000000d2', 'a1000000-0000-4000-8000-0000000000d2', 'd1000000-0000-4000-8000-0000000000d2', 'Other owner', 'fit-oth@example.invalid', 'owner', NULL, 'active'),
  ('c1000000-0000-4000-8000-0000000000d3', 'a1000000-0000-4000-8000-0000000000d1', 'd1000000-0000-4000-8000-0000000000d3', 'Accountant', 'fit-acc@example.invalid', 'accountant', NULL, 'active');
INSERT INTO public.customers (id, tenant_id, name, phone) VALUES
  ('e1000000-0000-4000-8000-0000000000d1', 'a1000000-0000-4000-8000-0000000000d1', 'عميلة', '0500000d11');
INSERT INTO public.orders (id, tenant_id, customer_id, customer_name, order_number, delivery_date, total_amount, paid_amount, status, kind) VALUES
  ('91000000-0000-4000-8000-0000000000d1', 'a1000000-0000-4000-8000-0000000000d1', 'e1000000-0000-4000-8000-0000000000d1', 'عميلة', 1, now() + interval '10 days', 300, 100, 'sewing', 'tailoring');
SET session_replication_role = DEFAULT;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d1000000-0000-4000-8000-0000000000d1"}';
SELECT lives_ok($$
  INSERT INTO public.appointments (tenant_id, customer_id, order_id, kind, starts_at, notes)
  VALUES ('a1000000-0000-4000-8000-0000000000d1', 'e1000000-0000-4000-8000-0000000000d1', '91000000-0000-4000-8000-0000000000d1',
          'fitting', now() + interval '3 days', 'البروفة الأولى')
$$, 'the shop books a fitting for its order');
SELECT is((SELECT count(*) FROM public.appointments WHERE order_id = '91000000-0000-4000-8000-0000000000d1'), 1::bigint,
  'and sees it');
SELECT throws_ok($$
  INSERT INTO public.appointments (tenant_id, customer_id, kind, starts_at)
  VALUES ('a1000000-0000-4000-8000-0000000000d1', 'e1000000-0000-4000-8000-0000000000d1', 'spa', now())
$$, '23514', NULL, 'an unknown kind is refused');

SET LOCAL request.jwt.claims = '{"sub":"d1000000-0000-4000-8000-0000000000d2"}';
SELECT is((SELECT count(*) FROM public.appointments WHERE order_id = '91000000-0000-4000-8000-0000000000d1'), 0::bigint,
  'another shop sees none of them');
SELECT throws_ok($$
  INSERT INTO public.appointments (tenant_id, customer_id, kind, starts_at)
  VALUES ('a1000000-0000-4000-8000-0000000000d1', 'e1000000-0000-4000-8000-0000000000d1', 'fitting', now())
$$, '42501', NULL, 'nor books one in it');

SET LOCAL request.jwt.claims = '{"sub":"d1000000-0000-4000-8000-0000000000d3"}';
SELECT throws_ok($$
  INSERT INTO public.appointments (tenant_id, customer_id, kind, starts_at)
  VALUES ('a1000000-0000-4000-8000-0000000000d1', 'e1000000-0000-4000-8000-0000000000d1', 'fitting', now())
$$, '42501', NULL, 'someone without orders.create / orders.edit cannot book');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
