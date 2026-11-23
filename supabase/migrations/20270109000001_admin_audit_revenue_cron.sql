-- seen-readiness-fixes-task.md P6 (PLATFORM-09, -18, -20) -- the admin's
-- actions logged by the server, Seen's own revenue, and the scheduled jobs
-- watched.
--
--  * saas_log_admin_action(action, details): writes saas_security_logs (no
--    foreign key to tenants, so a line about a deleted shop stays). Called
--    from inside trash_tenant, restore_tenant, permanently_delete_tenant,
--    approve_ and reject_subscription_request -- the browser's own log lines
--    could be skipped, and the one after a permanent delete always failed.
--  * get_saas_revenue_report: Seen's revenue is its subscription payments
--    (it summed every shop's sales), per month, with the MRR of shops on an
--    active paid subscription (yearly price / 12), test shops left out.
--  * saas_cron_health(): the scheduled jobs and how each last ran, for the
--    server's daily check; says so plainly when pg_cron is not installed.
--  * app_current_tenant_id: a trial past its end is closed even when the
--    lock sweep has not run.
-- Rollback: supabase/rollbacks/20270109_admin_audit_revenue_cron.down.sql

CREATE OR REPLACE FUNCTION public.saas_log_admin_action(p_action text, p_details text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   text := auth.uid()::text;
  v_email text;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  INSERT INTO public.saas_security_logs (user_id, user_email, action, details, occurred_at)
  VALUES (CASE WHEN EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_uid) THEN v_uid END, v_email, p_action, left(p_details, 2000), now());
END;
$function$;
REVOKE ALL ON FUNCTION public.saas_log_admin_action(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_saas_revenue_report()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_revenue numeric;
  v_monthly jsonb;
  v_mrr numeric;
  v_paying int;
BEGIN
  IF NOT app_is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: super admin only';
  END IF;
  -- P6 (PLATFORM-18): Seen's revenue is what shops paid Seen.
  SELECT COALESCE(SUM(sp.amount), 0) INTO v_total_revenue
    FROM saas_subscription_payments sp
    LEFT JOIN tenants t ON t.id = sp.tenant_id
   WHERE NOT COALESCE(t.is_test, false);
  SELECT COALESCE(jsonb_agg(m ORDER BY m.month_start), '[]'::jsonb) INTO v_monthly
  FROM (
    SELECT date_trunc('month', sp.created_at AT TIME ZONE 'Asia/Riyadh') AS month_start,
           SUM(sp.amount) AS revenue
    FROM saas_subscription_payments sp
    LEFT JOIN tenants t ON t.id = sp.tenant_id
    WHERE NOT COALESCE(t.is_test, false)
      AND sp.created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Riyadh') - interval '11 months') AT TIME ZONE 'Asia/Riyadh'
    GROUP BY date_trunc('month', sp.created_at AT TIME ZONE 'Asia/Riyadh')
  ) m;
  SELECT COALESCE(SUM(CASE WHEN COALESCE(p.billing_period, 'year') = 'month' THEN p.price ELSE p.price / 12.0 END), 0), count(*)
    INTO v_mrr, v_paying
    FROM tenants t JOIN plans p ON p.id = t.plan_id
   WHERE t.subscription_status = 'active' AND NOT COALESCE(t.is_trial, false) AND NOT COALESCE(t.is_test, false)
     AND t.trashed_at IS NULL AND COALESCE(p.price, 0) > 0
     AND (t.subscription_end_date IS NULL OR t.subscription_end_date > now());
  RETURN jsonb_build_object('total_revenue', v_total_revenue, 'monthly', v_monthly, 'mrr', round(v_mrr, 2), 'paying_shops', v_paying);
END; $function$;

CREATE OR REPLACE FUNCTION public.saas_cron_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_jobs jsonb;
BEGIN
  IF auth.role() = 'authenticated' AND NOT app_is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF to_regclass('cron.job') IS NULL THEN
    RETURN jsonb_build_object('pg_cron', false, 'jobs', '[]'::jsonb);
  END IF;
  EXECUTE $q$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
             'last_status', r.status, 'last_start', r.start_time, 'last_end', r.end_time,
             'last_message', left(r.return_message, 300)) ORDER BY j.jobname), '[]'::jsonb)
      FROM cron.job j
      LEFT JOIN LATERAL (SELECT d.status, d.start_time, d.end_time, d.return_message
                           FROM cron.job_run_details d WHERE d.jobid = j.jobid
                          ORDER BY d.start_time DESC LIMIT 1) r ON true
  $q$ INTO v_jobs;
  RETURN jsonb_build_object('pg_cron', true, 'jobs', v_jobs);
END;
$function$;
REVOKE ALL ON FUNCTION public.saas_cron_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saas_cron_health() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trash_tenant(p_tenant_id uuid, p_confirm_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name TEXT;
BEGIN
  IF NOT public.app_is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT name INTO v_name FROM public.tenants WHERE id = p_tenant_id FOR UPDATE;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'التاجر غير موجود' USING ERRCODE = '42501';
  END IF;
  IF v_name IS DISTINCT FROM p_confirm_name THEN
    RAISE EXCEPTION 'الاسم المُدخل لا يطابق اسم التاجر' USING ERRCODE = '22023';
  END IF;

  UPDATE public.tenants
     SET trashed_at = now(), trashed_by = app_current_uid()
   WHERE id = p_tenant_id AND trashed_at IS NULL;
  PERFORM public.saas_log_admin_action('trash_tenant', format('tenant %s (%s)', p_tenant_id, v_name));
END $function$
;

CREATE OR REPLACE FUNCTION public.restore_tenant(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.app_is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.tenants
     SET trashed_at = NULL, trashed_by = NULL
   WHERE id = p_tenant_id;
  PERFORM public.saas_log_admin_action('restore_tenant', format('tenant %s (%s)', p_tenant_id,
    (SELECT name FROM public.tenants WHERE id = p_tenant_id)));
END $function$
;

CREATE OR REPLACE FUNCTION public.permanently_delete_tenant(p_tenant_id uuid, p_confirm_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name       TEXT;
  v_trashed_at TIMESTAMPTZ;
BEGIN
  IF NOT public.app_is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT name, trashed_at INTO v_name, v_trashed_at FROM public.tenants WHERE id = p_tenant_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'التاجر غير موجود' USING ERRCODE = '42501';
  END IF;
  IF v_trashed_at IS NULL THEN
    RAISE EXCEPTION 'يجب نقل التاجر لسلة المهملات أولاً قبل الحذف النهائي' USING ERRCODE = '22023';
  END IF;
  IF v_name IS DISTINCT FROM p_confirm_name THEN
    RAISE EXCEPTION 'الاسم المُدخل لا يطابق اسم التاجر' USING ERRCODE = '22023';
  END IF;
  -- P5 (PLATFORM-08): an export taken after the shop went to the trash, first.
  IF NOT EXISTS (SELECT 1 FROM public.tenant_data_exports e WHERE e.tenant_id = p_tenant_id AND e.created_at >= v_trashed_at) THEN
    RAISE EXCEPTION 'صدّر بيانات المحل أولاً: يلزم تصدير بعد نقله إلى سلة المهملات' USING ERRCODE = '22023';
  END IF;
  -- ...and its tax documents are kept, apart from the shop, for the legal period.
  INSERT INTO public.tax_document_archive (tenant_id, tenant_name, kind, document_id, issued_at, document, retain_until)
  SELECT p_tenant_id, v_name, 'invoice', ti.id, ti.created_at, to_jsonb(ti), (ti.created_at + interval '6 years')::date
    FROM public.tax_invoices ti WHERE ti.tenant_id = p_tenant_id
  ON CONFLICT (kind, document_id) DO NOTHING;
  INSERT INTO public.tax_document_archive (tenant_id, tenant_name, kind, document_id, issued_at, document, retain_until)
  SELECT p_tenant_id, v_name, 'credit_note', sr.id, sr.created_at,
         to_jsonb(sr) || jsonb_build_object('items', COALESCE((SELECT jsonb_agg(to_jsonb(i)) FROM public.sales_return_items i WHERE i.return_id = sr.id), '[]'::jsonb)),
         (sr.created_at + interval '6 years')::date
    FROM public.sales_returns sr WHERE sr.tenant_id = p_tenant_id
  ON CONFLICT (kind, document_id) DO NOTHING;
  -- P6 (PLATFORM-09): logged here, before the row goes -- the browser's own
  -- log line pointed at the deleted shop and was refused by its foreign key.
  PERFORM public.saas_log_admin_action('permanently_delete_tenant', format('tenant %s (%s), trashed %s, tax documents archived: %s',
    p_tenant_id, v_name, v_trashed_at, (SELECT count(*) FROM public.tax_document_archive WHERE tenant_id = p_tenant_id)));
  DELETE FROM public.tenants WHERE id = p_tenant_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.approve_subscription_request(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_req    record;
  v_period text;
  v_start  timestamptz;
  v_end    timestamptz;
BEGIN
  IF NOT app_is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req FROM public.subscription_requests WHERE id = p_request_id FOR UPDATE;
  IF v_req IS NULL THEN
    RAISE EXCEPTION 'subscription request not found' USING ERRCODE = '02000';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'already_processed: request is already %', v_req.status USING ERRCODE = '22023';
  END IF;

  UPDATE public.subscription_requests
     SET status = 'approved', updated_at = now()
   WHERE id = p_request_id;

  -- seen-readiness-fixes-task.md P5 (PLATFORM-06): the plan's own period
  -- (was a year for every plan), from the later of today and the current end.
  SELECT COALESCE(billing_period, 'year') INTO v_period FROM public.plans WHERE id = v_req.plan_id;
  SELECT GREATEST(now(), COALESCE(subscription_end_date, now())) INTO v_start FROM public.tenants WHERE id = v_req.tenant_id;
  v_end := v_start + CASE WHEN v_period = 'month' THEN interval '1 month' ELSE interval '1 year' END;

  UPDATE public.tenants
     SET plan_id = v_req.plan_id,
         status = 'active',
         subscription_status = 'active',
         is_trial = false,
         locked_at = NULL,
         purge_at = NULL,
         subscription_end_date = v_end,
         updated_at = now()
   WHERE id = v_req.tenant_id;

  -- P5 (PLATFORM-05, PLATFORM-06, question 7): Seen's own payment, for every
  -- plan, in Seen's own ledger with a receipt number -- not in the shop's
  -- payments (its sales), which the billing page used to show as Seen's.
  INSERT INTO public.saas_subscription_payments (
    tenant_id, request_id, plan_id, plan_name, amount, original_amount, discount_amount,
    payment_method, reference, period_start, period_end)
  VALUES (
    v_req.tenant_id, v_req.id, v_req.plan_id, v_req.plan_name, COALESCE(v_req.amount, 0),
    v_req.original_amount, v_req.discount_amount, v_req.payment_method,
    COALESCE(v_req.reference_no, 'APPROVED-' || to_char(now(), 'YYYYMMDDHH24MISS')), v_start, v_end)
  ON CONFLICT (request_id) DO NOTHING;
  PERFORM public.saas_log_admin_action('approve_subscription_request', format('request %s, tenant %s, plan %s, amount %s, until %s',
    v_req.id, v_req.tenant_id, v_req.plan_id, COALESCE(v_req.amount, 0), v_end));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reject_subscription_request(p_request_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_req public.subscription_requests;
BEGIN
  IF NOT app_is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req FROM public.subscription_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'subscription request not found' USING ERRCODE = '02000';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'already_processed: request is already %', v_req.status USING ERRCODE = '22023';
  END IF;

  UPDATE public.subscription_requests
     SET status = 'rejected', rejection_reason = p_reason, updated_at = now()
   WHERE id = p_request_id;

  IF v_req.coupon_id IS NOT NULL THEN
    UPDATE public.coupons SET redemption_count = GREATEST(redemption_count - 1, 0), updated_at = now()
     WHERE id = v_req.coupon_id;
  END IF;
  PERFORM public.saas_log_admin_action('reject_subscription_request', format('request %s, tenant %s, reason: %s',
    v_req.id, v_req.tenant_id, COALESCE(p_reason, '')));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.app_current_tenant_id()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    t_id UUID;
    cur_uid TEXT;
    t_status TEXT;
    t_trashed_at TIMESTAMPTZ;
    t_sub_status TEXT;
    t_sub_end TIMESTAMPTZ;
    t_trial_end TIMESTAMPTZ;
BEGIN
    cur_uid := app_current_uid();
    IF cur_uid IS NULL THEN RETURN NULL; END IF;

    -- 1. Check if user is staff (Owner is often also staff). Deterministic
    -- order: a user can hold more than one active staff row (across
    -- tenants); always resolve to the earliest one.
    SELECT tenant_id INTO t_id FROM staff
     WHERE uid = cur_uid AND status = 'active'
     ORDER BY created_at ASC
     LIMIT 1;

    -- 2. Check if user is owner directly from tenants table
    IF t_id IS NULL THEN
        SELECT id INTO t_id FROM tenants
         WHERE owner_uid = cur_uid
         ORDER BY created_at ASC
         LIMIT 1;
    END IF;

    IF t_id IS NULL THEN RETURN NULL; END IF;

    -- 3. Inactive, trashed, locked/purge_pending, or an expired paid term:
    -- every RLS policy keyed on this function stops matching any row for
    -- them, owner and staff alike.
    SELECT status, trashed_at, subscription_status, subscription_end_date, trial_ends_at
      INTO t_status, t_trashed_at, t_sub_status, t_sub_end, t_trial_end
      FROM tenants WHERE id = t_id;

    IF t_status = 'inactive' THEN
        RETURN NULL;
    END IF;

    IF t_trashed_at IS NOT NULL THEN
        RETURN NULL;
    END IF;

    IF t_sub_status IN ('locked', 'purge_pending') THEN
        RETURN NULL;
    END IF;
    -- P6 (PLATFORM-20): a second line behind the lock sweep -- a trial past
    -- its end is closed even if the scheduled sweep did not run.
    IF t_sub_status = 'trial' AND t_trial_end IS NOT NULL AND t_trial_end < now() THEN
        RETURN NULL;
    END IF;

    -- P5 (PLATFORM-02): 3 days' grace, as trial_lock_sweep.
    IF t_sub_end IS NOT NULL AND t_sub_end + interval '3 days' < now() THEN
        RETURN NULL;
    END IF;

    RETURN t_id;
END;
$function$
;
