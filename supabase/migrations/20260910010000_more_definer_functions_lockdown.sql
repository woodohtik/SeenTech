-- =============================================================================
--  إغلاق المزيد من الثغرات المكتشَفة أثناء الفحص الشامل لكل دالة في المشروع
--  (seen-master-backlog-and-structure.md، P0 بند 2)
--  ------------------------------------------------------------------------
--  فحص حي شامل (pg_proc + information_schema.routine_privileges لكل دالة
--  في public) وجد ثلاث مجموعات إضافية من نفس فئة المشكلة:
--
--  1) assistant_get_sales_summary/revenue_report/daily_closing/
--     low_stock_alerts/top_selling_items: كلها SECURITY DEFINER تقرأ
--     WHERE tenant_id = p_tenant_id بلا أي تحقق من app_current_tenant_id()
--     إطلاقاً، وكانت قابلة للاستدعاء من anon مباشرة -- أي زائر غير مسجَّل
--     يقدر يطلب تقرير إيرادات/مبيعات/إغلاق يومي/مخزون منخفض/الأصناف
--     الأكثر مبيعاً لأي مستأجر يعرف uuid ـه، بلا أي دخول إطلاقاً. الاستدعاء
--     الشرعي الوحيد (assistantTools.ts) يمرّ عبر supabaseAdmin (service_role)
--     من السيرفر، فلا حاجة لأي صلاحية عميل هنا مطلقاً.
--
--  2) increment_assistant_usage: SECURITY DEFINER بلا أي تحقق من tenant_id
--     الفاعل، قابلة للاستدعاء من anon/authenticated مباشرة -- أي طرف يقدر
--     يُضخِّم عدّاد استخدام المساعد الذكي لأي مستأجر آخر (استنزاف حصة/تكلفة
--     محتملة). الاستدعاء الشرعي الوحيد (server.ts) عبر supabaseAdmin أيضاً.
--
--  3) bootstrap_tenant_owner: يتحقق فقط أن المستأجر بلا أي staff حالياً --
--     لا يتحقق أن الفاعل هو owner_uid المُسجَّل فعلاً لهذا المستأجر. أي
--     مستخدم مصادَق (ليس بالضرورة صاحب علاقة حقيقية بهذا المستأجر) يقدر
--     يستدعيها مباشرة بـp_tenant_id لأي مستأجر آخر لا يزال بلا موظفين (نافذة
--     حقيقية أثناء onboarding أي مستخدم آخر) ويصبح owner له. الاستدعاء
--     الشرعي (ForcePinSetup.tsx) يمرّر tenantId المُستخرَج من جلسة المستخدم
--     نفسه، الذي يعني أصلاً أن tenants.owner_uid يساويه بالفعل في كل مسار
--     شرعي وصل لهذه الشاشة -- إضافة هذا الشرط لا يكسر شيئاً شرعياً.
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.assistant_get_sales_summary(uuid, date, date) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assistant_get_revenue_report(uuid, date, date) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assistant_get_daily_closing(uuid, date) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assistant_get_low_stock_alerts(uuid, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assistant_get_top_selling_items(uuid, date, date, integer) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.increment_assistant_usage(text) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.bootstrap_tenant_owner(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  existing_count int;
  cur_uid text;
  tenant_owner_uid text;
BEGIN
  cur_uid := app_current_uid();
  IF cur_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT owner_uid INTO tenant_owner_uid FROM tenants WHERE id = p_tenant_id;
  IF tenant_owner_uid IS DISTINCT FROM cur_uid THEN
    RAISE EXCEPTION 'forbidden: not the registered owner of this tenant' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO existing_count FROM staff WHERE tenant_id = p_tenant_id;
  IF existing_count > 0 THEN
    RAISE EXCEPTION 'tenant already has staff -- cannot self-bootstrap as owner';
  END IF;

  INSERT INTO staff (uid, tenant_id, role, status, name, email, phone, created_at)
  SELECT
    cur_uid,
    p_tenant_id,
    'owner',
    'active',
    COALESCE(NULLIF(current_setting('request.jwt.claims', true)::jsonb -> 'user_metadata' ->> 'full_name', ''), t.name, 'مالك المتجر'),
    COALESCE(t.owner_email::text, ''),
    COALESCE(t.phone, ''),
    now()
  FROM tenants t
  WHERE t.id = p_tenant_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.bootstrap_tenant_owner(uuid) FROM anon;
