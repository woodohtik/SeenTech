-- seen-order-images-upload-task.md, phase 1 (question 2's default): order
-- images in a PRIVATE bucket -- a customer's garment, or the customer, may be
-- in them (PDPL). Shown through signed links that last an hour.
--
-- Path: <tenantId>/<orderId>/<uuid>.webp. The shop's staff with the order
-- permissions read (to sign a link), upload and delete in their own shop's
-- folder only. 1 MB a file (the app compresses to <= 400 KB); WebP or JPEG.
--
-- Test: supabase/tests/order_images_bucket_test.sql
-- Rollback: supabase/rollbacks/20270122_order_images_bucket.down.sql

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('order-images', 'order-images', false, 1048576, ARRAY['image/webp', 'image/jpeg'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 1048576, allowed_mime_types = ARRAY['image/webp', 'image/jpeg'];

DROP POLICY IF EXISTS order_images_read ON storage.objects;
CREATE POLICY order_images_read ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'order-images'
  AND (storage.foldername(name))[1] = (app_current_tenant_id())::text
  AND (app_has_permission('orders.view') OR app_has_permission('orders.create') OR app_has_permission('orders.edit'))
);

DROP POLICY IF EXISTS order_images_upload ON storage.objects;
CREATE POLICY order_images_upload ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'order-images'
  AND (storage.foldername(name))[1] = (app_current_tenant_id())::text
  AND (app_has_permission('orders.create') OR app_has_permission('orders.edit'))
);

DROP POLICY IF EXISTS order_images_delete ON storage.objects;
CREATE POLICY order_images_delete ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'order-images'
  AND (storage.foldername(name))[1] = (app_current_tenant_id())::text
  AND (app_has_permission('orders.create') OR app_has_permission('orders.edit'))
);
