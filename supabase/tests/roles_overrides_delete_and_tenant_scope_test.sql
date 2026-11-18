-- docs/superpowers/plans/2026-11-18-permissions-server-enforcement.md Fix-C
-- (follow-up to whole-branch review findings C3 and I4 on top of Task 8's
-- 20261212000000_permissions_and_billing_admin_gates.sql).
--
-- C3: Task 8 gated roles_tenant_insert/_update and
-- user_permission_overrides_tenant_insert/_update on staff.permissions but
-- never touched either table's DELETE policy -- roles_tenant_delete and
-- user_permission_overrides_tenant_delete were still the generic
-- %I_tenant_delete form from the tenant_tables loop in
-- 20240601000000_track_base_schema.sql: app_is_super_admin() OR
-- tenant_id = app_current_tenant_id(), with NO permission check at all.
-- Confirmed by grepping every migration for both policy names -- no hits
-- besides the base-schema loop, same discipline as Tasks 6-8. This let any
-- staff member delete their own restrictive user_permission_overrides row,
-- or delete a custom roles row out from under staff.role_id (ON DELETE SET
-- NULL), bypassing the override/custom-role layers entirely.
--
-- I4: user_permission_overrides_tenant_insert/_update (Task 8) check
-- tenant_id = app_current_tenant_id() but never verify the row's staff_id
-- actually belongs to a staff member of that SAME tenant. This let tenant
-- A's admin plant an override row with tenant_id = A but staff_id pointing
-- at tenant B's staff, silently affecting tenant B's staff member's
-- permission resolution (app_has_permission's lookup has no tenant filter
-- of its own -- it is only tenant-safe because v_staff_id normally comes
-- from the CALLER's own app_current_staff_id(), never an arbitrary id).
-- Tenant B could never see or remove the planted row since their own
-- _tenant_read/_tenant_delete policies filter by tenant_id = B.
--
-- This migration (20261215000000_roles_overrides_delete_and_tenant_scope.sql):
--   1) roles_tenant_delete / user_permission_overrides_tenant_delete: gated
--      on staff.permissions, same shape as Task 8's INSERT/UPDATE policies.
--   2) user_permission_overrides_tenant_insert's WITH CHECK and
--      user_permission_overrides_tenant_update's USING+WITH CHECK: add an
--      EXISTS (SELECT 1 FROM public.staff s WHERE s.id = staff_id AND
--      s.tenant_id = app_current_tenant_id()) condition alongside the
--      existing tenant_id/staff.permissions check, inside the same
--      non-super-admin branch.
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

-- Fixtures: two tenants (A, B). Tenant A has a manager (role_id IS NULL, so
-- staff.permissions=false from the default table) and an admin (role_id IS
-- NULL, so staff.permissions=true from the default table). Tenant B has one
-- staff member, used only as a cross-tenant staff_id target for the I4
-- scenarios -- tenant A's admin never has any legitimate reason to touch
-- them. A custom roles row belongs to tenant A, as does one
-- user_permission_overrides row (staff_id = tenant A's manager).
SET session_replication_role = replica;

INSERT INTO public.tenants (id, name, owner_email, phone)
VALUES
  ('a1111111-1111-1111-1111-111111111111', 'Roles Overrides Delete Scope Test Tenant A', 'owner-a@roles-overrides-scope.test.invalid', '0500000010'),
  ('b2222222-2222-2222-2222-222222222222', 'Roles Overrides Delete Scope Test Tenant B', 'owner-b@roles-overrides-scope.test.invalid', '0500000011');

INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status)
VALUES
  ('c3333333-3333-3333-3333-333333333333', 'a1111111-1111-1111-1111-111111111111',
   'd4444444-4444-4444-4444-444444444444', 'Test Manager A', 'manager-a@roles-overrides-scope.test.invalid', 'manager', NULL, 'active'),
  ('e5555555-5555-5555-5555-555555555555', 'a1111111-1111-1111-1111-111111111111',
   'f6666666-6666-6666-6666-666666666666', 'Test Admin A', 'admin-a@roles-overrides-scope.test.invalid', 'admin', NULL, 'active'),
  ('a7777777-7777-7777-7777-777777777777', 'b2222222-2222-2222-2222-222222222222',
   'b8888888-8888-8888-8888-888888888888', 'Test Staff B', 'staff-b@roles-overrides-scope.test.invalid', 'cashier', NULL, 'active');

INSERT INTO public.roles (id, tenant_id, role_key, name, permissions)
VALUES ('19999999-9999-9999-9999-999999999999', 'a1111111-1111-1111-1111-111111111111', 'custom_role_delete_scope_test', 'Custom Role A', '{}'::jsonb);

INSERT INTO public.user_permission_overrides (staff_id, tenant_id, overrides)
VALUES ('c3333333-3333-3333-3333-333333333333', 'a1111111-1111-1111-1111-111111111111', '{}'::jsonb);

SET session_replication_role = DEFAULT;

-- Scenario 1 (C3, roles DELETE): manager (staff.permissions=false)
-- attempts to delete tenant A's custom roles row -- RLS silently excludes
-- the row; it must still be there afterward.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d4444444-4444-4444-4444-444444444444"}';
DELETE FROM public.roles WHERE id = '19999999-9999-9999-9999-999999999999';
INSERT INTO test_output (line) SELECT is(
  (SELECT count(*) FROM public.roles WHERE id = '19999999-9999-9999-9999-999999999999'),
  1::bigint,
  'manager (staff.permissions=false) deleting the custom role -- RLS blocks it, row still present'
);

-- Scenario 2 (C3, roles DELETE): admin (staff.permissions=true) deletes the
-- same roles row -- succeeds.
SET LOCAL request.jwt.claims = '{"sub":"f6666666-6666-6666-6666-666666666666"}';
DELETE FROM public.roles WHERE id = '19999999-9999-9999-9999-999999999999';
INSERT INTO test_output (line) SELECT is(
  (SELECT count(*) FROM public.roles WHERE id = '19999999-9999-9999-9999-999999999999'),
  0::bigint,
  'admin (staff.permissions=true) deleting the custom role -- lives_ok, row actually deleted'
);

-- Scenario 3 (C3, user_permission_overrides DELETE): manager
-- (staff.permissions=false) attempts to delete the override row (even
-- though it is their own row, by staff_id) -- RLS blocks it, row still
-- present. Proves the DELETE gate is on staff.permissions, not on whose
-- staff_id the row happens to carry.
SET LOCAL request.jwt.claims = '{"sub":"d4444444-4444-4444-4444-444444444444"}';
DELETE FROM public.user_permission_overrides WHERE staff_id = 'c3333333-3333-3333-3333-333333333333';
INSERT INTO test_output (line) SELECT is(
  (SELECT count(*) FROM public.user_permission_overrides WHERE staff_id = 'c3333333-3333-3333-3333-333333333333'),
  1::bigint,
  'manager (staff.permissions=false) deleting their own override row -- RLS blocks it, row still present'
);

-- Scenario 4 (C3, user_permission_overrides DELETE): admin
-- (staff.permissions=true) deletes the same override row -- succeeds.
SET LOCAL request.jwt.claims = '{"sub":"f6666666-6666-6666-6666-666666666666"}';
DELETE FROM public.user_permission_overrides WHERE staff_id = 'c3333333-3333-3333-3333-333333333333';
INSERT INTO test_output (line) SELECT is(
  (SELECT count(*) FROM public.user_permission_overrides WHERE staff_id = 'c3333333-3333-3333-3333-333333333333'),
  0::bigint,
  'admin (staff.permissions=true) deleting the override row -- lives_ok, row actually deleted'
);

-- Scenario 5 (I4, cross-tenant staff_id block): admin of tenant A
-- (staff.permissions=true) attempts to INSERT an override row with
-- tenant_id set to their own tenant A but staff_id pointing at tenant B's
-- staff member -- must FAIL: tenant_id/staff.permissions both pass, but
-- the EXISTS(staff WHERE id = staff_id AND tenant_id = A) check fails
-- since that staff_id's real tenant is B, not A. Rejected by the INSERT
-- WITH CHECK, which (unlike a DELETE/UPDATE USING-clause denial) raises a
-- real "new row violates row-level security policy" exception.
INSERT INTO test_output (line) SELECT throws_like(
  $$ INSERT INTO public.user_permission_overrides (staff_id, tenant_id, overrides)
     VALUES ('a7777777-7777-7777-7777-777777777777', 'a1111111-1111-1111-1111-111111111111', '{}'::jsonb) $$,
  '%row-level security%',
  'admin (tenant A) inserting an override row for tenant B''s staff_id -- rejected by RLS'
);

-- Scenario 6 (I4, positive case): the same tenant-A admin inserts an
-- override row for a staff_id that genuinely belongs to tenant A (the
-- manager's staff_id, freed up by scenario 4's delete) -- lives_ok, proves
-- the new EXISTS check does not block a legitimate same-tenant write.
INSERT INTO test_output (line) SELECT lives_ok(
  $$ INSERT INTO public.user_permission_overrides (staff_id, tenant_id, overrides)
     VALUES ('c3333333-3333-3333-3333-333333333333', 'a1111111-1111-1111-1111-111111111111', '{}'::jsonb) $$,
  'admin (tenant A) inserting an override row for tenant A''s own staff_id -- lives_ok'
);

INSERT INTO test_output (line) SELECT * FROM finish();
SELECT line FROM test_output ORDER BY seq;
ROLLBACK;
