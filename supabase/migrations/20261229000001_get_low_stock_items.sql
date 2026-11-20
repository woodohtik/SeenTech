-- =============================================================================
-- seen-performance-first-open-login-task.md Phase 4.3: the dashboard's
-- low-stock notification scan used to download every inventory_items and
-- branch_inventory row (~130KB for 300 items) to find the few that are low.
-- This returns only those: the same rule as get_dashboard_stats' low_stock
-- count and the old browser code (summed branch quantity at or under
-- min_threshold; no branch rows = 0), with the fields the notification
-- text uses. SECURITY INVOKER, under the existing RLS.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_low_stock_items(p_tenant_id uuid, p_limit int DEFAULT 500)
RETURNS TABLE (id uuid, name text, unit text, min_threshold numeric, quantity numeric)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT i.id, i.name, i.unit::text, coalesce(i.min_threshold, 0)::numeric, q.qty
    FROM public.inventory_items i
    LEFT JOIN LATERAL (
      SELECT coalesce(sum(bi.quantity), 0)::numeric AS qty
        FROM public.branch_inventory bi
       WHERE bi.item_id = i.id AND bi.tenant_id = p_tenant_id
    ) q ON true
   WHERE i.tenant_id = p_tenant_id
     AND q.qty <= coalesce(i.min_threshold, 0)
   ORDER BY i.name
   LIMIT greatest(1, least(coalesce(p_limit, 500), 2000));
$function$;

REVOKE ALL ON FUNCTION public.get_low_stock_items(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_low_stock_items(uuid, int) TO authenticated, service_role;
