-- seen-product-variants-barcode-po-price-task.md, phase 1: a barcode is used
-- once in a shop -- across its products AND their variants; another shop may
-- use the same code. is_barcode_available answers for the current shop only.
--
--   CI:    supabase test db
--   Here:  npx tsx scripts/db/pgtap-linked.ts supabase/tests/barcodes_test.sql   (staging, rolled back)
BEGIN;
SELECT plan(7);

SET session_replication_role = replica;
INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test) VALUES
  ('ae000000-0000-4000-8000-000000000001', 'Barcode Shop', 'bc-shop@example.invalid', '0500000e01', 'active', true),
  ('ae000000-0000-4000-8000-000000000002', 'Barcode Other', 'bc-other@example.invalid', '0500000e02', 'active', true);
INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status) VALUES
  ('ce000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000001', 'Owner', 'bc-own@example.invalid', 'owner', NULL, 'active');
INSERT INTO public.inventory_items (id, tenant_id, name, category, unit, conversion_rate, sku, barcode) VALUES
  ('fe000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', 'ثوب', 'ready_made', 'piece', 1, 'BC-1', '2000000000015'),
  ('fe000000-0000-4000-8000-000000000002', 'ae000000-0000-4000-8000-000000000002', 'Other', 'ready_made', 'piece', 1, 'BC-2', '2000000000022');
SET session_replication_role = DEFAULT;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"de000000-0000-4000-8000-000000000001"}';
SELECT is(public.is_barcode_available('2000000000015'), false, 'a product''s barcode is taken');
SELECT is(public.is_barcode_available('2000000000022'), true, 'another shop''s barcode is free here');
SELECT is(public.is_barcode_available('2999999999999'), true, 'an unused barcode is free');
RESET ROLE;

SELECT throws_ok($$
  INSERT INTO public.inventory_variants (tenant_id, item_id, sku, barcode, name)
  VALUES ('ae000000-0000-4000-8000-000000000001', 'fe000000-0000-4000-8000-000000000001', 'BC-1-W', '2000000000015', 'أبيض')
$$, '23505', NULL, 'a variant cannot take its shop''s product barcode');

SELECT lives_ok($$
  INSERT INTO public.inventory_variants (tenant_id, item_id, sku, barcode, name)
  VALUES ('ae000000-0000-4000-8000-000000000001', 'fe000000-0000-4000-8000-000000000001', 'BC-1-B', '2000000000039', 'أسود')
$$, 'a variant with its own barcode is saved');

SELECT throws_ok($$
  INSERT INTO public.inventory_variants (tenant_id, item_id, sku, barcode, name)
  VALUES ('ae000000-0000-4000-8000-000000000001', 'fe000000-0000-4000-8000-000000000001', 'BC-1-G', '2000000000039', 'رمادي')
$$, '23505', NULL, 'nor another variant''s');

SELECT throws_ok($$
  UPDATE public.inventory_items SET barcode = '2000000000039' WHERE id = 'fe000000-0000-4000-8000-000000000001'
$$, '23505', NULL, 'nor can a product take a variant''s');

SELECT * FROM finish();
ROLLBACK;
