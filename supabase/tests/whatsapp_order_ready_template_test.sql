-- seen-merchant-trial-test-2026-11-26.md, phase 2 item 6: "your order is
-- ready" is one of the shop's WhatsApp templates (seen-whatsapp-templates-task.md),
-- editable like the others; an unknown name is still refused.
--
--   CI:    supabase test db
--   Here:  npx tsx scripts/db/pgtap-linked.ts supabase/tests/whatsapp_order_ready_template_test.sql   (staging, rolled back)
BEGIN;
SELECT plan(3);

SET session_replication_role = replica;
INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test)
VALUES ('a9000000-0000-4000-8000-000000000001', 'Ready Template Shop', 'ready-tpl@example.invalid', '0500000901', 'active', true);
INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status)
VALUES ('c9000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000001', 'Owner', 'ready-own@example.invalid', 'owner', NULL, 'active');
SET session_replication_role = DEFAULT;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d9000000-0000-4000-8000-000000000001"}';

SELECT lives_ok($$ SELECT public.save_whatsapp_templates(NULL, '{"order_ready":"طلبك {order_id} جاهز يا {customer_name}"}'::jsonb) $$,
  'the "order ready" template is saved');
RESET ROLE;
SELECT is((SELECT whatsapp_settings #>> '{templates,order_ready}' FROM public.tenants WHERE id = 'a9000000-0000-4000-8000-000000000001'),
  'طلبك {order_id} جاهز يا {customer_name}', 'and kept with the shop');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d9000000-0000-4000-8000-000000000001"}';
SELECT throws_ok($$ SELECT public.save_whatsapp_templates(NULL, '{"anything_else":"x"}'::jsonb) $$, '22023', NULL,
  'an unknown template name is still refused');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
