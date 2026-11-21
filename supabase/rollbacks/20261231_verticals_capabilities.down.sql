-- Rollback of 20261231000001_verticals_capabilities.sql.
-- The furniture fields added by it are removed; a removed `dimensions` field
-- (only removed when no order used it) is put back.
DELETE FROM public.vertical_field_schemas
 WHERE vertical_key = 'furniture' AND field_key IN ('width_cm', 'depth_cm', 'height_cm', 'pieces_count', 'design_notes');
INSERT INTO public.vertical_field_schemas (vertical_key, field_key, label_ar, field_type, applies_to, sort)
SELECT 'furniture', 'dimensions', 'الأبعاد', 'text', 'order_item', 5
 WHERE NOT EXISTS (SELECT 1 FROM public.vertical_field_schemas WHERE vertical_key = 'furniture' AND field_key = 'dimensions');

ALTER TABLE public.tenant_categories DROP CONSTRAINT IF EXISTS tenant_categories_measure_kind_check;
ALTER TABLE public.tenant_categories DROP COLUMN IF EXISTS measure_kind;
ALTER TABLE public.vertical_inventory_categories DROP CONSTRAINT IF EXISTS vertical_inventory_categories_measure_kind_check;
ALTER TABLE public.vertical_inventory_categories DROP COLUMN IF EXISTS measure_kind;
ALTER TABLE public.vertical_inventory_categories DROP COLUMN IF EXISTS label_ur;
ALTER TABLE public.vertical_inventory_categories DROP COLUMN IF EXISTS label_en;
ALTER TABLE public.vertical_field_schemas DROP COLUMN IF EXISTS options_i18n;
ALTER TABLE public.vertical_field_schemas DROP COLUMN IF EXISTS label_ur;
ALTER TABLE public.vertical_field_schemas DROP COLUMN IF EXISTS label_en;
ALTER TABLE public.vertical_workflow_stages DROP CONSTRAINT IF EXISTS vertical_workflow_stages_phase_check;
ALTER TABLE public.vertical_workflow_stages DROP COLUMN IF EXISTS label_ur;
ALTER TABLE public.vertical_workflow_stages DROP COLUMN IF EXISTS label_en;
ALTER TABLE public.vertical_workflow_stages DROP COLUMN IF EXISTS consumes_materials;
ALTER TABLE public.vertical_workflow_stages DROP COLUMN IF EXISTS legacy_status;
ALTER TABLE public.vertical_workflow_stages DROP COLUMN IF EXISTS phase;
ALTER TABLE public.verticals DROP COLUMN IF EXISTS name_ur;
ALTER TABLE public.verticals DROP COLUMN IF EXISTS capabilities;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261231000001';
