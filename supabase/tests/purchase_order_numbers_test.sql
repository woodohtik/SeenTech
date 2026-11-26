-- seen-merchant-trial-test-2026-11-26.md, phase 3 item 5: purchase order
-- numbers were the browser's clock (PO-1795645685295). Now each shop counts
-- its own: PO-0001, PO-0002 ...; a purchase return counts on its own (RET-0001);
-- the same request again keeps its number.
--
--   CI:    supabase test db
--   Here:  npx tsx scripts/db/pgtap-linked.ts supabase/tests/purchase_order_numbers_test.sql   (staging, rolled back)
BEGIN;
SELECT plan(6);

SET session_replication_role = replica;
INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test) VALUES
  ('aa000000-0000-4000-8000-000000000001', 'PO Shop', 'po-shop@example.invalid', '0500000a01', 'active', true),
  ('aa000000-0000-4000-8000-000000000002', 'PO Other', 'po-other@example.invalid', '0500000a02', 'active', true);
INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status) VALUES
  ('ca000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001', 'da000000-0000-4000-8000-000000000001', 'Owner', 'po-own@example.invalid', 'owner', NULL, 'active'),
  ('ca000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-000000000002', 'da000000-0000-4000-8000-000000000002', 'Owner2', 'po-own2@example.invalid', 'owner', NULL, 'active');
INSERT INTO public.suppliers (id, tenant_id, name) VALUES
  ('ea000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001', 'مؤسسة الحرير'),
  ('ea000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-000000000002', 'Other supplier');
SET session_replication_role = DEFAULT;

CREATE TEMP TABLE _po (n int, number text);
GRANT ALL ON _po TO authenticated;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"da000000-0000-4000-8000-000000000001"}';
INSERT INTO _po SELECT 1, public.create_purchase_order('fa000000-0000-4000-8000-000000000001',
  '{"supplier_id":"ea000000-0000-4000-8000-000000000001","po_number":"PO-1795645685295"}'::jsonb,
  '[{"name":"x","quantity":1,"unit":"piece","conversion_rate":1,"base_quantity":1,"price_per_unit":10,"total":10}]'::jsonb) ->> 'po_number';
INSERT INTO _po SELECT 2, public.create_purchase_order('fa000000-0000-4000-8000-000000000002',
  '{"supplier_id":"ea000000-0000-4000-8000-000000000001","po_number":"PO-1"}'::jsonb,
  '[{"name":"x","quantity":1,"unit":"piece","conversion_rate":1,"base_quantity":1,"price_per_unit":10,"total":10}]'::jsonb) ->> 'po_number';
INSERT INTO _po SELECT 3, public.create_purchase_order('fa000000-0000-4000-8000-000000000003',
  '{"supplier_id":"ea000000-0000-4000-8000-000000000001","po_number":"RET-1795645685295"}'::jsonb,
  '[{"name":"x","quantity":1,"unit":"piece","conversion_rate":1,"base_quantity":1,"price_per_unit":10,"total":10}]'::jsonb) ->> 'po_number';
-- The same request again.
INSERT INTO _po SELECT 4, public.create_purchase_order('fa000000-0000-4000-8000-000000000001',
  '{"supplier_id":"ea000000-0000-4000-8000-000000000001","po_number":"PO-9"}'::jsonb,
  '[{"name":"x","quantity":1,"unit":"piece","conversion_rate":1,"base_quantity":1,"price_per_unit":10,"total":10}]'::jsonb) ->> 'po_number';
SET LOCAL request.jwt.claims = '{"sub":"da000000-0000-4000-8000-000000000002"}';
INSERT INTO _po SELECT 5, public.create_purchase_order('fa000000-0000-4000-8000-000000000005',
  '{"supplier_id":"ea000000-0000-4000-8000-000000000002","po_number":"PO-2"}'::jsonb,
  '[{"name":"x","quantity":1,"unit":"piece","conversion_rate":1,"base_quantity":1,"price_per_unit":10,"total":10}]'::jsonb) ->> 'po_number';
RESET ROLE;

SELECT is((SELECT number FROM _po WHERE n = 1), 'PO-0001', 'the first purchase order is PO-0001');
SELECT is((SELECT number FROM _po WHERE n = 2), 'PO-0002', 'the next is PO-0002');
SELECT is((SELECT number FROM _po WHERE n = 3), 'RET-0001', 'a purchase return counts on its own');
SELECT is((SELECT number FROM _po WHERE n = 4), 'PO-0001', 'the same request again keeps its number');
SELECT is((SELECT number FROM _po WHERE n = 5), 'PO-0001', 'another shop starts at PO-0001');
SELECT is((SELECT po_number FROM public.purchase_orders WHERE id = 'fa000000-0000-4000-8000-000000000002'), 'PO-0002', 'the saved order carries it');

SELECT * FROM finish();
ROLLBACK;
