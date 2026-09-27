-- inventory_items.base_unit exists on staging only (not in production at
-- all - part of a newer, not-yet-live fabric/UOM feature) and was bootstrapped
-- as NOT NULL with no default. The live "add product" insert path doesn't
-- populate it (production has no such column, so it never needed to),
-- causing "null value in column base_unit violates not-null constraint" here.
-- Relaxing the constraint mirrors production's actual behavior (no
-- constraint at all) until the fabric/UOM feature is finished and wired up.
--
-- Guarded with IF EXISTS (added 2026-09-28, after this file had already run
-- on staging): running the full migration backlog against production for
-- the first time ever hit exactly the divergence this comment already
-- described -- the bare ALTER fails outright with "column base_unit of
-- relation inventory_items does not exist" instead of being a no-op there.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventory_items' AND column_name = 'base_unit'
  ) THEN
    ALTER TABLE inventory_items ALTER COLUMN base_unit DROP NOT NULL;
  END IF;
END $$;
