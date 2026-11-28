-- seen-open-verticals-task.md, wave 1 (fabric stores item 4): a wholesale
-- customer (a tailor buying for his shop) pays the product's wholesale price;
-- everyone else, and a product without one, the usual price. The server
-- decides, not the browser.
--
--   CI:    supabase test db
--   Here:  npx tsx scripts/db/pgtap-linked.ts supabase/tests/price_levels_test.sql   (staging, rolled back)
BEGIN;
SELECT plan(4);

SET session_replication_role = replica;
INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test, vertical) VALUES
  ('a3000000-0000-4000-8000-000000000001', 'Levels Shop', 'lvl-shop@example.invalid', '0500000301', 'active', true, 'fabric_store');
INSERT INTO public.branches (id, tenant_id, name, location, is_main) VALUES
  ('b3000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'Main', 'x', true);
INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status, branch_id) VALUES
  ('c3000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001', 'Owner', 'lvl-own@example.invalid', 'owner', NULL, 'active', 'b3000000-0000-4000-8000-000000000001');
INSERT INTO public.shifts (id, tenant_id, branch_id, staff_id, staff_name, opening_balance, status, start_time) VALUES
  ('53000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'Owner', 0, 'open', now());
INSERT INTO public.customers (id, tenant_id, name, phone, price_level) VALUES
  ('e3000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'زبون تجزئة', '0500000302', 'retail'),
  ('e3000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000001', 'خياط جملة', '0500000303', 'wholesale');
INSERT INTO public.inventory_items (id, tenant_id, name, category, category_key, unit, base_unit, conversion_rate, sku, price_per_unit, wholesale_price) VALUES
  ('f3000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'كتان', 'fabric', 'linen', 'meter', 'meter', 1, 'LVL-1', 30, 22),
  ('f3000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000001', 'مقص', 'accessories', 'accessories', 'piece', 'piece', 1, 'LVL-2', 40, NULL);
INSERT INTO public.branch_inventory (tenant_id, branch_id, item_id, quantity) VALUES
  ('a3000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001', 100),
  ('a3000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000002', 10);
SET session_replication_role = DEFAULT;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d3000000-0000-4000-8000-000000000001"}';
SELECT public.create_pos_sale('93000000-0000-4000-8000-000000000001'::uuid,
  jsonb_build_object('shift_id', '53000000-0000-4000-8000-000000000001', 'customer_id', 'e3000000-0000-4000-8000-000000000001', 'customer_name', 'زبون تجزئة', 'status', 'delivered', 'payment_method', 'cash', 'delivery_date', now()::text),
  '[{"type":"ready_made","item_id":"f3000000-0000-4000-8000-000000000001","name":"كتان","quantity":2,"price":1}]'::jsonb, '{}'::jsonb);
SELECT public.create_pos_sale('93000000-0000-4000-8000-000000000002'::uuid,
  jsonb_build_object('shift_id', '53000000-0000-4000-8000-000000000001', 'customer_id', 'e3000000-0000-4000-8000-000000000002', 'customer_name', 'خياط جملة', 'status', 'delivered', 'payment_method', 'cash', 'delivery_date', now()::text),
  '[{"type":"ready_made","item_id":"f3000000-0000-4000-8000-000000000001","name":"كتان","quantity":2,"price":1},
    {"type":"ready_made","item_id":"f3000000-0000-4000-8000-000000000002","name":"مقص","quantity":1,"price":1}]'::jsonb, '{}'::jsonb);
SELECT public.create_pos_sale('93000000-0000-4000-8000-000000000003'::uuid,
  jsonb_build_object('shift_id', '53000000-0000-4000-8000-000000000001', 'customer_name', 'عميل نقدي', 'status', 'delivered', 'payment_method', 'cash', 'delivery_date', now()::text),
  '[{"type":"ready_made","item_id":"f3000000-0000-4000-8000-000000000001","name":"كتان","quantity":1,"price":1}]'::jsonb, '{}'::jsonb);
RESET ROLE;

SELECT is((SELECT price FROM public.order_items WHERE order_id = '93000000-0000-4000-8000-000000000001'), 30::numeric,
  'a retail customer pays the usual price (30 a metre)');
SELECT is((SELECT price FROM public.order_items WHERE order_id = '93000000-0000-4000-8000-000000000002' AND item_id = 'f3000000-0000-4000-8000-000000000001'), 22::numeric,
  'a wholesale customer pays the wholesale price (22)');
SELECT is((SELECT price FROM public.order_items WHERE order_id = '93000000-0000-4000-8000-000000000002' AND item_id = 'f3000000-0000-4000-8000-000000000002'), 40::numeric,
  'a product without a wholesale price: the usual price, even for him');
SELECT is((SELECT price FROM public.order_items WHERE order_id = '93000000-0000-4000-8000-000000000003'), 30::numeric,
  'a walk-in sale: the usual price');

SELECT * FROM finish();
ROLLBACK;
