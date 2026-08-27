-- =============================================================================
--  دوال RPC لأدوات بيانات "مساعد سين الذكي" (Data Access Tools)
--  ------------------------------------------------------------------------
--  التجميعات (SUM/GROUP BY عبر عدة جداول) أوضح وأكفأ كدالة SQL واحدة بدل
--  جلب صفوف خام وتجميعها في JS. كل دالة تأخذ p_tenant_id كمعامل صريح —
--  السيرفر فقط من يمرره (من جلسة المستخدم)، النموذج لا يراه أبداً. تستبعد
--  جميعها is_test=true والطلبات الملغاة (status='cancelled') بما يطابق نفس
--  منطق Reports.tsx الحالي في الواجهة.
-- =============================================================================

CREATE OR REPLACE FUNCTION assistant_get_sales_summary(
  p_tenant_id uuid, p_start date, p_end date
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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

CREATE OR REPLACE FUNCTION assistant_get_top_selling_items(
  p_tenant_id uuid, p_start date, p_end date, p_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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

CREATE OR REPLACE FUNCTION assistant_get_low_stock_alerts(
  p_tenant_id uuid, p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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

CREATE OR REPLACE FUNCTION assistant_get_revenue_report(
  p_tenant_id uuid, p_start date, p_end date
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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

CREATE OR REPLACE FUNCTION assistant_get_daily_closing(
  p_tenant_id uuid, p_date date
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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
