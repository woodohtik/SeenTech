-- After pushing 20270122000000-000001 (order images) and 20270123000000-000003
-- (barcodes, variant price/photo, variant opening balance, PO price) to
-- production. Read-only. Every value should be true (uq_variant_barcode may be
-- false only if barcode-duplicates-report.sql showed duplicates).
select
  exists (select 1 from storage.buckets where id = 'order-images' and public = false)                               as order_images_bucket_private,
  to_regprocedure('public.set_order_images(uuid, jsonb)') is not null                                                as set_order_images,
  to_regprocedure('public.is_barcode_available(text)') is not null                                                   as is_barcode_available,
  exists (select 1 from pg_trigger where tgname = 'trg_guard_barcode_unique' and tgrelid = 'public.inventory_items'::regclass)    as barcode_guard_items,
  exists (select 1 from pg_trigger where tgname = 'trg_guard_barcode_unique' and tgrelid = 'public.inventory_variants'::regclass) as barcode_guard_variants,
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_inventory_variants_tenant_barcode') as uq_variant_barcode,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'inventory_variants' and column_name = 'price_override') as variant_price_override,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'inventory_variants' and column_name = 'image_url')      as variant_image_url,
  to_regprocedure('public.record_opening_balance(uuid, uuid, numeric, uuid)') is not null                            as opening_balance_per_variant,
  to_regprocedure('public.record_opening_balance(uuid, uuid, numeric)') is null                                      as old_opening_balance_gone,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'purchase_order_items' and column_name = 'update_item_cost') as po_update_item_cost,
  position('price_override' in pg_get_functiondef('public.create_pos_sale(uuid, jsonb, jsonb, jsonb)'::regprocedure)) > 0 as pos_sale_prices_variants,
  position('update_item_cost' in pg_get_functiondef('public.confirm_purchase_order(uuid)'::regprocedure)) > 0        as po_confirm_updates_cost,
  position('app_has_permission(''inventory.create'')' in pg_get_functiondef('public.record_opening_balance(uuid, uuid, numeric, uuid)'::regprocedure)) > 0 as opening_balance_permission_kept;
