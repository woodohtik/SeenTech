-- Production carried two hand-applied policies that no migration ever created
-- (absent on staging): roles_admin_write and user_permission_overrides_admin_write.
-- Both are PERMISSIVE FOR ALL on the role enum (owner/admin), so Postgres ORs
-- them with the permission-based policies from 20261212000000 and
-- 20261215000000 -- letting an owner/admin skip the staff.permissions gate and
-- the cross-tenant staff_id check on user_permission_overrides.
-- No legitimate access is lost: owner always passes app_has_permission, admin
-- holds staff.permissions by default, and SELECT stays covered by *_tenant_read.
DROP POLICY IF EXISTS roles_admin_write ON public.roles;
DROP POLICY IF EXISTS user_permission_overrides_admin_write ON public.user_permission_overrides;
