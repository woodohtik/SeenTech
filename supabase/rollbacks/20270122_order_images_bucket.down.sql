-- Rollback of 20270122000000_order_images_bucket.sql: the policies go; the
-- bucket stays (it may hold images -- empty it through the Storage API first,
-- then delete it from the dashboard if it is to go too).
DROP POLICY IF EXISTS order_images_read ON storage.objects;
DROP POLICY IF EXISTS order_images_upload ON storage.objects;
DROP POLICY IF EXISTS order_images_delete ON storage.objects;
