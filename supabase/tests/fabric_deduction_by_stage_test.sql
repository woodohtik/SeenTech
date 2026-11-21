-- Fabric is deducted at the stage that uses it, not before
-- (seen-verticals-readiness-task.md Phase 2.4 / acceptance criterion).
--   npx supabase db query --linked --file supabase/tests/fabric_deduction_by_stage_test.sql
--
-- trg_orders_deduct_fabric_on_stage fires when orders.status reaches
-- 'cutting' or later (and not cancelled). orders.status is the stage's
-- legacy_status (20261231000001), so it is enough that, in every vertical:
--   - every stage before the consumes_materials stage writes a status below 'cutting';
--   - the consumes_materials stage writes 'cutting' or later;
--   - every stage after it (bar cancelled) writes 'cutting' or later.
DO $test$
DECLARE
  v record;
  bad text;
  checks int := 0;
BEGIN
  FOR v IN SELECT DISTINCT vertical_key FROM public.vertical_workflow_stages LOOP
    IF (SELECT count(*) FROM public.vertical_workflow_stages WHERE vertical_key = v.vertical_key AND consumes_materials) <> 1 THEN
      RAISE EXCEPTION 'FAIL: % has not exactly one consuming stage', v.vertical_key;
    END IF;

    SELECT string_agg(s.stage_key || '=' || s.legacy_status, ', ') INTO bad
      FROM public.vertical_workflow_stages s,
           (SELECT sort FROM public.vertical_workflow_stages WHERE vertical_key = v.vertical_key AND consumes_materials) c
     WHERE s.vertical_key = v.vertical_key
       AND s.phase <> 'cancelled'
       AND ((s.sort < c.sort AND s.legacy_status >= 'cutting')
         OR (s.sort >= c.sort AND s.legacy_status < 'cutting'));
    IF bad IS NOT NULL THEN
      RAISE EXCEPTION 'FAIL: %: %', v.vertical_key, bad;
    END IF;
    checks := checks + 1;
  END LOOP;

  -- The concrete case of the task file: a sofa at «اعتماد التصميم» deducts
  -- nothing; at «تنجيد» it does.
  IF (SELECT legacy_status >= 'cutting' FROM public.vertical_workflow_stages WHERE vertical_key = 'furniture' AND stage_key = 'design_approval') THEN
    RAISE EXCEPTION 'FAIL: furniture design approval would deduct fabric';
  END IF;
  IF NOT (SELECT legacy_status >= 'cutting' FROM public.vertical_workflow_stages WHERE vertical_key = 'furniture' AND stage_key = 'upholstery') THEN
    RAISE EXCEPTION 'FAIL: furniture upholstery would not deduct fabric';
  END IF;
  -- Women's «بروفة» comes after cutting: the fabric is already cut by then.
  IF NOT (SELECT legacy_status >= 'cutting' FROM public.vertical_workflow_stages WHERE vertical_key = 'womens_tailoring' AND stage_key = 'fitting') THEN
    RAISE EXCEPTION 'FAIL: womens fitting';
  END IF;
  checks := checks + 1;

  -- The trigger still fires on 'cutting' and above, as the property assumes.
  IF NOT (SELECT pg_get_triggerdef(oid) LIKE '%status >= ''cutting''::order_status%'
            FROM pg_trigger WHERE tgname = 'trg_orders_deduct_fabric_on_stage') THEN
    RAISE EXCEPTION 'FAIL: the fabric trigger condition changed';
  END IF;
  checks := checks + 1;

  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
