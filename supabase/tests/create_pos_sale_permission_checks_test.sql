-- docs/superpowers/plans/2026-11-18-permissions-server-enforcement.md Task 2.
-- Proves create_pos_sale gates the whole sale on payments.collect and gates
-- any requested discount (but never a zero discount) on action.discount,
-- using app_has_permission() from Task 1.
--
-- Run with: supabase test db --linked (pushes nothing; runs against the
-- already-migrated staging schema). Docker is down on this machine, so in
-- practice this was run via:
--   npx supabase db query --linked --file supabase/tests/create_pos_sale_permission_checks_test.sql
BEGIN;
SELECT plan(4);

-- Fixtures: one tenant, one open shift, a baseline cashier with role_id
-- IS NULL (so payments.collect=true, action.discount=true come straight
-- from the app_default_permission fallback table -- the common case must
-- keep working), and a second cashier ("cashier-no-discount") whose custom
-- role explicitly sets action.discount:false and nothing else (so
-- payments.collect still falls through to the default table's true).
-- A third staff member, a warehouse_manager with role_id IS NULL, is added
-- to cover the payments.collect=false default -- confirmed in Task 1's
-- matrix (20261205000000_app_has_permission.sql) that accountant,
-- warehouse_manager, and tailor all default payments.collect to false;
-- warehouse_manager is picked here.
SET session_replication_role = replica;

INSERT INTO public.tenants (id, name, owner_email, phone)
VALUES ('11111111-1111-1111-1111-111111111111', 'POS Sale Perm Test Tenant', 'owner@pos-sale-perm.test.invalid', '0500000002');

INSERT INTO public.roles (id, tenant_id, role_key, name, permissions)
VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
        'cashier_no_discount', 'Cashier No Discount', '{"action.discount": false}'::jsonb);

INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status)
VALUES
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   '44444444-4444-4444-4444-444444444444', 'Baseline Cashier', 'baseline@pos-sale-perm.test.invalid', 'cashier', NULL, 'active'),
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111',
   '66666666-6666-6666-6666-666666666666', 'No Discount Cashier', 'no-discount@pos-sale-perm.test.invalid', 'cashier',
   '22222222-2222-2222-2222-222222222222', 'active'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111',
   'dddddddd-dddd-dddd-dddd-dddddddddddd', 'Warehouse Manager', 'warehouse-manager@pos-sale-perm.test.invalid', 'warehouse_manager', NULL, 'active');

INSERT INTO public.shifts (id, tenant_id, branch_id, staff_id, staff_name, opening_balance, status)
VALUES
  ('77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111', NULL,
   '33333333-3333-3333-3333-333333333333', 'Baseline Cashier', 0, 'open'),
  ('88888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111', NULL,
   '55555555-5555-5555-5555-555555555555', 'No Discount Cashier', 0, 'open'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', NULL,
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Warehouse Manager', 0, 'open');

SET session_replication_role = DEFAULT;

-- Scenario 1: baseline cashier (payments.collect=true, action.discount=true
-- via the default table), paid_amount > 0, no discount requested. Nothing
-- regresses for the common case.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444"}';
SELECT lives_ok(
  $$ SELECT public.create_pos_sale(
       'a1000000-0000-0000-0000-000000000001'::uuid,
       jsonb_build_object(
         'shift_id', '77777777-7777-7777-7777-777777777777',
         'customer_name', 'Walk-in',
         'status', 'ready',
         'payment_method', 'cash',
         'paid_amount', 50,
         'delivery_date', now()::text
       ),
       jsonb_build_array(
         jsonb_build_object('type', 'custom', 'price', 100, 'quantity', 1)
       ),
       '{}'::jsonb
     ) $$,
  'baseline cashier: paid_amount > 0, no discount -- lives_ok, common case unaffected'
);

-- Scenario 2: cashier-no-discount, discount_value: 0 -- zero discount must
-- never be blocked by the action.discount gate (Review Focus item 3).
SET LOCAL request.jwt.claims = '{"sub":"66666666-6666-6666-6666-666666666666"}';
SELECT lives_ok(
  $$ SELECT public.create_pos_sale(
       'a1000000-0000-0000-0000-000000000002'::uuid,
       jsonb_build_object(
         'shift_id', '88888888-8888-8888-8888-888888888888',
         'customer_name', 'Walk-in',
         'status', 'ready',
         'payment_method', 'cash',
         'paid_amount', 50,
         'delivery_date', now()::text
       ),
       jsonb_build_array(
         jsonb_build_object('type', 'custom', 'price', 100, 'quantity', 1)
       ),
       jsonb_build_object('discount_type', 'percent', 'discount_value', 0)
     ) $$,
  'cashier-no-discount: discount_value 0 -- lives_ok, zero discount is never blocked'
);

-- Scenario 3: cashier-no-discount, discount_value: 10 (any positive value)
-- -- must throw the action.discount gate's specific Arabic message.
SET LOCAL request.jwt.claims = '{"sub":"66666666-6666-6666-6666-666666666666"}';
SELECT throws_matching(
  $$ SELECT public.create_pos_sale(
       'a1000000-0000-0000-0000-000000000003'::uuid,
       jsonb_build_object(
         'shift_id', '88888888-8888-8888-8888-888888888888',
         'customer_name', 'Walk-in',
         'status', 'ready',
         'payment_method', 'cash',
         'paid_amount', 50,
         'delivery_date', now()::text
       ),
       jsonb_build_array(
         jsonb_build_object('type', 'custom', 'price', 100, 'quantity', 1)
       ),
       jsonb_build_object('discount_type', 'percent', 'discount_value', 10)
     ) $$,
  'لا تملك صلاحية منح خصم',
  'cashier-no-discount: discount_value 10 -- throws the action.discount gate message'
);

-- Scenario 4: warehouse_manager (role_id IS NULL, so payments.collect=false
-- via the default table) attempts create_pos_sale -- must throw the
-- payments.collect gate's specific Arabic message (I3 gap: this denial path
-- was never exercised anywhere in the suite before now).
SET LOCAL request.jwt.claims = '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd"}';
SELECT throws_matching(
  $$ SELECT public.create_pos_sale(
       'a1000000-0000-0000-0000-000000000004'::uuid,
       jsonb_build_object(
         'shift_id', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
         'customer_name', 'Walk-in',
         'status', 'ready',
         'payment_method', 'cash',
         'paid_amount', 50,
         'delivery_date', now()::text
       ),
       jsonb_build_array(
         jsonb_build_object('type', 'custom', 'price', 100, 'quantity', 1)
       ),
       '{}'::jsonb
     ) $$,
  'لا تملك صلاحية استلام الدفعات',
  'warehouse_manager: payments.collect=false by default -- throws the payments.collect gate message'
);

SELECT * FROM finish();
ROLLBACK;
