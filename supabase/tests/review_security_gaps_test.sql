-- 20261225000000_close_review_security_gaps.sql.
--
-- Proves: tenant_voucher_counters is closed to anon and signed-in users;
-- apply_stock_movement refuses a direct call without the right permission and
-- any call against another shop's branch or item, while the functions that use
-- it internally still work; and money columns on orders / order_items /
-- payments cannot be changed by a direct table write, while ordinary edits and
-- the owning functions still can.
--
-- Run with: npx supabase db query --linked --file <this file>
-- (supabase test db --linked needs Docker, which is down on this machine.)
BEGIN;
SELECT plan(17);

SET session_replication_role = replica;

INSERT INTO public.tenants (id, name, owner_email, phone)
VALUES
  ('a1000000-0000-4000-8000-0000000000a1', 'Review Gaps Test Tenant', 'owner@review-gaps.test.invalid', '0500000061'),
  ('a1000000-0000-4000-8000-0000000000a2', 'Review Gaps Other Tenant', 'owner@review-gaps-other.test.invalid', '0500000062');

INSERT INTO public.branches (id, tenant_id, name, location, is_main)
VALUES
  ('b1000000-0000-4000-8000-0000000000b1', 'a1000000-0000-4000-8000-0000000000a1', 'Main', 'Test', true),
  ('b1000000-0000-4000-8000-0000000000b2', 'a1000000-0000-4000-8000-0000000000a2', 'Other Main', 'Test', true);

-- role_id IS NULL: permissions come from the default matrix
-- (manager: inventory.reconcile = true; cashier: false).
INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status, branch_id)
VALUES
  ('c1000000-0000-4000-8000-0000000000c1', 'a1000000-0000-4000-8000-0000000000a1',
   'd1000000-0000-4000-8000-0000000000d1', 'Test Cashier', 'cashier@review-gaps.test.invalid', 'cashier', NULL, 'active',
   'b1000000-0000-4000-8000-0000000000b1'),
  ('c1000000-0000-4000-8000-0000000000c2', 'a1000000-0000-4000-8000-0000000000a1',
   'd1000000-0000-4000-8000-0000000000d2', 'Test Manager', 'manager@review-gaps.test.invalid', 'manager', NULL, 'active',
   'b1000000-0000-4000-8000-0000000000b1');

INSERT INTO public.customers (id, tenant_id, name, phone)
VALUES ('e1000000-0000-4000-8000-0000000000e1', 'a1000000-0000-4000-8000-0000000000a1', 'Test Customer', '0500000071');

INSERT INTO public.inventory_items (id, tenant_id, name, category, unit, conversion_rate, sku)
VALUES
  ('f1000000-0000-4000-8000-0000000000f1', 'a1000000-0000-4000-8000-0000000000a1', 'Gaps Cloth', 'fabric', 'roll', 22.86, 'GAPS-CLOTH-1'),
  ('f1000000-0000-4000-8000-0000000000f2', 'a1000000-0000-4000-8000-0000000000a2', 'Other Shop Cloth', 'fabric', 'roll', 22.86, 'GAPS-CLOTH-2');

INSERT INTO public.branch_inventory (tenant_id, branch_id, item_id, quantity)
VALUES ('a1000000-0000-4000-8000-0000000000a1', 'b1000000-0000-4000-8000-0000000000b1', 'f1000000-0000-4000-8000-0000000000f1', 50);

INSERT INTO public.shifts (id, tenant_id, branch_id, staff_id, staff_name, opening_balance, status)
VALUES ('51000000-0000-4000-8000-000000000051', 'a1000000-0000-4000-8000-0000000000a1', 'b1000000-0000-4000-8000-0000000000b1',
        'c1000000-0000-4000-8000-0000000000c1', 'Test Cashier', 0, 'open');

SET session_replication_role = DEFAULT;

-- ====================================================================
-- 1) tenant_voucher_counters
-- ====================================================================
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tenant_voucher_counters'::regclass),
  'tenant_voucher_counters has RLS enabled'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.tenant_voucher_counters', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.tenant_voucher_counters', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.tenant_voucher_counters', 'UPDATE'),
  'neither anon nor a signed-in user can read or rewrite the voucher counters'
);

-- ====================================================================
-- 2) apply_stock_movement
-- ====================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d1000000-0000-4000-8000-0000000000d1","role":"authenticated"}';

-- A cashier calling it straight from the API.
SELECT throws_matching(
  $$ SELECT public.apply_stock_movement('gaps-test:direct-cashier', 'b1000000-0000-4000-8000-0000000000b1'::uuid,
       'f1000000-0000-4000-8000-0000000000f1'::uuid, 500, 'adjustment') $$,
  'لا تملك صلاحية تعديل المخزون',
  'a cashier cannot adjust stock by calling the function directly'
);

-- The same cashier creating an order and moving it to cutting: the deduction
-- reaches apply_stock_movement from inside update_order_status and goes through.
SELECT public.create_tailoring_order('11000000-0000-4000-8000-00000000000a'::uuid,
  '{"customer_id":"e1000000-0000-4000-8000-0000000000e1","paid_amount":20,"payment_method":"cash"}'::jsonb,
  '[{"garment_type":"thobe","fabric":"Gaps Cloth","fabric_id":"f1000000-0000-4000-8000-0000000000f1","quantity":1,"price":100,"consumed_meters":4}]'::jsonb);
SELECT lives_ok(
  $$ SELECT public.update_order_status('11000000-0000-4000-8000-00000000000a'::uuid, 'cutting', 'cutting',
       NULL, '21000000-0000-4000-8000-000000000001'::uuid, 'cut') $$,
  'the cutting-stage deduction still works for a cashier (internal call)'
);

SET LOCAL request.jwt.claims = '{"sub":"d1000000-0000-4000-8000-0000000000d2","role":"authenticated"}';

-- A manager has inventory.reconcile.
SELECT lives_ok(
  $$ SELECT public.apply_stock_movement('gaps-test:direct-manager', 'b1000000-0000-4000-8000-0000000000b1'::uuid,
       'f1000000-0000-4000-8000-0000000000f1'::uuid, 10, 'adjustment') $$,
  'a manager can adjust stock directly'
);
-- But not against another shop's item or branch.
SELECT throws_matching(
  $$ SELECT public.apply_stock_movement('gaps-test:foreign-item', 'b1000000-0000-4000-8000-0000000000b1'::uuid,
       'f1000000-0000-4000-8000-0000000000f2'::uuid, 10, 'adjustment') $$,
  'forbidden',
  'another shop''s item is refused'
);
SELECT throws_matching(
  $$ SELECT public.apply_stock_movement('gaps-test:foreign-branch', 'b1000000-0000-4000-8000-0000000000b2'::uuid,
       'f1000000-0000-4000-8000-0000000000f1'::uuid, 10, 'adjustment') $$,
  'forbidden',
  'another shop''s branch is refused'
);

-- ====================================================================
-- 3) money columns
-- ====================================================================
-- The manager may update orders under RLS, but not the money on them.
SELECT throws_matching(
  $$ UPDATE public.orders SET paid_amount = total_amount WHERE id = '11000000-0000-4000-8000-00000000000a' $$,
  'مبالغ الطلب لا تُعدَّل مباشرة',
  'a direct write cannot mark an order as paid'
);
SELECT throws_matching(
  $$ UPDATE public.orders SET total_amount = 1 WHERE id = '11000000-0000-4000-8000-00000000000a' $$,
  'مبالغ الطلب لا تُعدَّل مباشرة',
  'a direct write cannot change an order total'
);
SELECT throws_matching(
  $$ UPDATE public.orders SET fabric_deducted_at = NULL WHERE id = '11000000-0000-4000-8000-00000000000a' $$,
  'مبالغ الطلب لا تُعدَّل مباشرة',
  'a direct write cannot clear the fabric deduction stamp'
);
-- An ordinary edit still goes through.
SELECT lives_ok(
  $$ UPDATE public.orders SET notes = 'manager note' WHERE id = '11000000-0000-4000-8000-00000000000a' $$,
  'a direct write can still edit an order''s notes'
);
SELECT throws_matching(
  $$ UPDATE public.order_items SET price = 1 WHERE order_id = '11000000-0000-4000-8000-00000000000a' $$,
  'أصناف الطلب لا تُعدَّل مباشرة',
  'a direct write cannot change a line price'
);
SELECT throws_matching(
  $$ UPDATE public.payments SET amount = 999999 WHERE order_id = '11000000-0000-4000-8000-00000000000a' $$,
  'الدفعات لا تُعدَّل مباشرة',
  'a direct write cannot change a payment amount'
);
SELECT throws_matching(
  $$ INSERT INTO public.payments (tenant_id, order_id, amount, method)
     VALUES ('a1000000-0000-4000-8000-0000000000a1', '11000000-0000-4000-8000-00000000000a', 80, 'cash') $$,
  'الدفعات تُسجَّل عبر النظام فقط',
  'a payment cannot be inserted directly'
);
SELECT throws_matching(
  $$ INSERT INTO public.orders (tenant_id, customer_name, order_number, delivery_date, kind)
     VALUES ('a1000000-0000-4000-8000-0000000000a1', 'x', 999001, now(), 'tailoring') $$,
  'هذا الطلب يُنشأ عبر النظام فقط',
  'a tailoring-kind order cannot be inserted directly'
);

-- The owning function still records a payment.
SET LOCAL request.jwt.claims = '{"sub":"d1000000-0000-4000-8000-0000000000d1","role":"authenticated"}';
SELECT lives_ok(
  $$ SELECT public.record_order_payment('21000000-0000-4000-8000-000000000002'::uuid,
       '11000000-0000-4000-8000-00000000000a'::uuid, 30, 'cash',
       '51000000-0000-4000-8000-000000000051'::uuid, 'part payment', NULL, NULL) $$,
  'record_order_payment still records a payment'
);

RESET ROLE;
SELECT is((SELECT paid_amount FROM public.orders WHERE id = '11000000-0000-4000-8000-00000000000a'),
  50.00::numeric, 'the order shows the deposit and the payment, and nothing else');

SELECT * FROM finish();
ROLLBACK;
