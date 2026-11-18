-- docs/superpowers/plans/2026-11-18-permissions-server-enforcement.md Task 1.
-- Proves the 3-layer resolution in app_has_permission() / the fixed fallback
-- table in app_default_permission() before any later task in the plan
-- wires either into a real RPC or RLS policy -- every one of those tasks
-- inherits whatever this file locks in.
--
-- Run with: supabase test db --linked (pushes nothing; runs against the
-- already-migrated staging schema).
BEGIN;
SELECT plan(8);

-- Fixtures: one tenant; one tenant-custom role ('custom_cashier') whose
-- permissions JSONB deliberately only sets payments.collect -- every other
-- of the 11 keys is ABSENT from the object, not false, so scenario 3 proves
-- the fallback to app_default_permission fires on absence, not falsiness.
-- owner (no role_id) and tailor (no role_id) exercise the pure
-- default-table path; the two cashiers share the custom role but carry
-- different user_permission_overrides rows to prove an override only wins
-- when it actually mentions the key being checked.
SET session_replication_role = replica;

INSERT INTO public.tenants (id, name, owner_email, phone)
VALUES ('a1111111-1111-1111-1111-111111111111', 'Test Tenant', 'owner@test.invalid', '0500000001');

INSERT INTO public.roles (id, tenant_id, role_key, name, permissions)
VALUES ('b2222222-2222-2222-2222-222222222222', 'a1111111-1111-1111-1111-111111111111',
        'custom_cashier', 'Custom Cashier', '{"payments.collect": true}'::jsonb);

INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status)
VALUES
  ('c3333333-3333-3333-3333-333333333333', 'a1111111-1111-1111-1111-111111111111',
   'd4444444-4444-4444-4444-444444444444', 'Test Owner', 'owner@app-has-permission.test.invalid', 'owner', NULL, 'active'),
  ('e5555555-5555-5555-5555-555555555555', 'a1111111-1111-1111-1111-111111111111',
   'f6666666-6666-6666-6666-666666666666', 'Test Cashier', 'cashier@app-has-permission.test.invalid', 'cashier',
   'b2222222-2222-2222-2222-222222222222', 'active'),
  ('a7777777-7777-7777-7777-777777777777', 'a1111111-1111-1111-1111-111111111111',
   'a8888888-8888-8888-8888-888888888888', 'Test Cashier Two', 'cashier2@app-has-permission.test.invalid', 'cashier',
   'b2222222-2222-2222-2222-222222222222', 'active'),
  ('a9999999-9999-9999-9999-999999999999', 'a1111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Test Tailor', 'tailor@app-has-permission.test.invalid', 'tailor', NULL, 'active');

INSERT INTO public.user_permission_overrides (staff_id, tenant_id, overrides)
VALUES
  ('e5555555-5555-5555-5555-555555555555', 'a1111111-1111-1111-1111-111111111111', '{"action.discount": false}'::jsonb),
  ('a7777777-7777-7777-7777-777777777777', 'a1111111-1111-1111-1111-111111111111', '{"shifts.manage": false}'::jsonb);

SET session_replication_role = DEFAULT;

SET LOCAL ROLE authenticated;

-- Scenario 1: owner short-circuits to true, no table read needed.
SET LOCAL request.jwt.claims = '{"sub":"d4444444-4444-4444-4444-444444444444"}';
SELECT is(
  app_has_permission('settings.billing'),
  true,
  'owner short-circuits app_has_permission to true regardless of key'
);

-- Scenario 2: cashier's custom role sets payments.collect:true directly.
SET LOCAL request.jwt.claims = '{"sub":"f6666666-6666-6666-6666-666666666666"}';
SELECT is(
  app_has_permission('payments.collect'),
  true,
  'cashier with custom role reads payments.collect:true from roles.permissions'
);

-- Scenario 3: action.refund is absent from the custom role's JSONB -- must
-- fall through to app_default_permission('cashier', 'action.refund') = false,
-- not be treated as a falsy/missing value that happens to equal false.
SELECT is(
  app_has_permission('action.refund'),
  false,
  'cashier falls through to the default table when the custom role JSONB lacks the key'
);

-- Scenario 4: action.discount default-table value for cashier is true, but
-- this cashier's override sets it to false -- override must win.
SELECT is(
  app_has_permission('action.discount'),
  false,
  'per-user override of false wins over the role/default true for action.discount'
);

-- Scenario 5: cashier-two shares the same custom role; its override row
-- mentions only shifts.manage, so payments.collect must still resolve to
-- true via the custom role, unaffected by the unrelated override key.
SET LOCAL request.jwt.claims = '{"sub":"a8888888-8888-8888-8888-888888888888"}';
SELECT is(
  app_has_permission('payments.collect'),
  true,
  'an override row present but silent on this key does not affect payments.collect'
);

-- Scenario 6: tailor has role_id IS NULL -- pure default-table fallback.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';
SELECT is(
  app_has_permission('shifts.manage'),
  false,
  'tailor with no role_id falls through to the default table for shifts.manage'
);

-- Scenario 7: same tailor, a different key -- proves the default table
-- isn't accidentally returning true/false by coincidence of key name.
SELECT is(
  app_has_permission('orders.delete'),
  false,
  'tailor with no role_id falls through to the default table for orders.delete'
);

-- Scenario 8: no session at all -- a valid empty JWT claims object with no
-- "sub" key (RESET would instead fall back to the authenticated role's own
-- configured default for this GUC, which is an empty string and fails the
-- ::jsonb cast inside app_current_uid() rather than resolving NULL).
-- app_current_uid()/app_current_role() resolve NULL, and app_has_permission
-- must fail closed to false, not raise.
SET LOCAL request.jwt.claims = '{}';
SELECT is(
  app_has_permission('payments.collect'),
  false,
  'no active session resolves app_current_role() to NULL and app_has_permission fails closed to false'
);

SELECT * FROM finish();
ROLLBACK;
