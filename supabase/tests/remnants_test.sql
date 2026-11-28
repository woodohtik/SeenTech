-- seen-open-verticals-task.md, wave 1 (fabric stores item 3): the end of a
-- roll becomes a remnant -- its own item, one piece at its own price, named
-- with its length; the metres leave the fabric's stock in the same step.
--
--   CI:    supabase test db
--   Here:  npx tsx scripts/db/pgtap-linked.ts supabase/tests/remnants_test.sql   (staging, rolled back)
BEGIN;
SELECT plan(6);

SET session_replication_role = replica;
INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test, vertical) VALUES
  ('a2000000-0000-4000-8000-000000000091', 'Remnant Shop', 'rem-shop@example.invalid', '0500000291', 'active', true, 'fabric_store');
INSERT INTO public.branches (id, tenant_id, name, location, is_main) VALUES
  ('b2000000-0000-4000-8000-000000000091', 'a2000000-0000-4000-8000-000000000091', 'Main', 'x', true);
INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status, branch_id) VALUES
  ('c2000000-0000-4000-8000-000000000091', 'a2000000-0000-4000-8000-000000000091', 'd2000000-0000-4000-8000-000000000091', 'Owner', 'rem-own@example.invalid', 'owner', NULL, 'active', 'b2000000-0000-4000-8000-000000000091'),
  ('c2000000-0000-4000-8000-000000000092', 'a2000000-0000-4000-8000-000000000091', 'd2000000-0000-4000-8000-000000000092', 'Cashier', 'rem-cash@example.invalid', 'cashier', NULL, 'active', 'b2000000-0000-4000-8000-000000000091');
INSERT INTO public.inventory_items (id, tenant_id, name, category, category_key, unit, base_unit, conversion_rate, sku, price_per_unit) VALUES
  ('f2000000-0000-4000-8000-000000000091', 'a2000000-0000-4000-8000-000000000091', 'كتان أبيض', 'fabric', 'linen', 'meter', 'meter', 1, 'REM-1', 30);
INSERT INTO public.branch_inventory (tenant_id, branch_id, item_id, quantity) VALUES
  ('a2000000-0000-4000-8000-000000000091', 'b2000000-0000-4000-8000-000000000091', 'f2000000-0000-4000-8000-000000000091', 5);
SET session_replication_role = DEFAULT;

CREATE TEMP TABLE _r (v jsonb);
GRANT ALL ON _r TO authenticated;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d2000000-0000-4000-8000-000000000091"}';
INSERT INTO _r SELECT public.convert_to_remnant('f2000000-0000-4000-8000-000000000091', NULL, 1.2, 15);
RESET ROLE;

SELECT is((SELECT quantity FROM public.branch_inventory WHERE item_id = 'f2000000-0000-4000-8000-000000000091'), 3.8::numeric,
  'the 1.2 m leave the fabric (5 -> 3.8)');
SELECT is((SELECT name FROM public.inventory_items WHERE id = (SELECT (v->>'remnant_item_id')::uuid FROM _r)), 'بواقي: كتان أبيض — 1.2 م',
  'the remnant is its own item, named with its length');
SELECT is((SELECT price_per_unit FROM public.inventory_items WHERE id = (SELECT (v->>'remnant_item_id')::uuid FROM _r))::numeric, 15::numeric,
  'at its own price, a piece');
SELECT is((SELECT quantity FROM public.branch_inventory WHERE item_id = (SELECT (v->>'remnant_item_id')::uuid FROM _r)), 1::numeric,
  'one piece in stock');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d2000000-0000-4000-8000-000000000091"}';
SELECT throws_ok($$ SELECT public.convert_to_remnant('f2000000-0000-4000-8000-000000000091', NULL, 9, 10) $$, '22023', NULL,
  'not more than is in stock');
SET LOCAL request.jwt.claims = '{"sub":"d2000000-0000-4000-8000-000000000092"}';
SELECT throws_ok($$ SELECT public.convert_to_remnant('f2000000-0000-4000-8000-000000000091', NULL, 1, 10) $$, '42501', NULL,
  'a cashier cannot');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
