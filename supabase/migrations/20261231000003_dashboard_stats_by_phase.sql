-- =============================================================================
-- seen-verticals-readiness-task.md Phase 2: the owner dashboard counts by the
-- stage's meaning (vertical_workflow_stages.phase), not by fixed names.
--
-- get_dashboard_stats compared coalesce(status_key, status) with 'ready' /
-- 'delivered': a fabric store's «جاهز للاستلام» (ready_pickup) counted as
-- still pending, and its completion time was never found in the history.
--  - public.order_phase(vertical, status_key, status): the stage's phase, or,
--    for a key the vertical does not define (or no key), the old enum's
--    meaning. Men's tailoring: its stages are the enum, so the same answers
--    as before.
--  - dashboard_order_rows returns that phase.
--  - dashboard_order_completed_at takes the vertical's ready / delivered
--    stage keys.
--  - get_dashboard_stats: pending / in progress / ready / completion /
--    "measurements" (received) by phase; status_counts stays by stage key.
-- Rollback: supabase/rollbacks/20261231_dashboard_stats_by_phase.down.sql.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.order_phase(p_vertical text, p_status_key text, p_status text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT coalesce(
    (SELECT s.phase FROM public.vertical_workflow_stages s
      WHERE s.vertical_key = p_vertical AND s.stage_key = p_status_key),
    CASE coalesce(p_status_key, p_status)
      WHEN 'measurements_taken' THEN 'received'
      WHEN 'ready' THEN 'ready'
      WHEN 'delivered' THEN 'delivered'
      WHEN 'cancelled' THEN 'cancelled'
      ELSE 'in_progress'
    END);
$function$;

REVOKE ALL ON FUNCTION public.order_phase(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_phase(text, text, text) TO authenticated, service_role;

-- The completion time: the last history entry whose status is one of the
-- vertical's ready / delivered stage keys.
CREATE OR REPLACE FUNCTION public.dashboard_order_completed_at(p_notes text, p_done text[])
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_json text;
  v_history jsonb;
  v_entry jsonb;
  i int;
BEGIN
  IF p_notes IS NULL THEN RETURN NULL; END IF;
  IF left(p_notes, 22) = '__ORDER_METADATA_V2__:' OR left(p_notes, 23) = '__ORDER_METADATA_V2___:' THEN
    v_json := substr(p_notes, strpos(p_notes, ':') + 1);
  ELSIF left(p_notes, 23) = '__ORDER_WITH_HISTORY__:' THEN
    v_json := substr(p_notes, 24);
  ELSE
    RETURN NULL;
  END IF;
  BEGIN
    v_history := (v_json::jsonb) -> 'history';
    IF v_history IS NULL OR jsonb_typeof(v_history) <> 'array' THEN RETURN NULL; END IF;
    FOR i IN REVERSE jsonb_array_length(v_history) - 1 .. 0 LOOP
      v_entry := v_history -> i;
      IF jsonb_typeof(v_entry) = 'object' AND (v_entry ->> 'status') = ANY (p_done) THEN
        RETURN (v_entry ->> 'updatedAt')::timestamptz;
      END IF;
    END LOOP;
    RETURN NULL;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.dashboard_order_completed_at(text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_order_completed_at(text, text[]) TO authenticated, service_role;

-- + phase (return type changes, so drop and recreate).
DROP FUNCTION IF EXISTS public.dashboard_order_rows(uuid, uuid);
CREATE FUNCTION public.dashboard_order_rows(p_tenant_id uuid, p_branch_id uuid)
RETURNS TABLE (customer_id text, at timestamptz, status text, paid numeric, remaining numeric, notes text, phase text)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT coalesce(o.customer_id::text, ''), coalesce(o.order_date, now()),
         coalesce(o.status_key, o.status::text), coalesce(o.paid_amount, 0)::numeric,
         coalesce(o.remaining_amount, 0)::numeric, o.notes,
         public.order_phase(t.vertical, o.status_key, o.status::text)
    FROM public.orders o
    LEFT JOIN public.tenants t ON t.id = o.tenant_id
   WHERE o.tenant_id = p_tenant_id
     AND (p_branch_id IS NULL OR o.branch_id = p_branch_id);
$function$;

REVOKE ALL ON FUNCTION public.dashboard_order_rows(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_order_rows(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_dashboard_stats(
  p_tenant_id uuid,
  p_branch_id uuid DEFAULT NULL,
  p_ranges jsonb DEFAULT '[]'::jsonb,
  p_filter jsonb DEFAULT NULL,
  p_active_since timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ranges jsonb;
  v_filtered jsonb;
  v_totals jsonb;
  v_low_stock int;
  v_done text[];
  f_s timestamptz;
  f_e timestamptz;
  f_inc boolean;
BEGIN
  IF p_tenant_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(coalesce(p_ranges, '[]'::jsonb)) <> 'array' OR jsonb_array_length(coalesce(p_ranges, '[]'::jsonb)) > 200 THEN
    RAISE EXCEPTION 'p_ranges must be an array of at most 200 ranges' USING ERRCODE = '22023';
  END IF;

  IF p_filter IS NOT NULL THEN
    f_s := (p_filter ->> 's')::timestamptz;
    f_e := (p_filter ->> 'e')::timestamptz;
    f_inc := coalesce((p_filter ->> 'inc')::boolean, true);
  END IF;

  -- The vertical's ready / delivered stage keys (+ the enum's, as before).
  SELECT ARRAY['delivered', 'ready'] || coalesce(array_agg(s.stage_key), ARRAY[]::text[])
    INTO v_done
    FROM public.tenants t
    JOIN public.vertical_workflow_stages s ON s.vertical_key = t.vertical
   WHERE t.id = p_tenant_id AND s.phase IN ('ready', 'delivered');

  -- Per requested range: orders, money taken, still-open orders, new
  -- customers. One pass over the orders and one over the customers.
  WITH rg AS (
    SELECT x.ord, (x.v ->> 's')::timestamptz AS s, (x.v ->> 'e')::timestamptz AS e,
           coalesce((x.v ->> 'inc')::boolean, false) AS inc
      FROM jsonb_array_elements(coalesce(p_ranges, '[]'::jsonb)) WITH ORDINALITY AS x(v, ord)
  ),
  d AS MATERIALIZED (
    SELECT at, phase, paid FROM public.dashboard_order_rows(p_tenant_id, p_branch_id)
  ),
  ro AS (
    SELECT rg.ord, count(d.at) AS orders, coalesce(sum(d.paid), 0) AS paid,
           count(d.at) FILTER (WHERE d.phase NOT IN ('delivered', 'ready')) AS pending
      FROM rg LEFT JOIN d ON d.at >= rg.s AND (d.at < rg.e OR (rg.inc AND d.at = rg.e))
     GROUP BY rg.ord
  ),
  rc AS (
    SELECT rg.ord, count(c.id) AS customers
      FROM rg LEFT JOIN public.customers c
        ON c.tenant_id = p_tenant_id AND c.created_at IS NOT NULL
       AND c.created_at >= rg.s AND (c.created_at < rg.e OR (rg.inc AND c.created_at = rg.e))
     GROUP BY rg.ord
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'orders', ro.orders, 'paid', ro.paid, 'pending', ro.pending, 'customers', rc.customers
         ) ORDER BY ro.ord), '[]'::jsonb)
    INTO v_ranges
    FROM ro JOIN rc ON rc.ord = ro.ord;

  -- The selected period (or all time): the cards' figures.
  WITH f AS MATERIALIZED (
    SELECT * FROM public.dashboard_order_rows(p_tenant_id, p_branch_id) d
     WHERE p_filter IS NULL OR (d.at >= f_s AND (d.at < f_e OR (f_inc AND d.at = f_e)))
  ),
  done AS (
    SELECT f.at, public.dashboard_order_completed_at(f.notes, v_done) AS done_at
      FROM f WHERE f.phase IN ('delivered', 'ready')
  ),
  per_customer AS (
    SELECT f.customer_id, count(*) AS n FROM f WHERE f.customer_id <> '' GROUP BY f.customer_id
  )
  SELECT jsonb_build_object(
    'orders', (SELECT count(*) FROM f),
    'paid', (SELECT coalesce(sum(paid), 0) FROM f),
    'remaining', (SELECT coalesce(sum(remaining), 0) FROM f),
    'pending', (SELECT count(*) FROM f WHERE phase NOT IN ('delivered', 'ready')),
    'customers', (SELECT count(*) FROM public.customers c
                   WHERE c.tenant_id = p_tenant_id
                     AND (p_filter IS NULL
                          OR (c.created_at IS NOT NULL AND c.created_at >= f_s
                              AND (c.created_at < f_e OR (f_inc AND c.created_at = f_e))))),
    'completion_hours', (SELECT coalesce(sum(extract(epoch FROM (done_at - at)) / 3600.0), 0)
                           FROM done WHERE done_at > at),
    'completion_count', (SELECT count(*) FROM done WHERE done_at > at),
    'active_customers', (SELECT count(DISTINCT customer_id) FROM f
                          WHERE p_active_since IS NULL OR at >= p_active_since),
    'customers_with_orders', (SELECT count(*) FROM per_customer),
    'repeat_customers', (SELECT count(*) FROM per_customer WHERE n > 1),
    'status_counts', (SELECT coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb)
                        FROM (SELECT status, count(*) AS n FROM f GROUP BY status) s)
  ) INTO v_filtered;

  -- Whole-history figures the page shows regardless of the period.
  SELECT jsonb_build_object(
    'orders', count(*),
    'in_progress', count(*) FILTER (WHERE phase NOT IN ('delivered', 'ready', 'cancelled')),
    'measurements_taken', count(*) FILTER (WHERE phase = 'received'),
    'ready', count(*) FILTER (WHERE phase = 'ready')
  ) INTO v_totals FROM public.dashboard_order_rows(p_tenant_id, p_branch_id);

  SELECT count(*) INTO v_low_stock
    FROM public.inventory_items i
    LEFT JOIN LATERAL (
      SELECT coalesce(sum(bi.quantity), 0) AS qty
        FROM public.branch_inventory bi
       WHERE bi.item_id = i.id AND bi.tenant_id = p_tenant_id
    ) q ON true
   WHERE i.tenant_id = p_tenant_id
     AND q.qty <= coalesce(i.min_threshold, 0);

  RETURN jsonb_build_object(
    'ranges', v_ranges,
    'filtered', v_filtered,
    'totals', v_totals,
    'low_stock', v_low_stock,
    'customers_total', (SELECT count(*) FROM public.customers c WHERE c.tenant_id = p_tenant_id)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_dashboard_stats(uuid, uuid, jsonb, jsonb, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats(uuid, uuid, jsonb, jsonb, timestamptz) TO authenticated, service_role;
