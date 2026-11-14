-- seen-cto-sprint0-critical-fixes-task.md item 7, part 2 (DB1-01).
-- Confirmed live by item 0's own diagnostic:
-- `select has_column_privilege('authenticated','public.staff','pin_hash','select')`
-- returned TRUE. 20260909010000_staff_pin_hash_column_lockdown.sql's
-- `REVOKE SELECT (pin_hash) ON public.staff FROM anon, authenticated;` was a
-- no-op: a column-level REVOKE does nothing when the role still holds the
-- broader TABLE-level SELECT grant that Supabase's default privileges give
-- `anon`/`authenticated` on every table in `public`. Grepped every
-- `from('staff').select(...)` call in src/ (not just the 4 the task names --
-- all of them, both single-line and multi-line chains): every one already
-- lists explicit columns and none references pin_hash, so no application
-- code needs to change here -- the gap was purely this grant, reachable by
-- anyone running a raw `supabase.from('staff').select('pin_hash')` from
-- devtools regardless of what the app's own UI ever queries for.

REVOKE SELECT ON public.staff FROM anon, authenticated;

GRANT SELECT (
  id, tenant_id, uid, name, email, phone, role, role_id, branch_id, status,
  must_change_pin, is_test, created_at, updated_at,
  commission_type, commission_value, has_seen_onboarding, commission_balance, has_pin
) ON public.staff TO authenticated;
