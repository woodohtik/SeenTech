-- seen-tailoring-order-fabric-units-task.md batches D-2 / D-3 and the
-- hardening that followed the 2026-11-19 team review
-- (20261221000000, 20261222000000, 20261223000000, 20261224000000).
--
-- Proves, for create_tailoring_order: who may call it, that the stage and the
-- money are the server's, tenant isolation, and idempotency. For the fabric
-- deduction: both lines on one cloth, once per order, the bound on reviewed
-- quantities, a line that is not the order's, nothing stamped when nothing
-- was deducted, the delivery-by-payment path, and short stock. And that the
-- till balance counts a tailoring deposit.
--
-- Run with: npx supabase db query --linked --file <this file>
-- (supabase test db --linked needs Docker, which is down on this machine.)
BEGIN;
SELECT plan(24);

SET session_replication_role = replica;

INSERT INTO public.tenants (id, name, owner_email, phone)
VALUES
  ('a0000000-0000-4000-8000-0000000000a1', 'Tailoring Order Test Tenant', 'owner@tailoring-order.test.invalid', '0500000041'),
  ('a0000000-0000-4000-8000-0000000000a2', 'Other Tenant', 'owner@tailoring-other.test.invalid', '0500000042');

INSERT INTO public.branches (id, tenant_id, name, location, is_main)
VALUES ('b0000000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-0000000000a1', 'Main', 'Test', true);

-- role_id IS NULL on all three, so permissions come from the default matrix.
INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status, branch_id)
VALUES
  ('c0000000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-0000000000a1',
   'd0000000-0000-4000-8000-0000000000d1', 'Test Cashier', 'cashier@tailoring-order.test.invalid', 'cashier', NULL, 'active',
   'b0000000-0000-4000-8000-0000000000b1'),
  ('c0000000-0000-4000-8000-0000000000c2', 'a0000000-0000-4000-8000-0000000000a1',
   'd0000000-0000-4000-8000-0000000000d2', 'Test Tailor', 'tailor@tailoring-order.test.invalid', 'tailor', NULL, 'active',
   'b0000000-0000-4000-8000-0000000000b1');

INSERT INTO public.customers (id, tenant_id, name, phone, measurements)
VALUES
  ('e0000000-0000-4000-8000-0000000000e1', 'a0000000-0000-4000-8000-0000000000a1', 'Test Customer', '0500000051',
   '{"length": 145, "sleeve": 62}'::jsonb),
  ('e0000000-0000-4000-8000-0000000000e2', 'a0000000-0000-4000-8000-0000000000a2', 'Other Tenant Customer', '0500000052',
   '{}'::jsonb);

INSERT INTO public.inventory_items (id, tenant_id, name, category, unit, conversion_rate, sku)
VALUES
  ('f0000000-0000-4000-8000-0000000000f1', 'a0000000-0000-4000-8000-0000000000a1', 'Test Cloth', 'fabric', 'roll', 22.86, 'TEST-CLOTH-1'),
  ('f0000000-0000-4000-8000-0000000000f2', 'a0000000-0000-4000-8000-0000000000a1', 'Scarce Cloth', 'fabric', 'roll', 22.86, 'TEST-CLOTH-2');

INSERT INTO public.branch_inventory (tenant_id, branch_id, item_id, quantity)
VALUES
  ('a0000000-0000-4000-8000-0000000000a1', 'b0000000-0000-4000-8000-0000000000b1', 'f0000000-0000-4000-8000-0000000000f1', 100),
  ('a0000000-0000-4000-8000-0000000000a1', 'b0000000-0000-4000-8000-0000000000b1', 'f0000000-0000-4000-8000-0000000000f2', 2);

INSERT INTO public.shifts (id, tenant_id, branch_id, staff_id, staff_name, opening_balance, status)
VALUES ('50000000-0000-4000-8000-000000000051', 'a0000000-0000-4000-8000-0000000000a1', 'b0000000-0000-4000-8000-0000000000b1',
        'c0000000-0000-4000-8000-0000000000c1', 'Test Cashier', 0, 'open');

SET session_replication_role = DEFAULT;

-- ====================================================================
-- create_tailoring_order
-- ====================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d0000000-0000-4000-8000-0000000000d2"}';

-- 1: a tailor has no orders.create.
SELECT throws_matching(
  $$ SELECT public.create_tailoring_order(
       '10000000-0000-4000-8000-000000000001'::uuid,
       '{"customer_id":"e0000000-0000-4000-8000-0000000000e1"}'::jsonb,
       '[{"garment_type":"thobe","quantity":1,"price":100}]'::jsonb) $$,
  'لا تملك صلاحية إنشاء الطلبات',
  'a tailor cannot create an order'
);

SET LOCAL request.jwt.claims = '{"sub":"d0000000-0000-4000-8000-0000000000d1"}';

-- 2: a cashier with no role row can (orders.create from the default matrix).
-- Order A: two lines on the same cloth plus the customer's own cloth, a 50
-- deposit, and a payload that claims to be delivered and nearly free.
SELECT lives_ok(
  $$ SELECT public.create_tailoring_order(
       '10000000-0000-4000-8000-00000000000a'::uuid,
       '{"customer_id":"e0000000-0000-4000-8000-0000000000e1","status":"delivered","status_key":"measurements_taken",
         "total_amount":1,"tax_amount":999,"paid_amount":50,"payment_method":"cash","notes":"customer note"}'::jsonb,
       '[{"garment_type":"thobe","fabric":"Test Cloth","fabric_id":"f0000000-0000-4000-8000-0000000000f1","quantity":3,"price":200,"consumed_meters":11.4},
         {"garment_type":"thobe","fabric":"Test Cloth","fabric_id":"f0000000-0000-4000-8000-0000000000f1","quantity":1,"price":200,"consumed_meters":3.8},
         {"garment_type":"thobe","fabric":"custom","fabric_id":"","quantity":1,"price":150,"consumed_meters":5}]'::jsonb) $$,
  'a cashier with no role row can create an order'
);

-- 3: a later stage cannot be claimed through status_key either.
SELECT throws_matching(
  $$ SELECT public.create_tailoring_order(
       '10000000-0000-4000-8000-000000000003'::uuid,
       '{"customer_id":"e0000000-0000-4000-8000-0000000000e1","status_key":"delivered"}'::jsonb,
       '[{"garment_type":"thobe","quantity":1,"price":100}]'::jsonb) $$,
  'الطلب الجديد يبدأ من أول مرحلة',
  'a new order cannot start at a later stage'
);

-- 4: another shop's customer.
SELECT throws_matching(
  $$ SELECT public.create_tailoring_order(
       '10000000-0000-4000-8000-000000000004'::uuid,
       '{"customer_id":"e0000000-0000-4000-8000-0000000000e2"}'::jsonb,
       '[{"garment_type":"thobe","quantity":1,"price":100}]'::jsonb) $$,
  'forbidden',
  'a customer of another tenant is refused'
);

-- 5: pieces are whole.
SELECT throws_matching(
  $$ SELECT public.create_tailoring_order(
       '10000000-0000-4000-8000-000000000005'::uuid,
       '{"customer_id":"e0000000-0000-4000-8000-0000000000e1"}'::jsonb,
       '[{"garment_type":"thobe","quantity":2.5,"price":100}]'::jsonb) $$,
  'عدد قطع صحيحاً',
  'a fractional piece count is refused'
);

-- 6: the same operation id again returns the first result.
SELECT is(
  (public.create_tailoring_order('10000000-0000-4000-8000-00000000000a'::uuid, '{}'::jsonb, '[]'::jsonb)->>'replayed'),
  'true',
  'a repeated operation id is replayed, not run again'
);

-- Order B: one line, no fabric figure yet. Order C: scarce cloth, more than is in stock.
-- Order D: delivered straight from the payment dialog. Order E: same, short of stock.
SELECT public.create_tailoring_order('10000000-0000-4000-8000-00000000000b'::uuid,
  '{"customer_id":"e0000000-0000-4000-8000-0000000000e1"}'::jsonb,
  '[{"garment_type":"thobe","fabric":"Test Cloth","fabric_id":"f0000000-0000-4000-8000-0000000000f1","quantity":2,"price":100,"consumed_meters":0}]'::jsonb);
SELECT public.create_tailoring_order('10000000-0000-4000-8000-00000000000c'::uuid,
  '{"customer_id":"e0000000-0000-4000-8000-0000000000e1"}'::jsonb,
  '[{"garment_type":"thobe","fabric":"Scarce Cloth","fabric_id":"f0000000-0000-4000-8000-0000000000f2","quantity":1,"price":100,"consumed_meters":5}]'::jsonb);
SELECT public.create_tailoring_order('10000000-0000-4000-8000-00000000000d'::uuid,
  '{"customer_id":"e0000000-0000-4000-8000-0000000000e1"}'::jsonb,
  '[{"garment_type":"thobe","fabric":"Test Cloth","fabric_id":"f0000000-0000-4000-8000-0000000000f1","quantity":1,"price":100,"consumed_meters":4}]'::jsonb);
SELECT public.create_tailoring_order('10000000-0000-4000-8000-00000000000e'::uuid,
  '{"customer_id":"e0000000-0000-4000-8000-0000000000e1"}'::jsonb,
  '[{"garment_type":"thobe","fabric":"Scarce Cloth","fabric_id":"f0000000-0000-4000-8000-0000000000f2","quantity":1,"price":100,"consumed_meters":5}]'::jsonb);

RESET ROLE;

-- 7-11: what order A actually became.
SELECT is((SELECT status::text FROM public.orders WHERE id = '10000000-0000-4000-8000-00000000000a'),
  'measurements_taken', 'the stage in the payload is ignored: a new order starts at the first stage');
SELECT is((SELECT total_amount FROM public.orders WHERE id = '10000000-0000-4000-8000-00000000000a'),
  950.00::numeric, 'the total is computed on the server (3x200 + 200 + 150), not taken from the payload');
SELECT is((SELECT count(*)::int FROM public.orders WHERE id = '10000000-0000-4000-8000-00000000000a' AND kind = 'tailoring'),
  1, 'one order, of kind tailoring');
SELECT is((SELECT consumed_meters FROM public.order_items
            WHERE order_id = '10000000-0000-4000-8000-00000000000a' AND fabric_id IS NULL),
  0::numeric, 'the customer''s own cloth carries nothing to deduct');
SELECT is((SELECT (measurements->>'length')::numeric FROM public.order_items
            WHERE order_id = '10000000-0000-4000-8000-00000000000a' LIMIT 1),
  145::numeric, 'each line keeps the customer''s measurements as they were');

-- 12-13: the deposit went through the payment path, onto the cashier's shift.
SELECT is((SELECT paid_amount FROM public.orders WHERE id = '10000000-0000-4000-8000-00000000000a'),
  50.00::numeric, 'the deposit is recorded on the order');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d0000000-0000-4000-8000-0000000000d1"}';
SELECT is((SELECT total FROM public.get_shift_cash_balance('50000000-0000-4000-8000-000000000051'::uuid)),
  50.00::numeric, 'the till balance counts a tailoring deposit');

-- ====================================================================
-- fabric deduction
-- ====================================================================
SET LOCAL request.jwt.claims = '{"sub":"d0000000-0000-4000-8000-0000000000d2"}';

-- 14: a reviewed quantity far beyond the line's pieces is refused (3 pieces -> 45 m at most).
SELECT throws_matching(
  $$ SELECT public.update_order_status_with_fabric(
       '10000000-0000-4000-8000-00000000000a'::uuid, 'cutting', 'cutting',
       (SELECT jsonb_agg(jsonb_build_object('line_key', id, 'fabric_id', fabric_id, 'meters', 60))
          FROM public.order_items WHERE order_id = '10000000-0000-4000-8000-00000000000a' AND quantity = 3),
       NULL, '20000000-0000-4000-8000-000000000014'::uuid, 'cut') $$,
  'أكبر من الحد المسموح',
  'a reviewed quantity beyond the bound is refused'
);

-- 15: a line that belongs to another order is refused.
SELECT throws_matching(
  $$ SELECT public.update_order_status_with_fabric(
       '10000000-0000-4000-8000-00000000000a'::uuid, 'cutting', 'cutting',
       (SELECT jsonb_agg(jsonb_build_object('line_key', id, 'fabric_id', fabric_id, 'meters', 1))
          FROM public.order_items WHERE order_id = '10000000-0000-4000-8000-00000000000d'),
       NULL, '20000000-0000-4000-8000-000000000015'::uuid, 'cut') $$,
  -- seen-cutting-fabric-pos-orders-fix-task.md: a clear sentence (and 22023 with
  -- HINT fabric_line_mismatch, not 42501) since 20270115000000.
  'ليس من أصناف الطلب',
  'a line of another order is refused'
);

-- 16: order A skips cutting for sewing: both lines on the cloth are deducted (11.4 + 3.8).
SELECT lives_ok(
  $$ SELECT public.update_order_status('10000000-0000-4000-8000-00000000000a'::uuid, 'sewing', 'sewing',
       NULL, '20000000-0000-4000-8000-000000000016'::uuid, 'to sewing') $$,
  'an order can jump from measurements to sewing'
);

-- Moving it again must not deduct again.
SELECT public.update_order_status('10000000-0000-4000-8000-00000000000a'::uuid, 'cutting', 'cutting',
  NULL, '20000000-0000-4000-8000-000000000017'::uuid, 'back');
SELECT public.update_order_status('10000000-0000-4000-8000-00000000000a'::uuid, 'sewing', 'sewing',
  NULL, '20000000-0000-4000-8000-000000000018'::uuid, 'again');

-- Order B (no figure yet) goes to cutting: nothing to deduct.
SELECT public.update_order_status('10000000-0000-4000-8000-00000000000b'::uuid, 'cutting', 'cutting',
  NULL, '20000000-0000-4000-8000-000000000019'::uuid, 'cut');

-- 17: order C needs 5 m of a cloth with 2 m: the move is refused.
SELECT throws_matching(
  $$ SELECT public.update_order_status('10000000-0000-4000-8000-00000000000c'::uuid, 'cutting', 'cutting',
       NULL, '20000000-0000-4000-8000-00000000001a'::uuid, 'cut') $$,
  -- P4 (OPERATIONS-09, 20270105000007): the refusal names the cloth and the meters.
  'غير كافٍ: المطلوب 5',
  'short stock refuses the move to cutting'
);

-- Orders D and E are delivered straight from the payment dialog.
SET LOCAL request.jwt.claims = '{"sub":"d0000000-0000-4000-8000-0000000000d1"}';
SELECT public.record_order_payment('20000000-0000-4000-8000-00000000001b'::uuid,
  '10000000-0000-4000-8000-00000000000d'::uuid, 100, 'cash',
  '50000000-0000-4000-8000-000000000051'::uuid, 'settle', 'delivered', 'delivered');

-- 18: paying must not fail because the stock count is short.
SELECT lives_ok(
  $$ SELECT public.record_order_payment('20000000-0000-4000-8000-00000000001c'::uuid,
       '10000000-0000-4000-8000-00000000000e'::uuid, 100, 'cash',
       '50000000-0000-4000-8000-000000000051'::uuid, 'settle', 'delivered', 'delivered') $$,
  'a payment that delivers the order goes through even when its cloth is short'
);

RESET ROLE;

-- 19: 100 - 15.2 (order A) - 4 (order D) = 80.8, each deducted once.
SELECT is((SELECT quantity FROM public.branch_inventory
            WHERE item_id = 'f0000000-0000-4000-8000-0000000000f1' AND variant_id IS NULL),
  80.8::numeric, 'both lines on one cloth are deducted, once, and delivery by payment deducts too');
SELECT is((SELECT count(*)::int FROM public.stock_ledger WHERE reference_id = '10000000-0000-4000-8000-00000000000a'),
  2, 'order A has one stock movement per line, not per cloth');
SELECT ok((SELECT fabric_deducted_at IS NULL FROM public.orders WHERE id = '10000000-0000-4000-8000-00000000000b'),
  'an order with no fabric figure is not stamped as deducted');
SELECT is((SELECT status::text FROM public.orders WHERE id = '10000000-0000-4000-8000-00000000000c'),
  'measurements_taken', 'the refused move left the order where it was');
SELECT ok((SELECT fabric_deducted_at IS NOT NULL FROM public.orders WHERE id = '10000000-0000-4000-8000-00000000000d'),
  'delivery by payment stamps the deduction');
SELECT ok((SELECT status = 'delivered' AND paid_amount = total_amount AND fabric_deducted_at IS NULL
             FROM public.orders WHERE id = '10000000-0000-4000-8000-00000000000e')
          AND (SELECT quantity FROM public.branch_inventory WHERE item_id = 'f0000000-0000-4000-8000-0000000000f2') = 2,
  'the short-stock order is paid and delivered, its deduction left pending and the stock untouched');

SELECT * FROM finish();
ROLLBACK;
