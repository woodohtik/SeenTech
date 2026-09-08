-- =============================================================================
--  منع تجاوز إشعارات الدائن/الاسترجاعات لإجمالي الفاتورة الأصلي
--  (seen-comprehensive-review-fixes-task.md, بند 1.8)
--  ------------------------------------------------------------------------
--  CreditNotes.tsx كان يتحقق فقط أن المبلغ الجديد ≤ إجمالي الفاتورة
--  الأصلي، بلا أي اطّلاع على إشعارات دائنة سابقة على نفس الفاتورة --
--  إصدار عدة إشعارات، كل منها ضمن الحد فردياً، يمكن أن يتجاوز مجموعها
--  الإجمالي الفعلي بلا أي مانع. sales_returns هو نفس الجدول المستخدَم أيضاً
--  للاسترجاعات العادية (SalesReturns.tsx)، فالحارس هنا على مستوى القاعدة
--  (trigger، لا فحص عميل) يغطي الحالتين معاً بدل تكرار المنطق في كل مكان
--  يكتب لهذا الجدول.
--
--  قفل استشاري (pg_advisory_xact_lock) على معرّف الفاتورة يسلسل أي
--  إدراجات متزامنة لنفس invoice_id -- بدونه، معاملتان متزامنتان تقرآن
--  نفس المجموع السابق (كل منهما لا ترى صف الأخرى غير المُلتَزَم بعد)
--  وتتجاوزان الحد معاً رغم فحص كل منهما على حدة.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.check_sales_return_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_total numeric;
  v_prior_sum     numeric;
BEGIN
  IF NEW.invoice_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.invoice_id::text));

  -- invoice_id يشير أحياناً لـ order.id بدل tax_invoices.id فعلي (سلوك
  -- SalesReturns.tsx القائم: invoiceId = invoiceData?.id || order.id) --
  -- إن لم يُطابق صفاً حقيقياً في tax_invoices، لا حد معروف يُفرَض هنا.
  SELECT total_amount INTO v_invoice_total FROM public.tax_invoices WHERE id = NEW.invoice_id;
  IF v_invoice_total IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(refunded_amount), 0) INTO v_prior_sum
  FROM public.sales_returns
  WHERE invoice_id = NEW.invoice_id;

  IF v_prior_sum + COALESCE(NEW.refunded_amount, 0) > v_invoice_total THEN
    RAISE EXCEPTION 'مجموع الاسترجاعات/إشعارات الدائن لهذه الفاتورة (%) يتجاوز إجماليها (%)',
      v_prior_sum + NEW.refunded_amount, v_invoice_total USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_sales_return_total ON public.sales_returns;
CREATE TRIGGER trg_check_sales_return_total
  BEFORE INSERT ON public.sales_returns
  FOR EACH ROW EXECUTE FUNCTION public.check_sales_return_total();
