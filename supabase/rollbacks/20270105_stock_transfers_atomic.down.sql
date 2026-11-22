-- Rollback of 20270105000003_stock_transfers_atomic.sql (variant_id is kept).
DROP FUNCTION IF EXISTS public.ship_stock_transfer(uuid);
DROP FUNCTION IF EXISTS public.receive_stock_transfer(uuid, jsonb, text);
DROP FUNCTION IF EXISTS public.reject_stock_transfer(uuid, text);
GRANT EXECUTE ON FUNCTION public.transfer_ship_item(text, uuid, uuid, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_receive_item(text, uuid, uuid, uuid, numeric) TO authenticated;
