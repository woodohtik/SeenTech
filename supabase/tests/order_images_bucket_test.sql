-- seen-order-images-upload-task.md, phase 1 (question 2's default): order
-- images live in a PRIVATE bucket, one folder per shop
-- (<tenantId>/<orderId>/<uuid>.webp). A shop's staff with the order
-- permissions may upload, read (to sign a link) and delete in their own
-- folder only; nobody else, and nothing without signing in.
--
--   CI:    supabase test db
--   Here:  npx tsx scripts/db/pgtap-linked.ts supabase/tests/order_images_bucket_test.sql   (staging, rolled back)
BEGIN;
SELECT plan(9);

SET session_replication_role = replica;
INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test) VALUES
  ('ac000000-0000-4000-8000-000000000001', 'Images Shop', 'img-shop@example.invalid', '0500000c01', 'active', true),
  ('ac000000-0000-4000-8000-000000000002', 'Images Other', 'img-other@example.invalid', '0500000c02', 'active', true);
INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status) VALUES
  ('cc000000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000001', 'dc000000-0000-4000-8000-000000000001', 'Owner', 'img-own@example.invalid', 'owner', NULL, 'active'),
  ('cc000000-0000-4000-8000-000000000002', 'ac000000-0000-4000-8000-000000000002', 'dc000000-0000-4000-8000-000000000002', 'Other', 'img-oth@example.invalid', 'owner', NULL, 'active'),
  ('cc000000-0000-4000-8000-000000000003', 'ac000000-0000-4000-8000-000000000001', 'dc000000-0000-4000-8000-000000000003', 'Accountant', 'img-acc@example.invalid', 'accountant', NULL, 'active');
SET session_replication_role = DEFAULT;

SELECT is((SELECT public FROM storage.buckets WHERE id = 'order-images'), false, 'the bucket is private');
SELECT is((SELECT file_size_limit FROM storage.buckets WHERE id = 'order-images'), 1048576::bigint, 'a file is 1 MB at most');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"dc000000-0000-4000-8000-000000000001"}';
SELECT lives_ok($$
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('order-images', 'ac000000-0000-4000-8000-000000000001/9c000000-0000-4000-8000-000000000001/a.webp', 'dc000000-0000-4000-8000-000000000001')
$$, 'the owner uploads into their own shop''s folder');
SELECT throws_ok($$
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('order-images', 'ac000000-0000-4000-8000-000000000002/9c000000-0000-4000-8000-000000000002/b.webp', 'dc000000-0000-4000-8000-000000000001')
$$, '42501', NULL, 'but not into another shop''s folder');
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'order-images'), 1, 'and reads its own image');

SET LOCAL request.jwt.claims = '{"sub":"dc000000-0000-4000-8000-000000000002"}';
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'order-images'), 0, 'another shop sees none of it');
SET LOCAL storage.allow_delete_query = 'true';  -- storage blocks direct deletes otherwise
DELETE FROM storage.objects WHERE bucket_id = 'order-images';
RESET ROLE;
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'order-images'), 1, 'nor can it delete it');

SET LOCAL ROLE anon;
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'order-images'), 0, 'nothing without signing in');
RESET ROLE;

-- A role without the order permissions (an accountant) cannot upload.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"dc000000-0000-4000-8000-000000000003"}';
SELECT throws_ok($$
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('order-images', 'ac000000-0000-4000-8000-000000000001/9c000000-0000-4000-8000-000000000001/c.webp', 'dc000000-0000-4000-8000-000000000003')
$$, '42501', NULL, 'a role without the order permissions cannot upload');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
