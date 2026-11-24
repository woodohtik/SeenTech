-- Security audit batch 4 (20270112000003, 20270112000004), after the push. Read-only.
select json_build_object(
  'offline_actor_bound_ok', position('staff_acting_sessions' in pg_get_functiondef('public.app_offline_actor_staff_id()'::regprocedure)) > 0,
  'link_digest_fn_ok', exists (select 1 from pg_proc where proname = 'measurements_token_digest'),
  'issue_stores_digest_ok', position('measurements_token_digest(v_token)' in pg_get_functiondef('public.issue_measurements_link(uuid)'::regprocedure)) > 0,
  'save_reads_digest_ok', position('measurements_token_digest(p_token)' in pg_get_functiondef('public.save_public_measurements(uuid, jsonb)'::regprocedure)) > 0,
  'anon_definer_functions', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE'))
) as result;
