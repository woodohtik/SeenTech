/**
 * Builds "محل الاختبار الآلي" from nothing in the local test database
 * (seen-stability-guardrails-task.md, question 3) -- run before every golden
 * run:  npx tsx e2e/golden/seed.ts
 *
 * The users through the auth admin API (as GoTrue makes them); the shop's
 * rows as SQL through the local database's superuser, with triggers set aside
 * for that one transaction (as supabase/tests/*.sql set up theirs) -- the
 * guard that lets only an owner make an owner is right for people, not for
 * building a test shop. Anything left from an earlier run is removed first.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { db } from './db';
import { CUSTOMER, FABRIC, PRODUCT, SHOP, STAFF, TEST_PASSWORD } from './fixtures';

const q = (v: string | number | boolean | null) =>
  v === null ? 'NULL' : typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : String(v);

function runSql(sql: string): void {
  const file = path.join(tmpdir(), `golden-seed-${process.pid}.sql`);
  writeFileSync(file, sql);
  const cli = process.env.SUPABASE_CLI;
  execFileSync(cli || 'npx', [...(cli ? [] : ['supabase']), 'db', 'query', '--local', '--file', file], {
    stdio: ['ignore', 'pipe', 'inherit'], shell: process.platform === 'win32',
  });
}

async function main() {
  const sb = db();

  // Users: remove the earlier ones, make them again.
  const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 });
  for (const u of list?.users ?? []) if (u.email?.endsWith('@golden.test')) await sb.auth.admin.deleteUser(u.id);
  const uid = {} as Record<keyof typeof STAFF, string>;
  for (const key of Object.keys(STAFF) as Array<keyof typeof STAFF>) {
    const s = STAFF[key];
    const { data: created, error } = await sb.auth.admin.createUser({ email: s.email, password: TEST_PASSWORD, email_confirm: true, user_metadata: { full_name: s.name } });
    if (error || !created.user) throw new Error(`user ${s.email}: ${JSON.stringify(error)}`);
    uid[key] = created.user.id;
  }
  const keys = Object.keys(STAFF) as Array<keyof typeof STAFF>;

  // One statement (the local query runs it as a prepared statement), one transaction.
  runSql(`
DO $seed$
BEGIN
PERFORM set_config('session_replication_role', 'replica', true);
DELETE FROM public.tenants WHERE id = ${q(SHOP.tenantId)};
INSERT INTO public.users (id, email, display_name) VALUES
  ${keys.map((k) => `(${q(uid[k])}, ${q(STAFF[k].email)}, ${q(STAFF[k].name)})`).join(',\n  ')}
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, display_name = EXCLUDED.display_name;
INSERT INTO public.tenants (id, name, owner_email, owner_uid, phone, status, subscription_status, is_test, vat_number, is_tax_enabled, default_tax_rate)
VALUES (${q(SHOP.tenantId)}, ${q(SHOP.name)}, ${q(STAFF.owner.email)}, ${q(uid.owner)}, '0500000000', 'active', 'active', true, ${q(SHOP.vatNumber)}, true, 15);
INSERT INTO public.branches (id, tenant_id, name, location, is_main)
VALUES (${q(SHOP.branchId)}, ${q(SHOP.tenantId)}, 'الفرع الرئيسي', 'الرياض', true);
INSERT INTO public.staff (id, tenant_id, uid, name, email, role, status, branch_id, must_change_pin) VALUES
  ${keys.map((k) => `(${q(STAFF[k].staffId)}, ${q(SHOP.tenantId)}, ${q(uid[k])}, ${q(STAFF[k].name)}, ${q(STAFF[k].email)}, ${q(STAFF[k].role)}, 'active', ${q(SHOP.branchId)}, false)`).join(',\n  ')};
INSERT INTO public.customers (id, tenant_id, name, phone) VALUES (${q(CUSTOMER.id)}, ${q(SHOP.tenantId)}, ${q(CUSTOMER.name)}, ${q(CUSTOMER.phone)});
INSERT INTO public.inventory_items (id, tenant_id, name, sku, category, category_key, unit, base_unit, conversion_rate, price_per_unit, min_threshold) VALUES
  (${q(FABRIC.id)}, ${q(SHOP.tenantId)}, ${q(FABRIC.name)}, 'GOLDEN-COTTON', 'fabric', 'cotton', 'meter', 'meter', 1, 20, 0),
  (${q(PRODUCT.id)}, ${q(SHOP.tenantId)}, ${q(PRODUCT.name)}, 'GOLDEN-SHEMAGH', 'accessories', NULL, 'piece', 'piece', 1, ${PRODUCT.price}, 0);
INSERT INTO public.branch_inventory (tenant_id, branch_id, item_id, quantity) VALUES
  (${q(SHOP.tenantId)}, ${q(SHOP.branchId)}, ${q(FABRIC.id)}, ${FABRIC.stock}),
  (${q(SHOP.tenantId)}, ${q(SHOP.branchId)}, ${q(PRODUCT.id)}, ${PRODUCT.stock});
END
$seed$;
`);

  // The seed is checked, not assumed.
  const { data: staff, error } = await sb.from('staff').select('id').eq('tenant_id', SHOP.tenantId);
  if (error || staff?.length !== keys.length) throw new Error(`seed did not take: ${JSON.stringify(error ?? staff)}`);
  console.log(`seeded ${SHOP.name}: ${keys.length} staff, 1 customer, ${FABRIC.stock} m of ${FABRIC.name}, ${PRODUCT.stock} × ${PRODUCT.name}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
