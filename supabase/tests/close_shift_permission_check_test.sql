-- docs/superpowers/plans/2026-11-18-permissions-server-enforcement.md Task 3.
-- Proves close_shift lets a staff member close their OWN shift regardless of
-- permissions, and gates a cross-staff close on shifts.manage (via
-- app_has_permission() from Task 1) instead of the hard-coded role list.
--
-- Run with: npx supabase db query --linked --file <this file>
-- (supabase test db --linked needs Docker, which is down on this machine.)
BEGIN;
SELECT plan(3);

-- Fixtures: one tenant; two tailors (role_id IS NULL, so shifts.manage=false
-- comes from the default table) each with one open shift -- a second tailor
-- is needed because uq_one_open_shift_per_staff allows only one open shift
-- per staff member; a manager (role_id IS NULL, so shifts.manage=true from
-- the default table) with one open shift.
SET session_replication_role = replica;

INSERT INTO public.tenants (id, name, owner_email, phone)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Close Shift Perm Test Tenant', 'owner@close-shift-perm.test.invalid', '0500000003');

INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status)
VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Test Tailor', 'tailor@close-shift-perm.test.invalid', 'tailor', NULL, 'active'),
  ('99999999-9999-9999-9999-999999999999', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'ffffffff-ffff-ffff-ffff-ffffffffffff', 'Test Tailor 2', 'tailor2@close-shift-perm.test.invalid', 'tailor', NULL, 'active'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Test Manager', 'manager@close-shift-perm.test.invalid', 'manager', NULL, 'active');

INSERT INTO public.shifts (id, tenant_id, branch_id, staff_id, staff_name, opening_balance, status)
VALUES
  ('f1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL,
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Test Tailor', 0, 'open'),
  ('f2222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL,
   'dddddddd-dddd-dddd-dddd-dddddddddddd', 'Test Manager', 0, 'open'),
  ('f3333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL,
   '99999999-9999-9999-9999-999999999999', 'Test Tailor 2', 0, 'open');

SET session_replication_role = DEFAULT;

-- Scenario 1: tailor closes their OWN shift -- lives_ok (never gated by
-- shifts.manage; the v_staff IS DISTINCT FROM v_shift_staff short-circuit).
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc"}';
SELECT lives_ok(
  $$ SELECT public.close_shift(
       'a1000000-0000-0000-0000-000000000001'::uuid,
       'f1111111-1111-1111-1111-111111111111'::uuid,
       0,
       NULL
     ) $$,
  'tailor closes their own shift -- lives_ok, not gated by shifts.manage'
);

-- Scenario 2: tailor attempts to close the manager's shift -- must throw the
-- existing "not your shift" message (now reached via app_has_permission).
SELECT throws_matching(
  $$ SELECT public.close_shift(
       'a1000000-0000-0000-0000-000000000002'::uuid,
       'f2222222-2222-2222-2222-222222222222'::uuid,
       0,
       NULL
     ) $$,
  'لا تملك صلاحية إغلاق وردية موظف آخر',
  'tailor closes manager shift -- throws the cross-staff close message'
);

-- Scenario 3: manager (shifts.manage=true) closes the tailor's open shift --
-- lives_ok.
SET LOCAL request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"}';
SELECT lives_ok(
  $$ SELECT public.close_shift(
       'a1000000-0000-0000-0000-000000000003'::uuid,
       'f3333333-3333-3333-3333-333333333333'::uuid,
       0,
       NULL
     ) $$,
  'manager closes tailor shift -- lives_ok, shifts.manage=true allows cross-staff close'
);

SELECT * FROM finish();
ROLLBACK;
