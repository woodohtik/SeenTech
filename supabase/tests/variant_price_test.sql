-- seen-product-variants-barcode-po-price-task.md, phase 2 (question 2's
-- default): a variant follows its product's price unless it has its own
-- ("special price", price_override); the POS sale charges the right one.
--
--   CI:    supabase test db
--   Here:  npx tsx scripts/db/pgtap-linked.ts supabase/tests/variant_price_test.sql   (staging, rolled back)
BEGIN;
SELECT plan(4);

SET session_replication_role = replica;
INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test) VALUES
  ('af000000-0000-4000-8000-000000000001', 'Variant Price Shop', 'vp-shop@example.invalid', '0500000f01', 'active', true);
INSERT INTO public.branches (id, tenant_id, name, location, is_main) VALUES
  ('bf000000-0000-4000-8000-000000000001', 'af000000-0000-4000-8000-000000000001', 'Main', 'x', true);
INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status, branch_id) VALUES
  ('cf000000-0000-4000-8000-000000000001', 'af000000-0000-4000-8000-000000000001', 'df000000-0000-4000-8000-000000000001', 'Owner', 'vp-own@example.invalid', 'owner', NULL, 'active', 'bf000000-0000-4000-8000-000000000001');
INSERT INTO public.shifts (id, tenant_id, branch_id, staff_id, staff_name, opening_balance, status, start_time) VALUES
  ('5f000000-0000-4000-8000-000000000001', 'af000000-0000-4000-8000-000000000001', 'bf000000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000001', 'Owner', 0, 'open', now());
INSERT INTO public.inventory_items (id, tenant_id, name, category, unit, conversion_rate, sku, price_per_unit) VALUES
  ('ff000000-0000-4000-8000-000000000001', 'af000000-0000-4000-8000-000000000001', 'ثوب جاهز', 'ready_made', 'piece', 1, 'VP-1', 200);
INSERT INTO public.inventory_variants (id, tenant_id, item_id, sku, name, price_adjustment, price_override) VALUES
  ('ef000000-0000-4000-8000-000000000001', 'af000000-0000-4000-8000-000000000001', 'ff000000-0000-4000-8000-000000000001', 'VP-1-W', 'أبيض', 0, NULL),
  ('ef000000-0000-4000-8000-000000000002', 'af000000-0000-4000-8000-000000000001', 'ff000000-0000-4000-8000-000000000001', 'VP-1-B', 'أسود', 0, 260);
INSERT INTO public.branch_inventory (tenant_id, branch_id, item_id, variant_id, quantity) VALUES
  ('af000000-0000-4000-8000-000000000001', 'bf000000-0000-4000-8000-000000000001', 'ff000000-0000-4000-8000-000000000001', 'ef000000-0000-4000-8000-000000000001', 5),
  ('af000000-0000-4000-8000-000000000001', 'bf000000-0000-4000-8000-000000000001', 'ff000000-0000-4000-8000-000000000001', 'ef000000-0000-4000-8000-000000000002', 5);
SET session_replication_role = DEFAULT;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"df000000-0000-4000-8000-000000000001"}';
SELECT public.create_pos_sale('9f000000-0000-4000-8000-000000000001'::uuid,
  jsonb_build_object('shift_id', '5f000000-0000-4000-8000-000000000001', 'customer_name', 'A', 'status', 'delivered', 'payment_method', 'cash', 'delivery_date', now()::text),
  '[{"type":"ready_made","item_id":"ff000000-0000-4000-8000-000000000001","variant_id":"ef000000-0000-4000-8000-000000000001","name":"ثوب جاهز - أبيض","quantity":1,"price":1}]'::jsonb, '{}'::jsonb);
SELECT public.create_pos_sale('9f000000-0000-4000-8000-000000000002'::uuid,
  jsonb_build_object('shift_id', '5f000000-0000-4000-8000-000000000001', 'customer_name', 'B', 'status', 'delivered', 'payment_method', 'cash', 'delivery_date', now()::text),
  '[{"type":"ready_made","item_id":"ff000000-0000-4000-8000-000000000001","variant_id":"ef000000-0000-4000-8000-000000000002","name":"ثوب جاهز - أسود","quantity":1,"price":1}]'::jsonb, '{}'::jsonb);
RESET ROLE;

SELECT is((SELECT price FROM public.order_items WHERE order_id = '9f000000-0000-4000-8000-000000000001' LIMIT 1), 200::numeric,
  'white follows the product''s price (200)');
SELECT is((SELECT price FROM public.order_items WHERE order_id = '9f000000-0000-4000-8000-000000000002' LIMIT 1), 260::numeric,
  'black sells at its special price (260)');

-- The product's price moves: white follows, black keeps its own.
SET session_replication_role = replica;
UPDATE public.inventory_items SET price_per_unit = 220 WHERE id = 'ff000000-0000-4000-8000-000000000001';
SET session_replication_role = DEFAULT;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"df000000-0000-4000-8000-000000000001"}';
SELECT public.create_pos_sale('9f000000-0000-4000-8000-000000000003'::uuid,
  jsonb_build_object('shift_id', '5f000000-0000-4000-8000-000000000001', 'customer_name', 'C', 'status', 'delivered', 'payment_method', 'cash', 'delivery_date', now()::text),
  '[{"type":"ready_made","item_id":"ff000000-0000-4000-8000-000000000001","variant_id":"ef000000-0000-4000-8000-000000000001","name":"w","quantity":1,"price":1},
    {"type":"ready_made","item_id":"ff000000-0000-4000-8000-000000000001","variant_id":"ef000000-0000-4000-8000-000000000002","name":"b","quantity":1,"price":1}]'::jsonb, '{}'::jsonb);
RESET ROLE;
SELECT is((SELECT price FROM public.order_items WHERE order_id = '9f000000-0000-4000-8000-000000000003' AND variant_id = 'ef000000-0000-4000-8000-000000000001'), 220::numeric,
  'after the product goes to 220, white is 220');
SELECT is((SELECT price FROM public.order_items WHERE order_id = '9f000000-0000-4000-8000-000000000003' AND variant_id = 'ef000000-0000-4000-8000-000000000002'), 260::numeric,
  'and black stays at its own 260');

SELECT * FROM finish();
ROLLBACK;
