-- Rollback of 20270107000000_uploads_no_public_listing.sql
DROP POLICY IF EXISTS uploads_scoped_read ON storage.objects;
CREATE POLICY uploads_public_read ON storage.objects FOR SELECT TO public USING (bucket_id = 'uploads');
