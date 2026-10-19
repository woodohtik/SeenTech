-- =============================================================================
--  مراجعة-الفريق-التقني-الكامل-2026-10-19.md, نتيجة حرجة #2: ثلاثة جداول
--  مستخدَمة فعلياً في الكود (supplier_transactions, support_sessions,
--  support_access_requests) لا يوجد لها أي migration على الإطلاق -- تحقَّق
--  مباشرة عبر استعلام information_schema على staging أن الثلاثة غير موجودة
--  فعلياً في قاعدة البيانات الحية، لا مجرد غياب ملف توثيق.
--
--  supplier_transactions: التعريف منقول حرفياً من النص المضمَّن في
--  getLedgerSQLMigrationCode() (src/services/supplierAccountsService.ts) --
--  هذا هو SQL الذي كان يُفترَض لصقه يدوياً، أُضيف كـmigration حقيقي الآن.
--  بدون هذا الجدول، الكود يتراجع صامتاً إلى localStorage لكل متصفح/جهاز على
--  حدة (جهازا POS لنفس التاجر يريان رصيد مورد مختلفاً تماماً بلا أي تنبيه).
--
--  support_sessions / support_access_requests: لا تعريف موثَّق أصلاً؛ أُعيد
--  بناؤها من استخدامها الفعلي في AdminTailors.tsx, SuperAdminDashboard.tsx,
--  Layout.tsx, SupportConsentModal.tsx, TenantSupportHistory.tsx. تسجّلان
--  أخطر مسار في النظام: دخول مشرف المنصة "الخفي" لحساب تاجر (impersonation)
--  وطلبات/موافقات الدعم الفني الصريحة. بدونهما، سجل تدقيق هذا المسار لا
--  يُكتَب في أي مكان دائم على الإطلاق (المسار الاحتياطي في saas_settings لا
--  يُحتفَظ به كسجل تدقيق فعلي، فقط كمخزن JSON عام قابل للكتابة الكاملة).
--
--  RLS على الجدولين الأخيرين مقصورة على app_is_super_admin() فقط (لا قراءة
--  ولا كتابة لأي مستخدم تاجر عادي) -- هذا سجل تدقيق لعمليات منصة سِين نفسها،
--  ليس بيانات تاجر. supplier_transactions تبقى بنفس نمط عزل tenant_id
--  المعتاد (كما كان مكتوباً أصلاً في النص المضمَّن).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.supplier_transactions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    supplier_id      UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
    type             VARCHAR(30) NOT NULL CHECK (type IN ('purchase', 'payment', 'adjustment')),
    credit           NUMERIC(14,2) NOT NULL DEFAULT 0,
    debit            NUMERIC(14,2) NOT NULL DEFAULT 0,
    running_balance  NUMERIC(14,2) NOT NULL DEFAULT 0,
    reference_number VARCHAR(100) NOT NULL,
    date             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_transactions_supplier ON public.supplier_transactions(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_transactions_tenant   ON public.supplier_transactions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_supplier_transactions_date     ON public.supplier_transactions(date DESC);

ALTER TABLE public.supplier_transactions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY supplier_transactions_tenant_isolation ON public.supplier_transactions
      FOR ALL TO authenticated
      USING (app_is_super_admin() OR tenant_id = app_current_tenant_id())
      WITH CHECK (app_is_super_admin() OR tenant_id = app_current_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.support_sessions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    saas_user_id     UUID NOT NULL,
    saas_user_name   TEXT,
    access_type      VARCHAR(20) NOT NULL CHECK (access_type IN ('stealth', 'explicit')),
    started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at         TIMESTAMPTZ,
    duration_minutes INTEGER,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_sessions_tenant ON public.support_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_support_sessions_started ON public.support_sessions(started_at DESC);

ALTER TABLE public.support_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY support_sessions_super_admin_only ON public.support_sessions
      FOR ALL TO authenticated
      USING (app_is_super_admin())
      WITH CHECK (app_is_super_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.support_access_requests (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    saas_user_id   UUID NOT NULL,
    saas_user_name TEXT,
    status         VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    requested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at     TIMESTAMPTZ NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_access_requests_tenant ON public.support_access_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_support_access_requests_status ON public.support_access_requests(status);

ALTER TABLE public.support_access_requests ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY support_access_requests_super_admin_only ON public.support_access_requests
      FOR ALL TO authenticated
      USING (app_is_super_admin())
      WITH CHECK (app_is_super_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Realtime: SupportConsentModal.tsx subscribes to a 'support_access_requests'
-- postgres_changes channel -- needs this table in the realtime publication to
-- actually receive live updates (the channel name alone doesn't grant it).
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.support_access_requests;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
