-- seen-product-variants-barcode-po-price-task.md, phase 1: a barcode is used
-- once in a shop, across its products and their variants.
--
--   * is_barcode_available(p_barcode): for the app's "generate barcode"
--     (EAN-13 in the in-store range, lib/barcode.ts) -- the current shop only.
--   * guard_barcode_unique: a product or variant cannot take a code another
--     product or variant of the shop already has (23505, a sentence).
--   * A unique index on variants (tenant_id, barcode) -- only if the shop has
--     no duplicates today (scripts/release/barcode-duplicates-report.sql shows
--     them; none on staging). Products already have one.
--
-- Test: supabase/tests/barcodes_test.sql
-- Rollback: supabase/rollbacks/20270123_barcodes.down.sql

CREATE OR REPLACE FUNCTION public.is_barcode_available(p_barcode text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.app_current_tenant_id() IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.inventory_items WHERE tenant_id = public.app_current_tenant_id() AND barcode = btrim(p_barcode))
     AND NOT EXISTS (SELECT 1 FROM public.inventory_variants WHERE tenant_id = public.app_current_tenant_id() AND barcode = btrim(p_barcode));
$function$;
REVOKE ALL ON FUNCTION public.is_barcode_available(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_barcode_available(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_barcode_unique()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_code text := NULLIF(btrim(NEW.barcode), '');
BEGIN
  IF v_code IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.inventory_items
              WHERE tenant_id = NEW.tenant_id AND barcode = v_code
                AND NOT (TG_TABLE_NAME = 'inventory_items' AND id = NEW.id))
     OR EXISTS (SELECT 1 FROM public.inventory_variants
              WHERE tenant_id = NEW.tenant_id AND barcode = v_code
                AND NOT (TG_TABLE_NAME = 'inventory_variants' AND id = NEW.id)) THEN
    RAISE EXCEPTION 'الباركود % مستخدم لصنف آخر في المحل', v_code USING ERRCODE = '23505', HINT = 'barcode_taken';
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_guard_barcode_unique ON public.inventory_items;
CREATE TRIGGER trg_guard_barcode_unique BEFORE INSERT OR UPDATE OF barcode ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_barcode_unique();
DROP TRIGGER IF EXISTS trg_guard_barcode_unique ON public.inventory_variants;
CREATE TRIGGER trg_guard_barcode_unique BEFORE INSERT OR UPDATE OF barcode ON public.inventory_variants
  FOR EACH ROW EXECUTE FUNCTION public.guard_barcode_unique();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.inventory_variants
     WHERE NULLIF(btrim(barcode), '') IS NOT NULL
     GROUP BY tenant_id, barcode HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'duplicate variant barcodes exist -- the unique index is not created; see scripts/release/barcode-duplicates-report.sql';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_variants_tenant_barcode
      ON public.inventory_variants (tenant_id, barcode) WHERE barcode IS NOT NULL AND barcode <> '';
  END IF;
END $$;
