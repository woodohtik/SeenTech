-- Rollback of 20270120000001_stock_movement_type_opening.sql: PostgreSQL
-- cannot drop an enum value. The value 'opening_balance' stays, unused once
-- 20270120_opening_balance.down.sql has removed record_opening_balance.
-- Nothing to run.
SELECT 1;
