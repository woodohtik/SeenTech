-- The status repair of 20261231000002 on a simulated furniture order, rolled back.
--   npx supabase db query --linked --file supabase/staging-checks/fix_non_mens_order_status_test.sql
DO $test$
DECLARE
  o record;
  st order_status;
  checks int := 0;
BEGIN
  SELECT id, tenant_id INTO o FROM public.orders ORDER BY created_at LIMIT 1;
  IF o.id IS NULL THEN RAISE EXCEPTION 'SKIP: need an order'; END IF;

  -- As the system: the shop becomes a furniture shop, the order sits at
  -- «اعتماد التصميم» but was stored as ready (the old mapping).
  SET LOCAL session_replication_role = replica;
  UPDATE public.tenants SET vertical = 'furniture' WHERE id = o.tenant_id;
  UPDATE public.orders SET status_key = 'design_approval', status = 'ready' WHERE id = o.id;
  SET LOCAL session_replication_role = origin;

  -- The migration's two statements, for orders.
  INSERT INTO public._backup_20261231_order_status (kind, row_id, vertical, old_status, new_status)
  SELECT 'order', x.id, t.vertical, x.status, s.legacy_status
    FROM public.orders x
    JOIN public.tenants t ON t.id = x.tenant_id
    JOIN public.vertical_workflow_stages s ON s.vertical_key = t.vertical AND s.stage_key = x.status_key
   WHERE t.vertical <> 'mens_tailoring' AND x.status IS DISTINCT FROM s.legacy_status
  ON CONFLICT DO NOTHING;
  SET LOCAL session_replication_role = replica;
  UPDATE public.orders x SET status = b.new_status
    FROM public._backup_20261231_order_status b WHERE b.kind = 'order' AND b.row_id = x.id;
  SET LOCAL session_replication_role = origin;

  SELECT status INTO st FROM public.orders WHERE id = o.id;
  IF st <> 'measurements_taken' THEN RAISE EXCEPTION 'FAIL: design_approval stored as %', st; END IF;
  checks := checks + 1;
  IF (SELECT old_status FROM public._backup_20261231_order_status WHERE kind = 'order' AND row_id = o.id) <> 'ready' THEN
    RAISE EXCEPTION 'FAIL: old status not kept for the rollback';
  END IF;
  checks := checks + 1;

  -- Every stage of every vertical maps to its phase: nothing but a ready
  -- stage writes 'ready' (acceptance criterion).
  IF EXISTS (SELECT 1 FROM public.vertical_workflow_stages WHERE legacy_status = 'ready' AND phase <> 'ready') THEN
    RAISE EXCEPTION 'FAIL: a non-ready stage writes ready';
  END IF;
  IF EXISTS (SELECT 1 FROM public.vertical_workflow_stages WHERE phase = 'ready' AND legacy_status <> 'ready') THEN
    RAISE EXCEPTION 'FAIL: a ready stage does not write ready';
  END IF;
  checks := checks + 1;

  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
