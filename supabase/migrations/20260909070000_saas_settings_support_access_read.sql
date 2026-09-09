-- =============================================================================
--  استعادة قراءة saas_settings.support_access_requests لـowner/admin
--  (ultra-review -- انحدار أدخلته 20260909000000 لهذه الجلسة نفسها)
--  ------------------------------------------------------------------------
--  SupportConsentModal.tsx (يُعرَض فقط لـowner/admin) يقرأ المفتاح
--  support_access_requests من saas_settings كـfallback عندما يفشل استعلام
--  support_access_requests الأساسي. تضييق القراءة إلى key='branding' فقط
--  (20260909000000) كسر هذا الـfallback تماماً لـowner/admin بلا أي خطأ
--  ظاهر (RLS تُرجع صفوفاً فارغة بصمت). يوسِّع هذا الملف القراءة لتشمل
--  support_access_requests لـowner/admin تحديداً، مع بقاء أي مفتاح آخر
--  (temp_passwords، support_sessions...) مقصوراً على super_admin فقط.
-- =============================================================================

DROP POLICY IF EXISTS saas_settings_public_read ON public.saas_settings;
CREATE POLICY saas_settings_public_read ON public.saas_settings
  FOR SELECT TO authenticated
  USING (
    app_is_super_admin()
    OR key = 'branding'
    OR (key = 'support_access_requests' AND app_current_role() IN ('owner', 'admin'))
  );
