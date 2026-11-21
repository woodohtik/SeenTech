-- seen-verticals-readiness-task.md Phase 8.1: a test shop for every activity
-- other than men's tailoring (staging has real men's shops), is_test = true,
-- with its categories, a few items and two customers. STAGING ONLY.
--   npx supabase db query --linked --file supabase/seed/verticals_test_shops.sql
--
-- No user account is created and no one is given a password (this project's
-- rule): the shops have no owner_uid. To open one, the platform admin uses
-- the shop's page, or a real person is attached to it by hand.
-- Re-running is safe: a shop that already exists is left as it is.
DO $seed$
DECLARE
  v record;
  v_tenant uuid;
  v_branch uuid;
  v_item uuid;
  it record;
  made text := '';
BEGIN
  FOR v IN SELECT key, name_ar FROM public.verticals WHERE key <> 'mens_tailoring' ORDER BY sort LOOP
    IF EXISTS (SELECT 1 FROM public.tenants WHERE is_test AND owner_email = 'vertical-test-' || replace(v.key, '_', '-') || '@example.invalid') THEN
      made := made || v.key || ': exists; ';
      CONTINUE;
    END IF;

    INSERT INTO public.tenants (name, owner_email, phone, status, is_test, vertical, measurement_unit)
    VALUES ('اختبار نشاط — ' || v.name_ar, 'vertical-test-' || replace(v.key, '_', '-') || '@example.invalid',
            '0500000000', 'active', true, v.key, 'cm')
    RETURNING id INTO v_tenant;

    INSERT INTO public.branches (tenant_id, name, location, is_main)
    VALUES (v_tenant, 'الفرع الرئيسي', 'الرياض', true)
    RETURNING id INTO v_branch;

    -- The activity's categories, as the app seeds them on first open.
    INSERT INTO public.tenant_categories (tenant_id, scope, category_key, label_ar, display_order, is_custom, measure_kind)
    SELECT v_tenant, 'inventory', c.category_key, c.label_ar, row_number() OVER (ORDER BY c.sort) - 1, false, c.measure_kind
      FROM public.vertical_inventory_categories c WHERE c.vertical_key = v.key;

    -- Items: the first two length categories by the metre, the first count category by the piece.
    FOR it IN
      (SELECT c.category_key, c.label_ar, c.measure_kind, c.sort FROM public.vertical_inventory_categories c
        WHERE c.vertical_key = v.key AND c.measure_kind = 'length' ORDER BY c.sort LIMIT 2)
      UNION ALL
      (SELECT c.category_key, c.label_ar, c.measure_kind, c.sort FROM public.vertical_inventory_categories c
        WHERE c.vertical_key = v.key AND c.measure_kind = 'count' AND c.category_key <> 'other' ORDER BY c.sort LIMIT 1)
    LOOP
      INSERT INTO public.inventory_items (tenant_id, name, sku, category, category_key, unit, base_unit, conversion_rate,
                                          price_per_unit, min_threshold, is_test)
      VALUES (v_tenant, it.label_ar || ' — صنف اختبار', 'VT-' || upper(left(replace(v.key, '_', ''), 6)) || '-' || it.category_key,
              CASE WHEN it.category_key IN ('fabric','thread','button','lining','accessories','ready_made','other')
                   THEN it.category_key ELSE 'other' END::public.inventory_category,
              it.category_key,
              CASE WHEN it.measure_kind = 'length' THEN 'meter' ELSE 'piece' END::public.inventory_unit,
              CASE WHEN it.measure_kind = 'length' THEN 'meter' ELSE 'piece' END::public.inventory_base_unit,
              1, CASE WHEN it.measure_kind = 'length' THEN 25 ELSE 10 END, 5, true)
      RETURNING id INTO v_item;
      INSERT INTO public.branch_inventory (tenant_id, branch_id, item_id, quantity)
      VALUES (v_tenant, v_branch, v_item, CASE WHEN it.measure_kind = 'length' THEN 120 ELSE 40 END);
    END LOOP;

    INSERT INTO public.customers (tenant_id, name, phone, is_test) VALUES
      (v_tenant, 'عميل اختبار ١', '0500000011', true),
      (v_tenant, 'عميل اختبار ٢', '0500000012', true);

    made := made || v.key || ': created ' || v_tenant || '; ';
  END LOOP;

  RAISE NOTICE 'verticals test shops -- %', made;
END
$seed$;

-- What is there now.
SELECT t.vertical, t.name, t.id,
       (SELECT count(*) FROM public.tenant_categories c WHERE c.tenant_id = t.id) AS categories,
       (SELECT count(*) FROM public.inventory_items i WHERE i.tenant_id = t.id) AS items,
       (SELECT count(*) FROM public.customers c WHERE c.tenant_id = t.id) AS customers
  FROM public.tenants t
 WHERE t.is_test AND t.owner_email LIKE 'vertical-test-%@example.invalid'
 ORDER BY t.vertical;
