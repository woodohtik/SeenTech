-- Rollback of 20270122000001_set_order_images.sql: photos can then be set only
-- when the order is created.
DROP FUNCTION IF EXISTS public.set_order_images(uuid, jsonb);
