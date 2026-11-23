-- seen-readiness-fixes-task.md P6 -- read access to the uploads bucket's
-- rows follows the same scope as uploading.
--
-- Reading the bucket's rows (listing, the RETURNING of an upload) is
-- limited to what the user could have uploaded: their own shop's folders,
-- the logos they own, and the blog for the super admin. The images
-- themselves keep working: the bucket stays public, and a public object URL
-- (/storage/v1/object/public/uploads/...) does not go through these policies.
-- Rollback: supabase/rollbacks/20270107_uploads_no_public_listing.down.sql

DROP POLICY IF EXISTS uploads_public_read ON storage.objects;
DROP POLICY IF EXISTS uploads_scoped_read ON storage.objects;
CREATE POLICY uploads_scoped_read ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'uploads' AND (
       ((storage.foldername(name))[1] IN ('tenants', 'products') AND (storage.foldername(name))[2] = (app_current_tenant_id())::text)
    OR ((storage.foldername(name))[1] = 'logos' AND owner_id = (auth.uid())::text)
    OR ((storage.foldername(name))[1] = 'blog' AND app_is_super_admin())
  )
);
