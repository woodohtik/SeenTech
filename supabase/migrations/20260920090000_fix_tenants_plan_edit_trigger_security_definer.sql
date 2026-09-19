-- Found while verifying the tax_invoices immutability fix
-- (20260920020000): tenants_block_client_plan_edit() (from
-- 20260822090400_tenants_owner_update_and_plan_guard.sql) has the exact
-- same SECURITY DEFINER bug just fixed on prevent_tax_invoice_tamper() --
-- current_user inside it always reflects the function's owner, so its
-- `current_user IN ('postgres', 'service_role')` check was always true
-- and the trigger never actually blocked anything, for anyone.
--
-- No live impact, verified: a separate, later, correctly-implemented
-- trigger (tenants_no_self_billing_escalation_trigger, from
-- 20260908040000_tenants_no_self_billing_escalation.sql) already blocks
-- self-editing every column this one covers and more (owner_uid,
-- referred_by, enabled_modules, assistant_enabled, is_test, the trial
-- columns) -- it only checks app_is_super_admin(), which is unaffected
-- by SECURITY DEFINER since it reads JWT claims, not current_user. Both
-- triggers fire BEFORE UPDATE on tenants; alphabetically "block" sorts
-- before "no_self", so this one runs first, silently does nothing, and
-- the real trigger catches everything regardless. Verified live:
-- an authenticated-role status change was blocked, but with
-- tenants_no_self_billing_escalation's error text, not this function's.
--
-- Fixed anyway (dead code with a live-looking bug is worse than no code
-- for anyone auditing this later) by dropping SECURITY DEFINER, same as
-- the tax_invoices fix.
CREATE OR REPLACE FUNCTION public.tenants_block_client_plan_edit() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF app_is_super_admin() OR current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;

  IF NEW.plan_id IS DISTINCT FROM OLD.plan_id THEN
    RAISE EXCEPTION 'تغيير الباقة يتطلب مساراً إدارياً، لا تحديثاً مباشراً';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'تغيير حالة الحساب يتطلب مساراً إدارياً، لا تحديثاً مباشراً';
  END IF;

  IF OLD.trial_started_at IS NOT NULL THEN
    IF NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
       OR NEW.is_trial IS DISTINCT FROM OLD.is_trial
       OR NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at
       OR NEW.trial_started_at IS DISTINCT FROM OLD.trial_started_at
       OR NEW.locked_at IS DISTINCT FROM OLD.locked_at
       OR NEW.purge_at IS DISTINCT FROM OLD.purge_at THEN
      RAISE EXCEPTION 'تعديل حالة الاشتراك/التجربة يتطلب مساراً إدارياً، لا تحديثاً مباشراً';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
