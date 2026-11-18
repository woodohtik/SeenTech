-- docs/superpowers/plans/2026-11-18-permissions-server-enforcement.md Task 4.
-- Proves approve_stock_take's p_status = 'Approved' gate now runs on
-- inventory.reconcile (via app_has_permission() from Task 1) instead of the
-- hard-coded role list (owner,admin,manager).
--
-- Run with: npx supabase db query --linked --file <this file>
-- (supabase test db --linked needs Docker, which is down on this machine.)
BEGIN;
SELECT plan(3);

-- Fixtures: one tenant; a cashier (role_id IS NULL, so inventory.reconcile
-- comes from the default table, where cashier = false); a warehouse_manager
-- (role_id IS NULL, so inventory.reconcile = true from the default table --
-- a role name NOT in the old enum list owner/admin/manager, so this alone
-- already distinguishes OLD vs NEW); and a cashier-by-base-role whose custom
-- role grants inventory.reconcile:true, proving the JSONB override path is
-- actually what's being exercised (the old enum check on staff.role =
-- 'cashier' would deny this one outright).
SET session_replication_role = replica;

INSERT INTO public.tenants (id, name, owner_email, phone)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Approve Stock Take Perm Test Tenant', 'owner@approve-stock-take-perm.test.invalid', '0500000004');

INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status)
VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Test Cashier', 'cashier@approve-stock-take-perm.test.invalid', 'cashier', NULL, 'active'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Test Warehouse Manager', 'warehouse_manager@approve-stock-take-perm.test.invalid', 'warehouse_manager', NULL, 'active');

-- Custom role (base staff.role = 'cashier', which the OLD enum check would
-- deny) that grants inventory.reconcile via its own roles.permissions JSONB.
INSERT INTO public.roles (id, tenant_id, role_key, name, permissions)
VALUES ('12121212-1212-1212-1212-121212121212', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'stock_approver', 'Stock Approver', '{"inventory.reconcile": true}'::jsonb);

INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status)
VALUES ('12345678-1234-1234-1234-123456789012', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '13579135-1357-1357-1357-135791357913', 'Test Stock Approver', 'stock-approver@approve-stock-take-perm.test.invalid', 'cashier',
        '12121212-1212-1212-1212-121212121212', 'active');

SET session_replication_role = DEFAULT;

-- Scenario 1: cashier (inventory.reconcile=false) attempts to approve --
-- must throw the existing "no approval permission" message.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc"}';
SELECT throws_matching(
  $$ SELECT public.approve_stock_take(
       'a2000000-0000-0000-0000-000000000001'::uuid,
       'f0000000-0000-0000-0000-000000000001'::uuid,
       'Physical Count',
       NULL,
       '[{"item_id":"c0000000-0000-0000-0000-000000000001","physical_qty":0}]'::jsonb,
       'Approved'
     ) $$,
  'لا تملك صلاحية اعتماد الجرد',
  'cashier (inventory.reconcile=false) approving stock take -- throws the permission message'
);

-- Scenario 2: warehouse_manager (inventory.reconcile=true from the default
-- table, a role name not in the old owner/admin/manager list) approves --
-- lives_ok.
SET LOCAL request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"}';
SELECT lives_ok(
  $$ SELECT public.approve_stock_take(
       'a2000000-0000-0000-0000-000000000002'::uuid,
       'f0000000-0000-0000-0000-000000000002'::uuid,
       'Physical Count',
       NULL,
       '[{"item_id":"c0000000-0000-0000-0000-000000000002","physical_qty":0}]'::jsonb,
       'Approved'
     ) $$,
  'warehouse_manager (inventory.reconcile=true) approving stock take -- lives_ok, not rejected by the old role-name check'
);

-- Scenario 3: a cashier (base staff.role = 'cashier', which the old enum
-- check would deny outright) whose custom role grants
-- inventory.reconcile:true in its own JSONB approves -- lives_ok. Proves the
-- JSONB permission path, not merely a default-table role name, is what's
-- being exercised.
SET LOCAL request.jwt.claims = '{"sub":"13579135-1357-1357-1357-135791357913"}';
SELECT lives_ok(
  $$ SELECT public.approve_stock_take(
       'a2000000-0000-0000-0000-000000000003'::uuid,
       'f0000000-0000-0000-0000-000000000003'::uuid,
       'Physical Count',
       NULL,
       '[{"item_id":"c0000000-0000-0000-0000-000000000003","physical_qty":0}]'::jsonb,
       'Approved'
     ) $$,
  'custom-role cashier with inventory.reconcile=true approving stock take -- lives_ok'
);

SELECT * FROM finish();
ROLLBACK;
