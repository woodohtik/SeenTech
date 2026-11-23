-- Rollback of 20270107000001_order_lookup_per_number_limit.sql
DROP FUNCTION IF EXISTS public.increment_order_lookup_failure(text);
DELETE FROM public.tracking_attempts WHERE ip LIKE 'order:%';
