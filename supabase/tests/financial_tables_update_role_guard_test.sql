-- seen-cto-sprint4-design-quality-task.md item 4: codifies the manual
-- rolled-back-transaction verification done by hand for
-- 20261122000000_financial_tables_update_role_guard.sql.
BEGIN;
SELECT plan(4);

SET session_replication_role = replica;

INSERT INTO public.tenants (id, name, owner_email, phone)
VALUES ('11111111-1111-1111-1111-111111111111', 'Test Tenant', 'owner@test.invalid', '0500000000');

INSERT INTO public.staff (id, tenant_id, uid, name, email, role, status)
VALUES
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   '33333333-3333-3333-3333-333333333333', 'Test Owner', 'owner-staff@test.invalid', 'owner', 'active'),
  ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
   '55555555-5555-5555-5555-555555555555', 'Test Cashier', 'cashier@test.invalid', 'cashier', 'active');

INSERT INTO public.orders (id, tenant_id, customer_name, order_number, delivery_date, total_amount, paid_amount)
VALUES ('77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111',
        'Test Customer', 1, now() + interval '7 days', 100, 0);

INSERT INTO public.payments (id, tenant_id, order_id, amount, method)
VALUES ('88888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111',
        '77777777-7777-7777-7777-777777777777', 50, 'cash');

SET session_replication_role = DEFAULT;

SET LOCAL ROLE authenticated;

-- Scenario 1: cashier direct UPDATE on orders -- must be rejected by RLS.
SET LOCAL request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555"}';
WITH upd AS (
  UPDATE public.orders SET total_amount = 0
   WHERE id = '77777777-7777-7777-7777-777777777777' RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0, 'cashier UPDATE on orders matches 0 rows under RLS');

-- Scenario 2: cashier direct UPDATE on payments -- must be rejected by RLS.
WITH upd AS (
  UPDATE public.payments SET amount = 999999
   WHERE id = '88888888-8888-8888-8888-888888888888' RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 0, 'cashier UPDATE on payments matches 0 rows under RLS');

-- Scenario 3: owner direct UPDATE on orders -- still works (not a regression).
SET LOCAL request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
WITH upd AS (
  UPDATE public.orders SET updated_at = now()
   WHERE id = '77777777-7777-7777-7777-777777777777' RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 1, 'owner UPDATE on orders still works');

-- Scenario 4: owner direct UPDATE on payments -- still works (not a regression).
WITH upd AS (
  UPDATE public.payments SET notes = 'owner edit'
   WHERE id = '88888888-8888-8888-8888-888888888888' RETURNING 1
)
SELECT is((SELECT count(*)::int FROM upd), 1, 'owner UPDATE on payments still works');

SELECT * FROM finish();
ROLLBACK;
