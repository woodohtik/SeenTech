-- seen-cto-sprint0-critical-fixes-task.md item 5 (DB2-16, ZAT-07, DB1-19).
-- Full findings read from cto-review-2026-11-13/06-db-part2.md (DB2-16),
-- 02-zatca-invoices.md (ZAT-07), 05-db-part1.md (DB1-19) before writing
-- this migration, per the task's own instruction.

-- -----------------------------------------------------------------------
-- 1) DB1-19: REVOKE the generic tenant-wide INSERT/UPDATE/DELETE policies
--    on tax_invoices -- any tenant member could insert/forge an arbitrary
--    invoice_hash/previous_invoice_hash (wedging the real PIH chain) or
--    update/delete a real issued invoice (the immutability trigger only
--    protects it AFTER insert, and only partially -- see ZAT-07 below).
--    All legitimate inserts already go through create_pos_sale (SECURITY
--    DEFINER). Keeps tax_invoices_tenant_read untouched (needed by the
--    tax-invoice registry).
--
--    Grep found a SECOND direct writer the task's own text didn't know
--    about: src/services/taxInvoiceService.ts's syncTaxInvoicePaidAmount
--    (added this same session, for POS's debt-settlement feature) does a
--    plain client UPDATE of tax_invoices.paid_amount. Live-tested before
--    writing this migration: prevent_tax_invoice_tamper ALREADY blocks it
--    today for any real (non-test) order, for any non-super_admin caller
--    -- confirmed via `update tax_invoices set paid_amount=1 ...` as a
--    real tenant owner, which already throws "الفواتير الضريبية الصادرة
--    سجل ثابت...". That silent failure surfaces to the cashier as a
--    generic error toast even though the orders.paid_amount update (which
--    runs first) already succeeded. Replacing it with a SECURITY DEFINER
--    RPC fixes this regression AND is what item 5 requires regardless
--    (the raw client path has to go either way).
-- -----------------------------------------------------------------------

DROP POLICY IF EXISTS tax_invoices_tenant_insert ON public.tax_invoices;
DROP POLICY IF EXISTS tax_invoices_tenant_update ON public.tax_invoices;
DROP POLICY IF EXISTS tax_invoices_tenant_delete ON public.tax_invoices;

CREATE OR REPLACE FUNCTION public.sync_tax_invoice_paid_amount(p_order_id uuid, p_paid_amount numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    app_is_super_admin()
    OR EXISTS (SELECT 1 FROM orders o WHERE o.id = p_order_id AND o.tenant_id = app_current_tenant_id())
  ) THEN
    RAISE EXCEPTION 'لا يمكنك تعديل فاتورة هذا الطلب' USING ERRCODE = '42501';
  END IF;

  UPDATE tax_invoices SET paid_amount = p_paid_amount, updated_at = now()
  WHERE order_id = p_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_tax_invoice_paid_amount(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_tax_invoice_paid_amount(uuid, numeric) TO authenticated;

-- -----------------------------------------------------------------------
-- 2) ZAT-07 / DB2-16: orders.is_test had NO column guard at all (only
--    tenants.is_test is protected, 20260908040000:44) -- any staff member
--    could flip a real order's is_test to true, then (before part 3
--    below) freely UPDATE/DELETE its real, already-issued tax invoice
--    through prevent_tax_invoice_tamper's own is_test exemption.
-- -----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.orders_protect_is_test() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF app_is_super_admin() OR current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;

  IF NEW.is_test IS DISTINCT FROM OLD.is_test THEN
    RAISE EXCEPTION 'لا يمكن تغيير وضع (تجربة) لطلب بعد إنشائه' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_protect_is_test_trigger ON public.orders;
CREATE TRIGGER orders_protect_is_test_trigger
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_protect_is_test();

-- -----------------------------------------------------------------------
-- 3) prevent_tax_invoice_tamper: removed the standalone "order.is_test ->
--    anyone may edit/delete" branch entirely. It was a SEPARATE exemption
--    from the super_admin/service_role check above it, reachable by any
--    tenant member -- the actual ZAT-07 exploit path (now closed twice
--    over, since part 2 also stops is_test from being flipped in the
--    first place). Per the task's own wording ("لا يستثني is_test إلا
--    للسوبر أدمن"): super_admin already has an unconditional bypass above
--    this, so folding the is_test case into "super_admin only" is the
--    same as deleting the separate branch -- nothing else used it
--    (confirmed: no code in src/ relies on a non-super_admin editing a
--    real tax_invoices row via the is_test path; item 6 separately
--    converts trialService.ts's deleteTestDataForTenant, the one caller
--    that touched test invoices at all, to its own SECURITY DEFINER RPC).
--
--    Also stops swallowing the audit-insert failure ("لا تبتلع الخطأ"):
--    a failed audit write now fails the whole bypass operation instead of
--    silently vanishing. Scoped to the super_admin path only (not
--    service_role/postgres) -- DB2-16 itself flagged that logging every
--    routine service-role call (e.g. server.ts's frequent zatca_status/
--    invoice_hash updates) as a "tamper bypass" would bury real events in
--    noise, and making every one of those routine calls hard-fail on a
--    transient audit-insert hiccup is a real availability risk to the
--    live ZATCA submission pipeline. A super_admin manually overriding
--    immutability is rare and human -- exactly what's worth auditing
--    strictly; routine service-role writes are not.
-- -----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prevent_tax_invoice_tamper()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_acting_uid    text;
  v_acting_email  citext;
BEGIN
  IF app_is_super_admin() THEN
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
        '%s على tax_invoices.id=%s (order_id=%s) عبر استثناء super_admin -- خارج القفل العادي لعدم تعديل/حذف الفواتير الضريبية الصادرة',
        TG_OP, COALESCE(NEW.id, OLD.id), OLD.order_id
      )
    );
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF current_user IN ('postgres', 'service_role') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  RAISE EXCEPTION 'الفواتير الضريبية الصادرة سجل ثابت -- لا يمكن تعديلها أو حذفها مباشرة بعد الإصدار'
    USING ERRCODE = '42501';
END;
$$;
