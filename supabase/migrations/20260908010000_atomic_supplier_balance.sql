-- =============================================================================
--  زيادة/نقصان ذرّي على رصيد المورد (seen-comprehensive-review-fixes-task.md,
--  بند 1.6)
--  ------------------------------------------------------------------------
--  addSupplierTransaction في supplierAccountsService.ts كانت تقرأ
--  suppliers.balance (currentBalance يُمرَّر من المستدعي، مقروء مسبقاً في
--  استعلام منفصل)، تحسب newBalance في الكود، ثم تكتبها فوق balance مباشرة.
--  عمليتان متزامنتان لنفس المورد (أمر شراء + سند دفع خلال أجزاء من الثانية)
--  تقرآن نفس currentBalance وتكتب كل منهما فوق الأخرى -- إحداهما تُفقَد
--  بصمت. هذه الدالة تُطبَّق فرقاً نسبياً (delta) ذرّياً على مستوى القاعدة
--  بدل الاعتماد على قراءة جانب العميل.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.increment_supplier_balance(
  p_supplier_id uuid,
  p_delta numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant  uuid;
  v_new     numeric;
BEGIN
  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.suppliers
     SET balance = round(COALESCE(balance, 0) + COALESCE(p_delta, 0), 2)
   WHERE id = p_supplier_id
     AND tenant_id = v_tenant
  RETURNING balance INTO v_new;

  IF v_new IS NULL THEN
    RAISE EXCEPTION 'supplier not found' USING ERRCODE = '02000';
  END IF;

  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_supplier_balance(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_supplier_balance(uuid, numeric) TO authenticated, service_role;
