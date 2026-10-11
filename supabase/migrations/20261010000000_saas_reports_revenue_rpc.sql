-- SaaSReports.tsx (شاشة "التقارير المالية" في داشبورد سوبر أدمن) كانت تسحب
-- كل صف من جدول orders (أكبر جدول في المخطط) بلا أي فلترة تاريخ أو حد أقصى،
-- ثم تحسب إجمالي الإيرادات والرسم الشهري بـ reduce في المتصفح -- مع مئات
-- التجّار هذا يتحول لجلب مئات الآلاف من الصفوف في كل مرة تُفتح فيها الصفحة.
-- هذه الدالة تنقل الجمع (SUM/GROUP BY) إلى SQL فيرجع فقط النتيجة المُجمَّعة.
-- super_admin فقط -- نفس نمط process_withdrawal (20260816_referral_program_authz_fixes.sql).
CREATE OR REPLACE FUNCTION get_saas_revenue_report()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_total_revenue numeric;
  v_monthly jsonb;
BEGIN
  IF NOT app_is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: super admin only';
  END IF;

  SELECT COALESCE(SUM(total_amount), 0) INTO v_total_revenue FROM orders;

  -- آخر 12 شهراً كافية لعرض آخر 6 أشهر في الرسم البياني (الواجهة تأخذ
  -- slice(-6))، مع هامش أمان لو كان الشهر الحالي ناقص البيانات.
  SELECT COALESCE(jsonb_agg(m ORDER BY m.month_start), '[]'::jsonb) INTO v_monthly
  FROM (
    SELECT date_trunc('month', order_date) AS month_start,
           SUM(total_amount) AS revenue
    FROM orders
    WHERE order_date >= date_trunc('month', now()) - interval '11 months'
    GROUP BY date_trunc('month', order_date)
  ) m;

  RETURN jsonb_build_object('total_revenue', v_total_revenue, 'monthly', v_monthly);
END; $$;

REVOKE EXECUTE ON FUNCTION get_saas_revenue_report() FROM anon;
