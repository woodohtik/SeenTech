-- seen-merchant-trial-test-2026-11-26.md, phase 2 item 2 (question 2's
-- default): a garment type's components (buttons, thread) are kept once by
-- the shop, shown at cutting with the cloth, and taken from stock in the same
-- transaction as the stage move -- once per order.
--
--   CI:    supabase test db
--   Here:  npx tsx scripts/db/pgtap-linked.ts supabase/tests/garment_components_test.sql   (staging, rolled back)
BEGIN;
SELECT plan(9);

SET session_replication_role = replica;
INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test) VALUES
  ('a8000000-0000-4000-8000-000000000001', 'Components Shop', 'comp@example.invalid', '0500000801', 'active', true),
  ('a8000000-0000-4000-8000-000000000002', 'Other Shop', 'comp-other@example.invalid', '0500000802', 'active', true);
INSERT INTO public.branches (id, tenant_id, name, location, is_main) VALUES
  ('b8000000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000001', 'Main', 'x', true);
INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status, branch_id) VALUES
  ('c8000000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000001', 'Owner', 'comp-own@example.invalid', 'owner', NULL, 'active', 'b8000000-0000-4000-8000-000000000001'),
  ('c8000000-0000-4000-8000-000000000002', 'a8000000-0000-4000-8000-000000000002', 'd8000000-0000-4000-8000-000000000002', 'Other', 'comp-oth@example.invalid', 'owner', NULL, 'active', NULL);
INSERT INTO public.inventory_items (id, tenant_id, name, category, unit, conversion_rate, sku) VALUES
  ('f8000000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000001', 'أزرار صدف', 'accessories', 'piece', 1, 'COMP-BTN'),
  ('f8000000-0000-4000-8000-000000000002', 'a8000000-0000-4000-8000-000000000002', 'Other shop buttons', 'accessories', 'piece', 1, 'COMP-OTH');
INSERT INTO public.branch_inventory (tenant_id, branch_id, item_id, quantity) VALUES
  ('a8000000-0000-4000-8000-000000000001', 'b8000000-0000-4000-8000-000000000001', 'f8000000-0000-4000-8000-000000000001', 200);
INSERT INTO public.orders (id, tenant_id, customer_name, order_number, delivery_date, total_amount, paid_amount, status, kind, branch_id) VALUES
  ('98000000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000001', 'فيصل', 7, now() + interval '9 days', 250, 0, 'measurements_taken', 'tailoring', 'b8000000-0000-4000-8000-000000000001');
SET session_replication_role = DEFAULT;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d8000000-0000-4000-8000-000000000001"}';

-- The shop keeps "a thobe takes 5 buttons" once.
SELECT lives_ok($$
  INSERT INTO public.garment_components (tenant_id, garment_type, item_id, quantity)
  VALUES ('a8000000-0000-4000-8000-000000000001', 'ثوب', 'f8000000-0000-4000-8000-000000000001', 5)
$$, 'the owner keeps a thobe''s default components');

SELECT is((SELECT count(*)::int FROM public.garment_components), 1, 'the shop sees its own defaults');

-- Cutting: the buttons come out with the stage move.
SELECT lives_ok($$
  SELECT public.update_order_status_with_components(
    '98000000-0000-4000-8000-000000000001', 'cutting', 'cutting', NULL,
    '[{"item_id":"f8000000-0000-4000-8000-000000000001","quantity":5}]'::jsonb,
    NULL, gen_random_uuid(), NULL)
$$, 'cutting with 5 buttons');

RESET ROLE;
SELECT is((SELECT quantity FROM public.branch_inventory WHERE item_id = 'f8000000-0000-4000-8000-000000000001'), 195::numeric, '5 buttons left stock at cutting');
SELECT isnt((SELECT components_taken_at FROM public.orders WHERE id = '98000000-0000-4000-8000-000000000001'), NULL, 'the order remembers its components were taken');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d8000000-0000-4000-8000-000000000001"}';
-- The next stage, sent with the components again: nothing moves twice.
SELECT lives_ok($$
  SELECT public.update_order_status_with_components(
    '98000000-0000-4000-8000-000000000001', 'sewing', 'sewing', NULL,
    '[{"item_id":"f8000000-0000-4000-8000-000000000001","quantity":5}]'::jsonb,
    NULL, gen_random_uuid(), NULL)
$$, 'on to sewing');
RESET ROLE;
SELECT is((SELECT quantity FROM public.branch_inventory WHERE item_id = 'f8000000-0000-4000-8000-000000000001'), 195::numeric, 'the buttons are taken once only');

-- Another shop's item is refused.
SET session_replication_role = replica;
UPDATE public.orders SET components_taken_at = NULL WHERE id = '98000000-0000-4000-8000-000000000001';
SET session_replication_role = DEFAULT;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d8000000-0000-4000-8000-000000000001"}';
SELECT throws_ok($$
  SELECT public.update_order_status_with_components(
    '98000000-0000-4000-8000-000000000001', 'sewing', 'sewing', NULL,
    '[{"item_id":"f8000000-0000-4000-8000-000000000002","quantity":1}]'::jsonb,
    NULL, gen_random_uuid(), NULL)
$$, '22023', NULL, 'another shop''s item is refused');

-- The other shop sees none of these defaults.
SET LOCAL request.jwt.claims = '{"sub":"d8000000-0000-4000-8000-000000000002"}';
SELECT is((SELECT count(*)::int FROM public.garment_components), 0, 'another shop sees none of them');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
