-- =============================================================================
-- Team review 2026-11-19, item M-8 / action 17: one source for a shop's tax
-- settings.
--
-- Before: the settings were a JSON document in tenants.legacy_id (written by
-- POST /api/tenant/settings), parsed separately by create_tailoring_order,
-- the server, the browser's fetch layer and several screens; the Settings
-- screen's direct-save fallback wrote a `tax_settings` column that did not
-- exist (so it only reached localStorage); POS sales and tax invoices read
-- is_tax_enabled / default_tax_rate.
--
-- Now:
--  1. tenants.tax_settings (jsonb) is the source, filled from legacy_id.
--  2. public.tenant_tax_rules(tenant) gives the rules (enabled, type, rate)
--     exactly as create_tailoring_order computed them; it now calls it.
--  3. A trigger keeps the old places in step for every writer: a change to
--     tax_settings is copied to legacy_id (older app versions still read it)
--     and to is_tax_enabled / default_tax_rate (POS, tax invoices); a writer
--     that still sets legacy_id (an older server) updates tax_settings.
--  4. The owner self-edit allowlist accepts tax_settings, like the
--     is_tax_enabled / default_tax_rate columns it already accepts.
-- No change to any shop's rules: tenant_tax_rules returns what the old
-- parsing returned (checked shop by shop on staging).
-- Rollback: supabase/rollbacks/20261230_tenant_tax_settings.down.sql.
-- =============================================================================

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS tax_settings jsonb;

-- The settings object inside a legacy_id document: either under a
-- `tax_settings` key (older shape; its top-level notificationSettings is kept)
-- or the whole document. NULL when legacy_id is not a JSON object.
CREATE OR REPLACE FUNCTION public.tax_settings_from_legacy(p_legacy text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_meta jsonb;
BEGIN
  IF p_legacy IS NULL OR p_legacy NOT LIKE '{%' THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_meta := p_legacy::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  IF jsonb_typeof(v_meta->'tax_settings') = 'object' THEN
    IF jsonb_typeof(v_meta->'notificationSettings') = 'object'
       AND NOT (v_meta->'tax_settings') ? 'notificationSettings' THEN
      RETURN (v_meta->'tax_settings') || jsonb_build_object('notificationSettings', v_meta->'notificationSettings');
    END IF;
    RETURN v_meta->'tax_settings';
  END IF;
  IF jsonb_typeof(v_meta) = 'object' THEN
    RETURN v_meta;
  END IF;
  RETURN NULL;
END;
$function$;

-- A shop's tax rules -- the rules create_tailoring_order always applied:
-- enabled follows the stored flag, else whether the shop has a VAT number
-- (or a TRN in the settings); type defaults to exclusive; the rate to 15
-- (a stored 0 means "not set"). Mirrored by src/utils/tailoringOrder.ts
-- resolveTailoringTax; scripts/check-tax-rules.ts compares the two.
CREATE OR REPLACE FUNCTION public.tenant_tax_rules(p_tenant_id uuid)
RETURNS TABLE (enabled boolean, tax_type text, rate_pct numeric)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_settings jsonb;
  v_vat      text;
BEGIN
  SELECT coalesce(t.tax_settings, public.tax_settings_from_legacy(t.legacy_id)), t.vat_number
    INTO v_settings, v_vat
    FROM public.tenants t WHERE t.id = p_tenant_id;
  IF v_settings IS NULL OR jsonb_typeof(v_settings) <> 'object' THEN
    enabled  := COALESCE(btrim(v_vat), '') <> '';
    tax_type := 'exclusive';
    rate_pct := 15;
  ELSE
    enabled := COALESCE(
      (v_settings->>'enabled')::boolean,
      COALESCE(btrim(v_vat), '') <> '' OR COALESCE(v_settings->>'trn', '') <> ''
    );
    tax_type := COALESCE(NULLIF(v_settings->>'tailoringTaxType', ''), 'exclusive');
    rate_pct := COALESCE(NULLIF(v_settings->>'vatRate', '')::numeric, 15);
    IF rate_pct = 0 THEN rate_pct := 15; END IF;
  END IF;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.tax_settings_from_legacy(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tax_settings_from_legacy(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.tenant_tax_rules(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_tax_rules(uuid) TO authenticated, service_role;

-- Fill the column from legacy_id. Triggers off for this one statement so the
-- rows' updated_at and the other tenants triggers are not touched.
SET session_replication_role = replica;
UPDATE public.tenants
   SET tax_settings = public.tax_settings_from_legacy(legacy_id)
 WHERE tax_settings IS NULL
   AND public.tax_settings_from_legacy(legacy_id) IS NOT NULL;
SET session_replication_role = origin;

-- Keep the old places in step (see 3. above). Runs after the owner allowlist
-- trigger (BEFORE triggers fire in name order), so the allowlist judges what
-- the caller sent, not what this adds.
CREATE OR REPLACE FUNCTION public.tenants_tax_settings_sync()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_from_settings boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_from_settings := NEW.tax_settings IS NOT NULL;
    IF NOT v_from_settings THEN
      NEW.tax_settings := public.tax_settings_from_legacy(NEW.legacy_id);
    END IF;
  ELSIF NEW.tax_settings IS DISTINCT FROM OLD.tax_settings THEN
    v_from_settings := true;
  ELSIF NEW.legacy_id IS DISTINCT FROM OLD.legacy_id THEN
    v_from_settings := false;
    NEW.tax_settings := public.tax_settings_from_legacy(NEW.legacy_id);
  ELSE
    RETURN NEW;
  END IF;

  IF v_from_settings THEN
    -- legacy_id holds the settings document (or nothing); a real non-JSON
    -- legacy id is left alone.
    IF NEW.legacy_id IS NULL OR NEW.legacy_id LIKE '{%' THEN
      NEW.legacy_id := CASE WHEN NEW.tax_settings IS NULL THEN NULL ELSE NEW.tax_settings::text END;
    END IF;
  END IF;

  IF jsonb_typeof(NEW.tax_settings) = 'object' THEN
    NEW.is_tax_enabled := COALESCE(
      (NEW.tax_settings->>'enabled')::boolean,
      COALESCE(btrim(NEW.vat_number), '') <> '' OR COALESCE(NEW.tax_settings->>'trn', '') <> ''
    );
    NEW.default_tax_rate := COALESCE(NULLIF(NULLIF(NEW.tax_settings->>'vatRate', '')::numeric, 0), 15);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tenants_tax_settings_sync ON public.tenants;
CREATE TRIGGER tenants_tax_settings_sync
BEFORE INSERT OR UPDATE ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.tenants_tax_settings_sync();

-- Owner self-edit allowlist: + tax_settings (otherwise unchanged).
CREATE OR REPLACE FUNCTION public.tenants_no_self_billing_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_allowed_new tenants;
BEGIN
  IF app_is_super_admin() OR current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;

  -- Start from OLD, then overlay only the columns a self-edit may change.
  -- Anything else that differs between NEW and this constructed row means
  -- the caller touched a column outside the allow-list.
  v_allowed_new := OLD;
  v_allowed_new.name                := NEW.name;
  v_allowed_new.phone               := NEW.phone;
  v_allowed_new.address             := NEW.address;
  v_allowed_new.city                := NEW.city;
  v_allowed_new.postal_code         := NEW.postal_code;
  v_allowed_new.vat_number          := NEW.vat_number;
  v_allowed_new.commercial_register := NEW.commercial_register;
  v_allowed_new.logo_url            := NEW.logo_url;
  v_allowed_new.default_layout      := NEW.default_layout;
  v_allowed_new.inventory_strategy  := NEW.inventory_strategy;
  v_allowed_new.is_tax_enabled      := NEW.is_tax_enabled;
  v_allowed_new.default_tax_rate    := NEW.default_tax_rate;
  v_allowed_new.tax_settings        := NEW.tax_settings;
  v_allowed_new.measurement_unit    := NEW.measurement_unit;
  v_allowed_new.vertical            := NEW.vertical;
  v_allowed_new.updated_at          := NEW.updated_at;

  IF v_allowed_new IS DISTINCT FROM NEW THEN
    RAISE EXCEPTION 'يمكن للمالك تعديل بيانات الملف التجاري فقط -- أي تعديل آخر (الباقة، حالة الاشتراك، التجربة، الحذف، الملكية) يتطلب مساراً إدارياً'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- create_tailoring_order: the tax block now calls tenant_tax_rules (otherwise unchanged).
CREATE OR REPLACE FUNCTION public.create_tailoring_order(p_operation_id uuid, p_order jsonb, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant          uuid;
  v_staff           uuid;
  v_staff_name      text;
  v_branch          uuid;
  v_op_key          text;
  v_existing        jsonb;

  v_customer_id     uuid;
  v_customer_name   text;
  v_measurements    jsonb;
  v_tailor          uuid;

  v_status          order_status;
  v_status_key      text;
  v_method          payment_method;

  v_item            jsonb;
  v_qty             numeric;
  v_price           numeric;
  v_fabric_id       uuid;
  v_consumed        numeric;
  v_items_total     numeric := 0;
  v_discount        numeric;
  v_taxable         numeric;

  v_tax_enabled     boolean;
  v_tax_type        text;
  v_rate_pct        numeric;
  v_rate            numeric;
  v_tax_amount      numeric := 0;
  v_total           numeric;
  v_tax_rate_stored numeric := 0;

  v_paid            numeric;
  v_shift           uuid;
  v_deposit_skipped boolean := false;
  v_order_number    bigint;
  v_order           jsonb;
  v_result          jsonb;
BEGIN
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'operation_id مطلوب لمنع تكرار الطلب' USING ERRCODE = '22023';
  END IF;

  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_op_key := 'create_tailoring_order:' || p_operation_id::text;
  -- Two copies of the same save (a double click, or an offline replay racing
  -- the original) wait here in turn, so the second one finds the first one's
  -- recorded result below instead of failing on the order's primary key.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_op_key, 0));
  SELECT result INTO v_existing FROM public.stock_operations
   WHERE operation_id = v_op_key AND tenant_id = v_tenant;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing || jsonb_build_object('replayed', true);
  END IF;

  IF NOT public.app_has_permission('orders.create') THEN
    RAISE EXCEPTION 'لا تملك صلاحية إنشاء الطلبات' USING ERRCODE = '42501';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'الطلب بلا أصناف' USING ERRCODE = '22023';
  END IF;

  v_staff := public.app_current_staff_id();
  SELECT name, branch_id INTO v_staff_name, v_branch
    FROM public.staff WHERE id = v_staff AND tenant_id = v_tenant;

  -- Customer: must be this shop's; the name and the measurement snapshot come
  -- from the row, not from the browser.
  v_customer_id := NULLIF(p_order->>'customer_id', '')::uuid;
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'العميل مطلوب' USING ERRCODE = '22023';
  END IF;
  SELECT name, COALESCE(measurements, '{}'::jsonb) INTO v_customer_name, v_measurements
    FROM public.customers WHERE id = v_customer_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_tailor := NULLIF(p_order->>'assigned_tailor_id', '')::uuid;
  IF v_tailor IS NOT NULL THEN
    PERFORM 1 FROM public.staff WHERE id = v_tailor AND tenant_id = v_tenant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- A new order always starts at the first stage. The stage is not taken
  -- from the browser: accepting it let a caller create an order already
  -- "delivered" with nothing paid, past the rule that an order with a balance
  -- cannot be delivered. Every later stage goes through update_order_status.
  v_status := 'measurements_taken'::order_status;
  -- status_key is the activity's own name for its first stage (free text for
  -- activities other than men's tailoring). It may not borrow the name of a
  -- later fixed stage.
  v_status_key := COALESCE(NULLIF(left(p_order->>'status_key', 80), ''), 'measurements_taken');
  IF v_status_key IN ('cutting', 'sewing', 'embroidery', 'ironing_packaging', 'ready',
                      'partial_delivered', 'delivered', 'cancelled') THEN
    RAISE EXCEPTION 'الطلب الجديد يبدأ من أول مرحلة' USING ERRCODE = '22023';
  END IF;
  v_method := COALESCE(NULLIF(p_order->>'payment_method', ''), 'cash')::payment_method;

  -- Lines: whole pieces at a piece price. Validated before anything is written.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := NULLIF(v_item->>'quantity', '')::numeric;
    v_price := COALESCE(NULLIF(v_item->>'price', '')::numeric, 0);
    IF v_qty IS NULL OR v_qty < 1 OR v_qty <> trunc(v_qty) THEN
      RAISE EXCEPTION 'الكمية يجب أن تكون عدد قطع صحيحاً' USING ERRCODE = '22023';
    END IF;
    -- The piece price is whatever the shop agrees with the customer: a
    -- tailored garment has no catalogue price to check it against. That is
    -- deliberate. What needs action.discount is the discount field below.
    IF v_price < 0 THEN
      RAISE EXCEPTION 'سعر القطعة غير صالح' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(NULLIF(v_item->>'garment_type', ''), '') = '' THEN
      RAISE EXCEPTION 'نوع القطعة مطلوب' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(NULLIF(v_item->>'consumed_meters', '')::numeric, 0) < 0 THEN
      RAISE EXCEPTION 'كمية القماش غير صالحة' USING ERRCODE = '22023';
    END IF;
    v_fabric_id := NULLIF(v_item->>'fabric_id', '')::uuid;
    IF v_fabric_id IS NOT NULL THEN
      PERFORM 1 FROM public.inventory_items WHERE id = v_fabric_id AND tenant_id = v_tenant;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
      END IF;
    END IF;
    v_items_total := v_items_total + v_price * v_qty;
  END LOOP;

  v_discount := GREATEST(COALESCE(NULLIF(p_order->>'discount_amount', '')::numeric, 0), 0);
  IF v_discount > 0 AND NOT public.app_has_permission('action.discount') THEN
    RAISE EXCEPTION 'لا تملك صلاحية منح خصم' USING ERRCODE = '42501';
  END IF;
  v_discount := LEAST(v_discount, v_items_total);
  v_taxable := v_items_total - v_discount;

  -- Tailoring tax: the shop's rules from public.tenant_tax_rules, the one
  -- source shared with the browser's resolveTailoringTax (tenants.tax_settings
  -- since 20261230000000; the same rules as before: enabled follows the
  -- stored flag, else whether the shop has a VAT number; the rate defaults
  -- to 15 and the type to exclusive).
  SELECT r.enabled, r.tax_type, r.rate_pct INTO v_tax_enabled, v_tax_type, v_rate_pct
    FROM public.tenant_tax_rules(v_tenant) r;
  v_rate := v_rate_pct / 100;

  IF NOT v_tax_enabled OR v_tax_type = 'exempt' THEN
    v_tax_amount := 0;
    v_total := round(v_taxable, 2);
    v_tax_rate_stored := 0;
  ELSIF v_tax_type = 'inclusive' THEN
    v_tax_amount := round(v_taxable - v_taxable / (1 + v_rate), 2);
    v_total := round(v_taxable, 2);
    v_tax_rate_stored := v_rate_pct;
  ELSE
    v_tax_amount := round(v_taxable * v_rate, 2);
    v_total := round(v_taxable + v_taxable * v_rate, 2);
    v_tax_rate_stored := v_rate_pct;
  END IF;

  v_paid := GREATEST(COALESCE(NULLIF(p_order->>'paid_amount', '')::numeric, 0), 0);
  IF v_paid > v_total THEN
    RAISE EXCEPTION 'المبلغ المدفوع (%) أكبر من إجمالي الطلب (%)', v_paid, v_total USING ERRCODE = '22023';
  END IF;

  -- The order number only. allocate_tenant_sale_numbers would also consume an
  -- invoice number, and this order has no invoice yet.
  INSERT INTO public.tenant_order_counters (tenant_id) VALUES (v_tenant)
  ON CONFLICT (tenant_id) DO NOTHING;
  UPDATE public.tenant_order_counters t
     SET next_order_number = t.next_order_number + 1
   WHERE t.tenant_id = v_tenant
  RETURNING t.next_order_number - 1 INTO v_order_number;

  -- paid_amount starts at 0: the deposit, if any, goes through
  -- record_order_payment below so there is one payment rule in the system.
  INSERT INTO public.orders (
    id, tenant_id, branch_id, customer_id, customer_name, order_number,
    status, status_key, payment_method, total_amount, paid_amount,
    tax_rate, tax_amount, discount_amount, order_date, delivery_date,
    qr_code, images, notes, created_by, is_test, assigned_tailor_id, kind
  ) VALUES (
    p_operation_id, v_tenant, v_branch, v_customer_id, v_customer_name, v_order_number,
    v_status, v_status_key, v_method, v_total, 0,
    v_tax_rate_stored, v_tax_amount, v_discount, now(),
    COALESCE(NULLIF(p_order->>'delivery_date', '')::timestamptz, now()),
    'tailor-order-' || p_operation_id::text,
    CASE WHEN jsonb_typeof(p_order->'images') = 'array' THEN p_order->'images' ELSE '[]'::jsonb END,
    NULLIF(p_order->>'notes', ''), v_staff,
    COALESCE((p_order->>'is_test')::boolean, false), v_tailor, 'tailoring'
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_fabric_id := NULLIF(v_item->>'fabric_id', '')::uuid;
    -- Only cloth from stock carries a figure to deduct at cutting.
    v_consumed := CASE WHEN v_fabric_id IS NULL THEN 0
                       ELSE COALESCE(NULLIF(v_item->>'consumed_meters', '')::numeric, 0) END;
    INSERT INTO public.order_items (
      tenant_id, order_id, type, name, garment_type, fabric, fabric_id,
      quantity, price, consumed_meters, status, status_key,
      collar_type, cuff_type, pocket_type, chest_style, shoulder_style, cutting_type,
      collar_padding, closure_type, closure_visibility,
      additions, embroidery, attributes, measurements
    ) VALUES (
      v_tenant, p_operation_id, 'custom', v_item->>'garment_type', v_item->>'garment_type',
      NULLIF(v_item->>'fabric', ''), v_fabric_id,
      (v_item->>'quantity')::numeric, COALESCE(NULLIF(v_item->>'price', '')::numeric, 0),
      v_consumed, v_status, v_status_key,
      NULLIF(v_item->>'collar_type', ''), NULLIF(v_item->>'cuff_type', ''),
      NULLIF(v_item->>'pocket_type', ''), NULLIF(v_item->>'chest_style', ''),
      NULLIF(v_item->>'shoulder_style', ''), NULLIF(v_item->>'cutting_type', ''),
      NULLIF(v_item->>'collar_padding', '')::collar_padding,
      NULLIF(v_item->>'closure_type', '')::closure_type,
      NULLIF(v_item->>'closure_visibility', '')::closure_visibility,
      NULLIF(v_item->>'additions', ''), NULLIF(v_item->>'embroidery', ''),
      CASE WHEN jsonb_typeof(v_item->'attributes') = 'object' THEN v_item->'attributes' ELSE '{}'::jsonb END,
      -- The customer's measurements as they are now: a later edit to the
      -- customer must not change what this order was cut to.
      v_measurements
    );
  END LOOP;

  INSERT INTO public.order_history (tenant_id, order_id, status, notes, updated_by_staff, updated_by_name)
  VALUES (v_tenant, p_operation_id, v_status, NULLIF(p_order->>'history_note', ''), v_staff, COALESCE(v_staff_name, 'Staff'));

  -- Deposit: needs the caller's own open shift, so the till sees it. Without
  -- one the order is still saved and the deposit is left for the order screen.
  IF v_paid > 0 THEN
    SELECT id INTO v_shift FROM public.shifts
     WHERE tenant_id = v_tenant AND staff_id = v_staff AND status = 'open'
     ORDER BY start_time DESC LIMIT 1;
    IF v_shift IS NULL THEN
      v_deposit_skipped := true;
    ELSE
      PERFORM public.record_order_payment(
        md5('tailoring-deposit:' || p_operation_id::text)::uuid,
        p_operation_id, v_paid, v_method, v_shift,
        NULLIF(p_order->>'deposit_note', ''), NULL, NULL
      );
    END IF;
  END IF;

  SELECT to_jsonb(o) INTO v_order FROM public.orders o WHERE o.id = p_operation_id;

  v_result := jsonb_build_object(
    'order', v_order,
    'deposit_skipped', v_deposit_skipped,
    'replayed', false
  );

  INSERT INTO public.stock_operations (operation_id, tenant_id, kind, result)
  VALUES (v_op_key, v_tenant, 'create_tailoring_order', v_result);

  RETURN v_result;
END $function$;
