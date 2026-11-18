-- docs/superpowers/plans/2026-11-18-permissions-server-enforcement.md Task 5.
--
-- Proves issue_supplier_payment's and increment_supplier_balance's role
-- checks now run on suppliers.manage (via app_has_permission() from Task 1)
-- instead of their old hard-coded role lists
-- (owner/admin/manager/accountant). This is a deliberate, founder-approved
-- behavior CHANGE, not a mechanical port: per Task 1's default-permission
-- matrix, branch_manager AND warehouse_manager both have
-- suppliers.manage = true, so BOTH roles must gain real server-side access
-- they did not have before (the old enum list rejected both). The UI
-- already showed supplier-payment controls to these roles; the server was
-- the one lagging -- this closes that gap.
--
-- Run with: npx supabase db query --linked --file <this file>
-- (supabase test db --linked needs Docker, which is down on this machine.)
BEGIN;
SELECT plan(4);

-- Fixtures: one tenant; a supplier with a starting balance; a cashier
-- (role_id IS NULL, so suppliers.manage comes from the default table,
-- where cashier = false -- confirms the gate still rejects someone); a
-- branch_manager and a warehouse_manager (role_id IS NULL, so
-- suppliers.manage = true from the default table for both -- neither name
-- is in the old enum list owner/admin/manager/accountant, so success here
-- already distinguishes OLD vs NEW behavior).
SET session_replication_role = replica;

INSERT INTO public.tenants (id, name, owner_email, phone)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Supplier RPCs Perm Test Tenant', 'owner@supplier-rpcs-perm.test.invalid', '0500000005');

INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status)
VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Test Cashier', 'cashier@supplier-rpcs-perm.test.invalid', 'cashier', NULL, 'active'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Test Branch Manager', 'branch-manager@supplier-rpcs-perm.test.invalid', 'branch_manager', NULL, 'active'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-2222-3333-4444-555555555555', 'Test Warehouse Manager', 'warehouse-manager@supplier-rpcs-perm.test.invalid', 'warehouse_manager', NULL, 'active');

INSERT INTO public.suppliers (id, tenant_id, name, balance)
VALUES ('99999999-9999-9999-9999-999999999999', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Test Supplier', 1000);

SET session_replication_role = DEFAULT;

-- Scenario 1: cashier (suppliers.manage=false) calls issue_supplier_payment
-- -- must throw the existing "no supplier payment permission" message
-- (unchanged rejection).
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc"}';
SELECT throws_matching(
  $$ SELECT public.issue_supplier_payment(
       'a5000000-0000-0000-0000-000000000001'::uuid,
       '99999999-9999-9999-9999-999999999999'::uuid,
       100,
       'cash',
       NULL,
       NULL,
       NULL
     ) $$,
  'لا تملك صلاحية إصدار سند صرف للمورد',
  'cashier (suppliers.manage=false) calling issue_supplier_payment -- throws the permission message'
);

-- Scenario 2: branch_manager (suppliers.manage=true from the default table,
-- a role name not in the old enum list owner/admin/manager/accountant)
-- calls issue_supplier_payment -- lives_ok. This is the documented,
-- approved behavior change.
SET LOCAL request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"}';
SELECT lives_ok(
  $$ SELECT public.issue_supplier_payment(
       'a5000000-0000-0000-0000-000000000002'::uuid,
       '99999999-9999-9999-9999-999999999999'::uuid,
       100,
       'cash',
       NULL,
       NULL,
       NULL
     ) $$,
  'branch_manager (suppliers.manage=true) calling issue_supplier_payment -- lives_ok, not rejected by the old role-name check'
);

-- Scenario 3: warehouse_manager (suppliers.manage=true from the default
-- table, also not in the old enum list) calls increment_supplier_balance --
-- lives_ok. Same behavior change, the other RPC.
SET LOCAL request.jwt.claims = '{"sub":"11111111-2222-3333-4444-555555555555"}';
SELECT lives_ok(
  $$ SELECT public.increment_supplier_balance(
       '99999999-9999-9999-9999-999999999999'::uuid,
       50,
       NULL
     ) $$,
  'warehouse_manager (suppliers.manage=true) calling increment_supplier_balance -- lives_ok, not rejected by the old role-name check'
);

-- Scenario 4: cashier (suppliers.manage=false) calls
-- increment_supplier_balance -- must throw (unchanged rejection, confirms
-- the swap didn't accidentally open this one to everyone).
SET LOCAL request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc"}';
SELECT throws_matching(
  $$ SELECT public.increment_supplier_balance(
       '99999999-9999-9999-9999-999999999999'::uuid,
       50,
       NULL
     ) $$,
  'لا تملك صلاحية تعديل رصيد المورد',
  'cashier (suppliers.manage=false) calling increment_supplier_balance -- throws the permission message'
);

SELECT * FROM finish();
ROLLBACK;
