-- seen-order-images-upload-task.md, phase 5: the order-images bucket's size
-- per shop, to watch the storage quota (1 GB on the free plan). Read-only.
-- Monthly, by the platform admin:
--   npx supabase db query --linked --project-ref bvvhxjrlwphvrmneieuk --file scripts/reports/order-images-usage.sql
select
  t.name                                                        as shop,
  (storage.foldername(o.name))[1]                               as tenant_id,
  count(*)                                                      as images,
  round(sum(coalesce((o.metadata->>'size')::bigint, 0)) / 1024.0 / 1024.0, 2) as megabytes,
  round(avg(coalesce((o.metadata->>'size')::bigint, 0)) / 1024.0, 0)          as avg_kb,
  max(o.created_at)                                             as last_upload
from storage.objects o
left join public.tenants t on t.id::text = (storage.foldername(o.name))[1]
where o.bucket_id = 'order-images'
group by 1, 2
order by megabytes desc;
