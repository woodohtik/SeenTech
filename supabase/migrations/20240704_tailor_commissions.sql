-- Add commission fields to staff table
ALTER TABLE staff
ADD COLUMN IF NOT EXISTS commission_type VARCHAR(20) CHECK (commission_type IN ('percentage', 'fixed_amount')),
ADD COLUMN IF NOT EXISTS commission_value DECIMAL(10,2);

-- Add commission fields to order_items table
ALTER TABLE order_items
ADD COLUMN IF NOT EXISTS assigned_tailor_id UUID REFERENCES staff(id),
ADD COLUMN IF NOT EXISTS calculated_commission DECIMAL(10,2);

-- Function to calculate commission on order item status change
CREATE OR REPLACE FUNCTION calculate_tailor_commission()
RETURNS TRIGGER AS $$
DECLARE
    tailor_comm_type VARCHAR(20);
    tailor_comm_val DECIMAL(10,2);
BEGIN
    -- Only calculate when status changes to 'ready' or 'ironing_packaging'
    IF NEW.status::text IN ('ready', 'ironing_packaging') AND (OLD.status IS NULL OR OLD.status::text NOT IN ('ready', 'ironing_packaging')) THEN
        -- Check if a tailor is assigned
        IF NEW.assigned_tailor_id IS NOT NULL THEN
            -- Get tailor's commission policy
            SELECT commission_type, commission_value 
            INTO tailor_comm_type, tailor_comm_val
            FROM staff 
            WHERE id = NEW.assigned_tailor_id;

            IF tailor_comm_type = 'fixed_amount' THEN
                NEW.calculated_commission := tailor_comm_val;
            ELSIF tailor_comm_type = 'percentage' THEN
                -- Calculate percentage based on price
                NEW.calculated_commission := (NEW.price * tailor_comm_val) / 100;
            END IF;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to execute the function before update
DROP TRIGGER IF EXISTS trg_calculate_tailor_commission ON order_items;
CREATE TRIGGER trg_calculate_tailor_commission
BEFORE UPDATE ON order_items
FOR EACH ROW
EXECUTE FUNCTION calculate_tailor_commission();
