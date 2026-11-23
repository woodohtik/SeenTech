-- seen-readiness-fixes-task.md P6 (MONEY-20) -- a tailor's commission has its
-- own date, and follows the order.
--
--  * orders.commission_at: when the commission fell due (the order reached
--    ready). The statement uses it; it used updated_at, so any later edit
--    moved the commission into another month. Older orders get updated_at,
--    the best date there is for them.
--  * The commission is worked out again when the order changes tailor after
--    it fell due (for the new tailor), and when a return credits the order
--    (a percentage on the sales left after the credit note; a fixed amount
--    goes to zero when everything was returned).
-- Rollback: supabase/rollbacks/20270108_tailor_commission_date.down.sql

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS commission_at timestamptz;
UPDATE public.orders SET commission_at = updated_at WHERE calculated_commission IS NOT NULL AND commission_at IS NULL;

CREATE OR REPLACE FUNCTION public.calculate_order_tailor_commission()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  tailor_comm_type VARCHAR(20);
  tailor_comm_val  NUMERIC;
  v_net_sales      NUMERIC;
  v_kept           NUMERIC;
  v_due            boolean;
BEGIN
  IF NEW.status = 'cancelled' THEN
    NEW.calculated_commission := 0;
    RETURN NEW;
  END IF;

  -- Falls due: the order reaches ready.
  v_due := NEW.status::text IN ('ready', 'ironing_packaging')
           AND (OLD.status IS NULL OR OLD.status::text NOT IN ('ready', 'ironing_packaging'));
  -- Worked out again: a new tailor, or a credit note, after it fell due.
  IF NOT v_due AND NEW.calculated_commission IS NOT NULL
     AND (NEW.assigned_tailor_id IS DISTINCT FROM OLD.assigned_tailor_id
          OR NEW.credited_amount IS DISTINCT FROM OLD.credited_amount) THEN
    v_due := true;
  END IF;

  IF v_due AND NEW.assigned_tailor_id IS NOT NULL THEN
    SELECT commission_type, commission_value INTO tailor_comm_type, tailor_comm_val
      FROM public.staff WHERE id = NEW.assigned_tailor_id;
    -- What is left of the sale after credit notes, before VAT.
    v_kept := GREATEST(COALESCE(NEW.total_amount, 0) - COALESCE(NEW.credited_amount, 0), 0);
    v_net_sales := CASE WHEN COALESCE(NEW.total_amount, 0) > 0
                        THEN v_kept * (COALESCE(NEW.total_amount, 0) - COALESCE(NEW.tax_amount, 0)) / NEW.total_amount
                        ELSE 0 END;
    IF tailor_comm_type = 'fixed_amount' THEN
      NEW.calculated_commission := CASE WHEN v_kept <= 0 THEN 0 ELSE tailor_comm_val END;
    ELSIF tailor_comm_type = 'percentage' THEN
      NEW.calculated_commission := round(v_net_sales * COALESCE(tailor_comm_val, 0) / 100, 2);
    END IF;
    IF NEW.commission_at IS NULL OR NEW.assigned_tailor_id IS DISTINCT FROM OLD.assigned_tailor_id THEN
      NEW.commission_at := now();
    END IF;
  ELSIF v_due AND NEW.assigned_tailor_id IS NULL AND OLD.assigned_tailor_id IS NOT NULL THEN
    NEW.calculated_commission := NULL;
    NEW.commission_at := NULL;
  END IF;
  RETURN NEW;
END; $function$;
