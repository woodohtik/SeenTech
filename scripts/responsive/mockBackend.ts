/**
 * seen-responsive-layout-task.md Phase 0 -- a backend made of fixtures, for the
 * layout snapshots.
 *
 * The snapshot tool runs the branch's own code against NO real backend: the
 * dev server is started with a Supabase URL that does not exist
 * (MOCK_SUPABASE_URL), and every request to it, and to /api, is answered here.
 * Nothing can reach staging or production, no account is used, and the shop
 * on screen is invented. (This project's rule: no test accounts -- see
 * playwright.config.ts.)
 */
import type { BrowserContext, Route } from 'playwright';
import permissionsMatrix from '../../src/shared/permissionsMatrix.json' with { type: 'json' };
// The tailoring activity's reference rows (categories, stages, fields): product configuration, not shop data.
import vertical from './fixtures/vertical-mens-tailoring.json' with { type: 'json' };

export const MOCK_SUPABASE_URL = 'https://seen-mock.supabase.co';
export const MOCK_ANON_KEY = 'mock-anon-key';
const STORAGE_KEY = 'sb-seen-mock-auth-token';

const UID = '00000000-0000-4000-8000-0000000000aa';
const TENANT = '00000000-0000-4000-8000-0000000000bb';
const BRANCH = '00000000-0000-4000-8000-0000000000cc';
const STAFF = '00000000-0000-4000-8000-0000000000dd';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const daysAgo = (d: number) => new Date(Date.UTC(2026, 10, 23, 9, 0, 0) - d * 86_400_000).toISOString();

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** Shaped like a JWT (three parts); signed by nobody, checked by nobody here. */
const ACCESS_TOKEN = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ sub: UID, role: 'authenticated', aal: 'aal1', email: 'owner@example.invalid', exp: 4102444800 })}.mock`;

const user = {
  id: UID, aud: 'authenticated', role: 'authenticated', email: 'owner@example.invalid',
  app_metadata: { provider: 'email' }, user_metadata: { full_name: 'صاحب المحل' }, created_at: daysAgo(300),
};
const session = { access_token: ACCESS_TOKEN, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 3600 * 24 * 365, expires_at: 4102444800, user };

const tenant = {
  id: TENANT, name: 'مشغل الأناقة للخياطة', legal_name: 'مؤسسة الأناقة للخياطة', owner_uid: UID, owner_email: 'owner@example.invalid',
  phone: '0500000000', address: 'الرياض، حي الملز', city: 'الرياض', vat_number: '310000000000003', commercial_register: '1010000000',
  status: 'active', plan_id: 'basic', subscription_status: 'active', is_trial: false, subscription_end_date: '2027-09-01T00:00:00Z',
  trial_ends_at: null, locked_at: null, purge_at: null, trashed_at: null, is_test: true, vertical: 'mens_tailoring',
  measurement_unit: 'inch', default_layout: 'sidebar', is_tax_enabled: true, default_tax_rate: 15,
  tax_settings: { enabled: true, vatRate: 15, trn: '310000000000003', taxType: 'exclusive', legalName: 'مؤسسة الأناقة للخياطة' },
  enabled_modules: ['pos', 'orders', 'inventory', 'invoicing', 'customers'], assistant_enabled: true, logo_url: null,
  whatsapp_settings: {}, created_at: daysAgo(300), updated_at: daysAgo(1), onboarding_step: 4,
};
const staff = {
  id: STAFF, uid: UID, tenant_id: TENANT, branch_id: BRANCH, name: 'صاحب المحل', email: 'owner@example.invalid', phone: '0500000000',
  role: 'owner', role_id: null, status: 'active', must_change_pin: false, is_test: false, has_seen_onboarding: true, has_pin: false,
  commission_type: null, commission_value: 0, commission_balance: 0, created_at: daysAgo(300), updated_at: daysAgo(1),
};
const NAMES = ['أبو عبدالله', 'محمد العتيبي', 'سعد القحطاني', 'فهد الدوسري', 'خالد الحربي', 'عبدالرحمن الشهري', 'ناصر المطيري', 'تركي الغامدي'];
const customers = NAMES.map((name, i) => ({
  id: id(100 + i), tenant_id: TENANT, name, phone: `05${String(10000000 + i * 1111111).slice(0, 8)}`, email: null, notes: null,
  measurements: { length: 58 + i, shoulder: 18, chest: 22 }, balance: i % 3 === 0 ? 150 : 0, created_at: daysAgo(40 - i), updated_at: daysAgo(i),
}));
const STATUSES = ['measurements_taken', 'cutting', 'sewing', 'ready', 'delivered', 'measurements_taken', 'sewing', 'ready'];
const orders = NAMES.map((name, i) => ({
  id: id(200 + i), tenant_id: TENANT, branch_id: BRANCH, customer_id: id(100 + i), customer_name: name, customer_phone: customers[i].phone,
  order_number: 1040 + i, status: STATUSES[i], status_key: STATUSES[i], total_amount: 345 + i * 115, paid_amount: i % 2 ? 345 + i * 115 : 100,
  credited_amount: 0, remaining_amount: i % 2 ? 0 : 245 + i * 115, tax_amount: 45 + i * 15, tax_rate: 0.15, discount_amount: 0,
  order_date: daysAgo(i), delivery_date: daysAgo(i - 5), notes: null, items: [], history: [], is_test: false, created_by: STAFF,
  tracking_token: id(300 + i), assigned_tailor_id: null, payment_method: 'cash', created_at: daysAgo(i), updated_at: daysAgo(i),
}));
const ITEMS = ['قماش ياباني أبيض', 'قماش كوري سكري', 'أزرار صدف', 'كبك فضي', 'قماش إنجليزي رمادي', 'ياقات جاهزة'];
const inventory = ITEMS.map((name, i) => ({
  id: id(400 + i), tenant_id: TENANT, name, sku: `SKU-${100 + i}`, category: i < 2 || i === 4 ? 'fabric' : 'accessories', category_key: i < 2 || i === 4 ? 'fabric' : 'accessories',
  quantity: 40 - i * 6, unit: i < 2 || i === 4 ? 'meter' : 'piece', price_per_unit: 35 + i * 10, cost_per_unit: 20 + i * 5, min_quantity: 10,
  tax_type: 'exclusive', is_active: true, image: null, created_at: daysAgo(90), updated_at: daysAgo(i),
}));

const TABLES: Record<string, unknown[]> = {
  tenants: [tenant],
  staff: [staff],
  users: [{ id: UID, email: 'owner@example.invalid', display_name: 'صاحب المحل', has_seen_tour: true, created_at: daysAgo(300) }],
  branches: [{ id: BRANCH, tenant_id: TENANT, name: 'الفرع الرئيسي', location: 'الرياض', is_main: true, created_at: daysAgo(300) }],
  customers,
  orders,
  inventory_items: inventory,
  branch_inventory: inventory.map((it: any, i) => ({ id: id(500 + i), tenant_id: TENANT, branch_id: BRANCH, item_id: it.id, quantity: it.quantity })),
  plans: [
    { id: 'free', name: 'الباقة المجانية', price: 0, features: ['تجربة 14 يوم'], max_staff: 2, max_orders: 100, is_active: true, billing_period: 'year' },
    { id: 'basic', name: 'الخطة الأساسية', price: 999, features: ['إدارة العملاء', 'إدارة الطلبات', 'دعم فني'], max_staff: 5, max_orders: 0, is_active: true, billing_period: 'year' },
  ],
  shifts: [{ id: id(600), tenant_id: TENANT, branch_id: BRANCH, staff_id: STAFF, staff_name: 'صاحب المحل', status: 'open', opening_balance: 200, start_time: daysAgo(0), totals: {} }],
  suppliers: [{ id: id(700), tenant_id: TENANT, name: 'مؤسسة الأقمشة الحديثة', phone: '0111111111', balance: 1200, created_at: daysAgo(100) }],
  ...(vertical as Record<string, unknown[]>),
  notifications: [],
  saas_settings: [],
  support_access_requests: [],
  order_items: [],
  tax_invoices: [],
  sales_returns: [],
  payments: [],
  shift_entries: [],
  roles: [],
  tenant_categories: [],
  inventory_variants: [],
  purchase_orders: [],
  supplier_transactions: [],
  employee_activity_logs: [],
  audit_logs: [],
  subscription_requests: [],
  saas_subscription_payments: [],
  support_sessions: [],
  zatca_credentials: [],
  zatca_submissions: [],
  print_stations: [],
  stock_transfers: [],
  inventory_adjustments: [],
  fabric_shortages: [],
};

const allPermissions = Object.fromEntries((permissionsMatrix.keys as string[]).map((k) => [k, true]));

const RPC: Record<string, unknown> = {
  get_session_identity: { user: TABLES.users[0], staff, tenant, saas_user: null, tailor_request: null, referral_partner: null, role_key: 'owner', has_staff_with_pin: false },
  get_my_permissions: allPermissions,
  app_effective_permissions: allPermissions,
  staff_ids_with_pin_set: [],
  tenant_tax_rules: { enabled: true, rate: 0.15, tax_type: 'exclusive' },
  get_dashboard_stats: {
    ranges: [{ orders: 3, paid: 1380, pending: 2, customers: 2 }, { orders: 8, paid: 4140, pending: 5, customers: 6 }, { orders: 31, paid: 15870, pending: 9, customers: 22 }],
    filtered: {
      orders: 8, paid: 4140, remaining: 1610, pending: 5, customers: 8, completion_hours: 96, completion_count: 2,
      active_customers: 6, customers_with_orders: 8, repeat_customers: 2,
      status_counts: { measurements_taken: 2, cutting: 1, sewing: 2, ready: 2, delivered: 1 },
    },
    totals: { orders: 8, in_progress: 5, measurements_taken: 2, ready: 2 },
    low_stock: 1, customers_total: 8,
  },
  get_low_stock_items: [],
  get_setup_progress: { has_stock: true, has_customers: true, has_orders: true, has_invoices: true },
};

export type Unmocked = { method: string; url: string };

function json(route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) {
  return route.fulfill({
    status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', ...headers },
    body: JSON.stringify(body),
  });
}

/** Answers every Supabase and /api request from fixtures. Returns what it had no fixture for. */
export async function installMockBackend(context: BrowserContext, opts: { lang: 'ar' | 'en'; theme?: 'light' | 'dark' }): Promise<Unmocked[]> {
  const unmocked: Unmocked[] = [];
  const blocked = new Set<string>();
  (unmocked as Unmocked[] & { blockedHosts?: Set<string> }).blockedHosts = blocked;

  await context.addInitScript(({ key, value, lang, theme }) => {
    try {
      localStorage.setItem(key, value);
      localStorage.setItem('i18nextLng', lang);
      localStorage.setItem('language', lang);
      localStorage.setItem('theme', theme);
    } catch { /* storage unavailable: the app starts signed out and the run fails loudly */ }
  }, { key: STORAGE_KEY, value: JSON.stringify(session), lang: opts.lang, theme: opts.theme || 'light' });

  // Default deny: anything that is not the local dev server or the mock
  // backend is aborted (later routes take precedence over this one), so no
  // key in a local .env file can reach a real service during a run.
  await context.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === '127.0.0.1' || host === 'localhost') return route.fallback();
    blocked.add(host);
    return route.abort();
  });

  await context.route(`${MOCK_SUPABASE_URL}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    if (method === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    }
    if (url.pathname.startsWith('/auth/v1/')) {
      if (url.pathname.endsWith('/user')) return json(route, user);
      if (url.pathname.endsWith('/token')) return json(route, session);
      if (url.pathname.includes('/factors')) return json(route, { all: [], totp: [] });
      return json(route, {});
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const name = url.pathname.slice('/rest/v1/rpc/'.length);
      if (name in RPC) return json(route, RPC[name]);
      unmocked.push({ method, url: `rpc/${name}` });
      return json(route, null);
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.slice('/rest/v1/'.length);
      if (!(table in TABLES)) unmocked.push({ method, url: `table/${table}` });
      if (method !== 'GET' && method !== 'HEAD') return json(route, []);
      let rows = (TABLES[table] || []) as Array<Record<string, unknown>>;
      // The equality filters the screens use: column=eq.value.
      for (const [col, cond] of url.searchParams) {
        if (typeof cond === 'string' && cond.startsWith('eq.') && rows.length && col in rows[0]) rows = rows.filter((r) => String(r[col]) === cond.slice(3));
      }
      const limit = Number(url.searchParams.get('limit') || 0);
      if (limit > 0) rows = rows.slice(0, limit);
      const range = { 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' };
      if ((req.headers()['accept'] || '').includes('vnd.pgrst.object')) {
        if (rows.length === 0) return json(route, { code: 'PGRST116', message: 'no rows', details: 'The result contains 0 rows', hint: null }, 406);
        return json(route, rows[0], 200, range);
      }
      return json(route, method === 'HEAD' ? '' : rows, 200, range);
    }
    if (url.pathname.startsWith('/storage/v1/')) return json(route, []);
    unmocked.push({ method, url: url.pathname });
    return json(route, {});
  });

  // The Express server is not running: the app's own /api, from fixtures.
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (!/^(127\.0\.0\.1|localhost)$/.test(url.hostname)) return route.fallback();
    if (url.pathname === '/api/assistant-settings/status') return json(route, { isEnabled: true, remaining: 30, dailyLimit: 40 });
    if (url.pathname === '/api/ping') return json(route, { ok: true });
    if (url.pathname === '/api/assistant/conversations') return json(route, { conversations: [] });
    if (url.pathname.startsWith('/api/print/')) return json(route, { ok: false }, 501);
    unmocked.push({ method: route.request().method(), url: url.pathname });
    return json(route, {});
  });

  // Realtime: accept the socket and say nothing.
  await context.routeWebSocket(/seen-mock\.supabase\.co/, () => { /* connected, silent */ });
  return unmocked;
}
