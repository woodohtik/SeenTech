-- seen-open-verticals-task.md, wave 1 (women's tailoring item 3): an order
-- carries the occasion's date and an "urgent" mark; both are saved with the
-- order and can be changed later (logged like the delivery date).
--
--   CI:    supabase test db
--   Here:  npx tsx scripts/db/pgtap-linked.ts supabase/tests/order_occasion_test.sql   (staging, rolled back)
BEGIN;
SELECT plan(5);

SET session_replication_role = replica;
INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test, vertical) VALUES
  ('a4000000-0000-4000-8000-000000000001', 'Occasion Shop', 'occ-shop@example.invalid', '0500000401', 'active', true, 'womens_tailoring');
INSERT INTO public.branches (id, tenant_id, name, location, is_main) VALUES
  ('b4000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'Main', 'x', true);
INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status, branch_id) VALUES
  ('c4000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001', 'Owner', 'occ-own@example.invalid', 'owner', NULL, 'active', 'b4000000-0000-4000-8000-000000000001');
INSERT INTO public.customers (id, tenant_id, name, phone) VALUES
  ('e4000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'عميلة', '0500000402');
SET session_replication_role = DEFAULT;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d4000000-0000-4000-8000-000000000001"}';
SELECT public.create_tailoring_order('94000000-0000-4000-8000-000000000001'::uuid,
  '{"customer_id":"e4000000-0000-4000-8000-000000000001","occasion_date":"2027-02-14","is_urgent":true,"delivery_date":"2027-02-10"}'::jsonb,
  '[{"garment_type":"dress","quantity":1,"price":400}]'::jsonb);
SELECT public.create_tailoring_order('94000000-0000-4000-8000-000000000002'::uuid,
  '{"customer_id":"e4000000-0000-4000-8000-000000000001"}'::jsonb,
  '[{"garment_type":"abaya","quantity":1,"price":200}]'::jsonb);
RESET ROLE;

SELECT is((SELECT occasion_date FROM public.orders WHERE id = '94000000-0000-4000-8000-000000000001'), '2027-02-14'::date,
  'the occasion date is saved with the order');
SELECT is((SELECT is_urgent FROM public.orders WHERE id = '94000000-0000-4000-8000-000000000001'), true,
  'and the urgent mark');
SELECT is((SELECT is_urgent FROM public.orders WHERE id = '94000000-0000-4000-8000-000000000002'), false,
  'an order without them: not urgent, no occasion');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d4000000-0000-4000-8000-000000000001"}';
SELECT public.update_tailoring_order('95000000-0000-4000-8000-000000000001'::uuid, '94000000-0000-4000-8000-000000000002'::uuid,
  '{"occasion_date":"2027-03-01","is_urgent":true}'::jsonb, NULL, 'المناسبة');
RESET ROLE;
SELECT is((SELECT occasion_date FROM public.orders WHERE id = '94000000-0000-4000-8000-000000000002'), '2027-03-01'::date,
  'the occasion date can be changed later');
SELECT is((SELECT is_urgent FROM public.orders WHERE id = '94000000-0000-4000-8000-000000000002'), true,
  'and the urgent mark');

SELECT * FROM finish();
ROLLBACK;
