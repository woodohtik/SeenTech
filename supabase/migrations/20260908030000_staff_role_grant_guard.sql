-- =============================================================================
--  إغلاق ثغرة تصعيد صلاحيات حقيقية على جدول staff
--  (seen-comprehensive-review-fixes-task.md, بند 2.2 -- "أخطر بند بالملف")
--  ------------------------------------------------------------------------
--  فحص حي لسياسات RLS الفعلية على staff (pg_policies، هذه الجلسة) أكّد:
--
--   - staff_tenant_insert: WITH CHECK فقط tenant_id = app_current_tenant_id()
--     -- لا قيد على قيمة role إطلاقاً. أي موظف بالمستأجر (حتى كاشير) يقدر
--     يُدخل صفاً جديداً بـ role='super_admin' أو 'owner'/'admin' لنفسه أو
--     لأي uid آخر.
--   - staff_tenant_update: نفس القيد فقط (tenant_id match) -- المُشغِّل
--     staff_no_self_escalation_trigger (20260822090100) يمنع تعديل صفّك
--     الشخصي فقط (OLD.uid = app_current_uid())، ولا يمنع تعديل صف زميل
--     آخر لمنحه role مرتفعاً.
--   - staff_onboarding_insert: يستثني owner/admin فقط من self-insert،
--     يترك أدوار المنصّة (super_admin, support_tech, billing_admin) بلا
--     قيد.
--
--  هذا المُشغِّل يغلق الثلاثة معاً بفحص قيمة role نفسها بغضّ النظر عن الصف
--  المستهدَف: أدوار المنصّة تتطلب app_is_super_admin() فعلياً؛ owner/admin
--  تتطلب أن يكون الفاعل نفسه owner أو admin بالفعل (عبر app_current_role()،
--  الذي يرجع 'owner' لمالك المستأجر حتى قبل إنشاء صفّه في staff -- هذا ما
--  يُبقي مسارات onboarding الثلاثة (Login.tsx/Onboarding.tsx/App.tsx) التي
--  تُنشئ صف tenants بـ owner_uid ثم صف staff بـ role='owner' تعمل بلا مشاكل).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.staff_role_grant_guard() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role text;
BEGIN
  IF app_is_super_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;

  IF NEW.role::text IN ('super_admin', 'support_tech', 'billing_admin') THEN
    RAISE EXCEPTION 'لا يمكن منح دور منصّة (%) بدون صلاحية super_admin فعلية', NEW.role
      USING ERRCODE = '42501';
  END IF;

  IF NEW.role::text IN ('owner', 'admin') THEN
    actor_role := app_current_role();
    IF actor_role IS NULL OR actor_role NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'لا يمكن منح دور % بدون أن يكون المستخدم الحالي owner أو admin بالفعل', NEW.role
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff_role_grant_guard_insert ON public.staff;
CREATE TRIGGER staff_role_grant_guard_insert
BEFORE INSERT ON public.staff
FOR EACH ROW EXECUTE FUNCTION public.staff_role_grant_guard();

DROP TRIGGER IF EXISTS staff_role_grant_guard_update ON public.staff;
CREATE TRIGGER staff_role_grant_guard_update
BEFORE UPDATE ON public.staff
FOR EACH ROW EXECUTE FUNCTION public.staff_role_grant_guard();
