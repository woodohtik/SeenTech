-- docs/superpowers/plans/2026-11-18-permissions-server-enforcement.md Fix-D.
-- Proves process_sales_return gates on action.refund via app_has_permission()
-- instead of the old hardcoded owner/admin/manager role check.
--
-- Run with: supabase test db --linked (pushes nothing; runs against the
-- already-migrated staging schema). Docker is down on this machine, so in
-- practice this was run via:
--   npx supabase db query --linked --file supabase/tests/process_sales_return_permission_check_test.sql
BEGIN;
SELECT plan(3);

-- Fixtures: one tenant, a custom role ("cashier_refund_override") whose
-- JSONB explicitly sets action.refund:true (base cashier enum default is
-- false), three staff (plain manager, plain cashier, cashier-with-override),
-- one open shift per staff, and -- per order, since process_sales_return
-- needs a real orders/order_items/tax_invoices row to return against --
-- three separate orders each with one custom order_item (price 100, qty 1)
-- and a matching tax_invoice (total_amount 100) so check_sales_return_total
-- never blocks the refund.
SET session_replication_role = replica;

INSERT INTO public.tenants (id, name, owner_email, phone)
VALUES ('11111111-1111-1111-1111-111111111111', 'Sales Return Perm Test Tenant', 'owner@sales-return-perm.test.invalid', '0500000003');

INSERT INTO public.roles (id, tenant_id, role_key, name, permissions)
VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
        'cashier_refund_override', 'Cashier Refund Override', '{"action.refund": true}'::jsonb);

INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status)
VALUES
  -- plain manager: action.refund=true via app_default_permission's manager row
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444444', 'Returns Manager', 'manager@sales-return-perm.test.invalid', 'manager', NULL, 'active'),
  -- plain cashier: action.refund=false via app_default_permission's cashier row
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111',
   '66666666-6666-6666-6666-666666666666', 'Returns Cashier', 'cashier@sales-return-perm.test.invalid', 'cashier', NULL, 'active'),
  -- cashier whose custom role JSONB overrides action.refund to true
  ('77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111',
   '88888888-8888-8888-8888-888888888888', 'Override Cashier', 'override@sales-return-perm.test.invalid', 'cashier',
   '22222222-2222-2222-2222-222222222222', 'active');

INSERT INTO public.shifts (id, tenant_id, branch_id, staff_id, staff_name, opening_balance, status)
VALUES
  ('99999999-9999-9999-9999-999999999991', '11111111-1111-1111-1111-111111111111', NULL,
   '33333333-3333-3333-3333-333333333333', 'Returns Manager', 0, 'open'),
  ('99999999-9999-9999-9999-999999999992', '11111111-1111-1111-1111-111111111111', NULL,
   '55555555-5555-5555-5555-555555555555', 'Returns Cashier', 0, 'open'),
  ('99999999-9999-9999-9999-999999999993', '11111111-1111-1111-1111-111111111111', NULL,
   '77777777-7777-7777-7777-777777777777', 'Override Cashier', 0, 'open');

-- Order 1 (for the manager scenario)
INSERT INTO public.orders (id, tenant_id, customer_name, order_number, delivery_date, total_amount, paid_amount, tax_rate, discount_amount)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '11111111-1111-1111-1111-111111111111',
        'Return Test Customer 1', 1, now() + interval '7 days', 100, 100, 0, 0);
INSERT INTO public.order_items (id, tenant_id, order_id, type, name, quantity, price)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'custom', 'Custom Item 1', 1, 100);
INSERT INTO public.tax_invoices (id, tenant_id, order_id, invoice_number, subtotal, total_amount, paid_amount)
VALUES ('cccccccc-cccc-cccc-cccc-ccccccccccc1', '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'INV-RET-TEST-1', 100, 100, 100);

-- Order 2 (for the denied cashier scenario)
INSERT INTO public.orders (id, tenant_id, customer_name, order_number, delivery_date, total_amount, paid_amount, tax_rate, discount_amount)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', '11111111-1111-1111-1111-111111111111',
        'Return Test Customer 2', 2, now() + interval '7 days', 100, 100, 0, 0);
INSERT INTO public.order_items (id, tenant_id, order_id, type, name, quantity, price)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'custom', 'Custom Item 2', 1, 100);
INSERT INTO public.tax_invoices (id, tenant_id, order_id, invoice_number, subtotal, total_amount, paid_amount)
VALUES ('cccccccc-cccc-cccc-cccc-ccccccccccc2', '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'INV-RET-TEST-2', 100, 100, 100);

-- Order 3 (for the custom-role-override cashier scenario)
INSERT INTO public.orders (id, tenant_id, customer_name, order_number, delivery_date, total_amount, paid_amount, tax_rate, discount_amount)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', '11111111-1111-1111-1111-111111111111',
        'Return Test Customer 3', 3, now() + interval '7 days', 100, 100, 0, 0);
INSERT INTO public.order_items (id, tenant_id, order_id, type, name, quantity, price)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3', '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'custom', 'Custom Item 3', 1, 100);
INSERT INTO public.tax_invoices (id, tenant_id, order_id, invoice_number, subtotal, total_amount, paid_amount)
VALUES ('cccccccc-cccc-cccc-cccc-ccccccccccc3', '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'INV-RET-TEST-3', 100, 100, 100);

SET session_replication_role = DEFAULT;

-- Scenario 1: plain manager (action.refund=true via the default table) --
-- lives_ok, and the refund actually lands.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444"}';
SELECT lives_ok(
  $$ SELECT public.process_sales_return(
       'd1111111-0000-0000-0000-000000000001'::uuid,
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid,
       '99999999-9999-9999-9999-999999999991'::uuid,
       jsonb_build_array(
         jsonb_build_object('order_item_id', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'quantity', 1)
       ),
       'test return', 'cash'
     ) $$,
  'manager: action.refund=true via default table -- lives_ok'
);

-- Scenario 2: plain cashier (action.refund=false via the default table) --
-- throws the exact permission-denied message.
SET LOCAL request.jwt.claims = '{"sub":"66666666-6666-6666-6666-666666666666"}';
SELECT throws_matching(
  $$ SELECT public.process_sales_return(
       'd2222222-0000-0000-0000-000000000002'::uuid,
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'::uuid,
       '99999999-9999-9999-9999-999999999992'::uuid,
       jsonb_build_array(
         jsonb_build_object('order_item_id', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'quantity', 1)
       ),
       'test return', 'cash'
     ) $$,
  'لا تملك صلاحية معالجة المرتجعات',
  'cashier: action.refund=false via default table -- denied with exact message'
);

-- Scenario 3: cashier whose custom role JSONB explicitly sets
-- action.refund:true -- proves the gate is driven by app_has_permission's
-- generic role_id/JSONB resolution, not coincidentally by the role enum.
SET LOCAL request.jwt.claims = '{"sub":"88888888-8888-8888-8888-888888888888"}';
SELECT lives_ok(
  $$ SELECT public.process_sales_return(
       'd3333333-0000-0000-0000-000000000003'::uuid,
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3'::uuid,
       '99999999-9999-9999-9999-999999999993'::uuid,
       jsonb_build_array(
         jsonb_build_object('order_item_id', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3', 'quantity', 1)
       ),
       'test return', 'cash'
     ) $$,
  'cashier with custom role action.refund:true override -- lives_ok, gate is generic'
);

SELECT * FROM finish();
ROLLBACK;
