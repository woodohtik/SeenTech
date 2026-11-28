-- seen-product-variants-barcode-po-price-task.md, phase 3: an opening
-- balance per variant, on that variant's stock row; the product's total is
-- the sum of its variants; once per variant.
--
--   CI:    supabase test db
--   Here:  npx tsx scripts/db/pgtap-linked.ts supabase/tests/variant_opening_balance_test.sql   (staging, rolled back)
BEGIN;
SELECT plan(7);

SET session_replication_role = replica;
INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test) VALUES
  ('a7000000-0000-4000-8000-000000000001', 'Variant Opening Shop', 'vo-shop@example.invalid', '0500000701', 'active', true);
INSERT INTO public.branches (id, tenant_id, name, location, is_main) VALUES
  ('b7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001', 'Main', 'x', true);
INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status, branch_id) VALUES
  ('c7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001', 'd7000000-0000-4000-8000-000000000001', 'Owner', 'vo-own@example.invalid', 'owner', NULL, 'active', 'b7000000-0000-4000-8000-000000000001');
INSERT INTO public.inventory_items (id, tenant_id, name, category, unit, conversion_rate, sku) VALUES
  ('f7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001', 'ثوب جاهز', 'ready_made', 'piece', 1, 'VO-1'),
  ('f7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000001', 'آخر', 'ready_made', 'piece', 1, 'VO-2');
INSERT INTO public.inventory_variants (id, tenant_id, item_id, sku, name) VALUES
  ('e7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001', 'f7000000-0000-4000-8000-000000000001', 'VO-1-1', 'أبيض 56'),
  ('e7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000001', 'f7000000-0000-4000-8000-000000000001', 'VO-1-2', 'أبيض 58'),
  ('e7000000-0000-4000-8000-000000000003', 'a7000000-0000-4000-8000-000000000001', 'f7000000-0000-4000-8000-000000000001', 'VO-1-3', 'أسود 56'),
  ('e7000000-0000-4000-8000-000000000009', 'a7000000-0000-4000-8000-000000000001', 'f7000000-0000-4000-8000-000000000002', 'VO-2-1', 'other');
SET session_replication_role = DEFAULT;

-- 10 pieces split over 3 variants: 4, 3, 3.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d7000000-0000-4000-8000-000000000001"}';
SELECT public.record_opening_balance('f7000000-0000-4000-8000-000000000001', NULL, 4, 'e7000000-0000-4000-8000-000000000001');
SELECT public.record_opening_balance('f7000000-0000-4000-8000-000000000001', NULL, 3, 'e7000000-0000-4000-8000-000000000002');
SELECT public.record_opening_balance('f7000000-0000-4000-8000-000000000001', NULL, 3, 'e7000000-0000-4000-8000-000000000003');
RESET ROLE;

SELECT is((SELECT quantity FROM public.branch_inventory WHERE variant_id = 'e7000000-0000-4000-8000-000000000001'), 4::numeric,
  'white 56 has its 4, on its own stock row');
SELECT is((SELECT quantity FROM public.branch_inventory WHERE variant_id = 'e7000000-0000-4000-8000-000000000003'), 3::numeric,
  'black 56 has its 3');
SELECT is((SELECT COALESCE(sum(quantity), 0) FROM public.branch_inventory WHERE item_id = 'f7000000-0000-4000-8000-000000000001'), 10::numeric,
  'the product''s total is the sum of its variants (10)');
SELECT is((SELECT opening_balance FROM public.inventory_items WHERE id = 'f7000000-0000-4000-8000-000000000001')::numeric, 10::numeric,
  'and its opening balance is 10');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d7000000-0000-4000-8000-000000000001"}';
SELECT throws_ok($$ SELECT public.record_opening_balance('f7000000-0000-4000-8000-000000000001', NULL, 2, 'e7000000-0000-4000-8000-000000000001') $$,
  '22023', NULL, 'once per variant: a second one is refused');
SELECT throws_ok($$ SELECT public.record_opening_balance('f7000000-0000-4000-8000-000000000001', NULL, 2, 'e7000000-0000-4000-8000-000000000009') $$,
  '22023', NULL, 'a variant of another product is refused');
-- The three-argument call (a product without variants) still works.
SELECT lives_ok($$ SELECT public.record_opening_balance('f7000000-0000-4000-8000-000000000002', NULL, 5) $$,
  'a product without variants keeps working');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
