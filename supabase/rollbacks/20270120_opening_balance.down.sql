-- Rollback of 20270120000000_opening_balance.sql: no opening quantity on a
-- new item (stock enters by purchase order only). Balances already entered stay.
DROP FUNCTION IF EXISTS public.record_opening_balance(uuid, uuid, numeric);
