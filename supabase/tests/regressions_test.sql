-- seen-stability-guardrails-task.md, phase 2: what was fixed in the last
-- month stays fixed. Each block names the fix it holds in place.
--
--   CI:    supabase test db
--   Here:  npx tsx scripts/db/pgtap-linked.ts supabase/tests/regressions_test.sql   (staging, rolled back)
BEGIN;
SELECT plan(16);

SET session_replication_role = replica;

-- One shop for the sales and orders, and five more for app_current_tenant_id.
INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test, vat_number, is_tax_enabled, default_tax_rate)
VALUES ('a1000000-0000-4000-8000-000000000001', 'Regression Shop', 'reg@example.invalid', '0500000101', 'active', true, '300000000000003', true, 15);
INSERT INTO public.tenants (id, name, owner_email, phone, owner_uid, status, trashed_at, subscription_status, trial_ends_at, subscription_end_date)
VALUES
  ('a1000000-0000-4000-8000-0000000000a1', 'Active', 'a1@example.invalid', '0500000111', '91000000-0000-4000-8000-000000000001', 'active', NULL, 'active', NULL, NULL),
  ('a1000000-0000-4000-8000-0000000000a2', 'Trashed', 'a2@example.invalid', '0500000112', '91000000-0000-4000-8000-000000000002', 'active', now(), 'active', NULL, NULL),
  ('a1000000-0000-4000-8000-0000000000a3', 'Inactive', 'a3@example.invalid', '0500000113', '91000000-0000-4000-8000-000000000003', 'inactive', NULL, 'active', NULL, NULL),
  ('a1000000-0000-4000-8000-0000000000a4', 'Locked', 'a4@example.invalid', '0500000114', '91000000-0000-4000-8000-000000000004', 'active', NULL, 'locked', NULL, NULL),
  ('a1000000-0000-4000-8000-0000000000a5', 'Trial over', 'a5@example.invalid', '0500000115', '91000000-0000-4000-8000-000000000005', 'active', NULL, 'trial', now() - interval '1 day', NULL);

INSERT INTO public.branches (id, tenant_id, name, location, is_main)
VALUES ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Main', 'x', true);

INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status, branch_id) VALUES
  ('c1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000011', 'Owner', 'reg-own@example.invalid', 'owner', NULL, 'active', 'b1000000-0000-4000-8000-000000000001'),
  ('c1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000012', 'Cashier', 'reg-cash@example.invalid', 'cashier', NULL, 'active', 'b1000000-0000-4000-8000-000000000001'),
  ('c1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000013', 'Tailor', 'reg-tail@example.invalid', 'tailor', NULL, 'active', 'b1000000-0000-4000-8000-000000000001');

INSERT INTO public.shifts (id, tenant_id, branch_id, staff_id, staff_name, opening_balance, status, start_time)
VALUES ('d1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001',
        'c1000000-0000-4000-8000-000000000001', 'Owner', 0, 'open', now());

INSERT INTO public.customers (id, tenant_id, name, phone) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Customer', '0500000121');

INSERT INTO public.inventory_items (id, tenant_id, name, sku, category, category_key, unit, base_unit, conversion_rate, price_per_unit, min_threshold)
VALUES ('f1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Cotton', 'REG-COTTON', 'fabric', 'cotton', 'meter', 'meter', 1, 20, 0);
INSERT INTO public.branch_inventory (tenant_id, branch_id, item_id, quantity)
VALUES ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 100);

SET session_replication_role = DEFAULT;

-- ---------------------------------------------------------------------------------
-- 1-5. app_current_tenant_id: a shop that is trashed, inactive, locked or whose
-- trial is over has no rows for anyone (20261115070000 once dropped the trash
-- check -- seen-status-fix-regressions-task.md item 2).
-- ---------------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000001"}';
SELECT is(public.app_current_tenant_id(), 'a1000000-0000-4000-8000-0000000000a1'::uuid, 'an active shop resolves');
SET LOCAL request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000002"}';
SELECT is(public.app_current_tenant_id(), NULL::uuid, 'a trashed shop resolves to nothing');
SET LOCAL request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000003"}';
SELECT is(public.app_current_tenant_id(), NULL::uuid, 'an inactive shop resolves to nothing');
SET LOCAL request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000004"}';
SELECT is(public.app_current_tenant_id(), NULL::uuid, 'a locked shop resolves to nothing');
SET LOCAL request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000005"}';
SELECT is(public.app_current_tenant_id(), NULL::uuid, 'a shop whose trial is over resolves to nothing');

-- ---------------------------------------------------------------------------------
-- 6-8. create_pos_sale keeps the ZATCA hash chain (PIH): each invoice names the
-- one before it (20261013040000 restored it after a rewrite from an old copy).
-- ---------------------------------------------------------------------------------
SET LOCAL request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000011"}';
SELECT public.create_pos_sale('a2000000-0000-4000-8000-000000000001'::uuid,
  jsonb_build_object('shift_id', 'd1000000-0000-4000-8000-000000000001', 'customer_name', 'A', 'status', 'delivered',
                     'payment_method', 'cash', 'paid_amount', 115, 'delivery_date', now()::text),
  '[{"type":"custom","name":"x","price":100,"quantity":1}]'::jsonb, '{}'::jsonb);
SELECT public.create_pos_sale('a2000000-0000-4000-8000-000000000002'::uuid,
  jsonb_build_object('shift_id', 'd1000000-0000-4000-8000-000000000001', 'customer_name', 'B', 'status', 'delivered',
                     'payment_method', 'cash', 'paid_amount', 115, 'delivery_date', now()::text),
  '[{"type":"custom","name":"y","price":100,"quantity":1}]'::jsonb, '{}'::jsonb);
RESET ROLE;
SELECT isnt((SELECT invoice_hash FROM public.tax_invoices WHERE order_id = 'a2000000-0000-4000-8000-000000000001'), NULL,
  'a POS sale''s tax invoice carries its hash');
SELECT is((SELECT previous_invoice_hash FROM public.tax_invoices WHERE order_id = 'a2000000-0000-4000-8000-000000000002'),
          (SELECT invoice_hash FROM public.tax_invoices WHERE order_id = 'a2000000-0000-4000-8000-000000000001'),
  'the next sale''s invoice names the one before it (PIH)');
SELECT is((SELECT last_invoice_hash FROM public.zatca_invoice_chain_state WHERE tenant_id = 'a1000000-0000-4000-8000-000000000001'),
          (SELECT invoice_hash FROM public.tax_invoices WHERE order_id = 'a2000000-0000-4000-8000-000000000002'),
  'the chain''s state moves to the latest invoice');

-- ---------------------------------------------------------------------------------
-- 9-12. A cashier and a tailor move an order's stage, and it really moves (no
-- silent success: 20261124000000 / the status RPC, after direct updates were
-- narrowed to owner/admin/manager and silently did nothing).
-- ---------------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000011"}';
SELECT public.create_tailoring_order('a3000000-0000-4000-8000-000000000001'::uuid,
  jsonb_build_object('customer_id', 'e1000000-0000-4000-8000-000000000001', 'paid_amount', 0, 'status', 'measurements_taken', 'status_key', 'measurements_taken'),
  '[{"garment_type":"ثوب","quantity":1,"price":100}]'::jsonb);
SET LOCAL request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000012"}';
SELECT lives_ok($$ SELECT public.update_order_status((SELECT id FROM public.orders WHERE tenant_id = 'a1000000-0000-4000-8000-000000000001' AND kind = 'tailoring' LIMIT 1),
  'cutting', 'cutting', NULL, 'a3000000-0000-4000-8000-000000000011'::uuid, 'cashier') $$, 'a cashier moves an order to cutting');
SELECT is((SELECT status::text FROM public.orders WHERE tenant_id = 'a1000000-0000-4000-8000-000000000001' AND kind = 'tailoring' LIMIT 1), 'cutting',
  '... and the order is in cutting');
SET LOCAL request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000013"}';
SELECT lives_ok($$ SELECT public.update_order_status((SELECT id FROM public.orders WHERE tenant_id = 'a1000000-0000-4000-8000-000000000001' AND kind = 'tailoring' LIMIT 1),
  'sewing', 'sewing', NULL, 'a3000000-0000-4000-8000-000000000012'::uuid, 'tailor') $$, 'a tailor moves it to sewing');
SELECT is((SELECT status::text FROM public.orders WHERE tenant_id = 'a1000000-0000-4000-8000-000000000001' AND kind = 'tailoring' LIMIT 1), 'sewing',
  '... and the order is in sewing');

-- ---------------------------------------------------------------------------------
-- 13-16. A thobe sold from the POS: its cloth is taken once (at the sale), and
-- cutting moves only the difference (20270115000000).
-- ---------------------------------------------------------------------------------
SET LOCAL request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000011"}';
SELECT public.create_pos_sale('a4000000-0000-4000-8000-000000000001'::uuid,
  jsonb_build_object('shift_id', 'd1000000-0000-4000-8000-000000000001', 'customer_name', 'C', 'status', 'measurements_taken',
                     'payment_method', 'cash', 'paid_amount', 0, 'delivery_date', now()::text),
  jsonb_build_array(jsonb_build_object('type', 'custom', 'name', 'ثوب', 'price', 100, 'quantity', 1,
                    'fabric_id', 'f1000000-0000-4000-8000-000000000001', 'fabric', 'Cotton', 'consumed_meters', 3.5)), '{}'::jsonb);
RESET ROLE;
SELECT is((SELECT quantity FROM public.branch_inventory WHERE item_id = 'f1000000-0000-4000-8000-000000000001'), 96.5::numeric,
  'the sale takes 3.5 m');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000011"}';
SELECT public.update_order_status_with_fabric('a4000000-0000-4000-8000-000000000001'::uuid, 'cutting', 'cutting',
  (SELECT jsonb_agg(jsonb_build_object('line_key', id, 'fabric_id', fabric_id, 'meters', 3.5)) FROM public.order_items WHERE order_id = 'a4000000-0000-4000-8000-000000000001'),
  NULL, 'a4000000-0000-4000-8000-000000000011'::uuid, 'cut');
RESET ROLE;
SELECT is((SELECT quantity FROM public.branch_inventory WHERE item_id = 'f1000000-0000-4000-8000-000000000001'), 96.5::numeric,
  'cutting at the sale figure takes nothing more (no double deduction)');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000011"}';
SELECT public.update_order_status_with_fabric('a4000000-0000-4000-8000-000000000001'::uuid, 'sewing', 'sewing',
  (SELECT jsonb_agg(jsonb_build_object('line_key', id, 'fabric_id', fabric_id, 'meters', 4)) FROM public.order_items WHERE order_id = 'a4000000-0000-4000-8000-000000000001'),
  NULL, 'a4000000-0000-4000-8000-000000000012'::uuid, 'sew');
SELECT public.update_order_status_with_fabric('a4000000-0000-4000-8000-000000000001'::uuid, 'sewing', 'sewing',
  (SELECT jsonb_agg(jsonb_build_object('line_key', id, 'fabric_id', fabric_id, 'meters', 4)) FROM public.order_items WHERE order_id = 'a4000000-0000-4000-8000-000000000001'),
  NULL, 'a4000000-0000-4000-8000-000000000012'::uuid, 'sew');
RESET ROLE;
SELECT is((SELECT quantity FROM public.branch_inventory WHERE item_id = 'f1000000-0000-4000-8000-000000000001'), 96::numeric,
  'a correction to 4 m takes only the 0.5 m difference, once, even when the request is sent twice');
SELECT is((SELECT kind FROM public.orders WHERE id = 'a4000000-0000-4000-8000-000000000001'), 'pos_sale',
  'the sale is marked as a POS sale');

SELECT * FROM finish();
ROLLBACK;
