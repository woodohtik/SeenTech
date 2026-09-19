-- Closes a critical schema-drift finding from the 2026-09-17 full-team
-- review (database-reviewer): activationService.ts (Reforge-style
-- activation/health tracking) references tenant_activation, v_tenant_health,
-- v_resurrection_segment, v_woms, and v_expansion_candidates -- none of
-- which exist anywhere in the database (verified live, not just missing
-- from migrations: confirmed absent on staging entirely). The SQL file
-- its header comment points to (ANALYTICS_instrumentation.sql) doesn't
-- exist in this repo at all.
--
-- Every call site already degrades gracefully on a missing table/view
-- (no error thrown, just a null/empty result), so this wasn't crashing
-- anything -- but it meant two real features were silently inert:
-- markSetup() (called from Onboarding.tsx on every real signup) and
-- getHealth() (called from ExpansionPrompt.tsx). Built here as a
-- reasonably simple first version rather than left as dead code, since
-- the scoring/segmentation logic below is a judgment call with no prior
-- spec to recover -- documented inline; revisit if it doesn't match how
-- the business actually wants to define "healthy"/"at risk"/"WOMS".
--
-- Activity signal: `orders` INSERT is used as the core usage event (this
-- is a POS -- creating an order is the central action), same for the
-- first_invoice_at signal via `tax_invoices` INSERT. Reforge terms used
-- as: aha = first real usage (first order), habit = recurring usage
-- (3rd distinct active day), WOMS = "Weekly Occurrence of Main Success"
-- (at least one order in the trailing 7 days).

CREATE TABLE IF NOT EXISTS public.tenant_activation (
    tenant_id        UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
    signup_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    setup_at         TIMESTAMPTZ,
    aha_at           TIMESTAMPTZ,
    habit_at         TIMESTAMPTZ,
    active_days      INT NOT NULL DEFAULT 0,
    last_active_at   TIMESTAMPTZ,
    first_invoice_at TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.tenant_activation ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY tenant_activation_read ON public.tenant_activation
      FOR SELECT USING (app_is_super_admin() OR tenant_id = app_current_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- No INSERT/UPDATE/DELETE policies: rows are only ever written by the
-- SECURITY DEFINER trigger/RPC below, never directly by a client.

CREATE OR REPLACE FUNCTION public.set_tenant_activation_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER trg_tenant_activation_updated_at
      BEFORE UPDATE ON public.tenant_activation
      FOR EACH ROW EXECUTE FUNCTION public.set_tenant_activation_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- mark_setup(): called once from Onboarding.tsx when a tenant completes
-- initial setup. SECURITY DEFINER because a normal tenant session has no
-- write policy on this table at all (see above) -- this is the one
-- sanctioned write path for this specific column, unconditional (no
-- current_user-based exemption logic, so none of the SECURITY DEFINER
-- pitfalls found elsewhere today apply here).
CREATE OR REPLACE FUNCTION public.mark_setup(p_tenant uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO tenant_activation (tenant_id, setup_at)
  VALUES (p_tenant, NOW())
  ON CONFLICT (tenant_id) DO UPDATE
    SET setup_at = COALESCE(tenant_activation.setup_at, EXCLUDED.setup_at);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_setup(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mark_setup(uuid) TO authenticated;

-- Activity tracking trigger on orders: upserts tenant_activation on every
-- order, tracking first-ever order (aha_at), distinct active days, and a
-- simple 3-distinct-day habit threshold.
CREATE OR REPLACE FUNCTION public.track_tenant_activity_on_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_active_date date;
  v_new_active_days int;
BEGIN
  INSERT INTO tenant_activation (tenant_id, aha_at, last_active_at, active_days)
  VALUES (NEW.tenant_id, NEW.created_at, NEW.created_at, 1)
  ON CONFLICT (tenant_id) DO NOTHING;

  SELECT last_active_at::date, active_days INTO v_last_active_date, v_new_active_days
  FROM tenant_activation WHERE tenant_id = NEW.tenant_id;

  IF v_last_active_date IS DISTINCT FROM NEW.created_at::date THEN
    v_new_active_days := COALESCE(v_new_active_days, 0) + 1;
  END IF;

  UPDATE tenant_activation SET
    aha_at = COALESCE(aha_at, NEW.created_at),
    last_active_at = GREATEST(COALESCE(last_active_at, NEW.created_at), NEW.created_at),
    active_days = GREATEST(active_days, v_new_active_days),
    habit_at = CASE WHEN habit_at IS NULL AND v_new_active_days >= 3 THEN NEW.created_at ELSE habit_at END
  WHERE tenant_id = NEW.tenant_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_track_tenant_activity_on_order ON public.orders;
CREATE TRIGGER trg_track_tenant_activity_on_order
AFTER INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.track_tenant_activity_on_order();

-- first_invoice_at signal.
CREATE OR REPLACE FUNCTION public.track_tenant_first_invoice()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO tenant_activation (tenant_id, first_invoice_at)
  VALUES (NEW.tenant_id, NEW.created_at)
  ON CONFLICT (tenant_id) DO UPDATE
    SET first_invoice_at = COALESCE(tenant_activation.first_invoice_at, EXCLUDED.first_invoice_at);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_track_tenant_first_invoice ON public.tax_invoices;
CREATE TRIGGER trg_track_tenant_first_invoice
AFTER INSERT ON public.tax_invoices
FOR EACH ROW EXECUTE FUNCTION public.track_tenant_first_invoice();

-- Backfill existing tenants so the views below aren't empty for accounts
-- that predate this migration -- signup_at from tenants.created_at,
-- last order as a proxy for last_active_at/aha_at/active_days (a rough
-- one-time approximation, not a full historical day-by-day replay).
INSERT INTO tenant_activation (tenant_id, signup_at, aha_at, last_active_at, active_days, first_invoice_at)
SELECT
  t.id,
  t.created_at,
  (SELECT MIN(o.created_at) FROM orders o WHERE o.tenant_id = t.id),
  (SELECT MAX(o.created_at) FROM orders o WHERE o.tenant_id = t.id),
  (SELECT COUNT(DISTINCT o.created_at::date) FROM orders o WHERE o.tenant_id = t.id),
  (SELECT MIN(ti.created_at) FROM tax_invoices ti WHERE ti.tenant_id = t.id)
FROM tenants t
ON CONFLICT (tenant_id) DO NOTHING;

-- === Views ===
-- security_invoker so each caller's own RLS on tenant_activation/orders
-- is what's actually checked, not the view owner's.

CREATE OR REPLACE VIEW public.v_tenant_health WITH (security_invoker = true) AS
SELECT
  ta.tenant_id,
  LEAST(100, GREATEST(0,
    COALESCE((SELECT COUNT(*) FROM orders o WHERE o.tenant_id = ta.tenant_id AND o.created_at >= NOW() - INTERVAL '7 days'), 0) * 15
    + (
        (CASE WHEN EXISTS (SELECT 1 FROM orders o WHERE o.tenant_id = ta.tenant_id AND o.created_at >= NOW() - INTERVAL '30 days') THEN 1 ELSE 0 END)
      + (CASE WHEN EXISTS (SELECT 1 FROM customers c WHERE c.tenant_id = ta.tenant_id AND c.created_at >= NOW() - INTERVAL '30 days') THEN 1 ELSE 0 END)
      + (CASE WHEN EXISTS (SELECT 1 FROM inventory_items i WHERE i.tenant_id = ta.tenant_id AND i.created_at >= NOW() - INTERVAL '30 days') THEN 1 ELSE 0 END)
      + (CASE WHEN EXISTS (SELECT 1 FROM suppliers s WHERE s.tenant_id = ta.tenant_id AND s.created_at >= NOW() - INTERVAL '30 days') THEN 1 ELSE 0 END)
      + (CASE WHEN EXISTS (SELECT 1 FROM purchase_orders po WHERE po.tenant_id = ta.tenant_id AND po.created_at >= NOW() - INTERVAL '30 days') THEN 1 ELSE 0 END)
    ) * 10
  ))::int AS health_score,
  (
    ta.last_active_at IS NULL
    OR ta.last_active_at < NOW() - INTERVAL '14 days'
  ) AS at_risk,
  COALESCE((SELECT COUNT(*) FROM orders o WHERE o.tenant_id = ta.tenant_id AND o.created_at >= NOW() - INTERVAL '7 days'), 0)::int AS actions_7d,
  (
      (CASE WHEN EXISTS (SELECT 1 FROM orders o WHERE o.tenant_id = ta.tenant_id AND o.created_at >= NOW() - INTERVAL '30 days') THEN 1 ELSE 0 END)
    + (CASE WHEN EXISTS (SELECT 1 FROM customers c WHERE c.tenant_id = ta.tenant_id AND c.created_at >= NOW() - INTERVAL '30 days') THEN 1 ELSE 0 END)
    + (CASE WHEN EXISTS (SELECT 1 FROM inventory_items i WHERE i.tenant_id = ta.tenant_id AND i.created_at >= NOW() - INTERVAL '30 days') THEN 1 ELSE 0 END)
    + (CASE WHEN EXISTS (SELECT 1 FROM suppliers s WHERE s.tenant_id = ta.tenant_id AND s.created_at >= NOW() - INTERVAL '30 days') THEN 1 ELSE 0 END)
    + (CASE WHEN EXISTS (SELECT 1 FROM purchase_orders po WHERE po.tenant_id = ta.tenant_id AND po.created_at >= NOW() - INTERVAL '30 days') THEN 1 ELSE 0 END)
  )::int AS breadth,
  ta.last_active_at
FROM tenant_activation ta;

CREATE OR REPLACE VIEW public.v_resurrection_segment WITH (security_invoker = true) AS
SELECT
  ta.tenant_id,
  CASE
    WHEN ta.last_active_at IS NULL THEN 'non_activated'
    WHEN ta.last_active_at >= NOW() - INTERVAL '7 days' THEN 'active'
    WHEN ta.last_active_at >= NOW() - INTERVAL '30 days' THEN 'dormant'
    ELSE 'churned'
  END AS segment
FROM tenant_activation ta;

CREATE OR REPLACE VIEW public.v_woms WITH (security_invoker = true) AS
SELECT
  ta.tenant_id,
  (ta.last_active_at IS NOT NULL AND ta.last_active_at >= NOW() - INTERVAL '7 days') AS is_woms
FROM tenant_activation ta;

CREATE OR REPLACE VIEW public.v_expansion_candidates WITH (security_invoker = true) AS
SELECT * FROM v_tenant_health
WHERE health_score >= 70 AND at_risk = false;
