-- Rollback of 20270102000000_revoke_reopened_function_grants.sql.
-- Restores the guarded functions' previous bodies. It deliberately does NOT
-- reopen the function grants or recreate remap_user_uid: that state was the
-- security hole. Re-grant a single function by hand if one turns out to be needed.
CREATE OR REPLACE FUNCTION public.assistant_get_daily_closing(p_tenant_id uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE result jsonb; by_method jsonb; returns_total numeric;
BEGIN
  SELECT COALESCE(jsonb_object_agg(payment_method, method_total), '{}'::jsonb) INTO by_method
  FROM (
    SELECT payment_method, SUM(total_amount) AS method_total
    FROM orders
    WHERE tenant_id = p_tenant_id AND is_test IS NOT TRUE AND status <> 'cancelled'
      AND order_date::date = p_date
    GROUP BY payment_method
  ) m;

  SELECT COALESCE(SUM(refunded_amount), 0) INTO returns_total
  FROM sales_returns
  WHERE tenant_id = p_tenant_id AND returned_at::date = p_date;

  SELECT jsonb_build_object(
    'totalSales', COALESCE(SUM(total_amount), 0),
    'totalRevenueCollected', COALESCE(SUM(paid_amount), 0),
    'invoiceCount', COUNT(*),
    'byPaymentMethod', by_method,
    'returnsTotal', returns_total
  ) INTO result
  FROM orders
  WHERE tenant_id = p_tenant_id AND is_test IS NOT TRUE AND status <> 'cancelled'
    AND order_date::date = p_date;
  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assistant_get_low_stock_alerts(p_tenant_id uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO result
  FROM (
    SELECT
      i.name,
      i.sku,
      i.unit,
      i.min_threshold,
      COALESCE(SUM(bi.quantity), 0) AS current_quantity
    FROM inventory_items i
    LEFT JOIN branch_inventory bi ON bi.item_id = i.id AND bi.tenant_id = i.tenant_id
    WHERE i.tenant_id = p_tenant_id
      AND i.is_test IS NOT TRUE
      AND i.min_threshold IS NOT NULL
    GROUP BY i.id, i.name, i.sku, i.unit, i.min_threshold
    HAVING COALESCE(SUM(bi.quantity), 0) <= i.min_threshold
    ORDER BY (COALESCE(SUM(bi.quantity), 0) - i.min_threshold) ASC
    LIMIT LEAST(GREATEST(p_limit, 1), 50)
  ) t;
  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assistant_get_revenue_report(p_tenant_id uuid, p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE result jsonb; by_method jsonb;
BEGIN
  SELECT COALESCE(jsonb_object_agg(payment_method, method_total), '{}'::jsonb) INTO by_method
  FROM (
    SELECT payment_method, SUM(total_amount) AS method_total
    FROM orders
    WHERE tenant_id = p_tenant_id AND is_test IS NOT TRUE AND status <> 'cancelled'
      AND order_date::date BETWEEN p_start AND p_end
    GROUP BY payment_method
  ) m;

  SELECT jsonb_build_object(
    'totalSales', COALESCE(SUM(total_amount), 0),
    'totalRevenueCollected', COALESCE(SUM(paid_amount), 0),
    'totalTax', COALESCE(SUM(tax_amount), 0),
    'totalDiscount', COALESCE(SUM(discount_amount), 0),
    'invoiceCount', COUNT(*),
    'averageOrderValue', CASE WHEN COUNT(*) > 0 THEN SUM(total_amount) / COUNT(*) ELSE 0 END,
    'byPaymentMethod', by_method,
    'note', 'لا يتضمن هامش الربح/تكلفة البضاعة لعدم توفر بيانات تكلفة الشراء في هذا النظام حالياً'
  ) INTO result
  FROM orders
  WHERE tenant_id = p_tenant_id AND is_test IS NOT TRUE AND status <> 'cancelled'
    AND order_date::date BETWEEN p_start AND p_end;
  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assistant_get_sales_summary(p_tenant_id uuid, p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'totalSales', COALESCE(SUM(total_amount), 0),
    'totalRevenueCollected', COALESCE(SUM(paid_amount), 0),
    'totalTax', COALESCE(SUM(tax_amount), 0),
    'invoiceCount', COUNT(*)
  ) INTO result
  FROM orders
  WHERE tenant_id = p_tenant_id
    AND is_test IS NOT TRUE
    AND status <> 'cancelled'
    AND order_date::date BETWEEN p_start AND p_end;
  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assistant_get_top_selling_items(p_tenant_id uuid, p_start date, p_end date, p_limit integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO result
  FROM (
    SELECT
      oi.name,
      SUM(oi.quantity) AS total_quantity,
      SUM(COALESCE(oi.price, 0) * COALESCE(oi.quantity, 1)) AS total_revenue
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE oi.tenant_id = p_tenant_id
      AND o.tenant_id = p_tenant_id
      AND o.is_test IS NOT TRUE
      AND o.status <> 'cancelled'
      AND o.order_date::date BETWEEN p_start AND p_end
    GROUP BY oi.name
    ORDER BY total_quantity DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 50)
  ) t;
  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.zatca_advance_chain_with_real_hash(p_tenant_id uuid, p_order_id uuid, p_real_hash text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_updated INT;
BEGIN
  PERFORM 1 FROM public.zatca_invoice_chain_state
   WHERE tenant_id = p_tenant_id
   FOR UPDATE;

  UPDATE public.zatca_invoice_chain_state
     SET last_invoice_hash = p_real_hash, updated_at = now()
   WHERE tenant_id = p_tenant_id
     AND last_invoice_id = p_order_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END $function$;

CREATE OR REPLACE FUNCTION public.allocate_tenant_invoice_number(p_tenant uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_num bigint;
BEGIN
  INSERT INTO public.tenant_order_counters (tenant_id)
  VALUES (p_tenant)
  ON CONFLICT (tenant_id) DO NOTHING;

  UPDATE public.tenant_order_counters
     SET next_invoice_number = next_invoice_number + 1
   WHERE tenant_id = p_tenant
  RETURNING next_invoice_number - 1 INTO v_num;

  RETURN v_num;
END $function$;

CREATE OR REPLACE FUNCTION public.allocate_tenant_sale_numbers(p_tenant uuid)
 RETURNS TABLE(order_number bigint, invoice_number bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.tenant_order_counters (tenant_id)
  VALUES (p_tenant)
  ON CONFLICT (tenant_id) DO NOTHING;

  RETURN QUERY
  UPDATE public.tenant_order_counters t
     SET next_order_number = t.next_order_number + 1,
         next_invoice_number = t.next_invoice_number + 1
   WHERE t.tenant_id = p_tenant
  RETURNING t.next_order_number - 1, t.next_invoice_number - 1;
END $function$;

CREATE OR REPLACE FUNCTION public.allocate_tenant_voucher_number(p_tenant uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_num bigint;
BEGIN
  INSERT INTO public.tenant_voucher_counters (tenant_id) VALUES (p_tenant)
  ON CONFLICT (tenant_id) DO NOTHING;

  UPDATE public.tenant_voucher_counters
     SET next_voucher_number = next_voucher_number + 1
   WHERE tenant_id = p_tenant
  RETURNING next_voucher_number - 1 INTO v_num;

  RETURN v_num;
END $function$;

CREATE OR REPLACE FUNCTION public.confirm_referral(p_referred_tenant uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r referrals%ROWTYPE;
BEGIN
  SELECT * INTO r FROM referrals WHERE referred_tenant_id = p_referred_tenant AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF now() <= r.qualified_until THEN
    UPDATE referrals SET status='credited', credited_at=now() WHERE id = r.id;
    INSERT INTO referral_wallets(tenant_id, balance, total_earned, updated_at)
      VALUES (r.referrer_tenant_id, r.reward_amount, r.reward_amount, now())
      ON CONFLICT (tenant_id) DO UPDATE
        SET balance = referral_wallets.balance + r.reward_amount,
            total_earned = referral_wallets.total_earned + r.reward_amount, updated_at = now();
  ELSE
    UPDATE referrals SET status='expired' WHERE id = r.id;
  END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public.confirm_partner_referral(p_referred_tenant uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r partner_referrals%ROWTYPE;
BEGIN
  SELECT * INTO r FROM partner_referrals WHERE referred_tenant_id = p_referred_tenant AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF now() <= r.qualified_until THEN
    UPDATE partner_referrals SET status='credited', credited_at=now() WHERE id = r.id;
    INSERT INTO partner_wallets(partner_id, balance, total_earned, updated_at)
      VALUES (r.partner_id, r.reward_amount, r.reward_amount, now())
      ON CONFLICT (partner_id) DO UPDATE
        SET balance = partner_wallets.balance + r.reward_amount,
            total_earned = partner_wallets.total_earned + r.reward_amount, updated_at = now();
  ELSE
    UPDATE partner_referrals SET status='expired' WHERE id = r.id;
  END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public.app_is_super_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    is_admin BOOLEAN;
    cur_uid TEXT;
BEGIN
    cur_uid := app_current_uid();
    IF cur_uid IS NULL THEN RETURN FALSE; END IF;
    SELECT TRUE INTO is_admin FROM saas_users WHERE uid = cur_uid AND role = 'super_admin' AND is_active = true;
    RETURN COALESCE(is_admin, FALSE);
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_pin_verify_failure(p_key text, p_max_attempts integer DEFAULT 5, p_max_lock_minutes integer DEFAULT 15)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_fail_count   integer;
  v_lock_minutes integer;
  v_lock_until   timestamptz;
BEGIN
  INSERT INTO pin_verify_attempts (attempt_key, fail_count, lock_minutes, updated_at)
  VALUES (p_key, 1, 1, now())
  ON CONFLICT (attempt_key) DO UPDATE SET
    fail_count = pin_verify_attempts.fail_count + 1,
    updated_at = now()
  RETURNING fail_count, lock_minutes INTO v_fail_count, v_lock_minutes;

  IF v_fail_count >= p_max_attempts THEN
    v_lock_until := now() + (v_lock_minutes || ' minutes')::interval;
    UPDATE pin_verify_attempts
       SET lock_until = v_lock_until,
           lock_minutes = LEAST(v_lock_minutes * 2, p_max_lock_minutes),
           fail_count = 0
     WHERE attempt_key = p_key;
    RETURN v_lock_until;
  END IF;

  RETURN NULL;
END;
$function$;

DROP FUNCTION IF EXISTS public.app_assert_tenant_access(uuid);
DROP FUNCTION IF EXISTS public.app_is_client_call();
