-- get_dashboard_stats by phase (seen-verticals-readiness-task.md Phase 2), rolled back.
--   npx supabase db query --linked --file supabase/staging-checks/dashboard_stats_by_phase_test.sql
DO $test$
DECLARE
  o record;
  before jsonb;
  after jsonb;
  checks int := 0;
BEGIN
  SELECT id, tenant_id INTO o FROM public.orders ORDER BY created_at LIMIT 1;
  IF o.id IS NULL THEN RAISE EXCEPTION 'SKIP: need an order'; END IF;

  SET LOCAL session_replication_role = replica;
  UPDATE public.tenants SET vertical = 'fabric_store' WHERE id = o.tenant_id;
  -- One order in each meaningful stage of the fabric store.
  UPDATE public.orders SET status_key = 'cutting_measuring', status = 'cutting' WHERE tenant_id = o.tenant_id;
  UPDATE public.orders SET status_key = 'ready_pickup', status = 'ready' WHERE id = o.id;
  SET LOCAL session_replication_role = origin;

  after := public.get_dashboard_stats(o.tenant_id, NULL, '[]'::jsonb, NULL, NULL);

  -- «جاهز للاستلام» is ready, not pending.
  IF (after->'totals'->>'ready')::int <> 1 THEN RAISE EXCEPTION 'FAIL: ready_pickup not counted ready: %', after->'totals'; END IF;
  checks := checks + 1;
  IF (after->'filtered'->>'pending')::int <> (after->'filtered'->>'orders')::int - 1 THEN
    RAISE EXCEPTION 'FAIL: ready_pickup counted pending: %', after->'filtered';
  END IF;
  checks := checks + 1;
  IF (after->'totals'->>'in_progress')::int <> (after->'totals'->>'orders')::int - 1 THEN
    RAISE EXCEPTION 'FAIL: in_progress %', after->'totals';
  END IF;
  checks := checks + 1;
  -- The stage keys stay in the status bars.
  IF NOT (after->'filtered'->'status_counts') ? 'ready_pickup' THEN RAISE EXCEPTION 'FAIL: status_counts %', after->'filtered'->'status_counts'; END IF;
  checks := checks + 1;

  -- order_phase: a stage the vertical defines, and the enum fallback.
  IF public.order_phase('furniture', 'design_approval', 'measurements_taken') <> 'in_progress' THEN RAISE EXCEPTION 'FAIL: furniture design_approval'; END IF;
  IF public.order_phase('mens_tailoring', NULL, 'measurements_taken') <> 'received' THEN RAISE EXCEPTION 'FAIL: mens fallback'; END IF;
  IF public.order_phase('fabric_store', 'ready_pickup', 'ready') <> 'ready' THEN RAISE EXCEPTION 'FAIL: ready_pickup'; END IF;
  checks := checks + 1;

  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
