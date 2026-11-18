-- docs/superpowers/plans/2026-11-18-permissions-server-enforcement.md Fix-B
-- (whole-branch review finding C2).
--
-- Task 7 (20261211000000_select_policies_permission_based.sql) rewrote
-- supplier_transactions_tenant_select to gate on suppliers.manage, but left
-- supplier_transactions_tenant_write/_update/_delete on the old hard-coded
-- role list (owner/admin/manager/accountant) from
-- 20261121000000_supplier_balance_role_guard.sql. Result: branch_manager and
-- warehouse_manager (suppliers.manage=true per Task 1's default matrix,
-- neither in the old enum) can successfully call
-- issue_supplier_payment/increment_supplier_balance (Task 5), but the
-- application's own follow-up ledger write in addSupplierTransaction()
-- (src/services/supplierAccountsService.ts) -- a direct upsert into
-- supplier_transactions -- then fails RLS for those two roles. The supplier
-- balance moves; the ledger entry recording it does not. This migration
-- (20261214000000_supplier_transactions_write_permission_check.sql) closes
-- that gap by swapping the same three policies' role-enum check for
-- app_has_permission('suppliers.manage'), symmetric with Task 7's SELECT
-- gate.
--
-- Also closes test gap I3: Task 5's own test file
-- (supplier_rpcs_permission_check_test.sql) only proved branch_manager
-- against issue_supplier_payment and warehouse_manager against
-- increment_supplier_balance -- each role against only ONE of the two RPCs.
-- Scenarios 7-8 below add the missing cross combinations (branch_manager x
-- increment_supplier_balance, warehouse_manager x issue_supplier_payment).
-- Both RPCs already gate on the same suppliers.manage check (Task 5), so
-- these two assertions are expected to pass independently of this
-- migration's policy change -- they close a test-coverage gap, not a code
-- gap.
--
-- NOTE on assertion style: an INSERT that fails its WITH CHECK clause
-- raises a real "new row violates row-level security policy" exception
-- (confirmed in supplier_balance_role_guard_test.sql scenario 2), so INSERT
-- denial is asserted with throws_like. An UPDATE/DELETE blocked by its
-- USING clause instead just silently matches 0 rows -- no exception (same
-- failure mode documented in select_policies_permission_based_test.sql) --
-- so a lives_ok() alone on the statement text would false-pass even before
-- this fix (the statement never throws either way). UPDATE/DELETE success
-- and failure are therefore asserted with isnt_empty()/is_empty() on the
-- same statement with a RETURNING clause, which only yields a row when the
-- USING clause actually let the operation touch it.
--
-- Run with: npx supabase db query --linked --file <this file>
-- (supabase test db --linked needs Docker, which is down on this machine.)
BEGIN;
SELECT plan(8);

-- db query --linked only surfaces the LAST statement's result set, so
-- collect each assertion's TAP line here and print them all together with
-- finish() at the end instead of relying on each SELECT's own output.
CREATE TEMP TABLE test_output (seq INT GENERATED ALWAYS AS IDENTITY, line TEXT);
GRANT INSERT, SELECT ON test_output TO authenticated;

-- Fixtures: one tenant; a cashier (role_id IS NULL, suppliers.manage=false
-- from the default table -- never had write access, old or new); a
-- branch_manager and a warehouse_manager (role_id IS NULL,
-- suppliers.manage=true from the default table for both -- neither name is
-- in the old enum list owner/admin/manager/accountant, so success on any of
-- these scenarios already distinguishes OLD vs NEW behavior); one supplier;
-- four pre-existing supplier_transactions rows, one each for the
-- UPDATE-success/UPDATE-fail/DELETE-success/DELETE-fail scenarios below.
SET session_replication_role = replica;

INSERT INTO public.tenants (id, name, owner_email, phone)
VALUES ('b7000000-0000-0000-0000-000000000001', 'Supplier Txn Write Perm Test Tenant', 'owner@supplier-txn-write-perm.test.invalid', '0500000011');

INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status)
VALUES
  ('b7000000-0000-0000-0000-000000000002', 'b7000000-0000-0000-0000-000000000001',
   'b7000000-0000-0000-0000-000000000003', 'Test Cashier', 'cashier@supplier-txn-write-perm.test.invalid', 'cashier', NULL, 'active'),
  ('b7000000-0000-0000-0000-000000000004', 'b7000000-0000-0000-0000-000000000001',
   'b7000000-0000-0000-0000-000000000005', 'Test Branch Manager', 'branch-manager@supplier-txn-write-perm.test.invalid', 'branch_manager', NULL, 'active'),
  ('b7000000-0000-0000-0000-000000000006', 'b7000000-0000-0000-0000-000000000001',
   'b7000000-0000-0000-0000-000000000007', 'Test Warehouse Manager', 'warehouse-manager@supplier-txn-write-perm.test.invalid', 'warehouse_manager', NULL, 'active');

INSERT INTO public.suppliers (id, tenant_id, name, balance)
VALUES ('b7000000-0000-0000-0000-000000000008', 'b7000000-0000-0000-0000-000000000001', 'Test Supplier', 1000);

INSERT INTO public.supplier_transactions (id, tenant_id, supplier_id, type, credit, debit, running_balance, reference_number, date)
VALUES
  ('b7000000-0000-0000-0000-000000000009', 'b7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000008',
   'adjustment', 0, 0, 1000, 'B7-UPD', now()),
  ('b7000000-0000-0000-0000-00000000000a', 'b7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000008',
   'adjustment', 0, 0, 1000, 'B7-DELFAIL', now()),
  ('b7000000-0000-0000-0000-00000000000b', 'b7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000008',
   'adjustment', 0, 0, 1000, 'B7-DELOK', now()),
  ('b7000000-0000-0000-0000-00000000000c', 'b7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000008',
   'adjustment', 0, 0, 1000, 'B7-UPDFAIL', now());

SET session_replication_role = DEFAULT;

SET LOCAL ROLE authenticated;

-- Scenario 1: cashier (suppliers.manage=false) INSERTs into
-- supplier_transactions -- rejected by RLS WITH CHECK, throws. Unchanged
-- by this fix, included to confirm the swap didn't accidentally open
-- writes to everyone.
SET LOCAL request.jwt.claims = '{"sub":"b7000000-0000-0000-0000-000000000003"}';
INSERT INTO test_output (line) SELECT throws_like(
  $$ INSERT INTO public.supplier_transactions
       (id, tenant_id, supplier_id, type, credit, debit, running_balance, reference_number, date)
     VALUES (gen_random_uuid(), 'b7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000008',
             'adjustment', 10, 0, 1010, 'B7-CASHIER-INSERT', now()) $$,
  '%row-level security%',
  'cashier (suppliers.manage=false) INSERT on supplier_transactions -- rejected by RLS'
);

-- Scenario 2: branch_manager (suppliers.manage=true from the default
-- table, a role name not in the old enum list) INSERTs into
-- supplier_transactions -- must now succeed. This is the behavior change
-- this migration makes.
SET LOCAL request.jwt.claims = '{"sub":"b7000000-0000-0000-0000-000000000005"}';
INSERT INTO test_output (line) SELECT lives_ok(
  $$ INSERT INTO public.supplier_transactions
       (id, tenant_id, supplier_id, type, credit, debit, running_balance, reference_number, date)
     VALUES (gen_random_uuid(), 'b7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000008',
             'adjustment', 20, 0, 1020, 'B7-BRANCHMGR-INSERT', now()) $$,
  'branch_manager (suppliers.manage=true) INSERT on supplier_transactions -- lives_ok, not rejected by the old role-name check'
);

-- Scenario 3: warehouse_manager (suppliers.manage=true, also not in the
-- old enum) UPDATEs an existing supplier_transactions row -- must now
-- actually touch the row. Asserted with isnt_empty() on a RETURNING
-- clause rather than lives_ok(), since an UPDATE blocked by USING just
-- silently matches 0 rows (no exception) -- lives_ok() alone would pass
-- even before this fix.
SET LOCAL request.jwt.claims = '{"sub":"b7000000-0000-0000-0000-000000000007"}';
INSERT INTO test_output (line) SELECT isnt_empty(
  $$ UPDATE public.supplier_transactions
        SET notes = 'updated by warehouse_manager'
      WHERE id = 'b7000000-0000-0000-0000-000000000009'
      RETURNING id $$,
  'warehouse_manager (suppliers.manage=true) UPDATE on supplier_transactions -- row actually updated, not silently filtered by the old role-name check'
);

-- Scenario 4: cashier (suppliers.manage=false) attempts to UPDATE a
-- supplier_transactions row -- must still match 0 rows (silently blocked
-- by USING, no exception). This is the scenario the review flagged as
-- missing: without it, a half-applied fix (e.g. only the UPDATE policy's
-- USING clause swapped, leaving its WITH CHECK clause on the old role
-- enum, or vice versa) would not be caught -- scenario 3 alone only proves
-- a permitted role is let through, not that a non-permitted role is still
-- blocked on this same policy.
SET LOCAL request.jwt.claims = '{"sub":"b7000000-0000-0000-0000-000000000003"}';
INSERT INTO test_output (line) SELECT is_empty(
  $$ UPDATE public.supplier_transactions
        SET notes = 'updated by cashier'
      WHERE id = 'b7000000-0000-0000-0000-00000000000c'
      RETURNING id $$,
  'cashier (suppliers.manage=false) UPDATE on supplier_transactions -- still blocked, 0 rows'
);

-- Scenario 5: cashier (suppliers.manage=false) attempts to DELETE a
-- supplier_transactions row -- must still match 0 rows (silently blocked
-- by USING, no exception), asserted with is_empty() on the same
-- RETURNING-based statement.
SET LOCAL request.jwt.claims = '{"sub":"b7000000-0000-0000-0000-000000000003"}';
INSERT INTO test_output (line) SELECT is_empty(
  $$ DELETE FROM public.supplier_transactions
      WHERE id = 'b7000000-0000-0000-0000-00000000000a'
      RETURNING id $$,
  'cashier (suppliers.manage=false) DELETE on supplier_transactions -- still blocked, 0 rows'
);

-- Scenario 6: branch_manager (suppliers.manage=true) DELETEs a
-- supplier_transactions row -- must now actually remove it.
SET LOCAL request.jwt.claims = '{"sub":"b7000000-0000-0000-0000-000000000005"}';
INSERT INTO test_output (line) SELECT isnt_empty(
  $$ DELETE FROM public.supplier_transactions
      WHERE id = 'b7000000-0000-0000-0000-00000000000b'
      RETURNING id $$,
  'branch_manager (suppliers.manage=true) DELETE on supplier_transactions -- row actually removed, not silently filtered by the old role-name check'
);

-- Scenario 7: branch_manager calls increment_supplier_balance (Task 5
-- already gates this on suppliers.manage) -- the missing cross
-- combination from Task 5's own test file, which only exercised
-- branch_manager against issue_supplier_payment. Expected to pass
-- regardless of this migration -- it proves Task 5's RPC gate, not this
-- migration's RLS policies.
INSERT INTO test_output (line) SELECT lives_ok(
  $$ SELECT public.increment_supplier_balance(
       'b7000000-0000-0000-0000-000000000008'::uuid,
       25,
       NULL
     ) $$,
  'branch_manager (suppliers.manage=true) calling increment_supplier_balance -- lives_ok (closes Task 5 test gap I3)'
);

-- Scenario 8: warehouse_manager calls issue_supplier_payment (Task 5
-- already gates this on suppliers.manage) -- the other missing cross
-- combination, the mirror of scenario 7.
SET LOCAL request.jwt.claims = '{"sub":"b7000000-0000-0000-0000-000000000007"}';
INSERT INTO test_output (line) SELECT lives_ok(
  $$ SELECT public.issue_supplier_payment(
       'b7000000-0000-0000-0000-0000000000c1'::uuid,
       'b7000000-0000-0000-0000-000000000008'::uuid,
       30,
       'cash',
       NULL,
       NULL,
       NULL
     ) $$,
  'warehouse_manager (suppliers.manage=true) calling issue_supplier_payment -- lives_ok (closes Task 5 test gap I3)'
);

INSERT INTO test_output (line) SELECT * FROM finish();
SELECT line FROM test_output ORDER BY seq;
ROLLBACK;
