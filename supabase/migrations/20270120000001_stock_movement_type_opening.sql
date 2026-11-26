-- seen-merchant-trial-test-2026-11-26.md, phase 3 item 1: the stock movement
-- type "opening_balance" for record_opening_balance (20270120000000).
-- An enum value cannot be removed; the rollback of 20270120 leaves it unused.
ALTER TYPE public.stock_movement_type ADD VALUE IF NOT EXISTS 'opening_balance';
