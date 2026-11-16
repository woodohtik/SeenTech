-- Sprint 2 reports engine, item 3 (seen-cto-sprint2-reports-engine-task.md):
-- tailor commission tracking. Confirmed by reading the code, not guessed:
-- a full commission system already exists (20240704_tailor_commissions.sql)
-- -- staff.commission_type/commission_value (a per-tailor policy, with a
-- real, live settings screen: AdminTailorCommissions.tsx inside Staff.tsx)
-- and order_items.assigned_tailor_id/calculated_commission with a trigger
-- that computes it when an order_items row's status changes to
-- 'ready'/'ironing_packaging'. TailorStatementReport.tsx (a real tab
-- inside the live /reports screen) reads calculated_commission directly,
-- trusting it as already correct.
--
-- The actual bug: that trigger has NEVER fired for a single real تفصيل
-- order, because a تفصيل order created in "الطلبات" never writes an
-- order_items row at all -- its items live only in orders.notes (same
-- root cause as the invoice-items and COGS bugs fixed earlier this
-- sprint). There is no row to assign a tailor to or change the status of.
--
-- Founder decision (2026-11-17): fix this at the ORDER level, not by
-- making Orders.tsx write order_items rows (a much larger change to its
-- create/edit/status-update flow) -- one tailor, one commission per
-- order, recomputed on status change. orders.total_amount is already the
-- final, discount-applied amount (sprint 1's create_pos_sale/
-- record_order_payment work), so "net of discount" falls out of the
-- existing column with no extra ratio math; tax_amount is subtracted so
-- commission is never paid on VAT collected for the government.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS assigned_tailor_id UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS calculated_commission NUMERIC(10,2);

CREATE INDEX IF NOT EXISTS idx_orders_assigned_tailor ON public.orders (assigned_tailor_id);

CREATE OR REPLACE FUNCTION public.calculate_order_tailor_commission()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  tailor_comm_type VARCHAR(20);
  tailor_comm_val  NUMERIC;
  v_net_sales      NUMERIC;
BEGIN
  -- A cancelled order never owes commission, regardless of which stage it
  -- reached first -- the one reversal case this order-level model needs
  -- (a full cancellation is a complete, unambiguous reversal; a partial
  -- return's partial commission adjustment is explicitly out of scope
  -- for this pass per the founder's "order level, simpler" call).
  IF NEW.status = 'cancelled' THEN
    NEW.calculated_commission := 0;
    RETURN NEW;
  END IF;

  -- Same trigger points the existing order_items-level version used
  -- (production finished, whether or not the customer has picked it up
  -- yet) -- only recompute on the actual transition into them, and only
  -- when a tailor is assigned; an order with no assigned_tailor_id simply
  -- never earns a commission figure.
  IF NEW.status::text IN ('ready', 'ironing_packaging')
     AND (OLD.status IS NULL OR OLD.status::text NOT IN ('ready', 'ironing_packaging'))
     AND NEW.assigned_tailor_id IS NOT NULL THEN
    SELECT commission_type, commission_value INTO tailor_comm_type, tailor_comm_val
      FROM public.staff WHERE id = NEW.assigned_tailor_id;

    v_net_sales := COALESCE(NEW.total_amount, 0) - COALESCE(NEW.tax_amount, 0);

    IF tailor_comm_type = 'fixed_amount' THEN
      NEW.calculated_commission := tailor_comm_val;
    ELSIF tailor_comm_type = 'percentage' THEN
      NEW.calculated_commission := round(v_net_sales * COALESCE(tailor_comm_val, 0) / 100, 2);
    END IF;
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_calculate_order_tailor_commission ON public.orders;
CREATE TRIGGER trg_calculate_order_tailor_commission
BEFORE UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.calculate_order_tailor_commission();
