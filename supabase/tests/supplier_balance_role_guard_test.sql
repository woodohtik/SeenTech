-- seen-cto-sprint4-design-quality-task.md item 4 (CTO review section
-- 6/9): codifies the manual rolled-back-transaction verification done by
-- hand for 20261121000000_supplier_balance_role_guard.sql, so a future
-- migration that touches these policies can't silently regress them.
--
-- Run with: supabase test db (spins up a fresh local Postgres from every
-- migration in supabase/migrations/, then runs every *.sql file here).
BEGIN;
SELECT plan(6);

-- Fixtures: one tenant, an owner and a cashier on it, one supplier.
-- staff_role_grant_guard (a trigger, not RLS) requires the caller to
-- already be owner/admin before INSERTing a staff row with an
-- elevated role -- correct for a real grant action, but fixture
-- seeding has no caller identity yet. session_replication_role
-- disables triggers for this session only (never RLS, which the
-- scenarios below still fully exercise), the standard Postgres
-- pattern for seeding fixtures.
SET session_replication_role = replica;

INSERT INTO public.tenants (id, name, owner_email, phone)
VALUES ('11111111-1111-1111-1111-111111111111', 'Test Tenant', 'owner@test.invalid', '0500000000');

INSERT INTO public.staff (id, tenant_id, uid, name, email, role, status)
VALUES
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   '33333333-3333-3333-3333-333333333333', 'Test Owner', 'owner-staff@test.invalid', 'owner', 'active'),
  ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
   '55555555-5555-5555-5555-555555555555', 'Test Cashier', 'cashier@test.invalid', 'cashier', 'active');

INSERT INTO public.suppliers (id, tenant_id, name, balance)
VALUES ('66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111', 'Test Supplier', 0);

SET session_replication_role = DEFAULT;

-- Scenario 1: cashier calls increment_supplier_balance directly -- must be rejected.
-- SET LOCAL ROLE authenticated: the pgTAP test connection runs as a
-- superuser/table owner, which bypasses RLS entirely regardless of JWT
-- claims -- without this, scenario 2 below would "pass" for the wrong
-- reason (RLS never evaluated at all). increment_supplier_balance's own
-- role check isn't RLS-based, so this role switch doesn't change
-- scenario 1's outcome, but it's required for every RLS-dependent
-- scenario from here on.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555"}';
SELECT throws_matching(
  $$SELECT increment_supplier_balance('66666666-6666-6666-6666-666666666666'::uuid, 100, NULL)$$,
  'لا تملك صلاحية تعديل رصيد المورد',
  'cashier calling increment_supplier_balance is rejected with the role-specific error'
);

-- Scenario 2: cashier tries a direct INSERT on supplier_transactions -- must be rejected by RLS.
SELECT throws_like(
  $$INSERT INTO public.supplier_transactions
      (id, supplier_id, tenant_id, type, credit, debit, running_balance, reference_number, date)
    VALUES (gen_random_uuid(), '66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111',
            'adjustment', 100, 0, 999, 'TEST', now())$$,
  '%row-level security%',
  'cashier direct INSERT on supplier_transactions is rejected by RLS'
);

-- Scenario 3: cashier can still SELECT the ledger (read access preserved).
SELECT lives_ok(
  $$SELECT * FROM public.supplier_transactions WHERE tenant_id = '11111111-1111-1111-1111-111111111111'$$,
  'cashier SELECT on supplier_transactions still works'
);

-- Scenario 4: owner calls increment_supplier_balance -- must succeed and return the new balance.
SET LOCAL request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
SELECT is(
  increment_supplier_balance('66666666-6666-6666-6666-666666666666'::uuid, 150, NULL),
  150::numeric,
  'owner calling increment_supplier_balance succeeds and returns the new balance'
);

-- Scenario 5: owner can INSERT a supplier_transactions row directly.
SELECT lives_ok(
  $$INSERT INTO public.supplier_transactions
      (id, supplier_id, tenant_id, type, credit, debit, running_balance, reference_number, date)
    VALUES (gen_random_uuid(), '66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111',
            'adjustment', 150, 0, 150, 'TEST-OWNER', now())$$,
  'owner direct INSERT on supplier_transactions succeeds'
);

-- Scenario 6: owner can still UPDATE/DELETE their own ledger row -- same role gate as INSERT.
SELECT lives_ok(
  $$DELETE FROM public.supplier_transactions WHERE reference_number = 'TEST-OWNER'$$,
  'owner direct DELETE on supplier_transactions succeeds'
);

SELECT * FROM finish();
ROLLBACK;
