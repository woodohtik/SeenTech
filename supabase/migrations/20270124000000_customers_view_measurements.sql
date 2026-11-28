-- seen-open-verticals-task.md, wave 1 (question 6's default): «عرض مقاسات
-- العملاء» -- in a women's tailoring shop the customers' measurements are seen
-- only with it. On for owner, admin, managers and the tailors; off for the
-- cashier, accountant and warehouse (src/shared/permissionsMatrix.json, its
-- block regenerated in 20270101000000 for a fresh database; this adds the rows
-- to an existing one). A role's own list without the key falls back to these
-- defaults (app_effective_permissions), so nothing else changes.
--
-- Test: supabase/tests/customers_view_measurements_test.sql
-- Rollback: supabase/rollbacks/20270124_customers_view_measurements.down.sql
INSERT INTO public.role_default_permissions (role_key, permission_key, allowed) VALUES
  ('owner', 'customers.view_measurements', true),
  ('admin', 'customers.view_measurements', true),
  ('manager', 'customers.view_measurements', true),
  ('branch_manager', 'customers.view_measurements', true),
  ('accountant', 'customers.view_measurements', false),
  ('warehouse_manager', 'customers.view_measurements', false),
  ('cashier', 'customers.view_measurements', false),
  ('tailor', 'customers.view_measurements', true)
ON CONFLICT (role_key, permission_key) DO UPDATE SET allowed = EXCLUDED.allowed;
