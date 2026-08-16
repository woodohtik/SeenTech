-- Every useRealtimeSync() call in the app (inventory live sync, POS stock
-- updates, order tracking, and the new setup checklist bar) depends on
-- Supabase Realtime's postgres_changes feed - which requires the table to be
-- added to the `supabase_realtime` publication. Neither staging nor
-- production ever had ANY table in that publication (confirmed on both), so
-- every one of these "live sync" features has been silently doing nothing.
ALTER PUBLICATION supabase_realtime ADD TABLE tenants;
ALTER PUBLICATION supabase_realtime ADD TABLE inventory_items;
ALTER PUBLICATION supabase_realtime ADD TABLE branch_inventory;
ALTER PUBLICATION supabase_realtime ADD TABLE customers;
ALTER PUBLICATION supabase_realtime ADD TABLE orders;
ALTER PUBLICATION supabase_realtime ADD TABLE tax_invoices;
