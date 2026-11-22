-- Rollback of 20270105000000_edit_tailoring_order.sql.
DROP FUNCTION IF EXISTS public.update_tailoring_order(uuid, uuid, jsonb, jsonb, text);
