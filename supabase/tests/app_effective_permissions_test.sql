-- seen-permissions-fix-task.md Phase 7: app_effective_permissions, the one
-- decision. pgTAP -- runs in CI (`supabase test db`) on a fresh database built
-- from the migrations alone, and on staging with
--   npx supabase db query --linked --file supabase/tests/app_effective_permissions_test.sql
-- role_default_permissions is generated from src/shared/permissionsMatrix.json
-- (src/shared/permissionsMatrix.test.ts keeps the two equal).
BEGIN;
SELECT plan(14);

SET LOCAL session_replication_role = replica;
INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test) VALUES
  ('e0000000-0000-4000-8000-0000000000a1', 'eff A', 'eff-a@example.invalid', '0500000040', 'active', true),
  ('e0000000-0000-4000-8000-0000000000b1', 'eff B', 'eff-b@example.invalid', '0500000041', 'active', true);
INSERT INTO public.staff (id, tenant_id, uid, name, email, role, status, is_test)
SELECT ('e0000000-0000-4000-8000-0000000001' || lpad(n::text, 2, '0'))::uuid, 'e0000000-0000-4000-8000-0000000000a1',
       'e0000000-0000-4000-8000-0000000009' || lpad(n::text, 2, '0'), 'eff ' || r, 'eff-' || r || '@example.invalid', r::public.user_role, 'active', true
  FROM unnest(ARRAY['owner','admin','manager','branch_manager','accountant','warehouse_manager','cashier','tailor']) WITH ORDINALITY AS x(r, n);
-- shop B's cashier, a custom role and an override in shop A
INSERT INTO public.staff (id, tenant_id, uid, name, email, role, status, is_test) VALUES
  ('e0000000-0000-4000-8000-000000000201', 'e0000000-0000-4000-8000-0000000000b1', 'e0000000-0000-4000-8000-000000000991', 'eff B cashier', 'eff-b-cashier@example.invalid', 'cashier', 'active', true);
INSERT INTO public.roles (id, tenant_id, role_key, name, permissions, base_role) VALUES
  ('e0000000-0000-4000-8000-000000000301', 'e0000000-0000-4000-8000-0000000000a1', 'custom_eff', 'custom', '{"action.refund": true, "payments.collect": false}'::jsonb, 'cashier');
INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status, is_test) VALUES
  ('e0000000-0000-4000-8000-000000000302', 'e0000000-0000-4000-8000-0000000000a1', 'e0000000-0000-4000-8000-000000000992', 'eff custom', 'eff-custom@example.invalid', 'cashier', 'e0000000-0000-4000-8000-000000000301', 'active', true);
INSERT INTO public.user_permission_overrides (tenant_id, staff_id, overrides) VALUES
  ('e0000000-0000-4000-8000-0000000000a1', 'e0000000-0000-4000-8000-000000000108', '{"payments.collect": true}'::jsonb);
SET LOCAL session_replication_role = origin;

-- 1-7. Every built-in role (no roles rows) gets exactly its defaults, every key.
SELECT is(
  (SELECT count(*) FROM public.role_default_permissions d
     JOIN public.staff s ON s.role::text = d.role_key AND s.tenant_id = 'e0000000-0000-4000-8000-0000000000a1' AND s.role_id IS NULL AND s.role::text = r
    WHERE (public.app_effective_permissions(s.id) ->> d.permission_key)::boolean IS DISTINCT FROM d.allowed),
  0::bigint, r || ': every key equals its default')
FROM unnest(ARRAY['admin','manager','branch_manager','accountant','warehouse_manager','cashier']) AS r;
SELECT is((SELECT count(*) FROM jsonb_object_keys(public.app_effective_permissions('e0000000-0000-4000-8000-000000000107'))), 50::bigint,
          'a role''s map names all 50 keys');

-- 8. The owner: every key.
SELECT ok(NOT EXISTS (SELECT 1 FROM jsonb_each(public.app_effective_permissions('e0000000-0000-4000-8000-000000000101')) e WHERE e.value <> 'true'::jsonb),
          'owner: every key');

-- 9. An override wins over the role (tailor + payments.collect).
SELECT is((public.app_effective_permissions('e0000000-0000-4000-8000-000000000108') ->> 'payments.collect')::boolean, true,
          'tailor with an override may take payments');

-- 10-11. A custom role (role_id) decides its keys; keys it omits keep the base role's defaults.
SELECT is((public.app_effective_permissions('e0000000-0000-4000-8000-000000000302') ->> 'payments.collect')::boolean, false,
          'custom role: its own "no" wins over the base role''s default');
SELECT is((public.app_effective_permissions('e0000000-0000-4000-8000-000000000302') ->> 'action.discount')::boolean, true,
          'custom role: an omitted key keeps the base role''s default');

-- 12-13. Editing "cashier" in shop A changes shop A only.
INSERT INTO public.roles (tenant_id, role_key, name, permissions)
VALUES ('e0000000-0000-4000-8000-0000000000a1', 'cashier', 'cashier (edited)', '{"action.refund": true}'::jsonb);
SELECT is((public.app_effective_permissions('e0000000-0000-4000-8000-000000000107') ->> 'action.refund')::boolean, true,
          'shop A''s edited cashier role applies to shop A''s cashier');
SELECT is((public.app_effective_permissions('e0000000-0000-4000-8000-000000000201') ->> 'action.refund')::boolean, false,
          'shop B''s cashier is not changed by shop A''s edit');

-- 14. app_has_permission reads the same map (shop A's cashier, every key).
SELECT set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-000000000907","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*) FROM jsonb_each(public.app_effective_permissions('e0000000-0000-4000-8000-000000000107')) e
    WHERE public.app_has_permission(e.key) IS DISTINCT FROM (e.value = 'true'::jsonb)),
  0::bigint, 'app_has_permission agrees with app_effective_permissions on every key');

SELECT * FROM finish();
ROLLBACK;
