-- seen-permissions-fix-task.md Phase 0: the permissions matrix, measured on
-- the server (the database the app calls), not through the UI.
--   npx supabase db query --linked --file supabase/tests/permissions_matrix.sql
-- (scripts/permissions/verify-matrix.ts runs it and writes the markdown.)
--
-- Everything happens inside one transaction that ends in RAISE EXCEPTION, so
-- nothing stays: a throwaway shop, one employee per role (the eight roles), a
-- custom role, and an employee with a personal exception. No login account
-- and no password is created (this project's rule) -- each employee is a
-- staff row whose uid is put in request.jwt.claims, the way PostgREST does.
--
-- Two modes, per the task:
--   a) the employee calls with their own identity;
--   b) the shop owner's device, the employee switched in by PIN -- the JWT is
--      the owner's, the employee is named only by the acting-staff header
--      (x-seen-acting-staff). Before Phase 2 nothing reads that header.
--
-- Each action runs in its own sub-transaction that is always rolled back,
-- so one action never changes the next one's starting point. Outcomes:
--   allow | deny (refused by a permission/RLS check) | error:<code>:<message>
-- The result is raised as 'MATRIX:<json>'.
DO $matrix$
DECLARE
  T  uuid := 'a0000000-0000-4000-8000-0000000000a1';
  T2 uuid := 'a0000000-0000-4000-8000-0000000000a2';
  B  uuid := 'a0000000-0000-4000-8000-0000000000b1';
  B2 uuid := 'a0000000-0000-4000-8000-0000000000b2';
  OWNER_UID text := 'a0000000-0000-4000-8000-00000000f000';
  OWNER_STAFF uuid := 'a0000000-0000-4000-8000-00000000e000';
  C  uuid := 'a0000000-0000-4000-8000-0000000000c1';
  C2 uuid := 'a0000000-0000-4000-8000-0000000000c2';
  I  uuid := 'a0000000-0000-4000-8000-0000000000d1';
  I2 uuid := 'a0000000-0000-4000-8000-0000000000d2';
  S  uuid := 'a0000000-0000-4000-8000-0000000000e1';
  CUSTOM_ROLE uuid := 'a0000000-0000-4000-8000-0000000000f1';
  O1 uuid;
  O2 uuid;
  ITEM2 uuid;
  v_res jsonb;
  st record;
  a record;
  q text;
  n bigint;
  v_bool boolean;
  v_json jsonb;
  outcome text;
  mode text;
  token text;
  row_a jsonb;
  row_b jsonb;
  result jsonb := '{}'::jsonb;
  has_sessions boolean := to_regclass('public.staff_acting_sessions') IS NOT NULL;
  actions jsonb := jsonb_build_array(
    -- key, kind (exec: no error = allow; rows: rows touched > 0; value: query returns true), sql
    jsonb_build_object('k','orders.create','kind','exec','q',
      $q$SELECT public.create_tailoring_order(gen_random_uuid(), jsonb_build_object('customer_id', :C, 'paid_amount', 0, 'status', 'measurements_taken', 'status_key', 'measurements_taken'), '[{"garment_type":"ثوب","quantity":1,"price":100}]'::jsonb)$q$),
    jsonb_build_object('k','orders.edit','kind','rows','q',
      $q$UPDATE public.orders SET notes = coalesce(notes, '') || ' ' WHERE id = :O1$q$),
    jsonb_build_object('k','orders.update_status','kind','exec','q',
      $q$SELECT public.update_order_status(:O1, 'cutting', 'cutting', NULL, gen_random_uuid(), NULL)$q$),
    jsonb_build_object('k','order.payment','kind','exec','q',
      $q$SELECT public.record_order_payment(gen_random_uuid(), :O1, 10, 'cash', :SHIFT, NULL, NULL, NULL)$q$),
    jsonb_build_object('k','pos.sale','kind','exec','q',
      $q$SELECT public.create_pos_sale(gen_random_uuid(), jsonb_build_object('shift_id', :SHIFT, 'customer_name', 'Walk-in', 'status', 'ready', 'payment_method', 'cash', 'paid_amount', 100, 'delivery_date', now()::text), '[{"type":"custom","price":100,"quantity":1}]'::jsonb, '{}'::jsonb)$q$),
    jsonb_build_object('k','pos.discount','kind','exec','q',
      $q$SELECT public.create_pos_sale(gen_random_uuid(), jsonb_build_object('shift_id', :SHIFT, 'customer_name', 'Walk-in', 'status', 'ready', 'payment_method', 'cash', 'paid_amount', 90, 'delivery_date', now()::text), '[{"type":"custom","price":100,"quantity":1}]'::jsonb, '{"discount_type":"percent","discount_value":10}'::jsonb)$q$),
    -- attr: the call returns the sale; its order's created_by must be the acting employee.
    jsonb_build_object('k','pos.sale_attributed_to_actor','kind','attr','q',
      $q$SELECT public.create_pos_sale(gen_random_uuid(), jsonb_build_object('shift_id', :SHIFT, 'customer_name', 'Walk-in', 'status', 'ready', 'payment_method', 'cash', 'paid_amount', 100, 'delivery_date', now()::text), '[{"type":"custom","price":100,"quantity":1}]'::jsonb, '{}'::jsonb)$q$),
    jsonb_build_object('k','action.refund','kind','exec','q',
      $q$SELECT public.process_sales_return(gen_random_uuid(), :O2, :SHIFT, jsonb_build_array(jsonb_build_object('order_item_id', :ITEM2, 'quantity', 1)))$q$),
    jsonb_build_object('k','orders.delete','kind','rows','q',
      $q$DELETE FROM public.orders WHERE id = :O1$q$),
    jsonb_build_object('k','customers.delete','kind','rows','q',
      $q$DELETE FROM public.customers WHERE id = :C2$q$),
    jsonb_build_object('k','inventory.delete','kind','rows','q',
      $q$DELETE FROM public.inventory_items WHERE id = :I2$q$),
    jsonb_build_object('k','customers.create','kind','exec','q',
      $q$INSERT INTO public.customers (tenant_id, name, phone) VALUES (:T, 'عميل مصفوفة', '0500000099')$q$),
    jsonb_build_object('k','customers.edit','kind','rows','q',
      $q$UPDATE public.customers SET name = name WHERE id = :C$q$),
    jsonb_build_object('k','inventory.create','kind','exec','q',
      $q$INSERT INTO public.inventory_items (tenant_id, name, sku, category, unit, conversion_rate) VALUES (:T, 'صنف مصفوفة', 'PM-' || left(gen_random_uuid()::text, 8), 'other', 'piece', 1)$q$),
    jsonb_build_object('k','inventory.edit','kind','rows','q',
      $q$UPDATE public.inventory_items SET name = name WHERE id = :I$q$),
    jsonb_build_object('k','inventory.reconcile','kind','exec','q',
      $q$SELECT public.approve_stock_take(gen_random_uuid(), :B, 'Physical Count', NULL, jsonb_build_array(jsonb_build_object('item_id', :I, 'physical_qty', 90)), 'Approved')$q$),
    jsonb_build_object('k','inventory.transfer','kind','exec','q',
      $q$SELECT public.transfer_ship_item(gen_random_uuid()::text, gen_random_uuid(), :B, :I, 1)$q$),
    jsonb_build_object('k','shifts.close','kind','exec','q',
      $q$SELECT public.close_shift(gen_random_uuid(), :SHIFT, 0, 'matrix')$q$),
    jsonb_build_object('k','read.financial_summary','kind','value','q',
      $q$SELECT (public.get_tenant_financial_summary(:T, current_date - 30, current_date)->>'revenue') IS NOT NULL$q$),
    jsonb_build_object('k','read.dashboard_money','kind','value','q',
      $q$SELECT (public.get_dashboard_stats(:T)->'filtered'->>'paid') IS NOT NULL$q$),
    jsonb_build_object('k','read.customers_page','kind','value','q',
      $q$SELECT public.get_tenant_customers_page(:T, 1, 10) IS NOT NULL$q$),
    jsonb_build_object('k','staff.create','kind','exec','q',
      $q$INSERT INTO public.staff (tenant_id, uid, name, email, role, status) VALUES (:T, gen_random_uuid()::text, 'موظف مصفوفة', 'matrix-new@example.invalid', 'cashier', 'active')$q$),
    jsonb_build_object('k','staff.permissions','kind','exec','q',
      $q$INSERT INTO public.roles (tenant_id, role_key, name, permissions) VALUES (:T, 'matrix_role_' || left(gen_random_uuid()::text, 6), 'دور مصفوفة', '{}'::jsonb)$q$),
    jsonb_build_object('k','suppliers.manage','kind','exec','q',
      $q$INSERT INTO public.suppliers (tenant_id, name) VALUES (:T, 'مورد مصفوفة')$q$),
    jsonb_build_object('k','supplier.payment','kind','exec','q',
      $q$SELECT public.issue_supplier_payment(gen_random_uuid(), :S, 10, 'cash', :SHIFT)$q$),
    jsonb_build_object('k','settings.billing','kind','exec','q',
      $q$SELECT public.create_subscription_request(:T, (SELECT id FROM public.plans WHERE is_active ORDER BY price DESC LIMIT 1), 'bank_transfer')$q$),
    jsonb_build_object('k','settings.direct_edit','kind','rows','q',
      $q$UPDATE public.tenants SET name = name WHERE id = :T$q$),
    jsonb_build_object('k','settings.direct_tax','kind','rows','q',
      $q$UPDATE public.tenants SET vat_number = '300000000000003' WHERE id = :T$q$),
    jsonb_build_object('k','customers.save_measurements','kind','exec','q',
      $q$SELECT public.save_customer_measurements(:C, '{"length": 150}'::jsonb)$q$),
    jsonb_build_object('k','isolation.other_shop_customer_edit','kind','rows','q',
      $q$UPDATE public.customers SET name = name WHERE tenant_id = :T2$q$)
  );
BEGIN
  -- ---------- Fixtures (as the system, triggers off) ----------
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.tenants (id, name, owner_email, phone, status, owner_uid, is_test)
  -- owner_uid stays NULL: it references a real user (the owner is the 'owner' staff row below).
  VALUES (T,  'مصفوفة الصلاحيات', 'matrix-owner@example.invalid', '0500000090', 'active', NULL, true),
         (T2, 'مصفوفة — محل آخر', 'matrix-other@example.invalid', '0500000091', 'active', NULL, true);
  INSERT INTO public.branches (id, tenant_id, name, location, is_main)
  VALUES (B, T, 'الرئيسي', 'الرياض', true), (B2, T, 'الثاني', 'جدة', false);
  INSERT INTO public.customers (id, tenant_id, name, phone, is_test)
  VALUES (C, T, 'عميل مصفوفة', '0500000092', true), (C2, T, 'عميل للحذف', '0500000093', true),
         (gen_random_uuid(), T2, 'عميل محل آخر', '0500000094', true);
  INSERT INTO public.inventory_items (id, tenant_id, name, sku, category, category_key, unit, base_unit, conversion_rate, price_per_unit)
  VALUES (I,  T, 'صنف مصفوفة', 'PM-I1', 'other', 'other', 'piece', 'piece', 1, 10),
         (I2, T, 'صنف للحذف', 'PM-I2', 'other', 'other', 'piece', 'piece', 1, 10);
  INSERT INTO public.branch_inventory (tenant_id, branch_id, item_id, quantity) VALUES (T, B, I, 100);
  INSERT INTO public.suppliers (id, tenant_id, name) VALUES (S, T, 'مورد مصفوفة');
  -- A custom role, saved the way Staff.tsx saves it today (staff.role 'tailor', role_id the custom row).
  INSERT INTO public.roles (id, tenant_id, role_key, name, permissions)
  VALUES (CUSTOM_ROLE, T, 'senior_cashier', 'كاشير أول',
          '{"orders.view":true,"orders.create":true,"orders.update_status":true,"payments.collect":true,"action.discount":true,"action.refund":true,"shifts.manage":true,"customers.view":true,"customers.create":true,"customers.edit":true}'::jsonb);

  CREATE TEMP TABLE _m_staff (label text, id uuid, uid text, role text, role_id uuid, shift uuid) ON COMMIT DROP;
  GRANT SELECT ON _m_staff TO authenticated;
  INSERT INTO _m_staff VALUES
    ('owner',             OWNER_STAFF, OWNER_UID, 'owner', NULL, gen_random_uuid()),
    ('admin',             gen_random_uuid(), gen_random_uuid()::text, 'admin', NULL, gen_random_uuid()),
    ('manager',           gen_random_uuid(), gen_random_uuid()::text, 'manager', NULL, gen_random_uuid()),
    ('branch_manager',    gen_random_uuid(), gen_random_uuid()::text, 'branch_manager', NULL, gen_random_uuid()),
    ('accountant',        gen_random_uuid(), gen_random_uuid()::text, 'accountant', NULL, gen_random_uuid()),
    ('warehouse_manager', gen_random_uuid(), gen_random_uuid()::text, 'warehouse_manager', NULL, gen_random_uuid()),
    ('cashier',           gen_random_uuid(), gen_random_uuid()::text, 'cashier', NULL, gen_random_uuid()),
    ('tailor',            gen_random_uuid(), gen_random_uuid()::text, 'tailor', NULL, gen_random_uuid()),
    ('custom:senior_cashier', gen_random_uuid(), gen_random_uuid()::text, 'tailor', CUSTOM_ROLE, gen_random_uuid()),
    ('cashier+override',  gen_random_uuid(), gen_random_uuid()::text, 'cashier', NULL, gen_random_uuid());
  INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, branch_id, status, is_test)
  SELECT id, T, uid, 'مصفوفة ' || label, 'matrix-' || replace(replace(label, ':', '-'), '+', '-') || '@example.invalid',
         role::public.user_role, role_id, B, 'active', true
    FROM _m_staff;
  -- The personal exception: this cashier may refund, may not discount.
  INSERT INTO public.user_permission_overrides (tenant_id, staff_id, overrides)
  SELECT T, id, '{"action.refund": true, "action.discount": false}'::jsonb FROM _m_staff WHERE label = 'cashier+override';
  INSERT INTO public.shifts (id, tenant_id, branch_id, staff_id, staff_name, opening_balance, status, start_time)
  SELECT shift, T, B, id, 'مصفوفة ' || label, 0, 'open', now() FROM _m_staff;
  SET LOCAL session_replication_role = origin;

  -- An order to work on (O1) and a paid POS sale to refund (O2), made by the owner.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', OWNER_UID, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_res := public.create_tailoring_order(gen_random_uuid(),
    jsonb_build_object('customer_id', C, 'paid_amount', 0, 'status', 'measurements_taken', 'status_key', 'measurements_taken'),
    '[{"garment_type":"ثوب","quantity":1,"price":100}]'::jsonb);
  O1 := (v_res->'order'->>'id')::uuid;
  v_res := public.create_pos_sale(gen_random_uuid(),
    jsonb_build_object('shift_id', (SELECT shift FROM _m_staff WHERE label = 'owner'), 'customer_name', 'Walk-in', 'status', 'delivered',
                       'payment_method', 'cash', 'paid_amount', 200, 'delivery_date', now()::text),
    '[{"type":"custom","name":"قطعة","price":100,"quantity":2}]'::jsonb, '{}'::jsonb);
  O2 := (v_res->>'order_id')::uuid;
  EXECUTE 'RESET ROLE';
  SELECT id INTO ITEM2 FROM public.order_items WHERE order_id = O2 LIMIT 1;
  IF O1 IS NULL OR O2 IS NULL OR ITEM2 IS NULL THEN RAISE EXCEPTION 'SETUP FAILED: O1 % O2 % ITEM2 %', O1, O2, ITEM2; END IF;

  -- ---------- The matrix ----------
  FOREACH mode IN ARRAY ARRAY['a', 'b'] LOOP
    FOR st IN SELECT * FROM _m_staff ORDER BY CASE label WHEN 'owner' THEN 0 ELSE 1 END, label LOOP
      IF mode = 'a' THEN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', st.uid, 'role', 'authenticated')::text, true);
        PERFORM set_config('request.headers', '{}', true);
      ELSE
        -- The owner's device; the employee is named by a PIN session token.
        token := encode(gen_random_bytes(32), 'hex');
        IF has_sessions THEN
          EXECUTE 'INSERT INTO public.staff_acting_sessions (token_hash, tenant_id, auth_uid, staff_id, expires_at)
                   VALUES ($1, $2, $3, $4, now() + interval ''1 hour'')'
            USING encode(sha256(convert_to(token, 'UTF8')), 'hex'), T, OWNER_UID, st.id;
        END IF;
        PERFORM set_config('request.jwt.claims', json_build_object('sub', OWNER_UID, 'role', 'authenticated')::text, true);
        PERFORM set_config('request.headers', json_build_object('x-seen-acting-staff', token)::text, true);
      END IF;

      row_a := '{}'::jsonb;
      FOR a IN SELECT * FROM jsonb_to_recordset(actions) AS x(k text, kind text, q text) LOOP
        q := a.q;
        q := replace(q, ':SHIFT', quote_literal(st.shift) || '::uuid');
        q := replace(q, ':STAFF', quote_literal(st.id) || '::uuid');
        q := replace(q, ':ITEM2', quote_literal(ITEM2) || '::uuid');
        q := replace(q, ':O1', quote_literal(O1) || '::uuid');
        q := replace(q, ':O2', quote_literal(O2) || '::uuid');
        q := replace(q, ':C2', quote_literal(C2) || '::uuid');
        q := replace(q, ':C', quote_literal(C) || '::uuid');
        q := replace(q, ':I2', quote_literal(I2) || '::uuid');
        q := replace(q, ':I', quote_literal(I) || '::uuid');
        q := replace(q, ':S', quote_literal(S) || '::uuid');
        q := replace(q, ':T2', quote_literal(T2) || '::uuid');
        q := replace(q, ':T', quote_literal(T) || '::uuid');
        q := replace(q, ':B', quote_literal(B) || '::uuid');
        BEGIN
          EXECUTE 'SET LOCAL ROLE authenticated';
          IF a.kind = 'exec' THEN
            EXECUTE q;
            outcome := 'allow';
          ELSIF a.kind = 'rows' THEN
            EXECUTE q;
            GET DIAGNOSTICS n = ROW_COUNT;
            outcome := CASE WHEN n > 0 THEN 'allow' ELSE 'deny' END;
          ELSIF a.kind = 'attr' THEN
            EXECUTE q INTO v_json;
            outcome := CASE WHEN (SELECT o.created_by FROM public.orders o WHERE o.id = (v_json->>'order_id')::uuid) = st.id
                            THEN 'allow' ELSE 'deny' END;
          ELSE
            EXECUTE q INTO v_bool;
            outcome := CASE WHEN v_bool THEN 'allow' ELSE 'deny' END;
          END IF;
          RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = outcome;  -- undo the action
        EXCEPTION
          WHEN SQLSTATE 'P0099' THEN outcome := SQLERRM;
          WHEN insufficient_privilege THEN outcome := 'deny';
          WHEN OTHERS THEN
            outcome := CASE WHEN SQLERRM ~* '(صلاحية|forbidden|permission|غير مصرح|not allowed|row-level security)'
                            THEN 'deny' ELSE 'error:' || SQLSTATE || ':' || left(SQLERRM, 90) END;
        END;
        row_a := row_a || jsonb_build_object(a.k, outcome);
      END LOOP;
      result := jsonb_set(result, ARRAY[mode], coalesce(result->mode, '{}'::jsonb) || jsonb_build_object(st.label, row_a));
    END LOOP;
  END LOOP;

  RAISE EXCEPTION 'MATRIX:%', result::text;
END
$matrix$;
