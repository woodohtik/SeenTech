-- 20270113000000_public_measurements_keep_notes.sql, after the push. Read-only.
select json_build_object(
  'link_keeps_notes_ok', position('fieldNotes' in pg_get_functiondef('public.save_public_measurements(uuid, jsonb)'::regprocedure)) > 0,
  'link_still_digest_ok', position('measurements_token_digest(p_token)' in pg_get_functiondef('public.save_public_measurements(uuid, jsonb)'::regprocedure)) > 0,
  'notification_text_ok', position('تحديث مقاسات' in pg_get_functiondef('public.save_public_measurements(uuid, jsonb)'::regprocedure)) > 0,
  'permission_text_ok', position('تعديل العملاء' in pg_get_functiondef('public.issue_measurements_link(uuid)'::regprocedure)) > 0,
  'anon_definer_functions', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE'))
) as result;
