/**
 * Repeatable verification of create_pos_sale / apply_stock_movement /
 * create_purchase_order against a REAL Postgres instance -- see
 * seen-pos-sale-testing-task.md for the full scoping behind this (High #10
 * in seen-deep-technical-audit.md: zero test coverage on the actual sale/
 * stock-deduction RPCs).
 *
 * This is "Option B" from that task file: no new infra (no Docker/local
 * Supabase stack, which isn't available on this machine). It creates a
 * disposable, clearly-marked tenant on STAGING via a direct Postgres
 * connection, exercises the RPCs with known inputs, asserts the results,
 * then deletes everything it created. Nothing here is a real Supabase Auth
 * account -- the "staff" it creates has no password, no real login
 * capability, and the uid is never granted a session; it only exists so the
 * SQL-level app_current_tenant_id()/app_current_staff_id() lookups resolve.
 *
 * -----------------------------------------------------------------------
 * WHY A DIRECT PG CONNECTION (not @supabase/supabase-js / PostgREST):
 * create_pos_sale and friends gate on app_current_tenant_id(), which reads
 * Supabase's real auth.uid() -- and auth.uid() casts the JWT `sub` claim to
 * uuid internally. Simulating a specific staff member without forging a
 * signed JWT (a bigger, riskier undertaking) means setting the
 * `request.jwt.claims` GUC directly before calling the RPC, in the SAME
 * database session -- something only a raw Postgres connection can do.
 * This is exactly the recipe manually verified once already (see the task
 * file); this script just makes it repeatable.
 *
 * SETUP (one-time): get the DIRECT (non-pooled) connection string for the
 * STAGING project (yodvqhdjzjyhvrlhguzf) -- Supabase Dashboard -> Project
 * Settings -> Database -> Connection string -> "Direct connection" (port
 * 5432). Do NOT use the Transaction pooler (port 6543): pgbouncer in
 * transaction mode can hand the SET and the following SELECT to two
 * different underlying connections, silently breaking the whole technique.
 * Put it in .env.local as SUPABASE_STAGING_DB_URL -- never commit it, never
 * print it.
 *
 * RUN: npm run db:verify-pos-sale
 * (add --keep to skip cleanup, for inspecting the fixtures manually)
 */
import { Client } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: true });
} else {
  dotenv.config({ override: true });
}

const STAGING_PROJECT_REF = 'yodvqhdjzjyhvrlhguzf';
const connectionString = process.env.SUPABASE_STAGING_DB_URL;
const KEEP_FIXTURES = process.argv.includes('--keep');

if (!connectionString) {
  console.error('Missing SUPABASE_STAGING_DB_URL in .env.local -- see the header comment in this file for where to get it.');
  process.exit(1);
}
// SAFETY: this script creates and deletes real rows. Refuse to run against
// anything that isn't verifiably the staging project -- a pasted-in-error
// production connection string must never reach this code path.
if (!connectionString.includes(STAGING_PROJECT_REF)) {
  console.error(`SAFETY CHECK FAILED: SUPABASE_STAGING_DB_URL does not contain the staging project ref (${STAGING_PROJECT_REF}). Refusing to run against what might be production.`);
  process.exit(1);
}

// Fixed, recognizable fixture ids -- never random. Real rows always get
// fully random UUIDs, so this pattern can never collide with real data, and
// a fixed id makes cleanup (and re-running after a crash mid-script)
// unambiguous: DELETE WHERE id = <this exact value>, nothing fuzzy.
const USER_ID = '00000000-0000-4000-8000-0000000000aa';
const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const BRANCH_ID = '00000000-0000-4000-8000-000000000002';
const ITEM_ID = '00000000-0000-4000-8000-000000000003';
const SUPPLIER_ID = '00000000-0000-4000-8000-000000000004';
const SALE1_ID = '00000000-0000-4000-8000-00000000a001';
const SALE2_ID = '00000000-0000-4000-8000-00000000a002';
const PO_ID = '00000000-0000-4000-8000-00000000b001';

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`);
    failed++;
  }
}

async function asUser(client: Client) {
  await client.query(`SET request.jwt.claims = '{"sub": "${USER_ID}"}'`);
}

async function setupFixtures(client: Client) {
  console.log('Setting up disposable fixtures on staging...');
  await client.query(`INSERT INTO users (id, email) VALUES ('${USER_ID}', 'posesaletest-owner@test.invalid')`);
  await client.query(`INSERT INTO tenants (id, name, owner_email, phone, status, owner_uid, is_test)
    VALUES ('${TENANT_ID}', '__pos_sale_rpc_test__', 'posesaletest-tenant@test.invalid', '+966500000099', 'active', '${USER_ID}', true)`);
  await client.query(`INSERT INTO branches (id, tenant_id, name, location, type, is_main, is_active)
    VALUES ('${BRANCH_ID}', '${TENANT_ID}', 'Test Branch', 'Test Location', 'store', true, true)`);
  // 'cashier', not 'owner'/'admin' -- staff_role_grant_guard blocks inserting
  // a privileged role from an unauthenticated session, and the RPCs under
  // test don't care about role at all, only tenant/staff existence.
  await client.query(`INSERT INTO staff (tenant_id, uid, name, email, role, status)
    VALUES ('${TENANT_ID}', '${USER_ID}', 'Test Cashier', 'posesaletest-staff@test.invalid', 'cashier', 'active')`);
  await client.query(`INSERT INTO inventory_items (id, tenant_id, name, category, unit, base_unit, conversion_rate, sku, quantity, price_per_unit)
    VALUES ('${ITEM_ID}', '${TENANT_ID}', 'Test Ready-Made Item', 'ready_made', 'piece', 'piece', 1, 'TEST-SKU-001', 0, 50)`);
  await client.query(`INSERT INTO branch_inventory (tenant_id, branch_id, item_id, quantity)
    VALUES ('${TENANT_ID}', '${BRANCH_ID}', '${ITEM_ID}', 10)`);
  await client.query(`INSERT INTO suppliers (id, tenant_id, name) VALUES ('${SUPPLIER_ID}', '${TENANT_ID}', 'Test Supplier')`);
}

async function cleanupFixtures(client: Client) {
  console.log('Cleaning up disposable fixtures...');
  // tenant delete cascades through staff/branches/inventory_items/
  // branch_inventory/suppliers/orders/order_items/tax_invoices/
  // purchase_orders/purchase_order_items -- but stock_operations and
  // zatca_invoice_chain_state have no FK to tenants at all, so they need
  // explicit cleanup, and the fake `users` row outlives the cascade too.
  await client.query(`DELETE FROM tenants WHERE id = '${TENANT_ID}'`);
  await client.query(`DELETE FROM stock_operations WHERE tenant_id = '${TENANT_ID}'`);
  await client.query(`DELETE FROM zatca_invoice_chain_state WHERE tenant_id = '${TENANT_ID}'`);
  await client.query(`DELETE FROM stock_ledger WHERE tenant_id = '${TENANT_ID}'`);
  await client.query(`DELETE FROM users WHERE id = '${USER_ID}'`);
}

async function main() {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    await setupFixtures(client);

    // --- Test 1: a normal sale ---------------------------------------
    console.log('\nTest 1: create_pos_sale -- normal sale (2 units)');
    await asUser(client);
    const sale1 = await client.query(`SELECT public.create_pos_sale(
      '${SALE1_ID}'::uuid,
      jsonb_build_object('branch_id','${BRANCH_ID}','shift_id',null,'customer_id',null,'customer_name','Test Customer','order_number',900001,'status','delivered','payment_method','cash','total_amount',100,'paid_amount',100,'tax_rate',0,'tax_amount',0,'discount_amount',0,'order_date',now()::text,'delivery_date',now()::text,'qr_code',null,'notes',null),
      jsonb_build_array(jsonb_build_object('type','ready_made','item_id','${ITEM_ID}','name','Test Item','quantity',2,'price',50)),
      jsonb_build_object('invoice_number','TEST-INV-900001','subtotal',100,'vat_number',null,'notes',null)
    ) AS result`);
    const r1 = sale1.rows[0].result;
    check('order_id matches operation_id', r1.order_id === SALE1_ID, r1.order_id);
    check('not replayed on first call', r1.replayed === false, r1.replayed);
    check('tracking_token generated', typeof r1.tracking_token === 'string' && r1.tracking_token.length > 0, r1.tracking_token);
    check('no stock conflicts', r1.stock_conflicts === 0, r1.stock_conflicts);

    const after1 = await client.query(`SELECT
      (SELECT count(*) FROM order_items WHERE order_id = '${SALE1_ID}') AS items,
      (SELECT invoice_hash FROM tax_invoices WHERE order_id = '${SALE1_ID}') AS invoice_hash,
      (SELECT previous_invoice_hash FROM tax_invoices WHERE order_id = '${SALE1_ID}') AS prev_hash,
      (SELECT quantity FROM branch_inventory WHERE item_id = '${ITEM_ID}') AS stock`);
    const a1 = after1.rows[0];
    check('exactly 1 order_items row', Number(a1.items) === 1, a1.items);
    check('invoice_hash set', !!a1.invoice_hash, a1.invoice_hash);
    check('first invoice has no previous_invoice_hash (fresh tenant)', a1.prev_hash === null, a1.prev_hash);
    check('stock deducted 10 -> 8', Number(a1.stock) === 8, a1.stock);
    const invoice1Hash: string = a1.invoice_hash;

    // --- Test 2: replay the same operation_id -------------------------
    console.log('\nTest 2: create_pos_sale -- replay same operation_id (idempotency)');
    await asUser(client);
    const sale1replay = await client.query(`SELECT public.create_pos_sale(
      '${SALE1_ID}'::uuid,
      jsonb_build_object('branch_id','${BRANCH_ID}','shift_id',null,'customer_id',null,'customer_name','Test Customer','order_number',900001,'status','delivered','payment_method','cash','total_amount',100,'paid_amount',100,'tax_rate',0,'tax_amount',0,'discount_amount',0,'order_date',now()::text,'delivery_date',now()::text,'qr_code',null,'notes',null),
      jsonb_build_array(jsonb_build_object('type','ready_made','item_id','${ITEM_ID}','name','Test Item','quantity',2,'price',50)),
      jsonb_build_object('invoice_number','TEST-INV-900001','subtotal',100,'vat_number',null,'notes',null)
    ) AS result`);
    const r1replay = sale1replay.rows[0].result;
    check('replayed on retry', r1replay.replayed === true, r1replay.replayed);
    check('same tracking_token on replay', r1replay.tracking_token === r1.tracking_token, r1replay.tracking_token);

    const stockAfterReplay = await client.query(`SELECT quantity FROM branch_inventory WHERE item_id = '${ITEM_ID}'`);
    check('stock NOT double-deducted on replay (still 8)', Number(stockAfterReplay.rows[0].quantity) === 8, stockAfterReplay.rows[0].quantity);

    // --- Test 3: a second real sale -> PIH chain must link ------------
    console.log('\nTest 3: create_pos_sale -- second sale, PIH chain linkage');
    await asUser(client);
    await client.query(`SELECT public.create_pos_sale(
      '${SALE2_ID}'::uuid,
      jsonb_build_object('branch_id','${BRANCH_ID}','shift_id',null,'customer_id',null,'customer_name','Test Customer 2','order_number',900002,'status','delivered','payment_method','cash','total_amount',50,'paid_amount',50,'tax_rate',0,'tax_amount',0,'discount_amount',0,'order_date',now()::text,'delivery_date',now()::text,'qr_code',null,'notes',null),
      jsonb_build_array(jsonb_build_object('type','ready_made','item_id','${ITEM_ID}','name','Test Item','quantity',1,'price',50)),
      jsonb_build_object('invoice_number','TEST-INV-900002','subtotal',50,'vat_number',null,'notes',null)
    )`);
    const after2 = await client.query(`SELECT
      (SELECT previous_invoice_hash FROM tax_invoices WHERE order_id = '${SALE2_ID}') AS prev_hash,
      (SELECT quantity FROM branch_inventory WHERE item_id = '${ITEM_ID}') AS stock`);
    check('invoice 2 previous_invoice_hash == invoice 1 invoice_hash', after2.rows[0].prev_hash === invoice1Hash, after2.rows[0].prev_hash);
    check('stock deducted 8 -> 7', Number(after2.rows[0].stock) === 7, after2.rows[0].stock);

    // --- Test 4: apply_stock_movement rejects over-deduction ----------
    console.log('\nTest 4: apply_stock_movement -- rejects deducting more than available');
    await asUser(client);
    let overDeductionRejected = false;
    let overDeductionErrorCode: string | undefined;
    try {
      await client.query(`SELECT public.apply_stock_movement('test-op-negative-guard-001', '${BRANCH_ID}'::uuid, '${ITEM_ID}'::uuid, -1000, 'adjustment')`);
    } catch (err: any) {
      overDeductionRejected = true;
      overDeductionErrorCode = err?.code;
    }
    check('over-deduction raised an exception', overDeductionRejected);
    check('exception is the stock-conflict error code (23514)', overDeductionErrorCode === '23514', overDeductionErrorCode);

    // --- Test 5: create_purchase_order atomic creation -----------------
    console.log('\nTest 5: create_purchase_order -- atomic header+items creation');
    await asUser(client);
    const po1 = await client.query(`SELECT public.create_purchase_order(
      '${PO_ID}'::uuid,
      jsonb_build_object('supplier_id','${SUPPLIER_ID}','branch_id','${BRANCH_ID}','po_number','TEST-PO-001','notes',null),
      jsonb_build_array(jsonb_build_object('item_id','${ITEM_ID}','name','Test Item','quantity',5,'unit','piece','conversion_rate',1,'base_quantity',5,'price_per_unit',20,'total',100))
    ) AS result`);
    check('PO not replayed on first call', po1.rows[0].result.replayed === false, po1.rows[0].result.replayed);
    const poRows = await client.query(`SELECT
      (SELECT count(*) FROM purchase_orders WHERE id = '${PO_ID}') AS header,
      (SELECT count(*) FROM purchase_order_items WHERE purchase_order_id = '${PO_ID}') AS items`);
    check('PO header created', Number(poRows.rows[0].header) === 1, poRows.rows[0].header);
    check('PO item created atomically with header', Number(poRows.rows[0].items) === 1, poRows.rows[0].items);

    // --- Test 6: replay create_purchase_order --------------------------
    console.log('\nTest 6: create_purchase_order -- replay same operation_id (idempotency)');
    await asUser(client);
    const po1replay = await client.query(`SELECT public.create_purchase_order(
      '${PO_ID}'::uuid,
      jsonb_build_object('supplier_id','${SUPPLIER_ID}','branch_id','${BRANCH_ID}','po_number','TEST-PO-001','notes',null),
      jsonb_build_array(jsonb_build_object('item_id','${ITEM_ID}','name','Test Item','quantity',5,'unit','piece','conversion_rate',1,'base_quantity',5,'price_per_unit',20,'total',100))
    ) AS result`);
    check('PO replayed on retry', po1replay.rows[0].result.replayed === true, po1replay.rows[0].result.replayed);
    const poItemsAfterReplay = await client.query(`SELECT count(*) AS n FROM purchase_order_items WHERE purchase_order_id = '${PO_ID}'`);
    check('no duplicate PO item on replay', Number(poItemsAfterReplay.rows[0].n) === 1, poItemsAfterReplay.rows[0].n);
  } finally {
    if (KEEP_FIXTURES) {
      console.log('\n--keep passed: leaving fixtures in place for inspection. Clean up manually when done.');
    } else {
      await cleanupFixtures(client);
    }
    await client.end();
  }

  console.log(`\n${passed} passed, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Script failed with an unexpected error:', err);
  process.exit(1);
});
