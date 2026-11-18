-- docs/superpowers/plans/2026-11-18-permissions-server-enforcement.md Fix-A
-- (whole-branch review follow-up on Task 8).
--
-- Task 8 (20261212000000_permissions_and_billing_admin_gates.sql) added a
-- settings.billing exemption to tenants_no_self_billing_escalation's
-- billing-field block. The review found this was a real regression: the
-- ONLY caller who can ever reach this trigger is the tenant owner
-- (tenants_owner_update's RLS only lets owner_uid = app_current_uid()
-- through), and 'owner' always has settings.billing=true via
-- app_has_permission's own short-circuit. Net effect: Task 8 completely
-- exempted the owner from the block, letting them write directly to
-- subscription_end_date/trashed_at/locked_at/purge_at/etc -- exactly the
-- fraud-sensitive fields 20261114000003 created this trigger to protect
-- from self-editing.
--
-- Fix-A (20261213000000_fix_billing_escalation_scope.sql):
--   1. Reverts tenants_no_self_billing_escalation to its unconditional
--      block (no settings.billing exemption at all) -- restores the exact
--      pre-Task-8 behavior.
--   2. Wires app_has_permission('settings.billing') into
--      create_subscription_request instead -- BillingSettings.tsx's only
--      write path, confirmed to have had ZERO role/permission check
--      before this fix (any tenant staff member could submit a
--      subscription/renewal request).
--
-- Run with: npx supabase db query --linked --file <this file>
-- (supabase test db --linked needs Docker, which is down on this machine.)
BEGIN;
SELECT plan(5);

-- db query --linked only surfaces the LAST statement's result set, so
-- collect each assertion's TAP line here and print them all together with
-- finish() at the end instead of relying on each SELECT's own output.
CREATE TEMP TABLE test_output (seq INT GENERATED ALWAYS AS IDENTITY, line TEXT);
GRANT INSERT, SELECT ON test_output TO authenticated;

-- Fixtures: one tenant; an owner (role enum 'owner' -- app_has_permission
-- short-circuits any key to true for 'owner', which is exactly the bug
-- Task 8 introduced for scenario 1 below); a cashier (role_id IS NULL, so
-- settings.billing=false from the default-permission table, confirmed in
-- 20261205000000_app_has_permission.sql's app_default_permission); a
-- custom role granting settings.billing:true explicitly (same pattern
-- Task 1's own tests used for a non-owner permission grant) with a second
-- staff member attached to it, to prove the new create_subscription_request
-- gate is driven by app_has_permission (any true source), not a hard-coded
-- role check. A plan row is needed for create_subscription_request's own
-- plan lookup to succeed past the permission gate.
SET session_replication_role = replica;

INSERT INTO public.tenants (id, name, owner_email, phone)
VALUES ('bbbbbbbb-1111-1111-1111-111111111111', 'Fix-A Billing Scope Test Tenant', 'owner@fix-a-billing-scope.test.invalid', '0500000013');

INSERT INTO public.users (id, email)
VALUES ('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner-user@fix-a-billing-scope.test.invalid');

UPDATE public.tenants SET owner_uid = '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
 WHERE id = 'bbbbbbbb-1111-1111-1111-111111111111';

INSERT INTO public.roles (id, tenant_id, role_key, name, permissions)
VALUES ('cccccccc-2222-2222-2222-222222222222', 'bbbbbbbb-1111-1111-1111-111111111111',
        'custom_role_billing_fix_a', 'Custom Billing Role', '{"settings.billing": true}'::jsonb);

INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status)
VALUES
  ('dddddddd-3333-3333-3333-333333333333', 'bbbbbbbb-1111-1111-1111-111111111111',
   '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Test Owner', 'owner-staff@fix-a-billing-scope.test.invalid', 'owner', NULL, 'active'),
  ('eeeeeeee-4444-4444-4444-444444444444', 'bbbbbbbb-1111-1111-1111-111111111111',
   '66666666-4444-4444-4444-444444444444', 'Test Cashier', 'cashier@fix-a-billing-scope.test.invalid', 'cashier', NULL, 'active'),
  ('ffffffff-5555-5555-5555-555555555555', 'bbbbbbbb-1111-1111-1111-111111111111',
   '77777777-5555-5555-5555-555555555555', 'Custom Billing Staff', 'custom-billing@fix-a-billing-scope.test.invalid', 'manager',
   'cccccccc-2222-2222-2222-222222222222', 'active');

INSERT INTO public.plans (id, name, price, is_active)
VALUES ('fix-a-billing-plan', 'Fix-A Billing Test Plan', 100, true)
ON CONFLICT (id) DO NOTHING;

SET session_replication_role = DEFAULT;

-- Scenario 1 (billing-trigger revert): owner (owner_uid matches, so
-- tenants_owner_update's RLS lets the UPDATE through to the trigger)
-- attempts to self-edit tenants.subscription_end_date directly. Before
-- this fix, Task 8's settings.billing exemption let this through for the
-- owner (the exact regression). After the fix, the trigger is
-- unconditional again and this must throw the same exception message
-- 20261114000003 originally used.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';
INSERT INTO test_output (line) SELECT throws_matching(
  $$ UPDATE public.tenants SET subscription_end_date = '2099-01-01' WHERE id = 'bbbbbbbb-1111-1111-1111-111111111111' $$,
  'يمكن للمالك تعديل بيانات الملف التجاري فقط',
  'owner self-editing tenants.subscription_end_date -- blocked again (Task 8 regression closed)'
);

-- Scenario 2 (no over-correction): the SAME owner updates tenants.name --
-- an allow-listed, non-billing commercial-profile column -- must still
-- succeed. Proves the revert didn't turn the trigger into a total block
-- on the owner's legitimate self-edits.
INSERT INTO test_output (line) SELECT lives_ok(
  $$ UPDATE public.tenants SET name = 'Fix-A Billing Scope Test Tenant (renamed)' WHERE id = 'bbbbbbbb-1111-1111-1111-111111111111' $$,
  'owner self-editing tenants.name (allow-listed, non-billing) -- still lives_ok'
);

-- Scenario 3 (create_subscription_request gate, denial): cashier
-- (settings.billing=false via the default-permission table) attempts
-- create_subscription_request for their own tenant. Before this fix,
-- create_subscription_request had zero role/permission check at all, so
-- this would succeed for any tenant staff member (the BO-15 finding).
-- After the fix, it must throw the new settings.billing gate's message.
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"66666666-4444-4444-4444-444444444444"}';
INSERT INTO test_output (line) SELECT throws_matching(
  $$ SELECT * FROM public.create_subscription_request(
       'bbbbbbbb-1111-1111-1111-111111111111'::uuid,
       'fix-a-billing-plan', 'bank_transfer'
     ) $$,
  'لا تملك صلاحية',
  'cashier (settings.billing=false) calling create_subscription_request -- throws the new gate message'
);

-- Scenario 4 (create_subscription_request gate, allow via custom role):
-- the custom-role staff member (settings.billing=true via roles.permissions,
-- NOT the 'owner' short-circuit -- proves the gate is driven by
-- app_has_permission generically) calling create_subscription_request for
-- their own tenant must succeed.
SET LOCAL request.jwt.claims = '{"sub":"77777777-5555-5555-5555-555555555555"}';
INSERT INTO test_output (line) SELECT lives_ok(
  $$ SELECT * FROM public.create_subscription_request(
       'bbbbbbbb-1111-1111-1111-111111111111'::uuid,
       'fix-a-billing-plan', 'bank_transfer'
     ) $$,
  'custom-role staff (settings.billing=true) calling create_subscription_request -- lives_ok'
);

-- Scenario 5 (create_subscription_request gate, allow via owner): owner
-- (settings.billing=true via the 'owner' short-circuit) calling
-- create_subscription_request for their own tenant must also succeed --
-- the common case (BillingSettings.tsx is normally used by the owner)
-- must keep working.
SET LOCAL request.jwt.claims = '{"sub":"11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';
INSERT INTO test_output (line) SELECT lives_ok(
  $$ SELECT * FROM public.create_subscription_request(
       'bbbbbbbb-1111-1111-1111-111111111111'::uuid,
       'fix-a-billing-plan', 'bank_transfer'
     ) $$,
  'owner (settings.billing=true via short-circuit) calling create_subscription_request -- lives_ok'
);

INSERT INTO test_output (line) SELECT * FROM finish();
SELECT line FROM test_output ORDER BY seq;
ROLLBACK;
