-- seen-product-variants-barcode-po-price-task.md, phase 1: barcodes used more
-- than once in a shop -- among its variants, or a variant sharing a product's
-- barcode -- BEFORE the unique rule goes on. Read-only; the founder sees this
-- report before 20270123000000 is pushed to production.
with codes as (
  select tenant_id, nullif(btrim(barcode), '') as barcode, 'item' as kind, id::text as id, name from public.inventory_items
  union all
  select tenant_id, nullif(btrim(barcode), ''), 'variant', id::text, name from public.inventory_variants
)
select t.name as shop, c.barcode, count(*) as uses,
       string_agg(c.kind || ': ' || c.name, ' | ' order by c.kind, c.name) as used_by
from codes c left join public.tenants t on t.id = c.tenant_id
where c.barcode is not null
group by t.name, c.tenant_id, c.barcode
having count(*) > 1
order by uses desc, shop;
