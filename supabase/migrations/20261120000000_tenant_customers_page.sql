-- Sprint 2 pagination project (seen-cto-sprint2-pagination-task.md),
-- second batch, Customers.tsx. Founder decision (2026-11-17): a "lite"
-- version now -- plain substring (ILIKE) search server-side, no fuzzy/
-- typo-tolerant fallback (Customers.tsx's own client-side fuzzyIncludes
-- stays unused by this function; a full fuzzy rebuild is deferred,
-- tracked alongside the same gap in InventoryManager.tsx).
--
-- Confirmed by reading the code, not guessed: Customers.tsx's balance/
-- creditor/debtor filter and "sort by balance" both need every
-- customer's balance (sum of non-cancelled orders.remaining_amount)
-- computed BEFORE paging -- a plain .range() on the customers table
-- alone would page correctly but silently drop debtors who happen to
-- fall on a page the UI isn't currently viewing. This function computes
-- balance/order_count/total_purchases once per customer in SQL, filters
-- and sorts on it, THEN pages -- so a debtor on "page 3" is still found
-- by the debtor filter regardless of which page is requested.
CREATE OR REPLACE FUNCTION public.get_tenant_customers_page(
  p_tenant_id        UUID,
  p_page             INT,
  p_page_size        INT,
  p_search           TEXT DEFAULT NULL,
  p_category_filter  TEXT DEFAULT 'all',
  p_balance_filter   TEXT DEFAULT 'all',
  p_sort_by          TEXT DEFAULT 'date_desc'
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller_tenant UUID;
  v_offset        INT;
  v_search        TEXT;
  v_result        JSONB;
BEGIN
  v_caller_tenant := public.app_current_tenant_id();
  IF v_caller_tenant IS NULL OR v_caller_tenant <> p_tenant_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_offset := p_page * p_page_size;
  v_search := NULLIF(trim(COALESCE(p_search, '')), '');

  WITH balances AS (
    SELECT o.customer_id,
           SUM(o.remaining_amount) AS balance,
           COUNT(*) AS order_count,
           SUM(o.total_amount) AS total_purchases
      FROM public.orders o
     WHERE o.tenant_id = p_tenant_id
       AND o.status <> 'cancelled'
       AND o.customer_id IS NOT NULL
     GROUP BY o.customer_id
  ),
  filtered AS (
    SELECT c.id, c.name, c.phone, c.email, c.measurements, c.styles, c.notes,
           c.is_test, c.company_name, c.vat_number, c.measurements_token,
           c.created_at, c.updated_at,
           COALESCE(b.balance, 0) AS balance,
           COALESCE(b.order_count, 0) AS order_count,
           COALESCE(b.total_purchases, 0) AS total_purchases
      FROM public.customers c
      LEFT JOIN balances b ON b.customer_id = c.id
     WHERE c.tenant_id = p_tenant_id
       AND (
         v_search IS NULL
         OR c.name ILIKE '%' || v_search || '%'
         OR c.phone ILIKE '%' || v_search || '%'
         OR c.company_name ILIKE '%' || v_search || '%'
         OR c.vat_number ILIKE '%' || v_search || '%'
         OR (c.styles->>'city') ILIKE '%' || v_search || '%'
       )
       AND (
         p_category_filter IS NULL OR p_category_filter = 'all'
         OR (p_category_filter = 'measurements' AND EXISTS (
               SELECT 1 FROM jsonb_each_text(c.measurements) e
                WHERE e.value IS NOT NULL AND e.value <> '' AND e.value <> '0'))
         OR (p_category_filter = 'recent' AND c.created_at >= now() - interval '7 days')
         OR (p_category_filter = 'test' AND c.is_test)
         OR (p_category_filter = 'b2b' AND COALESCE(c.company_name, '') <> '')
         OR (p_category_filter = 'b2c' AND COALESCE(c.company_name, '') = '')
       )
       AND (
         p_balance_filter IS NULL OR p_balance_filter = 'all'
         OR (p_balance_filter = 'debtor' AND COALESCE(b.balance, 0) > 0)
         OR (p_balance_filter = 'creditor' AND COALESCE(b.balance, 0) < 0)
         OR (p_balance_filter = 'balanced' AND COALESCE(b.balance, 0) = 0)
       )
  ),
  paged AS (
    SELECT *, count(*) OVER() AS total_count
      FROM filtered
     ORDER BY
       CASE WHEN p_sort_by = 'name' THEN name END ASC,
       CASE WHEN p_sort_by = 'date_asc' THEN created_at END ASC,
       CASE WHEN p_sort_by = 'balance_desc' THEN balance END DESC,
       CASE WHEN p_sort_by NOT IN ('name', 'date_asc', 'balance_desc') THEN created_at END DESC
     LIMIT p_page_size OFFSET v_offset
  )
  SELECT jsonb_build_object(
    'rows', COALESCE(jsonb_agg(to_jsonb(paged) - 'total_count'), '[]'::jsonb),
    'total', COALESCE(MAX(total_count), (SELECT count(*) FROM filtered))
  ) INTO v_result
  FROM paged;

  RETURN v_result;
END; $$;

REVOKE EXECUTE ON FUNCTION public.get_tenant_customers_page(UUID, INT, INT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_tenant_customers_page(UUID, INT, INT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
