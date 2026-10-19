-- =============================================================================
--  مراجعة-الفريق-التقني-الكامل-2026-10-19.md (امتثال، متوسطة): قفل
--  prevent_tax_invoice_tamper (20260920020000) يستثني app_is_super_admin()
--  وcurrent_user IN ('postgres','service_role') من حماية عدم التعديل/الحذف
--  -- استثناء مقصود وضروري (دعم فني، صيانة طارئة)، لكن بلا أي سجل تدقيق
--  يوثّق متى/من استخدمه فعلياً على فاتورة حقيقية (غير تجريبية). هذا يسجّل
--  كل UPDATE/DELETE ناجح عبر هذا الاستثناء تحديداً في saas_security_logs
--  (نفس جدول التدقيق المستخدَم فعلياً لأحداث منصة مشابهة، مثل تبديل مزوّد
--  الذكاء الاصطناعي عند فشل) -- لا يغيّر أي سلوك مسموح به، فقط يجعله مرئياً.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.prevent_tax_invoice_tamper()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_is_test  boolean;
  v_acting_uid  text;
  v_acting_email citext;
BEGIN
  IF app_is_super_admin() OR current_user IN ('postgres', 'service_role') THEN
    -- التدقيق أفضل-جهد عمداً (BEGIN/EXCEPTION خاص به): فشل تسجيل السجل نفسه
    -- (مثلاً قيد غير متوقَّع لاحقاً) يجب ألا يحظر عملية صيانة حقيقية مشروعة
    -- بالفعل -- نفس فلسفة التسجيل في بقية هذا المشروع (logToolCall وغيرها).
    BEGIN
      v_acting_uid := app_current_uid();
      IF v_acting_uid IS NOT NULL THEN
        SELECT email INTO v_acting_email FROM public.users WHERE id = v_acting_uid;
      END IF;
      INSERT INTO public.saas_security_logs (user_id, user_email, action, details)
      VALUES (
        v_acting_uid,
        v_acting_email,
        'tax_invoice_tamper_bypass',
        format(
          '%s على tax_invoices.id=%s (order_id=%s) عبر استثناء %s -- خارج القفل العادي لعدم تعديل/حذف الفواتير الضريبية الصادرة',
          TG_OP, COALESCE(NEW.id, OLD.id), OLD.order_id,
          CASE WHEN app_is_super_admin() THEN 'super_admin' ELSE 'service_role/postgres' END
        )
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT is_test INTO v_is_test FROM public.orders WHERE id = OLD.order_id;
  IF COALESCE(v_is_test, false) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  RAISE EXCEPTION 'الفواتير الضريبية الصادرة سجل ثابت -- لا يمكن تعديلها أو حذفها مباشرة بعد الإصدار'
    USING ERRCODE = '42501';
END;
$$;
