-- inventory_adjustments / adjustment_items RLS policies referenced
-- current_setting('app.current_tenant_id', true), a Firebase-era session
-- variable the app never sets when talking to PostgREST directly. In
-- practice the stock-take feature's API routes always use the service-role
-- client (supabaseAdmin) which bypasses RLS entirely, so this never broke
-- anything client-visible -- but it left these two tables silently
-- inaccessible to any future direct (non-admin) query, and inconsistent
-- with the rest of the schema's app_current_tenant_id() convention.

DROP POLICY IF EXISTS tenant_isolation_inventory_adjustments ON inventory_adjustments;
CREATE POLICY inventory_adjustments_tenant ON inventory_adjustments
    FOR ALL
    TO authenticated
    USING (tenant_id = app_current_tenant_id()::text)
    WITH CHECK (tenant_id = app_current_tenant_id()::text);

DROP POLICY IF EXISTS tenant_isolation_adjustment_items ON adjustment_items;
CREATE POLICY adjustment_items_tenant ON adjustment_items
    FOR ALL
    TO authenticated
    USING (tenant_id = app_current_tenant_id()::text)
    WITH CHECK (tenant_id = app_current_tenant_id()::text);
