/**
 * Checks public.get_dashboard_stats against the browser calculation, on
 * real data of the linked Supabase project (staging):
 *   npx tsx scripts/check-dashboard-stats.ts [tenantId]
 *
 * For every dashboard period it builds the same plan the page sends, asks
 * the database function, and computes the same result from the raw rows
 * with statsFromRows (src/components/dashboard/dashboardStats.ts) -- which
 * its own unit test proves equal to the old page code. Read only.
 * Uses `npx supabase db query --linked` (database owner, so RLS is not in
 * play here; supabase/tests/get_dashboard_stats_rls_test.sql covers RLS).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDashboardPlan, planRanges, statsFromRows, type Timeframe } from '../src/components/dashboard/dashboardStats';
import { decodeOrderRow } from '../src/utils/orderHistoryHelper';

function query(sql: string): any[] {
  const file = path.join(os.tmpdir(), `dash-check-${process.pid}.sql`);
  fs.writeFileSync(file, sql);
  const out = execFileSync('npx', ['supabase', 'db', 'query', '--linked', '--file', file], { encoding: 'utf8', shell: true, maxBuffer: 256 * 1024 * 1024 });
  fs.unlinkSync(file);
  return JSON.parse(out.slice(out.indexOf('{'))).rows;
}

const lit = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;

let tenantId = process.argv[2];
if (!tenantId) {
  tenantId = query(`select tenant_id::text as t from public.orders group by tenant_id order by count(*) desc limit 1;`)[0].t;
}
console.log('tenant', tenantId);

const now = new Date();
const cases: Array<[Timeframe, string, string]> = [
  ['all', '', ''], ['daily', '', ''], ['weekly', '', ''], ['monthly', '', ''], ['quarterly', '', ''], ['yearly', '', ''],
  ['custom', '2026-09-01', '2026-11-30'], ['custom', '2026-11-19', '2026-11-19'],
];
const plans = cases.map(([tf, s, e]) => buildDashboardPlan({ timeframe: tf, customStartDate: s, customEndDate: e, revenueRange: 30, now }));

const calls = plans.map((p) =>
  `public.get_dashboard_stats('${tenantId}'::uuid, NULL, ${lit(planRanges(p))}, ${p.filter ? lit(p.filter) : 'NULL'}, '${p.activeSince}'::timestamptz)`);
const row = query(`
select jsonb_build_object(
  'stats', jsonb_build_array(${calls.join(',\n    ')}),
  'orders', (select coalesce(jsonb_agg(jsonb_build_object('customer_id', customer_id, 'order_date', order_date, 'status_key', status_key,
               'status', status, 'paid_amount', paid_amount, 'remaining_amount', remaining_amount, 'notes', notes,
               'phase', public.order_phase((select vertical from public.tenants where id = '${tenantId}'), status_key, status::text))), '[]') from public.orders where tenant_id = '${tenantId}'),
  'finished', (select coalesce(jsonb_agg(s.stage_key), '[]') from public.vertical_workflow_stages s join public.tenants t on t.vertical = s.vertical_key
                where t.id = '${tenantId}' and s.phase in ('ready', 'delivered')),
  'customers', (select coalesce(jsonb_agg(jsonb_build_object('created_at', created_at)), '[]') from public.customers where tenant_id = '${tenantId}'),
  'inventory', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'min_threshold', min_threshold)), '[]') from public.inventory_items where tenant_id = '${tenantId}'),
  'binv', (select coalesce(jsonb_agg(jsonb_build_object('item_id', item_id, 'quantity', quantity)), '[]') from public.branch_inventory where tenant_id = '${tenantId}')
) as r;`)[0].r;

// The rows exactly as DashboardOwner.tsx mapped them (PostgREST timestamps are +00:00).
const pgIso = (v: string | null) => (v ? new Date(v).toISOString().replace('Z', '+00:00') : v);
const rows = {
  orders: row.orders.map((o: any) => {
    const d = decodeOrderRow({ notes: o.notes });
    return {
      status: o.status_key || o.status,
    phase: o.phase,
      orderDate: pgIso(o.order_date) || new Date().toISOString(),
      paidAmount: Number(o.paid_amount) || 0,
      remainingAmount: Number(o.remaining_amount) || 0,
      customerId: o.customer_id || '',
      history: d.history,
    };
  }),
  customers: row.customers.map((c: any) => ({ createdAt: c.created_at })),
  inventory: row.inventory.map((i: any) => ({ id: i.id, minThreshold: Number(i.min_threshold) || 0 })),
  bInv: row.binv.map((b: any) => ({ itemId: b.item_id, quantity: Number(b.quantity) || 0 })),
};
console.log(`rows: ${rows.orders.length} orders, ${rows.customers.length} customers, ${rows.inventory.length} items`);

let failures = 0;
plans.forEach((plan, i) => {
  const fromSql = row.stats[i];
  const fromRows = statsFromRows(plan, rows, new Set(['delivered', 'ready', ...row.finished]));
  const norm = (x: any) => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v)));
  const a = norm({ ...fromSql, ranges: fromSql.ranges.map((r: any) => ({ ...r, paid: Number(r.paid) })) });
  a.filtered.paid = Number(a.filtered.paid); a.filtered.remaining = Number(a.filtered.remaining);
  a.filtered.completion_hours = Math.round(Number(a.filtered.completion_hours) * 1e3) / 1e3;
  const b = norm(fromRows); b.filtered.completion_hours = Math.round(b.filtered.completion_hours * 1e3) / 1e3;
  const same = JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
  console.log(`${same ? 'SAME' : 'DIFF'}  ${cases[i].filter(Boolean).join(' ')}`);
  if (!same) { failures++; console.log(' sql :', JSON.stringify(sortKeys(a))); console.log(' rows:', JSON.stringify(sortKeys(b))); }
});
function sortKeys(v: any): any {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
process.exit(failures ? 1 : 0);
