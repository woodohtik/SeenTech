-- seen-merchant-trial-test-2026-11-26.md, phase 3 item 1: a shop with stock
-- today had to make a fake purchase order to enter it. A new item takes an
-- opening quantity, recorded as a stock movement "opening balance" -- once.
--
--   CI:    supabase test db
--   Here:  npx tsx scripts/db/pgtap-linked.ts supabase/tests/opening_balance_test.sql   (staging, rolled back)
BEGIN;
SELECT plan(6);

SET session_replication_role = replica;
INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test) VALUES
  ('ab000000-0000-4000-8000-000000000001', 'Opening Shop', 'open-shop@example.invalid', '0500000b01', 'active', true),
  ('ab000000-0000-4000-8000-000000000002', 'Opening Other', 'open-other@example.invalid', '0500000b02', 'active', true);
INSERT INTO public.branches (id, tenant_id, name, location, is_main) VALUES
  ('bb000000-0000-4000-8000-000000000001', 'ab000000-0000-4000-8000-000000000001', 'Main', 'x', true);
INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status, branch_id) VALUES
  ('cb000000-0000-4000-8000-000000000001', 'ab000000-0000-4000-8000-000000000001', 'db000000-0000-4000-8000-000000000001', 'Owner', 'open-own@example.invalid', 'owner', NULL, 'active', 'bb000000-0000-4000-8000-000000000001'),
  ('cb000000-0000-4000-8000-000000000002', 'ab000000-0000-4000-8000-000000000001', 'db000000-0000-4000-8000-000000000002', 'Tailor', 'open-tail@example.invalid', 'tailor', NULL, 'active', 'bb000000-0000-4000-8000-000000000001');
INSERT INTO public.inventory_items (id, tenant_id, name, category, unit, conversion_rate, sku) VALUES
  ('fb000000-0000-4000-8000-000000000001', 'ab000000-0000-4000-8000-000000000001', 'ياباني أبيض', 'fabric', 'meter', 1, 'OPEN-1'),
  ('fb000000-0000-4000-8000-000000000002', 'ab000000-0000-4000-8000-000000000002', 'Other item', 'fabric', 'meter', 1, 'OPEN-2');
SET session_replication_role = DEFAULT;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"db000000-0000-4000-8000-000000000001"}';
SELECT lives_ok($$ SELECT public.record_opening_balance('fb000000-0000-4000-8000-000000000001', NULL, 38.72) $$,
  'the owner enters 38.72 m of stock on hand');
RESET ROLE;
SELECT is((SELECT quantity FROM public.branch_inventory WHERE item_id = 'fb000000-0000-4000-8000-000000000001'), 38.72::numeric,
  'it is in the main branch');
SELECT is((SELECT opening_balance FROM public.inventory_items WHERE id = 'fb000000-0000-4000-8000-000000000001')::numeric, 38.72::numeric,
  'and kept as the item''s opening balance');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"db000000-0000-4000-8000-000000000001"}';
SELECT throws_ok($$ SELECT public.record_opening_balance('fb000000-0000-4000-8000-000000000001', NULL, 10) $$, '22023', NULL,
  'only once: a second opening balance is refused');
SELECT throws_ok($$ SELECT public.record_opening_balance('fb000000-0000-4000-8000-000000000002', NULL, 5) $$, '42501', NULL,
  'another shop''s item is refused');
SET LOCAL request.jwt.claims = '{"sub":"db000000-0000-4000-8000-000000000002"}';
SELECT throws_ok($$ SELECT public.record_opening_balance('fb000000-0000-4000-8000-000000000001', NULL, 5) $$, '42501', NULL,
  'a tailor cannot');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
