-- seen-order-images-upload-task.md, phases 3-4 (question 4): photos can be
-- added or removed later from "edit order". set_order_images keeps at most 6,
-- each a path in THIS order's own folder (<tenant>/<order>/...) or a link the
-- order already had; another shop's order is refused.
--
--   CI:    supabase test db
--   Here:  npx tsx scripts/db/pgtap-linked.ts supabase/tests/set_order_images_test.sql   (staging, rolled back)
BEGIN;
SELECT plan(6);

SET session_replication_role = replica;
INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test) VALUES
  ('ad000000-0000-4000-8000-000000000001', 'Set Images Shop', 'set-img@example.invalid', '0500000d01', 'active', true),
  ('ad000000-0000-4000-8000-000000000002', 'Set Images Other', 'set-img2@example.invalid', '0500000d02', 'active', true);
INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status) VALUES
  ('cd000000-0000-4000-8000-000000000001', 'ad000000-0000-4000-8000-000000000001', 'dd000000-0000-4000-8000-000000000001', 'Owner', 'set-own@example.invalid', 'owner', NULL, 'active'),
  ('cd000000-0000-4000-8000-000000000002', 'ad000000-0000-4000-8000-000000000002', 'dd000000-0000-4000-8000-000000000002', 'Other', 'set-oth@example.invalid', 'owner', NULL, 'active');
INSERT INTO public.orders (id, tenant_id, customer_name, order_number, delivery_date, total_amount, paid_amount, status, kind, images) VALUES
  ('9d000000-0000-4000-8000-000000000001', 'ad000000-0000-4000-8000-000000000001', 'A', 1, now() + interval '7 days', 100, 0, 'measurements_taken', 'tailoring', '["https://old.example/a.jpg"]'::jsonb);
SET session_replication_role = DEFAULT;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"dd000000-0000-4000-8000-000000000001"}';

SELECT lives_ok($$ SELECT public.set_order_images('9d000000-0000-4000-8000-000000000001',
  '["https://old.example/a.jpg", "ad000000-0000-4000-8000-000000000001/9d000000-0000-4000-8000-000000000001/x.webp"]'::jsonb) $$,
  'the old link kept and a new photo of this order added');
RESET ROLE;
SELECT is((SELECT jsonb_array_length(images) FROM public.orders WHERE id = '9d000000-0000-4000-8000-000000000001'), 2, 'two photos on the order');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"dd000000-0000-4000-8000-000000000001"}';
SELECT throws_ok($$ SELECT public.set_order_images('9d000000-0000-4000-8000-000000000001',
  '["ad000000-0000-4000-8000-000000000002/9d000000-0000-4000-8000-000000000009/y.webp"]'::jsonb) $$,
  '22023', NULL, 'a path outside this order''s folder is refused');
SELECT throws_ok($$ SELECT public.set_order_images('9d000000-0000-4000-8000-000000000001',
  '["https://new.example/b.jpg"]'::jsonb) $$,
  '22023', NULL, 'a new outside link is refused (only links the order had stay)');
SELECT throws_ok($$ SELECT public.set_order_images('9d000000-0000-4000-8000-000000000001',
  (SELECT jsonb_agg('ad000000-0000-4000-8000-000000000001/9d000000-0000-4000-8000-000000000001/' || g || '.webp') FROM generate_series(1, 7) g)) $$,
  '22023', NULL, 'seven photos are one too many');

SET LOCAL request.jwt.claims = '{"sub":"dd000000-0000-4000-8000-000000000002"}';
SELECT throws_ok($$ SELECT public.set_order_images('9d000000-0000-4000-8000-000000000001', '[]'::jsonb) $$,
  '42501', NULL, 'another shop cannot touch this order''s photos');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
