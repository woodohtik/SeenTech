-- seen-readiness-fixes-task.md P5 (20270106000004). Staging, rolled back
-- (it deletes a real staging shop inside the transaction):
--   npx supabase db query --linked --file supabase/staging-checks/tenant_export_and_archive_test.sql
DO $test$
DECLARE
  admin_uid text;
  s record;
  o record;
  r jsonb;
  inv int;
  ret int;
  checks int := 0;
BEGIN
  SELECT su.uid INTO admin_uid FROM public.saas_users su WHERE su.role = 'super_admin' AND coalesce(su.is_active, true) LIMIT 1;
  SELECT t.id, t.name, t.owner_uid INTO s FROM public.tenants t
   WHERE t.owner_uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.tax_invoices x WHERE x.tenant_id = t.id)
   ORDER BY (SELECT count(*) FROM public.tax_invoices x WHERE x.tenant_id = t.id) DESC LIMIT 1;
  SELECT t.id, t.owner_uid INTO o FROM public.tenants t WHERE t.owner_uid IS NOT NULL AND t.id <> s.id LIMIT 1;
  IF admin_uid IS NULL OR s.id IS NULL OR o.id IS NULL THEN RAISE EXCEPTION 'SKIP: need an admin, a shop with invoices and another shop'; END IF;
  SELECT count(*) INTO inv FROM public.tax_invoices WHERE tenant_id = s.id;
  SELECT count(*) INTO ret FROM public.sales_returns WHERE tenant_id = s.id;

  -- 1. Another shop's owner cannot export it.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', o.owner_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', o.owner_uid::text, true);
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.export_tenant_data(s.id);
    RESET ROLE; RAISE EXCEPTION 'FAIL another owner exported the shop';
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; checks := checks + 1;
  END;

  -- 2. Its own owner can, with every invoice and no secrets.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s.owner_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', s.owner_uid::text, true);
  SET LOCAL ROLE authenticated;
  r := public.export_tenant_data(s.id);
  RESET ROLE;
  IF jsonb_array_length(r->'data'->'tax_invoices') <> inv THEN RAISE EXCEPTION 'FAIL export has % of % invoices', jsonb_array_length(r->'data'->'tax_invoices'), inv; END IF;
  checks := checks + 1;
  IF r::text ~ '"(pin_hash|tracking_token|measurements_token|token_hash)"' THEN RAISE EXCEPTION 'FAIL a secret was exported'; END IF;
  checks := checks + 1;

  -- 3. Deletion needs an export taken after the shop went to the trash.
  UPDATE public.tenants SET trashed_at = now() + interval '1 second' WHERE id = s.id;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  PERFORM set_config('request.jwt.claim.sub', admin_uid, true);
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.permanently_delete_tenant(s.id, s.name);
    RESET ROLE; RAISE EXCEPTION 'FAIL deleted without a fresh export';
  EXCEPTION WHEN invalid_parameter_value THEN RESET ROLE; checks := checks + 1;
  END;

  -- 4. With one, the shop goes and every tax document stays, in the archive.
  UPDATE public.tenants SET trashed_at = now() - interval '1 minute' WHERE id = s.id;
  SET LOCAL ROLE authenticated;
  PERFORM public.permanently_delete_tenant(s.id, s.name);
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM public.tenants WHERE id = s.id) THEN RAISE EXCEPTION 'FAIL not deleted'; END IF;
  checks := checks + 1;
  IF (SELECT count(*) FROM public.tax_document_archive WHERE tenant_id = s.id AND kind = 'invoice') <> inv
     OR (SELECT count(*) FROM public.tax_document_archive WHERE tenant_id = s.id AND kind = 'credit_note') <> ret THEN
    RAISE EXCEPTION 'FAIL archive has % / % (expected % / %)',
      (SELECT count(*) FROM public.tax_document_archive WHERE tenant_id = s.id AND kind = 'invoice'),
      (SELECT count(*) FROM public.tax_document_archive WHERE tenant_id = s.id AND kind = 'credit_note'), inv, ret;
  END IF;
  checks := checks + 1;
  IF (SELECT bool_or(retain_until < (issued_at + interval '6 years')::date) FROM public.tax_document_archive WHERE tenant_id = s.id) THEN RAISE EXCEPTION 'FAIL retention date'; END IF;
  checks := checks + 1;
  -- 5. The export outlived the shop.
  IF NOT EXISTS (SELECT 1 FROM public.tenant_data_exports WHERE tenant_id = s.id) THEN RAISE EXCEPTION 'FAIL export lost'; END IF;
  checks := checks + 1;
  RAISE EXCEPTION 'PASS: % checks (% invoices, % returns archived)', checks, inv, ret;
END
$test$;
