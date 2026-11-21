-- Rollback of 20270101000004_tenant_settings_by_permission.sql.
DROP TRIGGER IF EXISTS tenants_tax_permission_guard ON public.tenants;
DROP FUNCTION IF EXISTS public.tenants_tax_permission_guard();
DROP FUNCTION IF EXISTS public.app_tax_fingerprint(text, boolean, numeric, jsonb);
DROP POLICY IF EXISTS tenants_owner_update ON public.tenants;
CREATE POLICY tenants_owner_update ON public.tenants FOR UPDATE TO public
  USING (owner_uid = app_current_uid())
  WITH CHECK (owner_uid = app_current_uid());
REVOKE EXECUTE ON FUNCTION public.app_effective_permissions(uuid) FROM service_role;
