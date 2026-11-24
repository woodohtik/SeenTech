-- Read-only: every migration version applied to this database, newest first, and a count.
select json_build_object(
  'count', (select count(*) from supabase_migrations.schema_migrations),
  'latest', (select json_agg(version order by version desc) from (select version from supabase_migrations.schema_migrations order by version desc limit 25) x),
  'all', (select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations)
) as result;
