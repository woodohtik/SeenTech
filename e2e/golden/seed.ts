/**
 * Builds "محل الاختبار الآلي" from nothing in the local test database
 * (seen-stability-guardrails-task.md, question 3) -- run before every golden
 * run:  npx tsx e2e/golden/seed.ts
 *
 * Users through the auth admin API (as GoTrue makes them), the rest through
 * the service role. Anything left from an earlier run is removed first.
 */
import { db } from './db';
import { CUSTOMER, FABRIC, PRODUCT, SHOP, STAFF, TEST_PASSWORD } from './fixtures';

async function must<T>(label: string, p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${label}: ${JSON.stringify(error)}`);
  return data;
}

async function main() {
  const sb = db();

  // Users: remove the earlier ones, make them again.
  const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 });
  for (const u of list?.users ?? []) if (u.email?.endsWith('@golden.test')) await sb.auth.admin.deleteUser(u.id);
  const uid: Record<keyof typeof STAFF, string> = { owner: '', cashier: '', tailor: '' };
  for (const key of Object.keys(STAFF) as Array<keyof typeof STAFF>) {
    const s = STAFF[key];
    const { data: created, error } = await sb.auth.admin.createUser({ email: s.email, password: TEST_PASSWORD, email_confirm: true, user_metadata: { full_name: s.name } });
    if (error || !created.user) throw new Error(`user ${s.email}: ${JSON.stringify(error)}`);
    uid[key] = created.user.id;
  }

  // The shop, from nothing.
  await sb.from('tenants').delete().eq('id', SHOP.tenantId);
  await must('users', sb.from('users').upsert((Object.keys(STAFF) as Array<keyof typeof STAFF>).map((k) => ({ id: uid[k], email: STAFF[k].email, display_name: STAFF[k].name }))));
  await must('tenant', sb.from('tenants').insert({
    id: SHOP.tenantId, name: SHOP.name, owner_email: STAFF.owner.email, owner_uid: uid.owner, phone: '0500000000',
    status: 'active', subscription_status: 'active', is_test: true, vat_number: SHOP.vatNumber, is_tax_enabled: true, default_tax_rate: 15,
  }));
  await must('branch', sb.from('branches').insert({ id: SHOP.branchId, tenant_id: SHOP.tenantId, name: 'الفرع الرئيسي', location: 'الرياض', is_main: true }));
  await must('staff', sb.from('staff').insert((Object.keys(STAFF) as Array<keyof typeof STAFF>).map((k) => ({
    id: STAFF[k].staffId, tenant_id: SHOP.tenantId, uid: uid[k], name: STAFF[k].name, email: STAFF[k].email,
    role: STAFF[k].role, status: 'active', branch_id: SHOP.branchId, must_change_pin: false,
  }))));
  await must('customer', sb.from('customers').insert({ id: CUSTOMER.id, tenant_id: SHOP.tenantId, name: CUSTOMER.name, phone: CUSTOMER.phone }));
  await must('fabric', sb.from('inventory_items').insert({
    id: FABRIC.id, tenant_id: SHOP.tenantId, name: FABRIC.name, sku: 'GOLDEN-COTTON', category: 'fabric', category_key: 'cotton',
    unit: 'meter', base_unit: 'meter', conversion_rate: 1, price_per_unit: 20, min_threshold: 0,
  }));
  await must('product', sb.from('inventory_items').insert({
    id: PRODUCT.id, tenant_id: SHOP.tenantId, name: PRODUCT.name, sku: 'GOLDEN-SHEMAGH', category: 'accessories',
    unit: 'piece', base_unit: 'piece', conversion_rate: 1, price_per_unit: PRODUCT.price, min_threshold: 0,
  }));
  await must('stock', sb.from('branch_inventory').insert([
    { tenant_id: SHOP.tenantId, branch_id: SHOP.branchId, item_id: FABRIC.id, quantity: FABRIC.stock },
    { tenant_id: SHOP.tenantId, branch_id: SHOP.branchId, item_id: PRODUCT.id, quantity: PRODUCT.stock },
  ]));

  console.log(`seeded ${SHOP.name}: ${Object.keys(STAFF).length} staff, 1 customer, ${FABRIC.stock} m of ${FABRIC.name}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
