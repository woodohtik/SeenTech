-- Rollback of 20270108000005_tailor_commission_date.sql (commission_at kept)
CREATE OR REPLACE FUNCTION public.calculate_order_tailor_commission()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
END; $function$
;
