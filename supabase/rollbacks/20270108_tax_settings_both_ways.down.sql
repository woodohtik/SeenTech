-- Rollback of 20270108000004_tax_settings_both_ways.sql
CREATE OR REPLACE FUNCTION public.tenants_tax_settings_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_from_settings boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_from_settings := NEW.tax_settings IS NOT NULL;
    IF NOT v_from_settings THEN
      NEW.tax_settings := public.tax_settings_from_legacy(NEW.legacy_id);
    END IF;
  ELSIF NEW.tax_settings IS DISTINCT FROM OLD.tax_settings THEN
    v_from_settings := true;
  ELSIF NEW.legacy_id IS DISTINCT FROM OLD.legacy_id THEN
    v_from_settings := false;
    NEW.tax_settings := public.tax_settings_from_legacy(NEW.legacy_id);
  ELSE
    RETURN NEW;
  END IF;

  IF v_from_settings THEN
    -- legacy_id holds the settings document (or nothing); a real non-JSON
    -- legacy id is left alone.
    IF NEW.legacy_id IS NULL OR NEW.legacy_id LIKE '{%' THEN
      NEW.legacy_id := CASE WHEN NEW.tax_settings IS NULL THEN NULL ELSE NEW.tax_settings::text END;
    END IF;
  END IF;

  IF jsonb_typeof(NEW.tax_settings) = 'object' THEN
    NEW.is_tax_enabled := COALESCE(
      (NEW.tax_settings->>'enabled')::boolean,
      COALESCE(btrim(NEW.vat_number), '') <> '' OR COALESCE(NEW.tax_settings->>'trn', '') <> ''
    );
    NEW.default_tax_rate := COALESCE(NULLIF(NULLIF(NEW.tax_settings->>'vatRate', '')::numeric, 0), 15);
  END IF;
  RETURN NEW;
END;
$function$
;
