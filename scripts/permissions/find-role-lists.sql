-- seen-permissions-fix-task.md Phase 3 / acceptance: no fixed role list in the
-- latest definition of any policy or function for a shop action, except
-- conditions on 'owner' and 'super_admin'. Read-only.
--   npx supabase db query --linked --file scripts/permissions/find-role-lists.sql
-- Expected: "role_lists": null.
--
-- A role list is a comparison of a role (app_current_role(), v_role, s.role,
-- staff.role) with IN (...) / = ANY (...) / = '...' naming a shop role other
-- than owner/super_admin. Platform functions (saas_*, admin_*, the platform
-- reports, impersonation, the staff self-escalation guards the task says not
-- to touch) are out of scope and excluded by name.
WITH shop_roles AS (
  SELECT unnest(ARRAY['admin','manager','branch_manager','accountant','warehouse_manager','cashier','tailor']) AS r
),
fn AS (
  SELECT p.proname AS name, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname NOT LIKE 'saas\_%' AND p.proname NOT LIKE 'admin\_%'
     AND p.proname NOT LIKE 'staff\_role\_grant\_guard%' AND p.proname NOT LIKE 'staff\_column\_protection%'
     AND p.proname NOT IN ('app_default_permission', 'app_current_role', 'app_effective_permissions',
                           'get_saas_revenue_report', 'get_platform_order_summary', 'end_impersonation_session')
),
pol AS (
  SELECT tablename || '.' || policyname AS name, coalesce(qual, '') || ' ' || coalesce(with_check, '') AS def
    FROM pg_policies WHERE schemaname = 'public' AND tablename NOT LIKE 'saas\_%'
     -- The owner creating their own first staff row at sign-up: a condition on
     -- the new row's role value, not on who the caller is.
     AND policyname <> 'staff_onboarding_insert'
),
hits AS (
  SELECT 'function' AS kind, name, def FROM fn
  UNION ALL
  SELECT 'policy', name, def FROM pol
)
SELECT json_build_object('role_lists', (
  SELECT json_agg(DISTINCT kind || ' ' || name)
    FROM hits h
   WHERE h.def ~* '(app_current_role\(\)|v_role|s\.role|staff\.role|\mrole)\s*(NOT\s+)?(IN\s*\(|=\s*ANY|=\s*''|<>\s*'')'
     AND EXISTS (SELECT 1 FROM shop_roles sr WHERE h.def ~* ('''' || sr.r || ''''))
)) AS r;
