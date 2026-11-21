-- seen-permissions-fix-task.md Phase 3 (continued): the shop's settings row.
--
-- The settings screen saves through POST /api/tenant/settings (settings.edit;
-- a change to the tax fields also needs settings.tax) and, when that call
-- fails, writes the tenants row directly. That direct path was guarded by
-- "owner_uid = app_current_uid()" -- the device ACCOUNT, so after a PIN
-- switch on the owner's device (Phase 2) a cashier could still change the
-- shop's settings. Now:
--  * tenants UPDATE: the owner (as the identity the server sees, not just the
--    device account) or an employee with settings.edit in this shop;
--  * a change to the tax fields from the browser needs settings.tax
--    (tenants_tax_permission_guard), compared the same way the server route
--    compares them (taxFingerprint in requirePermission.ts), so saving the
--    profile with the tax fields as loaded is not a tax change;
--  * the server may call app_effective_permissions (requirePermission.ts).
-- Billing fields stay guarded by their own triggers, untouched.
-- Rollback: supabase/rollbacks/20270101_tenant_settings_by_permission.down.sql

DROP POLICY IF EXISTS tenants_owner_update ON public.tenants;
CREATE POLICY tenants_owner_update ON public.tenants FOR UPDATE TO public
  USING (((owner_uid = app_current_uid()) AND (app_current_role() = 'owner'))
         OR ((id = app_current_tenant_id()) AND app_has_permission('settings.edit'::text)))
  WITH CHECK (((owner_uid = app_current_uid()) AND (app_current_role() = 'owner'))
              OR ((id = app_current_tenant_id()) AND app_has_permission('settings.edit'::text)));

CREATE OR REPLACE FUNCTION public.app_tax_fingerprint(p_vat_number text, p_is_tax_enabled boolean, p_default_tax_rate numeric, p_tax_settings jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT jsonb_build_object(
    'vat', btrim(coalesce(p_vat_number, '')),
    'enabled', coalesce(p_is_tax_enabled, false),
    'rate', coalesce(p_default_tax_rate, 15),
    'tsEnabled', CASE WHEN p_tax_settings ? 'enabled' THEN coalesce((p_tax_settings->>'enabled')::boolean, false)
                      ELSE coalesce(p_is_tax_enabled, false) END,
    'tsTrn', CASE WHEN p_tax_settings ? 'trn' THEN btrim(coalesce(p_tax_settings->>'trn', '')) ELSE btrim(coalesce(p_vat_number, '')) END,
    'tsRate', CASE WHEN coalesce(p_tax_settings->>'vatRate', '') <> '' THEN (p_tax_settings->>'vatRate')::numeric
                   ELSE coalesce(p_default_tax_rate, 15) END,
    'legalName', btrim(coalesce(p_tax_settings->>'legalName', '')),
    'tailoringTaxType', coalesce(p_tax_settings->>'tailoringTaxType', 'exclusive')
  );
$function$;

-- SECURITY INVOKER on purpose: current_user must be the caller's role
-- (inside a SECURITY DEFINER function it is always the function's owner).
CREATE OR REPLACE FUNCTION public.tenants_tax_permission_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND public.app_tax_fingerprint(NEW.vat_number, NEW.is_tax_enabled, NEW.default_tax_rate, NEW.tax_settings)
         IS DISTINCT FROM public.app_tax_fingerprint(OLD.vat_number, OLD.is_tax_enabled, OLD.default_tax_rate, OLD.tax_settings)
     AND NOT public.app_has_permission('settings.tax') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل الإعدادات الضريبية' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tenants_tax_permission_guard ON public.tenants;
CREATE TRIGGER tenants_tax_permission_guard
BEFORE UPDATE ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.tenants_tax_permission_guard();

GRANT EXECUTE ON FUNCTION public.app_effective_permissions(uuid) TO service_role;
