-- =============================================================================
--  إصلاح: تعليق مستأجر (status='inactive') لا يقطع وصوله الفعلي فوراً
--  (seen-deep-technical-audit.md -- حرج #6).
--  ------------------------------------------------------------------------
--  التحقق المباشر من البيانات الحقيقية (staging + production) أكّد أن
--  القيمة المستخدَمة فعلياً عند "تعليق" تاجر من SuperAdminDashboard.tsx هي
--  'inactive' (handleToggleStatus) -- لا 'suspended' كما قد يوحي اسم العمود
--  في الواجهة (تلك قيمة معروضة في التصميم فقط، لم تُستخدَم فعلياً في أي
--  بيانات حقيقية). الإنتاج فيه حالياً 27 مستأجراً 'active' ومستأجر واحد
--  'inactive' فقط -- لا وجود فعلي لأي قيمة أخرى.
--
--  app_current_tenant_id() هي الدالة الوحيدة التي تعتمد عليها كل سياسات
--  RLS تقريباً في المشروع لتحديد نطاق tenant_id -- إرجاع NULL منها بمجرد
--  تعليق المستأجر يقطع وصول كل الجداول فوراً (دفاع في العمق حقيقي على
--  مستوى الخادم)، بدل الاعتماد فقط على إعادة تحميل الصفحة أو انتهاء صلاحية
--  التوكن كما كان الحال سابقاً (AuthContext.tsx يتجاهل عمداً إعادة فحص
--  الهوية عند TOKEN_REFRESHED -- هذا سليم لأداء الواجهة، لكنه كان يعني أن
--  نافذة "ما زال يعمل رغم التعليق" قد تمتد لساعة كاملة؛ هذا الإصلاح يسدّها
--  من طبقة البيانات نفسها بغضّ النظر عن حالة الجلسة في المتصفح).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.app_current_tenant_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    t_id UUID;
    cur_uid TEXT;
    t_status TEXT;
BEGIN
    cur_uid := app_current_uid();
    IF cur_uid IS NULL THEN RETURN NULL; END IF;

    -- 1. Check if user is staff (Owner is often also staff)
    SELECT tenant_id INTO t_id FROM staff WHERE uid = cur_uid AND status = 'active' LIMIT 1;

    -- 2. Check if user is owner directly from tenants table
    IF t_id IS NULL THEN
        SELECT id INTO t_id FROM tenants WHERE owner_uid = cur_uid LIMIT 1;
    END IF;

    IF t_id IS NULL THEN RETURN NULL; END IF;

    -- 3. A suspended tenant has no active tenant scope at all -- every RLS
    -- policy keyed on this function stops matching any row for them.
    SELECT status INTO t_status FROM tenants WHERE id = t_id;
    IF t_status = 'inactive' THEN
        RETURN NULL;
    END IF;

    RETURN t_id;
END;
$$;
