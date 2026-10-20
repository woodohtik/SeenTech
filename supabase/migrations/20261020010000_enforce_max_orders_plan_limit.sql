-- =============================================================================
--  seen-admin-reengineering-task.md بند 8 -- plans.max_orders مُدرَج ومُتحقَّق
--  منه فقط كقيد CHECK رقمي غير سالب عند إنشاء/تعديل الباقة نفسها
--  (20261017020000_add_missing_check_constraints.sql + src/utils/planValidation.ts)،
--  بلا أي عدّاد طلبات فعلي يفرضه -- بعكس max_staff المفروض فعلياً عبر
--  enforce_staff_plan_limit() (20261017010000). هذا نفس النمط بالضبط، على
--  جدول orders بدل staff، بحد شهري (الشهر التقويمي الحالي) بدل حد لحظي.
--
--  Trigger واحد على INSERT يغطي كل مسارات إنشاء الطلب (create_pos_sale،
--  وأي إدراج مباشر من شاشة الطلبات اليدوية) بلا الحاجة لتكرار الفحص في كل
--  مسار على حدة -- نفس فائدة enforce_staff_plan_limit الأصلية.
--
--  الطلبات الملغاة (status = 'cancelled') لا تُحتسَب ضمن الحد، بنفس منطق
--  استثناء الموظفين غير النشطين هناك. لا plan_id أو لا max_orders على الباقة
--  = لا حد مطبَّق، نفس سلوك اليوم.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enforce_orders_plan_limit() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_id    text;
  v_max_orders int;
  v_current    int;
BEGIN
  IF NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  SELECT plan_id INTO v_plan_id FROM public.tenants WHERE id = NEW.tenant_id;
  IF v_plan_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT max_orders INTO v_max_orders FROM public.plans WHERE id = v_plan_id;
  IF v_max_orders IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_current
    FROM public.orders
   WHERE tenant_id = NEW.tenant_id
     AND status <> 'cancelled'
     AND order_date >= date_trunc('month', now());

  IF v_current >= v_max_orders THEN
    -- Kept short (<100 chars) on purpose: getFriendlyErrorMessage
    -- (src/lib/firebase.ts) passes a Postgres error message straight
    -- through to the toast only below that length, else it falls back
    -- to a fully generic message.
    RAISE EXCEPTION 'تجاوزت باقتك الحد الأقصى لعدد الطلبات الشهرية (%)', v_max_orders
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_orders_plan_limit_insert ON public.orders;
CREATE TRIGGER enforce_orders_plan_limit_insert
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_orders_plan_limit();
