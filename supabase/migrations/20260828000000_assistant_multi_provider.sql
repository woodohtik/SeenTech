-- =============================================================================
--  توسعة "مساعد سين الذكي" لدعم عدة مزوّدي ذكاء اصطناعي (Multi-Provider)
--  ------------------------------------------------------------------------
--  بدل مفتاح API واحد ثابت داخل assistant_settings، لكل مزوّد الآن صف خاص
--  به في assistant_provider_credentials (مفتاح مشفّر منفصل + حالة اختبار
--  اتصال خاصة به). assistant_settings يحتفظ فقط بـ "أيّ مزوّد نشط حالياً"
--  (active_provider/active_model) وترتيب احتياطي (fallback_order) يُستخدم
--  عند فشل المزوّد النشط. نفس نمط الوصول الحالي لكل جداول المساعد:
--  service_role فقط من السيرفر (supabaseAdmin)، بلا سياسات RLS لـ
--  anon/authenticated.
-- =============================================================================

CREATE TABLE IF NOT EXISTS assistant_provider_credentials (
  provider_key      text PRIMARY KEY,
  api_key_encrypted text,
  is_configured     boolean NOT NULL DEFAULT false,
  last_tested_at    timestamptz,
  last_test_status  text,        -- 'success' | 'failed' | NULL (لم يُختبر بعد)
  last_test_message text,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        text
);

ALTER TABLE assistant_settings ADD COLUMN IF NOT EXISTS active_provider text;
ALTER TABLE assistant_settings ADD COLUMN IF NOT EXISTS active_model text;
ALTER TABLE assistant_settings ADD COLUMN IF NOT EXISTS fallback_order text[] NOT NULL DEFAULT '{}';

-- نقل بيانات المزوّد الحالي (إن وُجدت) إلى الجدول الجديد قبل حذف الأعمدة
-- القديمة، حتى لا يفقد أي تاجر وصول المساعد فور نشر هذه المهاجرة. المفتاح
-- المنقول يُعتبر "غير مُختبَر بعد" (last_test_status = NULL) حتى يُعاد
-- اختباره صراحةً من لوحة السوبر أدمن -- الاختبار السابق (قبل هذا الملف) لم
-- يُسجَّل بهذا الشكل أصلاً.
INSERT INTO assistant_provider_credentials (provider_key, api_key_encrypted, is_configured, updated_at, updated_by)
SELECT ai_provider, api_key_encrypted, (api_key_encrypted IS NOT NULL), updated_at, updated_by
FROM assistant_settings
WHERE id = 'global' AND ai_provider IS NOT NULL
ON CONFLICT (provider_key) DO NOTHING;

UPDATE assistant_settings
SET active_provider = COALESCE(active_provider, ai_provider, 'gemini'),
    active_model = COALESCE(active_model, model_name, 'gemini-3.6-flash')
WHERE id = 'global';

ALTER TABLE assistant_settings ALTER COLUMN active_provider SET NOT NULL;
ALTER TABLE assistant_settings ALTER COLUMN active_model SET NOT NULL;
ALTER TABLE assistant_settings ALTER COLUMN active_provider SET DEFAULT 'gemini';
ALTER TABLE assistant_settings ALTER COLUMN active_model SET DEFAULT 'gemini-3.6-flash';

ALTER TABLE assistant_settings DROP COLUMN IF EXISTS ai_provider;
ALTER TABLE assistant_settings DROP COLUMN IF EXISTS model_name;
ALTER TABLE assistant_settings DROP COLUMN IF EXISTS api_key_encrypted;

ALTER TABLE assistant_provider_credentials ENABLE ROW LEVEL SECURITY;
-- عمداً بلا أي سياسة: الوصول حصراً عبر مفتاح service_role من السيرفر
-- (supabaseAdmin في src/server/supabase-admin.ts)، الذي يتجاوز RLS أصلاً.
