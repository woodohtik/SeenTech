-- seen-cutting-fabric-pos-orders-fix-task.md, phase 0. Read-only, BEFORE the push.
-- The POS thobes that cannot reach cutting today (no kind, cloth lines in
-- order_items, not yet cut), with what the task expects to see.
select o.order_number, o.status, o.kind, o.fabric_deducted_at,
       left(o.notes, 30) as notes_prefix,
       (select count(*) from public.order_items i
         where i.order_id = o.id and i.type = 'custom' and i.fabric_id is not null) as cloth_lines,
       (select sum(coalesce(i.consumed_meters, 0)) from public.order_items i
         where i.order_id = o.id and i.type = 'custom') as meters_at_sale,
       (select coalesce(sum(-l.change), 0) from public.stock_ledger l
         where l.reference_id = o.id and l.reference_type = 'pos_sale' and l.type = 'sale' and l.change < 0
           and l.item_id in (select i.fabric_id from public.order_items i where i.order_id = o.id)) as cloth_taken_at_sale
  from public.orders o
 where o.kind is null
   and exists (select 1 from public.order_items i where i.order_id = o.id and i.type = 'custom' and i.fabric_id is not null)
 order by o.created_at desc
 limit 50;
