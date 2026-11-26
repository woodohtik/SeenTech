-- Rollback of 20270117000000_garment_components.sql: the cutting dialog goes
-- back to cloth only. Stock already taken for components stays taken (its
-- movements are in stock_movements); orders.components_* stay (nothing older
-- reads them).
DROP FUNCTION IF EXISTS public.update_order_status_with_components(uuid, text, text, jsonb, jsonb, text, uuid, text);
DROP TABLE IF EXISTS public.garment_components;
