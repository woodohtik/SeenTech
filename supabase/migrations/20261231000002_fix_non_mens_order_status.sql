-- =============================================================================
-- seen-verticals-readiness-task.md Phase 1.7: repair the stored status of
-- existing orders in verticals other than mens_tailoring.
--
-- mapStageKeyToLegacyStatus used to write 'ready' to orders.status /
-- order_items.status for any stage that is not an order_status enum value, so
-- a sofa in «اعتماد التصميم» or a dress at «بروفة» was stored as ready (and
-- counted as finished by reports, staff performance, the customer pages).
-- Each such row is recomputed from its status_key through the stage's
-- legacy_status (20261231000001).
--
-- Every changed row is copied first to public._backup_20261231_order_status
-- (no API access), so the rollback restores the exact old values.
-- Triggers are off for the two updates: a corrected status must not deduct
-- fabric, notify a customer or write history -- it is a correction, not a move.
-- mens_tailoring orders are not touched.
-- Rollback: supabase/rollbacks/20261231_fix_non_mens_order_status.down.sql.
-- Report: SELECT kind, vertical, count(*) FROM public._backup_20261231_order_status GROUP BY 1, 2;
-- =============================================================================

CREATE TABLE IF NOT EXISTS public._backup_20261231_order_status (
  kind        text NOT NULL,          -- 'order' | 'item'
  row_id      uuid NOT NULL,
  vertical    text NOT NULL,
  old_status  order_status,
  new_status  order_status NOT NULL,
  backed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, row_id)
);
ALTER TABLE public._backup_20261231_order_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._backup_20261231_order_status FROM PUBLIC, anon, authenticated;

INSERT INTO public._backup_20261231_order_status (kind, row_id, vertical, old_status, new_status)
SELECT 'order', o.id, t.vertical, o.status, s.legacy_status
  FROM public.orders o
  JOIN public.tenants t ON t.id = o.tenant_id
  JOIN public.vertical_workflow_stages s ON s.vertical_key = t.vertical AND s.stage_key = o.status_key
 WHERE t.vertical <> 'mens_tailoring'
   AND o.status IS DISTINCT FROM s.legacy_status
ON CONFLICT DO NOTHING;

INSERT INTO public._backup_20261231_order_status (kind, row_id, vertical, old_status, new_status)
SELECT 'item', i.id, t.vertical, i.status, s.legacy_status
  FROM public.order_items i
  JOIN public.tenants t ON t.id = i.tenant_id
  JOIN public.vertical_workflow_stages s ON s.vertical_key = t.vertical AND s.stage_key = i.status_key
 WHERE t.vertical <> 'mens_tailoring'
   AND i.status IS DISTINCT FROM s.legacy_status
ON CONFLICT DO NOTHING;

SET session_replication_role = replica;
UPDATE public.orders o SET status = b.new_status
  FROM public._backup_20261231_order_status b
 WHERE b.kind = 'order' AND b.row_id = o.id;
UPDATE public.order_items i SET status = b.new_status
  FROM public._backup_20261231_order_status b
 WHERE b.kind = 'item' AND b.row_id = i.id;
SET session_replication_role = origin;
