-- B-2 (security-fix-tasklist.md): no trigger anywhere in the schema (checked
-- all 22+ SQL files and every migration) actually prevents a staff member
-- from editing their own row to grant themselves a higher role, a different
-- role_id, reactivating themselves, or moving themselves to another tenant.
-- "staff_tenant_update" (generated in the tenant_tables loop) only checks
-- tenant_id = app_current_tenant_id(), which a self-edit already satisfies.
--
-- Confirmed staff has both role (user_role enum) and role_id (uuid, custom
-- role support) -- both must be covered, plus status and tenant_id.

CREATE OR REPLACE FUNCTION staff_no_self_escalation() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.uid = app_current_uid() AND NOT app_is_super_admin() THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.role_id IS DISTINCT FROM OLD.role_id
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'لا يمكن تعديل الدور أو الحالة أو المستأجر على حسابك الشخصي';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff_no_self_escalation_trigger ON staff;
CREATE TRIGGER staff_no_self_escalation_trigger
BEFORE UPDATE ON staff
FOR EACH ROW EXECUTE FUNCTION staff_no_self_escalation();
