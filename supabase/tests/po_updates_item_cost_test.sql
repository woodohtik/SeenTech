-- seen-product-variants-barcode-po-price-task.md, phase 4 (questions 3, 4):
-- a purchase line marked "update the product's price" changes the product's
-- cost when the order is CONFIRMED (not as a draft), per metre for fabric
-- bought by the roll; never from a return; only for someone with
-- inventory.edit; the selling price never moves.
--
--   CI:    supabase test db
--   Here:  npx tsx scripts/db/pgtap-linked.ts supabase/tests/po_updates_item_cost_test.sql   (staging, rolled back)
BEGIN;
SELECT plan(8);

SET session_replication_role = replica;
INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test) VALUES
  ('a6000000-0000-4000-8000-000000000001', 'PO Cost Shop', 'poc-shop@example.invalid', '0500000601', 'active', true);
INSERT INTO public.branches (id, tenant_id, name, location, is_main) VALUES
  ('b6000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001', 'Main', 'x', true);
INSERT INTO public.roles (id, tenant_id, role_key, name, permissions, base_role) VALUES
  ('96000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001', 'buyer', 'buyer', '{"suppliers.manage": true, "inventory.edit": false}'::jsonb, 'cashier');
INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status, branch_id) VALUES
  ('c6000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000001', 'Owner', 'poc-own@example.invalid', 'owner', NULL, 'active', 'b6000000-0000-4000-8000-000000000001'),
  ('c6000000-0000-4000-8000-000000000002', 'a6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000002', 'Buyer', 'poc-buy@example.invalid', 'cashier', '96000000-0000-4000-8000-000000000001', 'active', 'b6000000-0000-4000-8000-000000000001');
INSERT INTO public.suppliers (id, tenant_id, name) VALUES
  ('e6000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001', 'مؤسسة الحرير');
-- Fabric at 12 per metre (cost kept in the description's metadata, as the app does), sold at 40.
INSERT INTO public.inventory_items (id, tenant_id, name, category, unit, conversion_rate, sku, price_per_unit, description) VALUES
  ('f6000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001', 'ياباني', 'fabric', 'roll', 10, 'POC-1', 40,
   '__INVENTORY_METADATA__:{"costPrice":12,"taxType":"exclusive","originalDescription":"قماش"}'),
  ('f6000000-0000-4000-8000-000000000002', 'a6000000-0000-4000-8000-000000000001', 'أزرار', 'accessories', 'piece', 1, 'POC-2', 5, 'plain text'),
  ('f6000000-0000-4000-8000-000000000003', 'a6000000-0000-4000-8000-000000000001', 'خيط', 'accessories', 'piece', 1, 'POC-3', 3,
   '__INVENTORY_METADATA__:{"costPrice":1,"taxType":"exclusive","originalDescription":""}');
INSERT INTO public.branch_inventory (tenant_id, branch_id, item_id, quantity) VALUES
  ('a6000000-0000-4000-8000-000000000001', 'b6000000-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-000000000003', 10);
SET session_replication_role = DEFAULT;

CREATE TEMP TABLE _r (n int, v jsonb);
GRANT ALL ON _r TO authenticated;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d6000000-0000-4000-8000-000000000001"}';
-- 2 rolls of 10 m at 130 a roll (13 a metre), "update" ticked; buttons at 2, not ticked.
SELECT public.create_purchase_order('86000000-0000-4000-8000-000000000001',
  '{"supplier_id":"e6000000-0000-4000-8000-000000000001","po_number":"PO-"}'::jsonb,
  '[{"item_id":"f6000000-0000-4000-8000-000000000001","name":"ياباني","quantity":2,"unit":"roll","conversion_rate":10,"base_quantity":20,"price_per_unit":130,"total":260,"update_item_cost":true},
    {"item_id":"f6000000-0000-4000-8000-000000000002","name":"أزرار","quantity":10,"unit":"piece","conversion_rate":1,"base_quantity":10,"price_per_unit":2,"total":20}]'::jsonb);
RESET ROLE;
SELECT is(((substring((SELECT description FROM public.inventory_items WHERE id = 'f6000000-0000-4000-8000-000000000001') from 24))::jsonb ->> 'costPrice')::numeric,
  12::numeric, 'a draft changes nothing yet');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d6000000-0000-4000-8000-000000000001"}';
SELECT public.confirm_purchase_order('86000000-0000-4000-8000-000000000001');
RESET ROLE;
SELECT is(((substring((SELECT description FROM public.inventory_items WHERE id = 'f6000000-0000-4000-8000-000000000001') from 24))::jsonb ->> 'costPrice')::numeric,
  13::numeric, 'confirmed: the cost is 13 a metre (130 a roll of 10 m)');
SELECT is(((substring((SELECT description FROM public.inventory_items WHERE id = 'f6000000-0000-4000-8000-000000000001') from 24))::jsonb ->> 'originalDescription'),
  'قماش', 'the rest of the product''s description is kept');
SELECT is((SELECT description FROM public.inventory_items WHERE id = 'f6000000-0000-4000-8000-000000000002'), 'plain text',
  'a line not ticked leaves its product alone');
SELECT is((SELECT price_per_unit FROM public.inventory_items WHERE id = 'f6000000-0000-4000-8000-000000000001')::numeric, 40::numeric,
  'the selling price never moves');
SELECT ok(EXISTS (SELECT 1 FROM public.audit_logs WHERE tenant_id = 'a6000000-0000-4000-8000-000000000001'
                    AND action = 'inventory.cost_from_purchase_order' AND metadata->>'item_id' = 'f6000000-0000-4000-8000-000000000001'),
  'the change is logged with its purchase order');

-- A return, ticked: never changes the price.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d6000000-0000-4000-8000-000000000001"}';
SELECT public.create_purchase_order('86000000-0000-4000-8000-000000000002',
  '{"supplier_id":"e6000000-0000-4000-8000-000000000001","po_number":"RET-"}'::jsonb,
  '[{"item_id":"f6000000-0000-4000-8000-000000000003","name":"خيط","quantity":1,"unit":"piece","conversion_rate":1,"base_quantity":1,"price_per_unit":9,"total":9,"update_item_cost":true}]'::jsonb);
SELECT public.confirm_purchase_order('86000000-0000-4000-8000-000000000002');
-- Someone without inventory.edit confirms a ticked line: the order goes through, the price does not.
SET LOCAL request.jwt.claims = '{"sub":"d6000000-0000-4000-8000-000000000002"}';
SELECT public.create_purchase_order('86000000-0000-4000-8000-000000000003',
  '{"supplier_id":"e6000000-0000-4000-8000-000000000001","po_number":"PO-"}'::jsonb,
  '[{"item_id":"f6000000-0000-4000-8000-000000000003","name":"خيط","quantity":5,"unit":"piece","conversion_rate":1,"base_quantity":5,"price_per_unit":2,"total":10,"update_item_cost":true}]'::jsonb);
INSERT INTO _r SELECT 1, public.confirm_purchase_order('86000000-0000-4000-8000-000000000003');
RESET ROLE;
SELECT is(((substring((SELECT description FROM public.inventory_items WHERE id = 'f6000000-0000-4000-8000-000000000003') from 24))::jsonb ->> 'costPrice')::numeric,
  1::numeric, 'neither a return nor someone without inventory.edit changes the price');
SELECT is((SELECT (v ->> 'cost_not_updated')::int FROM _r WHERE n = 1), 1,
  'the confirm says one price was not updated');

SELECT * FROM finish();
ROLLBACK;
