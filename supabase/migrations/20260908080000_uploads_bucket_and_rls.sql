-- =============================================================================
--  إنشاء bucket "uploads" + سياسات RLS تفرض ملكية المستأجر على مسار الرفع
--  (seen-comprehensive-review-fixes-task.md، بند 3، src/lib/supabase/storage.ts)
--  ------------------------------------------------------------------------
--  فحص حي (هذه الجلسة): لا يوجد bucket واحد على staging إطلاقاً (storage.
--  buckets فارغ تماماً)، رغم أن الكود (uploadImageToSupabase) يفترض وجود
--  bucket باسم "uploads" ويتحمَّل الفشل بصمت عبر رجوع تلقائي لتضمين الصورة
--  Base64 مباشرة في القاعدة -- أي أن رفع الصور معطَّل فعلياً على staging
--  حالياً (كل صورة تُحوَّل لنص Base64 ضخم بدل رابط CDN حقيقي).
--
--  هذا الملف يُنشئ الـbucket (قراءة عامة، يطابق getPublicUrl المستخدَم في
--  الكود) + سياسات RLS على storage.objects تفرض أن مسار الرفع (folder) يبدأ
--  بمعرّف مستأجر الطالب فعلياً لمساري tenants/<tenantId>/... وproducts/
--  <tenantId>/...، بدل قبول أي folder يُمرَّر من العميل بلا أي تحقق (الثغرة
--  التي وصفها الملف: يقدر أي مستخدم مصادَق يمرّر tenant_id مستأجر آخر
--  فيكتب داخل مجلده). مسار logos/* يبقى مسموحاً لأي مستخدم مصادَق فقط (بلا
--  ربط بمستأجر) لأنه يُستخدَم أثناء onboarding قبل وجود صف tenant فعلي.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('uploads', 'uploads', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS uploads_public_read ON storage.objects;
CREATE POLICY uploads_public_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'uploads');

DROP POLICY IF EXISTS uploads_scoped_insert ON storage.objects;
CREATE POLICY uploads_scoped_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'uploads'
    AND (
      ((storage.foldername(name))[1] = 'tenants'  AND (storage.foldername(name))[2] = public.app_current_tenant_id()::text)
      OR ((storage.foldername(name))[1] = 'products' AND (storage.foldername(name))[2] = public.app_current_tenant_id()::text)
      OR ((storage.foldername(name))[1] = 'logos' AND public.app_current_uid() IS NOT NULL)
    )
  );

-- لا سياسة UPDATE/DELETE: uploadImageToSupabase يستخدم upsert:false ولا يوجد
-- أي مسار حذف/استبدال ملف من واجهة المستخدم حالياً -- المنع الافتراضي (RLS
-- مفعَّلة، لا سياسة) يطابق تماماً السلوك الحالي المطلوب.
