// مِقياس أداء «سِين» — أول فتح وتسجيل الدخول (مرجع لملف seen-performance-first-open-login-task.md)
// Perf probe for the Seen production build served by `vite preview` on :4173.
// Build first with a fake Supabase URL so every call is mocked locally:
//   VITE_SUPABASE_URL=https://perfprobe.supabase.co VITE_SUPABASE_ANON_KEY=dummy npx vite build && npx vite preview --port 4173
// usage: node docs/perf/seen-perf-probe.cjs <scenario> <profile> [supabaseDelayMs] [apiDelayMs]
//   env: DATA=big (1500 customers / 2400 orders) · REFOCUS=1 (hide→show tab) · BASE=http://localhost:4173 · TAG=before-
//   scenario: login-cold | app-open-cold | app-open-warm
//   profile:  wifi | 4g
// Supabase and /api are mocked with fixed per-request delays (server time +
// round trip). Output: JSON summary + waterfall written to out/<scenario>-<profile>.json
const fs = require('fs');
const { chromium } = require('@playwright/test');

fs.mkdirSync('perf-out', { recursive: true });
const [scenario = 'login-cold', profile = 'wifi', supaDelayArg, apiDelayArg] = process.argv.slice(2);
const SUPA_DELAY = Number(supaDelayArg || 180);
const API_DELAY = Number(apiDelayArg || 250);
const GFONTS_DELAY = 250;
const BASE = process.env.BASE || 'http://localhost:4173';
const UID = '11111111-1111-4111-8111-111111111111';
const TENANT = '22222222-2222-4222-8222-222222222222';
const STAFF = '33333333-3333-4333-8333-333333333333';

const PROFILES = {
  wifi: { latency: 20, down: (10 * 1024 * 1024) / 8, up: (5 * 1024 * 1024) / 8, cpu: 1 },
  '4g': { latency: 150, down: (1.6 * 1024 * 1024) / 8, up: (750 * 1024) / 8, cpu: 4 },
};

const tenantRow = {
  id: TENANT, name: 'محل تجريبي', status: 'active', plan_id: 'pro', subscription_status: 'active',
  trial_ends_at: new Date(Date.now() + 30 * 864e5).toISOString(), created_at: new Date(Date.now() - 90 * 864e5).toISOString(),
  measurement_unit: 'cm', logo_url: null, inventory_strategy: 'decentralized', tax_settings: {}, vertical_key: 'mens_tailoring',
};
const staffRow = {
  id: STAFF, uid: UID, name: 'سلطان', email: 'owner@example.com', phone: '+966500000000', role: 'owner', role_id: null,
  branch_id: null, status: 'active', must_change_pin: false, is_test: false, tenant_id: TENANT, has_pin: false,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(), commission_type: null, commission_value: 0,
  has_seen_onboarding: true, commission_balance: 0,
};

function b64u(o) { return Buffer.from(JSON.stringify(o)).toString('base64url'); }
function makeSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const access_token = `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ sub: UID, email: 'owner@example.com', role: 'authenticated', aud: 'authenticated', exp })}.sig`;
  return {
    access_token, refresh_token: 'perf-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'owner@example.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  };
}

const BIG = process.env.DATA === 'big';
const MAX_ROWS = 1000; // PostgREST max-rows default on Supabase
const big = (() => {
  if (!BIG) return null;
  const meas = { length: 145, shoulder: 47, chest: 112, sleeve: 62, neck: 41, handWidth: 22, midSleeveWidth: 14, cuffLength: 8, waist: 100, bottomWidth: 150, collarType: 'classic', cuffType: 'square', pocketType: 'hidden', chestStyle: 'plain' };
  const customers = Array.from({ length: 1500 }, (_, i) => ({ id: `c-${i}`, tenant_id: TENANT, name: `زبون رقم ${i}`, phone: `+9665${String(10000000 + i)}`, email: '', measurements: meas, notes: '', is_test: false, is_b2b: false, created_at: new Date(Date.now() - i * 36e5).toISOString() }));
  const item = { garmentType: 'ثوب', fabric: 'قماش ياباني أبيض', fabricId: 'f-1', quantity: 2, price: 180, consumedMeters: 7.6, closureType: 'buttons', closureVisibility: 'visible', collarType: 'classic', cuffType: 'square', pocketType: 'hidden', chestStyle: 'plain', additions: 'جيب داخلي', embroidery: '' };
  const hist = ['measurements_taken', 'cutting', 'sewing', 'ready'].map((st) => ({ status: st, updatedAt: new Date().toISOString(), updatedBy: 'سلطان', updatedByUid: UID, notes: 'تم تحديث الحالة' }));
  const orders = Array.from({ length: 2400 }, (_, i) => ({ id: `o-${i}`, tenant_id: TENANT, branch_id: null, customer_id: `c-${i % 1500}`, customer_name: `زبون رقم ${i % 1500}`, order_number: String(1000 + i), status: 'sewing', status_key: 'sewing', payment_method: 'cash', total_amount: 414, paid_amount: 200, remaining_amount: 214, tax_rate: 0.15, tax_amount: 54, discount_amount: 0, order_date: new Date(Date.now() - i * 36e5).toISOString(), delivery_date: new Date(Date.now() + 5 * 864e5).toISOString(), qr_code: 'x', images: [], is_test: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), notes: '__ORDER_METADATA_V2__:' + JSON.stringify({ originalNotes: 'الزبون يبي الياقة أعرض شوي', history: hist, items: [item, { ...item, fabric: 'قماش كوري' }], subtotalAmount: 360 }) }));
  const inventory = Array.from({ length: 300 }, (_, i) => ({ id: `f-${i}`, tenant_id: TENANT, name: `قماش ${i}`, category: 'fabric', unit: 'roll', base_unit: 'meter', conversion_rate: 22.86, min_threshold: 10, price_per_unit: 35, sku: String(10000000 + i), barcode: '1', quantity: 120, images: [], description: '', updated_at: new Date().toISOString() }));
  const bInv = inventory.map((it, i) => ({ id: `b-${i}`, branch_id: 'br-1', item_id: it.id, quantity: 120, tenant_id: TENANT, variant_id: null }));
  return { customers, orders, inventory_items: inventory, branch_inventory: bInv };
})();

function tableData(table, url) {
  if (big && big[table]) {
    let rows = big[table];
    if (table === 'orders' && /limit=(\d+)/.test(url)) rows = rows.slice(0, Number(url.match(/limit=(\d+)/)[1]));
    return rows.slice(0, MAX_ROWS);
  }
  switch (table) {
    case 'users': return [{ id: UID, email: 'owner@example.com', display_name: 'سلطان', photo_url: null }];
    case 'staff': return url.includes('uid=eq') || url.includes('email=eq') ? [{ ...staffRow, tenant: tenantRow }] : [{ ...staffRow }];
    case 'tenants': return [tenantRow];
    case 'saas_settings': return [];
    default: return [];
  }
}

(async () => {
  const p = PROFILES[profile];
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1366, height: 820 }, locale: 'ar-SA', serviceWorkers: 'allow' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: p.latency, downloadThroughput: p.down, uploadThroughput: p.up });
  if (p.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu });

  const t0 = { v: 0 };
  const reqs = [];
  const byId = new Map();
  const now = () => Date.now() - t0.v;
  context.on('request', (r) => { const rec = { url: r.url(), method: r.method(), type: r.resourceType(), start: now(), end: null, bytes: 0, sw: !!r.serviceWorker() }; byId.set(r, rec); reqs.push(rec); });
  context.on('requestfinished', async (r) => { const rec = byId.get(r); if (!rec) return; rec.end = now(); try { const s = await r.sizes(); rec.bytes = s.responseBodySize + s.responseHeadersSize; } catch {} });
  context.on('requestfailed', (r) => { const rec = byId.get(r); if (rec) { rec.end = now(); rec.failed = true; } });

  await context.route('https://perfprobe.supabase.co/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    await new Promise((r) => setTimeout(r, SUPA_DELAY));
    if (u.pathname === '/rest/v1/rpc/get_session_identity') {
      // seen-performance-first-open-login-task.md Phase 3: the same rows the
      // separate users/staff/tenant reads below return, as one object.
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        user: tableData('users', '')[0], staff: { ...staffRow }, tenant: tenantRow, saas_user: null,
        tailor_request: null, referral_partner: null, role_key: null, has_staff_with_pin: false }) });
    }
    if (u.pathname === '/rest/v1/rpc/get_dashboard_stats') {
      // Phase 4.3: the dashboard's figures, summed by the database. The
      // shape and size of a real answer; the values come from the mock rows.
      let body = {};
      try { body = JSON.parse(req.postData() || '{}'); } catch {}
      const n = Array.isArray(body.p_ranges) ? body.p_ranges.length : 0;
      const orders = tableData('orders', '');
      const customers = tableData('customers', '');
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        ranges: Array.from({ length: n }, () => ({ orders: 0, paid: 0, pending: 0, customers: 0 })),
        filtered: { orders: orders.length, paid: 0, remaining: 0, pending: orders.length, customers: customers.length,
          completion_hours: 0, completion_count: 0, active_customers: 0, customers_with_orders: 0, repeat_customers: 0,
          status_counts: orders.length ? { sewing: orders.length } : {} },
        totals: { orders: orders.length, in_progress: orders.length, measurements_taken: 0, ready: 0 },
        low_stock: 0, customers_total: customers.length }) });
    }
    if (u.pathname.startsWith('/rest/v1/rpc/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    if (u.pathname.startsWith('/rest/v1/')) {
      const table = u.pathname.split('/')[3];
      const m = req.method();
      if (m === 'HEAD') return route.fulfill({ status: 200, headers: { 'content-range': '0-0/0' }, body: '' });
      if (m !== 'GET') return route.fulfill({ status: 204, body: '' });
      const rows = tableData(table, u.search);
      const accept = req.headers()['accept'] || '';
      if (accept.includes('vnd.pgrst.object')) {
        if (rows.length) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows[0]) });
        return route.fulfill({ status: 406, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST116', details: 'The result contains 0 rows', message: 'JSON object requested, multiple (or no) rows returned' }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` }, body: JSON.stringify(rows) });
    }
    if (u.pathname.startsWith('/auth/v1/')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(makeSession()) });
    return route.abort();
  });
  await context.route('wss://perfprobe.supabase.co/**', (route) => route.abort());
  await context.route('**/api/**', async (route) => {
    await new Promise((r) => setTimeout(r, API_DELAY));
    const path = new URL(route.request().url()).pathname;
    const body = path.includes('assistant-settings/status') ? { isEnabled: true } : path.includes('health') ? { ok: true } : {};
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await context.route('https://fonts.googleapis.com/**', async (route) => { await new Promise((r) => setTimeout(r, GFONTS_DELAY)); route.fulfill({ status: 200, contentType: 'text/css', body: '/* stub: 3 families, 18 weights */' }); });
  await context.route('https://accounts.google.com/**', async (route) => { await new Promise((r) => setTimeout(r, 300)); route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* gsi stub */' }); });

  const loggedIn = scenario.startsWith('app-open');
  if (scenario === 'app-open-warm') {
    // first visit to fill HTTP cache + service worker, then measure the second open
    await page.addInitScript(([s]) => { try { localStorage.setItem('sb-perfprobe-auth-token', s); localStorage.setItem('i18nextLng', 'ar'); } catch {} }, [JSON.stringify(makeSession())]);
    t0.v = Date.now();
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForTimeout(12000);
    reqs.length = 0;
  } else if (loggedIn) {
    await page.addInitScript(([s]) => { try { localStorage.setItem('sb-perfprobe-auth-token', s); localStorage.setItem('i18nextLng', 'ar'); } catch {} }, [JSON.stringify(makeSession())]);
  }

  await page.addInitScript(() => {
    window.__perf = { marks: {} };
    const mark = (k) => { if (!window.__perf.marks[k]) window.__perf.marks[k] = performance.now(); };
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') mark('fcp'); }).observe({ type: 'paint', buffered: true });
    new PerformanceObserver((l) => { const es = l.getEntries(); window.__perf.marks.lcp = es[es.length - 1].startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    let tbt = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) tbt += Math.max(0, e.duration - 50); window.__perf.tbt = tbt; }).observe({ type: 'longtask', buffered: true });
    const poll = () => {
      const root = document.getElementById('root');
      if (root && root.children.length) mark('root_rendered');
      if (document.querySelector('.animate-pulse')) mark('skeleton_seen');
      if (document.querySelector('form input[type="password"]')) mark('login_form');
      if (document.querySelector('#tour-sidebar')) mark('app_shell');
      if (document.querySelector('#tour-sidebar') && !document.querySelector('main .animate-pulse')) mark('app_shell_no_skeleton');
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  });

  t0.v = Date.now();
  const navStart = Date.now();
  await page.goto(BASE + (loggedIn ? '/' : '/login'), { waitUntil: 'load' });
  const loadAt = Date.now() - navStart;
  await page.waitForTimeout(loggedIn ? 15000 : 8000);
  if (process.env.REFOCUS === '1') {
    const before = reqs.length; const tf = now();
    await page.evaluate(() => {
      const set = (v) => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
      set('hidden'); document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
      set('visible'); document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
      window.dispatchEvent(new Event('focus'));
    });
    await page.waitForTimeout(2500);
    const after = reqs.slice(before).filter((r) => r.url.includes('perfprobe.supabase.co/rest'));
    console.log('REFOCUS: supabase requests within 2.5s after tab became visible again:', after.length);
    for (const r of after) console.log('  ', r.start - tf, r.method, r.url.replace('https://perfprobe.supabase.co/rest/v1/', '').slice(0, 70));
  }
  const perf = await page.evaluate(() => window.__perf);
  const navTiming = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { domContentLoaded: n.domContentLoadedEventEnd, load: n.loadEventEnd }; });
  await page.screenshot({ path: `perf-out/${process.env.TAG||""}${scenario}-${profile}${process.env.DATA === 'big' ? '-big' : ''}.png` });
  await browser.close();

  const sumBytes = (f) => reqs.filter(f).reduce((a, r) => a + (r.bytes || 0), 0);
  const supa = reqs.filter((r) => r.url.includes('perfprobe.supabase.co/rest') || r.url.includes('perfprobe.supabase.co/auth'));
  const summary = {
    scenario, profile, data: BIG ? 'big' : 'empty', supabaseDelayMs: SUPA_DELAY, apiDelayMs: API_DELAY,
    marks: Object.fromEntries(Object.entries(perf.marks).map(([k, v]) => [k, Math.round(v)])), tbtMs: Math.round(perf.tbt || 0),
    navTiming: { domContentLoaded: Math.round(navTiming.domContentLoaded), load: Math.round(navTiming.load) }, loadEventWallMs: loadAt,
    requests: reqs.length, pageBytesKB: Math.round(sumBytes((r) => !r.sw) / 1024), swBytesKB: Math.round(sumBytes((r) => r.sw) / 1024),
    jsKB: Math.round(sumBytes((r) => !r.sw && r.url.endsWith('.js')) / 1024), fontKB: Math.round(sumBytes((r) => !r.sw && /\.(ttf|woff2?)$/.test(r.url)) / 1024),
    supabaseRequests: supa.length, apiRequests: reqs.filter((r) => new URL(r.url).pathname.startsWith('/api/')).length,
  };
  
  const tag = BIG ? '-big' : '';
  fs.writeFileSync(`perf-out/${process.env.TAG||""}${scenario}-${profile}${tag}.json`, JSON.stringify({ summary, reqs: reqs.map((r) => ({ ...r, url: r.url.replace(BASE, '').replace('https://perfprobe.supabase.co', 'SUPA') })) }, null, 1));
  console.log(JSON.stringify(summary));
})().catch((e) => { console.error(e); process.exit(1); });
