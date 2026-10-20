-- seen-admin-reengineering-task.md بند 4 -- AdminTailors.tsx كان يجلب
-- *كل* صفوف orders.paid_amount في كل المنصة (supabase.from('orders').select
-- ('paid_amount') بلا أي حد) فقط ليجمعها في المتصفح لعرض رقمين: إجمالي عدد
-- الطلبات وإجمالي الإيرادات. دالة واحدة تحسب المجموع في قاعدة البيانات
-- وتُرجع صفاً واحداً، بدل نقل كل صف طلب عبر الشبكة. SECURITY DEFINER لأنها
-- تقرأ عبر كل تجّار المنصة، فالتحقق من app_is_super_admin() داخل الدالة
-- نفسها إلزامي (نفس نمط 20260816_referral_program_authz_fixes.sql) -- لا
-- يكفي افتراض أن واجهة الاستدعاء الوحيدة ستبقى محصورة بالسوبر أدمن.

CREATE OR REPLACE FUNCTION public.get_platform_order_summary()
RETURNS TABLE(total_orders BIGINT, total_revenue NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT app_is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: only a super admin may read platform-wide order summaries';
  END IF;

  RETURN QUERY
  SELECT COUNT(*)::BIGINT, COALESCE(SUM(paid_amount), 0)::NUMERIC
  FROM public.orders;
END;
$$;

REVOKE ALL ON FUNCTION public.get_platform_order_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_platform_order_summary() TO authenticated;
