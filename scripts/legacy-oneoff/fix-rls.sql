-- Execute this script in Supabase SQL Editor to make the database work with direct client requests
-- This replaces the requirement to run `set_config` from a backend.

-- 1.-- Helper Function: Get current user ID from Firebase JWT
CREATE OR REPLACE FUNCTION app_current_uid()
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
    SELECT current_setting('request.jwt.claims', true)::jsonb ->> 'sub'
$$;

-- Helper Function: Check if super admin (bypassing RLS on saas_users)
CREATE OR REPLACE FUNCTION app_is_super_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    is_admin BOOLEAN;
    cur_uid TEXT;
BEGIN
    cur_uid := app_current_uid();
    IF cur_uid IS NULL THEN RETURN FALSE; END IF;
    SELECT TRUE INTO is_admin FROM saas_users WHERE uid = cur_uid AND role = 'super_admin' AND is_active = true;
    RETURN COALESCE(is_admin, FALSE);
END;
$$;

-- Helper Function: Get current tenant ID dynamically 
-- IMPROVED: Avoids recursion by using explicit policies or bypassing RLS via security definer
CREATE OR REPLACE FUNCTION app_current_tenant_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    t_id UUID;
    cur_uid TEXT;
BEGIN
    -- SECURITY: The tenant ID is derived ONLY from the verified Firebase JWT
    -- (request.jwt.claims -> sub), never from a client-supplied header.
    -- A previous version trusted an `x-tenant-id` request header "for
    -- performance", which let any authenticated user set that header (via
    -- localStorage in the web client) and read/write ANY other tenant's data —
    -- a full cross-tenant isolation breach. That header shortcut is removed.

    cur_uid := app_current_uid();
    IF cur_uid IS NULL THEN RETURN NULL; END IF;

    -- 1. Check if user is staff (Owner is often also staff)
    -- This query bypasses RLS because it's in a SECURITY DEFINER function
    SELECT tenant_id INTO t_id FROM staff WHERE uid = cur_uid AND status = 'active' LIMIT 1;
    IF t_id IS NOT NULL THEN
        RETURN t_id;
    END IF;

    -- 2. Check if user is owner directly from tenants table
    SELECT id INTO t_id FROM tenants WHERE owner_uid = cur_uid LIMIT 1;
    RETURN t_id;
END;
$$;

-- 4. Fix specific policies for identity lookup
-- We must allow users to see their OWN records in staff and tenants even without a tenant_id header
-- to prevent the "onboarding loop" when recursion fails.

-- STAFF: Let user see their own row
DROP POLICY IF EXISTS "staff_read_own" ON staff;
CREATE POLICY "staff_read_own" ON staff
    FOR SELECT USING (uid = app_current_uid() OR (tenant_id = app_current_tenant_id()));

-- TENANTS: Let owner see their own row
DROP POLICY IF EXISTS "tenants_read_own" ON tenants;
CREATE POLICY "tenants_read_own" ON tenants
    FOR SELECT USING (
        app_is_super_admin() 
        OR owner_uid = app_current_uid()
        OR id = app_current_tenant_id()
    );

-- USERS: Standard self-read
DROP POLICY IF EXISTS users_self_read ON users;
CREATE POLICY users_self_read ON users
    FOR SELECT USING (app_is_super_admin() OR id = app_current_uid());

DROP POLICY IF EXISTS users_self_write ON users;
CREATE POLICY users_self_write ON users
    FOR UPDATE USING (app_is_super_admin() OR id = app_current_uid())
    WITH CHECK (app_is_super_admin() OR id = app_current_uid());

-- TAILOR REQUESTS
DROP POLICY IF EXISTS tailor_requests_self ON tailor_requests;
CREATE POLICY tailor_requests_self ON tailor_requests
    FOR SELECT USING (
        app_is_super_admin() OR uid = app_current_uid()
    );

DROP POLICY IF EXISTS tailor_requests_create ON tailor_requests;
CREATE POLICY tailor_requests_create ON tailor_requests
    FOR INSERT WITH CHECK (uid = app_current_uid());

DROP POLICY IF EXISTS tailor_requests_update ON tailor_requests;
CREATE POLICY tailor_requests_update ON tailor_requests
    FOR UPDATE USING (
        app_is_super_admin() OR uid = app_current_uid()
    )
    WITH CHECK (
        app_is_super_admin() OR uid = app_current_uid()
    );

-- 5. Enable insertion for newly registered users (Crucial for first-time login)
DROP POLICY IF EXISTS "users_super_admin_write" ON users;
CREATE POLICY "users_super_admin_write" ON users 
    FOR INSERT WITH CHECK (id = app_current_uid() OR app_is_super_admin());

-- 6. Support for Onboarding process
DROP POLICY IF EXISTS "tenants_onboarding_insert" ON tenants;
CREATE POLICY "tenants_onboarding_insert" ON tenants
    FOR INSERT WITH CHECK (owner_uid = app_current_uid() OR app_is_super_admin());

DROP POLICY IF EXISTS "staff_onboarding_insert" ON staff;
CREATE POLICY "staff_onboarding_insert" ON staff
    FOR INSERT WITH CHECK (uid = app_current_uid() OR app_is_super_admin());
