-- docs/superpowers/plans/2026-11-18-permissions-server-enforcement.md Task 3.
-- Proves close_shift lets a staff member who handles cash (payments.collect)
-- close their OWN shift without shifts.manage, and gates a cross-staff close
-- on shifts.manage (via app_has_permission() from Task 1) instead of the
-- hard-coded role list.
--
-- seen-stability-guardrails-task.md: test 1 used to have a tailor close their
-- own shift. Since 20270101000003 a shift is opened and closed by whoever
-- handles cash (shifts.manage or payments.collect) -- a tailor can no longer
-- open one -- so the test now uses a cashier (CI's pgtap job had been failing
-- on it since).
--
-- Run with: npx supabase db query --linked --file <this file>
-- (supabase test db --linked needs Docker, which is down on this machine.)
BEGIN;
SELECT plan(4);

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
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Test Manager', 'manager@close-shift-perm.test.invalid', 'manager', NULL, 'active'),
  ('77777777-7777-7777-7777-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '88888888-8888-8888-8888-888888888888', 'Test Cashier', 'cashier@close-shift-perm.test.invalid', 'cashier', NULL, 'active');

-- Custom role (not owner/admin/manager by name) that grants shifts.manage via
-- its own roles.permissions JSONB; the staff member below is assigned to it.
INSERT INTO public.roles (id, tenant_id, role_key, name, permissions)
VALUES ('12121212-1212-1212-1212-121212121212', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'shift_closer', 'Shift Closer', '{"shifts.manage": true}'::jsonb);

INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status)
VALUES ('12345678-1234-1234-1234-123456789012', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '13579135-1357-1357-1357-135791357913', 'Test Shift Closer', 'closer@close-shift-perm.test.invalid', 'cashier',
        '12121212-1212-1212-1212-121212121212', 'active');

INSERT INTO public.shifts (id, tenant_id, branch_id, staff_id, staff_name, opening_balance, status)
VALUES
  ('f1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL,
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Test Tailor', 0, 'open'),
  ('f2222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL,
   'dddddddd-dddd-dddd-dddd-dddddddddddd', 'Test Manager', 0, 'open'),
  ('f3333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL,
   '99999999-9999-9999-9999-999999999999', 'Test Tailor 2', 0, 'open'),
  ('f4444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL,
   '77777777-7777-7777-7777-777777777777', 'Test Cashier', 0, 'open');

SET session_replication_role = DEFAULT;

-- Scenario 1: tailor closes their OWN shift -- lives_ok (never gated by
-- shifts.manage; the v_staff IS DISTINCT FROM v_shift_staff short-circuit).
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"88888888-8888-8888-8888-888888888888"}';
SELECT lives_ok(
  $$ SELECT public.close_shift(
       'a1000000-0000-0000-0000-000000000001'::uuid,
       'f4444444-4444-4444-4444-444444444444'::uuid,
       0,
       NULL
     ) $$,
  'cashier closes their own shift -- lives_ok, payments.collect, not shifts.manage'
);

SET LOCAL request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc"}';

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

-- Scenario 4: a cashier (not owner/admin/manager) whose custom role grants
-- shifts.manage:true closes the manager's still-open shift -- lives_ok. The
-- old role-name check would deny this; app_has_permission resolves it via the
-- custom role's own permissions JSONB.
SET LOCAL request.jwt.claims = '{"sub":"13579135-1357-1357-1357-135791357913"}';
SELECT lives_ok(
  $$ SELECT public.close_shift(
       'a1000000-0000-0000-0000-000000000004'::uuid,
       'f2222222-2222-2222-2222-222222222222'::uuid,
       0,
       NULL
     ) $$,
  'custom-role cashier with shifts.manage=true closes another staff shift -- lives_ok'
);

SELECT * FROM finish();
ROLLBACK;
