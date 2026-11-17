-- seen-cto-sprint4-design-quality-task.md item 4: confirmed by `supabase
-- test db` in CI, once the migration-ordering bugs (previous two commits)
-- were fixed and every migration finally applied cleanly to a fresh local
-- Postgres: every pgTAP scenario hitting a real table (not a SECURITY
-- DEFINER RPC) failed with "permission denied for table X", even for the
-- owner role, even on a plain SELECT. Supabase Cloud provisions every new
-- project with baseline anon/authenticated/service_role table grants as
-- part of its own one-time platform bootstrap -- outside anything tracked
-- in supabase/migrations/, since migrations only capture schema changes
-- a developer explicitly authored. `supabase db start` builds a fresh
-- local Postgres purely from this project's own migrations, so it never
-- gets that bootstrap -- this project's RLS policies (tenant_tables loop,
-- 20240601000000, and everything layered on top of it since) were always
-- the real row-level gate, but with no table-level grant at all, nothing
-- ever reached RLS evaluation in a from-scratch build.
--
-- These are exactly Supabase's own documented default grants, made
-- explicit here instead of assumed. CREATE OR REPLACE semantics don't
-- apply to GRANT, but GRANT itself is idempotent -- re-running this
-- against staging/production (which already have these from Cloud's
-- bootstrap) changes nothing there.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- The blanket GRANT ALL ON ALL TABLES above would silently re-open three
-- deliberate, already-applied lockdowns if left unrepeated here (checked
-- every REVOKE statement across supabase/migrations/*.sql, not assumed --
-- these are the only three targeting a table rather than a function):
-- staff (pin_hash exposure, 20261114000005), tenant_order_counters
-- (SECURITY DEFINER-only, 20261115000000), and tenant_print_hosts
-- (SECURITY DEFINER-only, 20261026000000). Re-applying each exactly as it
-- stands today keeps this migration a true no-op against staging/
-- production, instead of a regression.
REVOKE SELECT ON public.staff FROM anon, authenticated;
GRANT SELECT (
  id, tenant_id, uid, name, email, phone, role, role_id, branch_id, status,
  must_change_pin, is_test, created_at, updated_at,
  commission_type, commission_value, has_seen_onboarding, commission_balance, has_pin
) ON public.staff TO authenticated;

REVOKE ALL ON public.tenant_order_counters FROM PUBLIC, anon, authenticated;

REVOKE ALL ON public.tenant_print_hosts FROM authenticated, anon;
