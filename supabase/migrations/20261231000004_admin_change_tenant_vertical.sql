-- =============================================================================
-- seen-verticals-readiness-task.md Phase 7.2: the platform admin changes a
-- shop's activity -- only while the shop has no orders (its orders' stages and
-- statuses belong to the old activity; moving a shop that has orders needs a
-- documented stage conversion, not this). Every change is written to
-- saas_security_logs.
-- SECURITY DEFINER for the audit insert and the tenants update; it checks the
-- caller is the platform admin first. Running as the owner, it passes the
-- readiness gate (20261231000000), so the admin may also set a beta or
-- coming_soon activity -- e.g. for a test shop.
-- Rollback: supabase/rollbacks/20261231_admin_change_tenant_vertical.down.sql.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_change_tenant_vertical(p_tenant_id uuid, p_vertical text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old    text;
  v_name   text;
  v_orders int;
  v_email  text;
BEGIN
  IF NOT public.app_is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.verticals WHERE key = p_vertical AND is_active) THEN
    RAISE EXCEPTION 'نشاط غير معروف: %', p_vertical USING ERRCODE = '22023';
  END IF;

  SELECT vertical, name INTO v_old, v_name FROM public.tenants WHERE id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المحل غير موجود' USING ERRCODE = '22023';
  END IF;
  IF v_old = p_vertical THEN
    RETURN jsonb_build_object('changed', false, 'vertical', v_old);
  END IF;

  SELECT count(*) INTO v_orders FROM public.orders WHERE tenant_id = p_tenant_id;
  IF v_orders > 0 THEN
    RAISE EXCEPTION 'لا يمكن تغيير نشاط محل لديه طلبات (%) -- مراحل طلباته وحالاتها من النشاط الحالي', v_orders
      USING ERRCODE = '23514', HINT = 'tenant_has_orders';
  END IF;

  UPDATE public.tenants SET vertical = p_vertical WHERE id = p_tenant_id;

  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  INSERT INTO public.saas_security_logs (user_id, user_email, action, details, occurred_at)
  VALUES (auth.uid()::text, v_email, 'change_tenant_vertical',
          format('tenant %s (%s): %s -> %s', p_tenant_id, v_name, v_old, p_vertical), now());

  RETURN jsonb_build_object('changed', true, 'from', v_old, 'to', p_vertical);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_change_tenant_vertical(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_change_tenant_vertical(uuid, text) TO authenticated, service_role;
