-- docs/superpowers/plans/2026-11-18-permissions-server-enforcement.md Fix-F
-- (follow-up finding surfaced during Fix-B's review).
--
-- Fix-B (20261214000000_supplier_transactions_write_permission_check.sql)
-- gated supplier_transactions' write policies on suppliers.manage. Its
-- reviewer separately flagged that the suppliers TABLE ITSELF has no role
-- or permission check at all on its own INSERT/UPDATE/DELETE policies --
-- confirmed via grep, no migration has ever named suppliers_tenant_insert/
-- _update/_delete explicitly, so they come purely from the generic loop in
-- 20240601000000_track_base_schema.sql (tenant_tables array includes
-- 'suppliers'), which only checks tenant_id = app_current_tenant_id().
--
-- That means any authenticated tenant staff member -- including a cashier
-- -- could write DIRECTLY to suppliers (including its balance column) via
-- a plain UPDATE suppliers SET balance = ..., completely bypassing both the
-- RPCs (issue_supplier_payment/increment_supplier_balance, gated in Task 5)
-- and the suppliers.manage permission entirely. This migration
-- (20261217000000_suppliers_write_permission_check.sql) closes that gap by
-- applying the same suppliers.manage gate used throughout this plan,
-- following the exact same pattern as Fix-B.
--
-- NOTE on assertion style (same as Fix-B's test): an INSERT blocked by its
-- WITH CHECK clause raises a real "new row violates row-level security
-- policy" exception, so INSERT denial is asserted with throws_like().
-- UPDATE/DELETE blocked by their USING clause instead just silently match 0
-- rows -- no exception -- so success and failure are asserted with
-- isnt_empty()/is_empty() on the same statement with a RETURNING clause.
--
-- Run with: npx supabase db query --linked --file <this file>
-- (supabase test db --linked needs Docker, which is down on this machine.)
BEGIN;
SELECT plan(6);

-- db query --linked only surfaces the LAST statement's result set, so
-- collect each assertion's TAP line here and print them all together with
-- finish() at the end instead of relying on each SELECT's own output.
CREATE TEMP TABLE test_output (seq INT GENERATED ALWAYS AS IDENTITY, line TEXT);
GRANT INSERT, SELECT ON test_output TO authenticated;

-- Fixtures: one tenant; an accountant (role_id IS NULL, suppliers.manage=true
-- from the default table per Task 1's matrix); a cashier (role_id IS NULL,
-- suppliers.manage=false); two pre-existing suppliers rows, one each for the
-- UPDATE/DELETE scenarios below (kept separate so the DELETE doesn't starve
-- the later UPDATE-denied scenario of a row to target).
SET session_replication_role = replica;

INSERT INTO public.tenants (id, name, owner_email, phone)
VALUES ('c8000000-0000-0000-0000-000000000001', 'Suppliers Write Perm Test Tenant', 'owner@suppliers-write-perm.test.invalid', '0500000012');

INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status)
VALUES
  ('c8000000-0000-0000-0000-000000000002', 'c8000000-0000-0000-0000-000000000001',
   'c8000000-0000-0000-0000-000000000003', 'Test Accountant', 'accountant@suppliers-write-perm.test.invalid', 'accountant', NULL, 'active'),
  ('c8000000-0000-0000-0000-000000000004', 'c8000000-0000-0000-0000-000000000001',
   'c8000000-0000-0000-0000-000000000005', 'Test Cashier', 'cashier@suppliers-write-perm.test.invalid', 'cashier', NULL, 'active');

INSERT INTO public.suppliers (id, tenant_id, name, balance)
VALUES
  ('c8000000-0000-0000-0000-000000000006', 'c8000000-0000-0000-0000-000000000001', 'Test Supplier UPDATE Target', 500),
  ('c8000000-0000-0000-0000-000000000007', 'c8000000-0000-0000-0000-000000000001', 'Test Supplier DELETE Target', 500);

SET session_replication_role = DEFAULT;

SET LOCAL ROLE authenticated;

-- Scenario 1: accountant (suppliers.manage=true) INSERTs a new supplier --
-- must succeed. This is the behavior this migration must NOT break: a role
-- with the permission keeps direct write access.
SET LOCAL request.jwt.claims = '{"sub":"c8000000-0000-0000-0000-000000000003"}';
INSERT INTO test_output (line) SELECT lives_ok(
  $$ INSERT INTO public.suppliers (id, tenant_id, name, balance)
     VALUES (gen_random_uuid(), 'c8000000-0000-0000-0000-000000000001', 'Accountant Created Supplier', 0) $$,
  'accountant (suppliers.manage=true) INSERT on suppliers -- lives_ok'
);

-- Scenario 2: cashier (suppliers.manage=false) attempts to INSERT a new
-- supplier -- rejected by RLS WITH CHECK, throws. This is the gap this
-- migration closes: before the fix, the generic tenant-only policy let any
-- authenticated tenant staff member (including a cashier) write directly
-- to suppliers with no permission check at all.
SET LOCAL request.jwt.claims = '{"sub":"c8000000-0000-0000-0000-000000000005"}';
INSERT INTO test_output (line) SELECT throws_like(
  $$ INSERT INTO public.suppliers (id, tenant_id, name, balance)
     VALUES (gen_random_uuid(), 'c8000000-0000-0000-0000-000000000001', 'Cashier Created Supplier', 0) $$,
  '%row-level security%',
  'cashier (suppliers.manage=false) INSERT on suppliers -- rejected by RLS'
);

-- Scenario 3: accountant UPDATEs an existing supplier -- must actually
-- touch the row. Asserted with isnt_empty() on a RETURNING clause rather
-- than lives_ok(), since an UPDATE blocked by USING just silently matches 0
-- rows (no exception) -- lives_ok() alone would pass even before this fix.
SET LOCAL request.jwt.claims = '{"sub":"c8000000-0000-0000-0000-000000000003"}';
INSERT INTO test_output (line) SELECT isnt_empty(
  $$ UPDATE public.suppliers
        SET balance = 999
      WHERE id = 'c8000000-0000-0000-0000-000000000006'
      RETURNING id $$,
  'accountant (suppliers.manage=true) UPDATE on suppliers -- row actually updated'
);

-- Scenario 4: cashier attempts to UPDATE the same supplier -- must match 0
-- rows (silently blocked by USING, no exception). Before this fix, this
-- would have succeeded -- a cashier could directly set a supplier's
-- balance, bypassing both the RPCs' business logic (idempotency,
-- ledger-row creation) and the suppliers.manage permission entirely.
SET LOCAL request.jwt.claims = '{"sub":"c8000000-0000-0000-0000-000000000005"}';
INSERT INTO test_output (line) SELECT is_empty(
  $$ UPDATE public.suppliers
        SET balance = 123456
      WHERE id = 'c8000000-0000-0000-0000-000000000006'
      RETURNING id $$,
  'cashier (suppliers.manage=false) UPDATE on suppliers -- still blocked, 0 rows'
);

-- Scenario 5: accountant DELETEs an existing supplier -- must actually
-- remove it.
SET LOCAL request.jwt.claims = '{"sub":"c8000000-0000-0000-0000-000000000003"}';
INSERT INTO test_output (line) SELECT isnt_empty(
  $$ DELETE FROM public.suppliers
      WHERE id = 'c8000000-0000-0000-0000-000000000007'
      RETURNING id $$,
  'accountant (suppliers.manage=true) DELETE on suppliers -- row actually removed'
);

-- Scenario 6: cashier attempts to DELETE a supplier -- must match 0 rows
-- (silently blocked by USING, no exception). Uses the UPDATE-target row
-- from scenario 3/4 (still present) rather than the already-deleted
-- scenario-5 row, so a false pass from "there was nothing to delete
-- anyway" is impossible.
SET LOCAL request.jwt.claims = '{"sub":"c8000000-0000-0000-0000-000000000005"}';
INSERT INTO test_output (line) SELECT is_empty(
  $$ DELETE FROM public.suppliers
      WHERE id = 'c8000000-0000-0000-0000-000000000006'
      RETURNING id $$,
  'cashier (suppliers.manage=false) DELETE on suppliers -- still blocked, 0 rows'
);

INSERT INTO test_output (line) SELECT * FROM finish();
SELECT line FROM test_output ORDER BY seq;
ROLLBACK;
