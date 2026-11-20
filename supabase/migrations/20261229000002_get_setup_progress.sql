-- =============================================================================
-- seen-performance-first-open-login-task.md Phase 4.6: the quick-start
-- checklist (useSetupChecklist) asked four separate exact counts -- stock
-- items, customers, orders, tax invoices -- on every open and on every change
-- to any of those tables, only to know whether each is non-zero. This answers
-- the four yes/no questions in one request with EXISTS (stops at the first
-- row). SECURITY INVOKER: each EXISTS sees exactly the rows the caller's RLS
-- lets them read, as the four head-only counts did.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_setup_progress(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'has_stock',     EXISTS (SELECT 1 FROM public.inventory_items WHERE tenant_id = p_tenant_id),
    'has_customers', EXISTS (SELECT 1 FROM public.customers       WHERE tenant_id = p_tenant_id),
    'has_orders',    EXISTS (SELECT 1 FROM public.orders          WHERE tenant_id = p_tenant_id),
    'has_invoices',  EXISTS (SELECT 1 FROM public.tax_invoices    WHERE tenant_id = p_tenant_id)
  );
$function$;

REVOKE ALL ON FUNCTION public.get_setup_progress(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_setup_progress(uuid) TO authenticated, service_role;
