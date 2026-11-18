-- docs/superpowers/plans/2026-11-18-permissions-server-enforcement.md Task 8
-- (final task).
--
-- Two halves:
--
-- 1) roles/user_permission_overrides INSERT/UPDATE: gated on
--    staff.permissions via app_has_permission() (Task 1) instead of
--    roles_tenant_insert/roles_tenant_update's hard-coded
--    app_current_role() IN ('owner','admin') (20260909080000) and
--    user_permission_overrides_tenant_insert/_update's bare
--    tenant_id = app_current_tenant_id() with no role/permission predicate
--    at all (generic %I_tenant_insert/%I_tenant_update form from the
--    tenant_tables loop in 20240601000000_track_base_schema.sql, never
--    overridden for this table before now).
--
-- 2) tenants_no_self_billing_escalation (20260908040000, rewritten as an
--    allow-list by 20261114000003_tenants_billing_defaults_and_self_edit_allowlist.sql):
--    today it unconditionally blocks ANY self-edit outside the fixed
--    commercial-profile allow-list (name/phone/address/.../updated_at) for
--    anyone except app_is_super_admin()/current_user IN
--    ('postgres','service_role') -- there's no permission check, it's a
--    flat block. This task adds a settings.billing
--    escape hatch: a caller WITH app_has_permission('settings.billing')
--    may edit billing fields (e.g. plan_id) directly; everyone else still
--    hits the same allow-list block with the same exception message as
--    before. Function stays SECURITY INVOKER (no SECURITY DEFINER clause
--    in its CREATE), matching its own 20261114000003 comment: "SECURITY
--    DEFINER would make current_user always report this function's OWNER
--    instead of the real caller, making the current_user check below
--    meaningless."
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

-- Fixtures: one tenant; an admin (role_id IS NULL, so from the default
-- table: staff.permissions=true, settings.billing=false); a manager
-- (role_id IS NULL, so staff.permissions=false from the default table);
-- an owner (role enum 'owner' -- app_has_permission short-circuits any key
-- to true for 'owner' before ever consulting the default table); a custom
-- roles row for this tenant, owned by nobody in particular, just a target
-- for the roles UPDATE scenarios.
SET session_replication_role = replica;

INSERT INTO public.tenants (id, name, owner_email, phone)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Perm And Billing Gates Test Tenant', 'owner@perm-billing-gates.test.invalid', '0500000008');

-- owner_uid (set further below, for scenarios 3/4) is a real FK to
-- users(id), so the admin/owner uids need a users row each -- otherwise
-- the later owner_uid UPDATE fails tenants_owner_uid_fkey.
INSERT INTO public.users (id, email)
VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'admin-user@perm-billing-gates.test.invalid'),
  ('11111111-2222-3333-4444-555555555555', 'owner-user@perm-billing-gates.test.invalid');

INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status)
VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Test Manager', 'manager@perm-billing-gates.test.invalid', 'manager', NULL, 'active'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Test Admin', 'admin@perm-billing-gates.test.invalid', 'admin', NULL, 'active'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-2222-3333-4444-555555555555', 'Test Owner', 'owner-staff@perm-billing-gates.test.invalid', 'owner', NULL, 'active');

INSERT INTO public.roles (id, tenant_id, role_key, name, permissions)
VALUES ('99999999-9999-9999-9999-999999999999', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'custom_role_perm_billing_test', 'Custom Role', '{"payments.collect": true}'::jsonb);

SET session_replication_role = DEFAULT;

-- tenants_owner_update (20260822090400) only lets the row through RLS at
-- all when owner_uid = app_current_uid() -- it is NOT a general
-- tenant-staff policy. So the trigger-level settings.billing gate in
-- scenarios 3/4 below can only be exercised by a caller who is also this
-- tenant's owner_uid. owner_uid is mutated between scenarios 3 and 4
-- (via the super-admin-exempt path, so it is itself unaffected by this
-- task's own trigger change) to let each caller's UPDATE actually reach
-- tenants_no_self_billing_escalation instead of being silently filtered
-- out by tenants_owner_update first (which would make throws_matching
-- fail with "no exception thrown" and lives_ok trivially pass for the
-- wrong reason -- both 0-row no-ops, not a real test of the trigger).

-- Scenario 1: manager (staff.permissions=false) attempts to UPDATE the
-- custom roles row -- RLS blocks it, 0 rows matched (no exception, same
-- as every other RLS-USING-clause denial in this plan -- see
-- delete_policies_permission_based_test.sql / financial_tables_update_role_guard_test.sql).
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc"}';
WITH upd AS (
  UPDATE public.roles SET permissions = '{}'::jsonb
   WHERE id = '99999999-9999-9999-9999-999999999999' RETURNING 1
)
INSERT INTO test_output (line) SELECT is(
  (SELECT count(*)::int FROM upd),
  0,
  'manager (staff.permissions=false) updating the custom role -- RLS blocks it, 0 rows matched'
);

-- Scenario 2: admin (staff.permissions=true) performs the same UPDATE --
-- succeeds, exactly 1 row matched.
SET LOCAL request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"}';
WITH upd AS (
  UPDATE public.roles SET permissions = '{"payments.collect": false}'::jsonb
   WHERE id = '99999999-9999-9999-9999-999999999999' RETURNING 1
)
INSERT INTO test_output (line) SELECT is(
  (SELECT count(*)::int FROM upd),
  1,
  'admin (staff.permissions=true) updating the custom role -- lives_ok, row actually updated'
);

-- Scenario 3: admin (staff.permissions=true but settings.billing=false)
-- attempts UPDATE tenants SET subscription_end_date = '2099-01-01' --
-- blocked by tenants_no_self_billing_escalation's trigger, reached via
-- the settings.billing permission check instead of the old unconditional
-- allow-list block, but with the exact same exception message as today
-- (confirmed verbatim from 20261114000003's RAISE EXCEPTION).
-- subscription_end_date, not plan_id, is used here deliberately: plan_id
-- (and status, and -- only once trial_started_at IS NOT NULL, which is
-- not the case for this fixture -- several trial columns) is ALSO
-- unconditionally blocked by the separate, earlier-firing
-- tenants_block_client_plan_edit trigger (20260822090400, still live,
-- "block" sorts before "no_self" alphabetically) for anyone who isn't
-- app_is_super_admin()/current_user IN ('postgres','service_role') --
-- confirmed live by running this scenario with plan_id first and getting
-- tenants_block_client_plan_edit's own unrelated message instead.
-- subscription_end_date is in tenants_no_self_billing_escalation's deny
-- set (not on 20261114000003's allow-list) and is untouched by
-- tenants_block_client_plan_edit, so it isolates the trigger this task
-- actually changes. owner_uid is set to admin's own uid first so the
-- UPDATE actually clears tenants_owner_update's RLS and reaches the
-- trigger. RESET ROLE first -- SET LOCAL ROLE authenticated above
-- persists for the rest of the transaction and lacks privilege to set
-- session_replication_role.
RESET ROLE;
SET session_replication_role = replica;
UPDATE public.tenants SET owner_uid = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
SET session_replication_role = DEFAULT;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"}';
INSERT INTO test_output (line) SELECT throws_matching(
  $$ UPDATE public.tenants SET subscription_end_date = '2099-01-01' WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  'يمكن للمالك تعديل بيانات الملف التجاري فقط',
  'admin (settings.billing=false) updating tenants.subscription_end_date -- blocked with the self-billing-escalation message'
);

-- Scenario 4 (review fix-round addition): the SAME admin
-- (settings.billing=false), still the matching owner_uid from scenario
-- 3, updates tenants.name and tenants.phone -- ordinary commercial-
-- profile columns on 20261114000003's allow-list -- in the same
-- statement as scenario 3's billing column. Must be lives_ok: proves the
-- `v_allowed_new IS DISTINCT FROM NEW` short-circuit in
-- tenants_no_self_billing_escalation still lets a normal self-edit
-- through for a caller who lacks settings.billing, without the
-- RAISE EXCEPTION ever triggering (it never even reaches the
-- app_has_permission('settings.billing') check, since v_allowed_new
-- equals NEW for an allow-list-only change). This closes the gap the
-- review flagged: previously only an uncommitted, non-persisted ad-hoc
-- check covered this -- not a real regression test.
INSERT INTO test_output (line) SELECT lives_ok(
  $$ UPDATE public.tenants SET name = 'Perm And Billing Gates Test Tenant (renamed)', phone = '0500000009' WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  'admin (settings.billing=false) updating tenants.name/phone (allow-listed, non-billing) -- lives_ok, not blocked'
);

-- Scenario 5 (corrected post-Fix-A -- see
-- fix_billing_escalation_scope_test.sql): this scenario originally
-- asserted lives_ok here, on the theory that
-- app_has_permission('settings.billing') short-circuits to true for the
-- 'owner' role before ever consulting the default-permission table, so
-- Task 8's settings.billing exemption on tenants_no_self_billing_escalation
-- would let the owner's own billing-column self-edit through. The
-- whole-branch review (and Fix-A, 20261213000000_fix_billing_escalation_scope.sql)
-- found that was exactly the regression: the ONLY caller who can ever
-- reach this trigger is the tenant owner (tenants_owner_update's RLS only
-- lets owner_uid = app_current_uid() through), and owner always has
-- settings.billing=true -- so Task 8's exemption fully defeated the
-- trigger's purpose for its one real caller. Fix-A reverted the trigger to
-- its unconditional block (no settings.billing exemption at all) and gave
-- settings.billing its intended target (create_subscription_request)
-- instead. This scenario is corrected to match that now-current, intended
-- behavior (throws_matching, not lives_ok) instead of being deleted, so
-- this file stays internally consistent with the trigger's actual
-- behavior rather than silently testing a reverted code path.
-- owner_uid is switched to the owner staff's uid first, same reason as
-- scenario 3 -- with owner_uid now matching, tenants_owner_update's RLS
-- lets the row through regardless of the trigger outcome, so this is a
-- real assertion about the trigger (not a 0-row no-op masquerading as a
-- result, which was the risk before owner_uid was set).
RESET ROLE;
SET session_replication_role = replica;
UPDATE public.tenants SET owner_uid = '11111111-2222-3333-4444-555555555555' WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
SET session_replication_role = DEFAULT;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"11111111-2222-3333-4444-555555555555"}';
INSERT INTO test_output (line) SELECT throws_matching(
  $$ UPDATE public.tenants SET subscription_end_date = '2099-01-01' WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  'يمكن للمالك تعديل بيانات الملف التجاري فقط',
  'owner (settings.billing via short-circuit) updating tenants.subscription_end_date -- blocked by Fix-A''s unconditional revert, not lives_ok'
);

INSERT INTO test_output (line) SELECT * FROM finish();
SELECT line FROM test_output ORDER BY seq;
ROLLBACK;
