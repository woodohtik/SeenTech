-- docs/superpowers/plans/2026-11-18-permissions-server-enforcement.md Task 6.
--
-- Proves the orders/customers/inventory_items DELETE RLS policies are gated
-- on orders.delete/customers.delete/inventory.delete (via app_has_permission()
-- from Task 1) instead of a hard-coded role enum (orders) or no role check
-- at all (customers/inventory_items previously only checked tenant_id, or in
-- customers' case a hard-coded role list from 20260917150000).
--
-- NOTE on assertion style: unlike the RPC tasks (2-5), a DELETE blocked by an
-- RLS USING clause does not raise an exception -- the row simply fails the
-- USING predicate and is excluded from the delete, so the statement reports
-- 0 rows affected with no error. There is nothing for throws_like/
-- throws_matching to catch here. So denial scenarios assert row survival via
-- a count before/after (is() on SELECT count(*)), and permission-granted
-- scenarios assert the row count actually dropped by exactly one.
--
-- Run with: npx supabase db query --linked --file <this file>
-- (supabase test db --linked needs Docker, which is down on this machine.)
BEGIN;
SELECT plan(6);

-- db query --linked only surfaces the LAST statement's result set, so
-- collect each assertion's TAP line here and print them all together with
-- finish() at the end instead of relying on each SELECT's own output.
CREATE TEMP TABLE test_output (seq INT GENERATED ALWAYS AS IDENTITY, line TEXT);
GRANT INSERT, SELECT ON test_output TO authenticated;

-- Fixtures: one tenant; one order, one customer, one inventory_item; a
-- cashier (role_id IS NULL, so orders.delete/customers.delete/
-- inventory.delete all come from the default table, where cashier = false
-- for all three); an admin (role_id IS NULL, so all three = true from the
-- default table).
SET session_replication_role = replica;

INSERT INTO public.tenants (id, name, owner_email, phone)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Delete Policies Perm Test Tenant', 'owner@delete-policies-perm.test.invalid', '0500000006');

INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status)
VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Test Cashier', 'cashier@delete-policies-perm.test.invalid', 'cashier', NULL, 'active'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Test Admin', 'admin@delete-policies-perm.test.invalid', 'admin', NULL, 'active');

INSERT INTO public.customers (id, tenant_id, name, phone)
VALUES ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Test Customer', '0500000007');

INSERT INTO public.orders (id, tenant_id, customer_id, customer_name, order_number, delivery_date)
VALUES ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '11111111-1111-1111-1111-111111111111', 'Test Customer', 1, NOW() + INTERVAL '7 days');

INSERT INTO public.inventory_items (id, tenant_id, name, category, unit, base_unit, conversion_rate, sku)
VALUES ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'Test Fabric', 'fabric', 'meter', 'meter', 1, 'SKU-DELPOL-1');

SET session_replication_role = DEFAULT;

-- Scenario 1: cashier (orders.delete=false) attempts to delete the order --
-- RLS silently excludes the row; it must still be there afterward.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc"}';
DELETE FROM public.orders WHERE id = '22222222-2222-2222-2222-222222222222';
INSERT INTO test_output (line) SELECT is(
  (SELECT count(*) FROM public.orders WHERE id = '22222222-2222-2222-2222-222222222222'),
  1::bigint,
  'cashier (orders.delete=false) deleting the order -- RLS blocks it, row still present'
);

-- Scenario 2: admin (orders.delete=true) deletes the same order -- succeeds.
SET LOCAL request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"}';
DELETE FROM public.orders WHERE id = '22222222-2222-2222-2222-222222222222';
INSERT INTO test_output (line) SELECT is(
  (SELECT count(*) FROM public.orders WHERE id = '22222222-2222-2222-2222-222222222222'),
  0::bigint,
  'admin (orders.delete=true) deleting the order -- lives_ok, row actually deleted'
);

-- Scenario 3: cashier (customers.delete=false) attempts to delete the
-- customer -- RLS blocks it, row still present.
SET LOCAL request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc"}';
DELETE FROM public.customers WHERE id = '11111111-1111-1111-1111-111111111111';
INSERT INTO test_output (line) SELECT is(
  (SELECT count(*) FROM public.customers WHERE id = '11111111-1111-1111-1111-111111111111'),
  1::bigint,
  'cashier (customers.delete=false) deleting the customer -- RLS blocks it, row still present'
);

-- Scenario 4: admin (customers.delete=true) deletes the same customer --
-- succeeds.
SET LOCAL request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"}';
DELETE FROM public.customers WHERE id = '11111111-1111-1111-1111-111111111111';
INSERT INTO test_output (line) SELECT is(
  (SELECT count(*) FROM public.customers WHERE id = '11111111-1111-1111-1111-111111111111'),
  0::bigint,
  'admin (customers.delete=true) deleting the customer -- lives_ok, row actually deleted'
);

-- Scenario 5: cashier (inventory.delete=false) attempts to delete the
-- inventory item -- RLS blocks it, row still present.
SET LOCAL request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc"}';
DELETE FROM public.inventory_items WHERE id = '33333333-3333-3333-3333-333333333333';
INSERT INTO test_output (line) SELECT is(
  (SELECT count(*) FROM public.inventory_items WHERE id = '33333333-3333-3333-3333-333333333333'),
  1::bigint,
  'cashier (inventory.delete=false) deleting the inventory item -- RLS blocks it, row still present'
);

-- Scenario 6: admin (inventory.delete=true) deletes the same item --
-- succeeds.
SET LOCAL request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"}';
DELETE FROM public.inventory_items WHERE id = '33333333-3333-3333-3333-333333333333';
INSERT INTO test_output (line) SELECT is(
  (SELECT count(*) FROM public.inventory_items WHERE id = '33333333-3333-3333-3333-333333333333'),
  0::bigint,
  'admin (inventory.delete=true) deleting the inventory item -- lives_ok, row actually deleted'
);

INSERT INTO test_output (line) SELECT * FROM finish();
SELECT line FROM test_output ORDER BY seq;
ROLLBACK;
