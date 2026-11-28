-- seen-open-verticals-task.md, wave 1 (question 6): who sees a women's shop's
-- customers' measurements by default.
--
--   CI:    supabase test db
--   Here:  npx tsx scripts/db/pgtap-linked.ts supabase/tests/customers_view_measurements_test.sql   (staging, rolled back)
BEGIN;
SELECT plan(3);

SET session_replication_role = replica;
INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test, vertical) VALUES
  ('a5000000-0000-4000-8000-000000000001', 'Privacy Shop', 'priv-shop@example.invalid', '0500000501', 'active', true, 'womens_tailoring');
INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status) VALUES
  ('c5000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000001', 'Cashier', 'priv-cash@example.invalid', 'cashier', NULL, 'active'),
  ('c5000000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000002', 'Tailor', 'priv-tail@example.invalid', 'tailor', NULL, 'active'),
  ('c5000000-0000-4000-8000-000000000003', 'a5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000003', 'Manager', 'priv-man@example.invalid', 'manager', NULL, 'active');
SET session_replication_role = DEFAULT;

SELECT is((public.app_effective_permissions('c5000000-0000-4000-8000-000000000001') ->> 'customers.view_measurements')::boolean, false,
  'a cashier does not see the measurements by default');
SELECT is((public.app_effective_permissions('c5000000-0000-4000-8000-000000000002') ->> 'customers.view_measurements')::boolean, true,
  'a tailor does');
SELECT is((public.app_effective_permissions('c5000000-0000-4000-8000-000000000003') ->> 'customers.view_measurements')::boolean, true,
  'a manager does');

SELECT * FROM finish();
ROLLBACK;
