-- seen-readiness-fixes-task.md P5 (PLATFORM-08) -- a shop's data is exported
-- before it is deleted, and its tax documents outlive it.
--
-- Before: permanently_delete_tenant deleted the tenant and, by cascade,
-- every tax invoice and credit note with it; there was no export at all
-- (the super admin's "export" button did nothing).
--
--  * tenant_data_exports: a JSON export of one shop's business records (no
--    foreign key to tenants, so it survives the deletion). Super admin reads
--    all; an owner reads their own. Secrets are not exported (PIN hashes,
--    tracking / measurement tokens; ZATCA keys and push tokens live in
--    tables that are left out).
--  * export_tenant_data(tenant): super admin or the shop's owner; stores the
--    export and returns it.
--  * tax_document_archive: every tax invoice and credit note of a deleted
--    shop, with retain_until = issue date + 6 years [the founder confirms
--    the legal period]. Super admin read only; nobody writes it but
--    permanently_delete_tenant.
--  * permanently_delete_tenant refuses until an export was taken after the
--    shop went to the trash, archives the tax documents, then deletes.
-- Rollback: supabase/rollbacks/20270106_tenant_export_and_archive.down.sql

CREATE TABLE IF NOT EXISTS public.tenant_data_exports (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL,
  tenant_name  text,
  requested_by text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  data         jsonb       NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tenant_data_exports_tenant ON public.tenant_data_exports (tenant_id, created_at DESC);
ALTER TABLE public.tenant_data_exports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_data_exports_read ON public.tenant_data_exports;
CREATE POLICY tenant_data_exports_read ON public.tenant_data_exports FOR SELECT TO authenticated
  USING (app_is_super_admin() OR app_is_tenant_owner(tenant_id));
REVOKE INSERT, UPDATE, DELETE ON public.tenant_data_exports FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.tax_document_archive (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL,
  tenant_name  text,
  kind         text        NOT NULL CHECK (kind IN ('invoice', 'credit_note')),
  document_id  uuid        NOT NULL,
  issued_at    timestamptz,
  document     jsonb       NOT NULL,
  retain_until date,
  archived_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, document_id)
);
CREATE INDEX IF NOT EXISTS idx_tax_document_archive_tenant ON public.tax_document_archive (tenant_id);
ALTER TABLE public.tax_document_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tax_document_archive_read ON public.tax_document_archive;
CREATE POLICY tax_document_archive_read ON public.tax_document_archive FOR SELECT TO authenticated
  USING (app_is_super_admin());
REVOKE INSERT, UPDATE, DELETE ON public.tax_document_archive FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.export_tenant_data(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tables text[] := ARRAY[
    'branches','staff','roles','customers','customer_measurement_changes',
    'orders','order_items','order_history','payments','tax_invoices','sales_returns','sales_return_items',
    'shifts','shift_entries','inventory_items','inventory_variants','branch_inventory','stock_ledger',
    'inventory_adjustments','adjustment_items','stock_transfers','stock_transfer_items',
    'suppliers','supplier_transactions','purchase_orders','purchase_order_items','purchase_returns','purchase_return_items',
    'tenant_categories','fabric_shortages','audit_logs','subscription_requests','saas_subscription_payments'];
  v_strip text[] := ARRAY['pin_hash','measurements_token','measurements_token_expires_at','tracking_token','token_hash','agent_token','client_token'];
  v_name  text;
  v_tbl   text;
  v_rows  jsonb;
  v_data  jsonb;
  v_id    uuid;
BEGIN
  IF NOT (app_is_super_admin() OR app_is_tenant_owner(p_tenant_id)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT name INTO v_name FROM public.tenants WHERE id = p_tenant_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'المحل غير موجود' USING ERRCODE = '02000';
  END IF;

  v_data := jsonb_build_object(
    'format', 'seen-tenant-export/1',
    'exported_at', now(),
    'tenant', (SELECT to_jsonb(t) FROM public.tenants t WHERE t.id = p_tenant_id));
  FOREACH v_tbl IN ARRAY v_tables LOOP
    IF to_regclass('public.' || v_tbl) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(x) - $2), ''[]''::jsonb) FROM public.%I x WHERE x.tenant_id::text = $1::text', v_tbl)
      INTO v_rows USING p_tenant_id, v_strip;
    v_data := v_data || jsonb_build_object(v_tbl, v_rows);
  END LOOP;

  INSERT INTO public.tenant_data_exports (tenant_id, tenant_name, requested_by, data)
  VALUES (p_tenant_id, v_name, auth.uid()::text, v_data) RETURNING id INTO v_id;
  RETURN jsonb_build_object('export_id', v_id, 'data', v_data);
END;
$function$;
REVOKE ALL ON FUNCTION public.export_tenant_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.export_tenant_data(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.permanently_delete_tenant(p_tenant_id uuid, p_confirm_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name       TEXT;
  v_trashed_at TIMESTAMPTZ;
BEGIN
  IF NOT public.app_is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT name, trashed_at INTO v_name, v_trashed_at FROM public.tenants WHERE id = p_tenant_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'التاجر غير موجود' USING ERRCODE = '42501';
  END IF;
  IF v_trashed_at IS NULL THEN
    RAISE EXCEPTION 'يجب نقل التاجر لسلة المهملات أولاً قبل الحذف النهائي' USING ERRCODE = '22023';
  END IF;
  IF v_name IS DISTINCT FROM p_confirm_name THEN
    RAISE EXCEPTION 'الاسم المُدخل لا يطابق اسم التاجر' USING ERRCODE = '22023';
  END IF;
  -- P5 (PLATFORM-08): an export taken after the shop went to the trash, first.
  IF NOT EXISTS (SELECT 1 FROM public.tenant_data_exports e WHERE e.tenant_id = p_tenant_id AND e.created_at >= v_trashed_at) THEN
    RAISE EXCEPTION 'صدّر بيانات المحل أولاً: يلزم تصدير بعد نقله إلى سلة المهملات' USING ERRCODE = '22023';
  END IF;
  -- ...and its tax documents are kept, apart from the shop, for the legal period.
  INSERT INTO public.tax_document_archive (tenant_id, tenant_name, kind, document_id, issued_at, document, retain_until)
  SELECT p_tenant_id, v_name, 'invoice', ti.id, ti.created_at, to_jsonb(ti), (ti.created_at + interval '6 years')::date
    FROM public.tax_invoices ti WHERE ti.tenant_id = p_tenant_id
  ON CONFLICT (kind, document_id) DO NOTHING;
  INSERT INTO public.tax_document_archive (tenant_id, tenant_name, kind, document_id, issued_at, document, retain_until)
  SELECT p_tenant_id, v_name, 'credit_note', sr.id, sr.created_at,
         to_jsonb(sr) || jsonb_build_object('items', COALESCE((SELECT jsonb_agg(to_jsonb(i)) FROM public.sales_return_items i WHERE i.return_id = sr.id), '[]'::jsonb)),
         (sr.created_at + interval '6 years')::date
    FROM public.sales_returns sr WHERE sr.tenant_id = p_tenant_id
  ON CONFLICT (kind, document_id) DO NOTHING;
  DELETE FROM public.tenants WHERE id = p_tenant_id;
END $function$
;
