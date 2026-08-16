-- inventory_items.base_unit exists on staging only (not in production at
-- all - part of a newer, not-yet-live fabric/UOM feature) and was bootstrapped
-- as NOT NULL with no default. The live "add product" insert path doesn't
-- populate it (production has no such column, so it never needed to),
-- causing "null value in column base_unit violates not-null constraint" here.
-- Relaxing the constraint mirrors production's actual behavior (no
-- constraint at all) until the fabric/UOM feature is finished and wired up.
ALTER TABLE inventory_items ALTER COLUMN base_unit DROP NOT NULL;
