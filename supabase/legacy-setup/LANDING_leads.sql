-- جدول الـ leads لصفحة الهبوط (التقاط حجوزات العرض) + RLS
CREATE TABLE IF NOT EXISTS leads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  phone         text NOT NULL,
  business_type text,
  source        text DEFAULT 'landing',
  status        text DEFAULT 'new',     -- new | contacted | qualified | won | lost
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- يسمح للزائر (anon) بالإدخال فقط — لا قراءة، لا تعديل، لا حذف.
DROP POLICY IF EXISTS leads_anon_insert ON leads;
CREATE POLICY leads_anon_insert ON leads
  FOR INSERT TO anon
  WITH CHECK (true);

-- (اختياري) اسمح لمدراء المنصة بالقراءة — عدّل حسب نموذج أدوارك:
-- DROP POLICY IF EXISTS leads_admin_read ON leads;
-- CREATE POLICY leads_admin_read ON leads FOR SELECT TO authenticated
--   USING (app_is_super_admin());
