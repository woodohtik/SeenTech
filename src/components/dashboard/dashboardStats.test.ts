import { describe, expect, it } from 'vitest';
import { buildDashboardPlan, figuresFrom, statsFromRows, type Timeframe } from './dashboardStats';

/*
 * The old DashboardOwner.tsx calculation, copied as it was (labels left
 * out), to prove the new plan + sums give the very same numbers.
 */
function legacy(timeframe: Timeframe, customStartDate: string, customEndDate: string, revenueRange: number,
  allOrders: any[], allCustomers: any[], allInventory: any[], branchInventory: any[], now: Date) {
  let currentPeriodStart: Date | null = null; let currentPeriodEnd: Date | null = null;
  let previousPeriodStart: Date | null = null; let previousPeriodEnd: Date | null = null;
  const NewDate = () => new Date(now);
  const roll = (n: number) => {
    currentPeriodStart = NewDate(); currentPeriodStart.setDate(currentPeriodStart.getDate() - n); currentPeriodStart.setHours(0, 0, 0, 0);
    currentPeriodEnd = now;
    previousPeriodStart = new Date(currentPeriodStart); previousPeriodStart.setDate(previousPeriodStart.getDate() - n);
    previousPeriodEnd = new Date(currentPeriodStart); previousPeriodEnd.setMilliseconds(previousPeriodEnd.getMilliseconds() - 1);
  };
  if (timeframe === 'daily') {
    currentPeriodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    currentPeriodEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    previousPeriodStart = new Date(currentPeriodStart); previousPeriodStart.setDate(previousPeriodStart.getDate() - 1);
    previousPeriodEnd = new Date(currentPeriodEnd); previousPeriodEnd.setDate(previousPeriodEnd.getDate() - 1);
  } else if (timeframe === 'weekly') roll(7);
  else if (timeframe === 'monthly') roll(30);
  else if (timeframe === 'quarterly') roll(90);
  else if (timeframe === 'yearly') roll(365);
  else if (timeframe === 'custom') {
    if (customStartDate && customEndDate) {
      currentPeriodStart = new Date(customStartDate); currentPeriodStart.setHours(0, 0, 0, 0);
      currentPeriodEnd = new Date(customEndDate); currentPeriodEnd.setHours(23, 59, 59, 999);
      const diffMs = currentPeriodEnd.getTime() - currentPeriodStart.getTime();
      previousPeriodStart = new Date(currentPeriodStart.getTime() - diffMs);
      previousPeriodEnd = new Date(currentPeriodStart.getTime() - 1);
    } else roll(30);
  }
  const inP = (d: Date) => d >= currentPeriodStart! && d <= currentPeriodEnd!;
  const dispRevenue = timeframe === 'all' ? allOrders.reduce((a, o) => a + (o.paidAmount || 0), 0)
    : allOrders.filter((o) => inP(new Date(o.orderDate || ''))).reduce((a, o) => a + (o.paidAmount || 0), 0);
  const dispCustomers = timeframe === 'all' ? allCustomers.length : allCustomers.filter((c) => inP(new Date(c.createdAt || ''))).length;
  const dispOrders = timeframe === 'all' ? allOrders.length : allOrders.filter((o) => inP(new Date(o.orderDate || ''))).length;
  const dispPending = timeframe === 'all' ? allOrders.filter((o) => !['delivered', 'ready'].includes(o.status)).length
    : allOrders.filter((o) => !['delivered', 'ready'].includes(o.status)).filter((o) => inP(new Date(o.orderDate || ''))).length;
  let curStart = currentPeriodStart; let curEnd = currentPeriodEnd; let prevStart = previousPeriodStart; let prevEnd = previousPeriodEnd;
  if (timeframe === 'all') {
    curStart = NewDate(); curStart!.setDate(curStart!.getDate() - 30); curStart!.setHours(0, 0, 0, 0); curEnd = now;
    prevStart = new Date(curStart!); prevStart.setDate(prevStart.getDate() - 30);
    prevEnd = new Date(curStart!); prevEnd.setMilliseconds(prevEnd.getMilliseconds() - 1);
  }
  const inC = (d: Date) => d >= curStart! && d <= curEnd!;
  const inV = (d: Date) => d >= prevStart! && d <= prevEnd!;
  const curRevenue = allOrders.filter((o) => inC(new Date(o.orderDate || ''))).reduce((a, o) => a + (o.paidAmount || 0), 0);
  const prevRevenue = allOrders.filter((o) => inV(new Date(o.orderDate || ''))).reduce((a, o) => a + (o.paidAmount || 0), 0);
  const curC = allCustomers.filter((c) => inC(new Date(c.createdAt || ''))).length;
  const prevC = allCustomers.filter((c) => inV(new Date(c.createdAt || ''))).length;
  const curO = allOrders.filter((o) => inC(new Date(o.orderDate || ''))).length;
  const prevO = allOrders.filter((o) => inV(new Date(o.orderDate || ''))).length;
  const curP = allOrders.filter((o) => !['delivered', 'ready'].includes(o.status)).filter((o) => inC(new Date(o.orderDate || ''))).length;
  const prevP = allOrders.filter((o) => !['delivered', 'ready'].includes(o.status)).filter((o) => inV(new Date(o.orderDate || ''))).length;
  const g = (c: number, p: number) => (p > 0 ? Number((((c - p) / p) * 100).toFixed(1)) : c > 0 ? 100 : 0);
  const filteredOrders = timeframe === 'all' ? allOrders : allOrders.filter((o) => inP(new Date(o.orderDate || '')));
  const lowStock = allInventory.filter((item) => branchInventory.filter((bi) => bi.itemId === item.id).reduce((s, bi) => s + bi.quantity, 0) <= item.minThreshold).length;
  const receivables = filteredOrders.reduce((a, o) => a + (o.remainingAmount || 0), 0);
  let total = 0; let n = 0;
  filteredOrders.filter((o) => ['delivered', 'ready'].includes(o.status)).forEach((o) => {
    const fh = Array.isArray(o.history) ? [...o.history].reverse().find((h: any) => h && ['delivered', 'ready'].includes(h.status)) : null;
    if (fh) { const s = new Date(o.orderDate || '').getTime(); const e = new Date(fh.updatedAt || '').getTime(); if (e > s) { total += e - s; n++; } }
  });
  const sixty = NewDate(); sixty.setDate(sixty.getDate() - 60);
  const active = new Set(filteredOrders.filter((o) => o.orderDate && new Date(o.orderDate) >= sixty).map((o) => o.customerId)).size;
  const counts: Record<string, number> = {};
  filteredOrders.forEach((o) => { if (o.customerId) counts[o.customerId] = (counts[o.customerId] || 0) + 1; });
  const withOrders = Object.keys(counts).length; const repeat = Object.values(counts).filter((c) => c > 1).length;
  return {
    customers: dispCustomers, customersGrowthRate: g(curC, prevC), prevCustomers: prevC,
    orders: dispOrders, ordersGrowthRate: g(curO, prevO), prevOrders: prevO,
    pending: dispPending, pendingGrowthRate: g(curP, prevP), prevPending: prevP,
    revenue: dispRevenue, revenueGrowthRate: g(curRevenue, prevRevenue), prevRevenue,
    lowStock, receivables, avgCompletionTime: n > 0 ? total / (3_600_000 * n) : 0,
    activeCustomers: active, retentionRate: withOrders > 0 ? (repeat / withOrders) * 100 : 0,
  };
}

/** The old chart values for the daily (hours) and weekly/monthly (UTC day prefix) views. */
function legacyChart(timeframe: Timeframe, revenueRange: number, allOrders: any[], now: Date) {
  if (timeframe === 'daily') {
    return [[0, 4], [4, 8], [8, 12], [12, 16], [16, 20], [20, 24]].map(([a, b]) => {
      const os = allOrders.filter((o) => { const d = new Date(o.orderDate || ''); if (d.toDateString() !== now.toDateString()) return false; const h = d.getHours(); return h >= a && h < b; });
      return { revenue: os.reduce((s, o) => s + (o.paidAmount || 0), 0), ordersCount: os.length };
    });
  }
  const len = timeframe === 'weekly' ? 7 : timeframe === 'all' ? revenueRange : 30;
  return Array.from({ length: len }, (_, i) => { const d = new Date(now); d.setDate(d.getDate() - i); return d.toISOString().split('T')[0]; }).reverse()
    .map((date) => { const os = allOrders.filter((o) => (typeof o.orderDate === 'string' ? o.orderDate : '').startsWith(date)); return { revenue: os.reduce((s, o) => s + (o.paidAmount || 0), 0), ordersCount: os.length }; });
}

// Deterministic pseudo-random data around "now".
function makeData(seed: number, now: Date) {
  let x = seed;
  const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  const statuses = ['measurements_taken', 'cutting', 'sewing', 'ready', 'delivered', 'cancelled'];
  const at = (maxDays: number) => new Date(now.getTime() - rnd() * maxDays * 86_400_000).toISOString();
  const orders = Array.from({ length: 400 }, (_, i) => {
    const status = statuses[Math.floor(rnd() * statuses.length)];
    const orderDate = at(800);
    const history = ['ready', 'delivered'].includes(status) && rnd() > 0.2
      ? [{ status: 'cutting', updatedAt: orderDate }, { status, updatedAt: new Date(Date.parse(orderDate) + rnd() * 9 * 86_400_000 - 86_400_000).toISOString() }]
      : [];
    return { status, orderDate, paidAmount: Math.round(rnd() * 500), remainingAmount: Math.round(rnd() * 200),
      customerId: rnd() < 0.1 ? '' : `c${Math.floor(rnd() * 120)}`, history };
  });
  const customers = Array.from({ length: 150 }, () => ({ createdAt: rnd() < 0.05 ? null : at(800) }));
  const inventory = Array.from({ length: 40 }, (_, i) => ({ id: `i${i}`, minThreshold: Math.floor(rnd() * 20) }));
  const bInv = Array.from({ length: 60 }, () => ({ itemId: `i${Math.floor(rnd() * 45)}`, quantity: Math.floor(rnd() * 30) }));
  return { orders, customers, inventory, bInv };
}

describe('the dashboard plan + sums give the same numbers as the old page', () => {
  const now = new Date('2026-11-20T10:37:12.345Z');
  const cases: Array<[Timeframe, string, string]> = [
    ['all', '', ''], ['daily', '', ''], ['weekly', '', ''], ['monthly', '', ''], ['quarterly', '', ''], ['yearly', '', ''],
    ['custom', '2026-10-01', '2026-11-15'], ['custom', '2026-11-20', '2026-11-20'], ['custom', '', ''],
  ];
  for (const seed of [7, 42, 1001]) {
    for (const [tf, cs, ce] of cases) {
      it(`${tf}${cs ? ` ${cs}..${ce}` : ''} (data ${seed})`, () => {
        const data = makeData(seed, now);
        const plan = buildDashboardPlan({ timeframe: tf, customStartDate: cs, customEndDate: ce, revenueRange: 30, now });
        const figures = figuresFrom(plan, statsFromRows(plan, data));
        const old = legacy(tf, cs, ce, 30, data.orders, data.customers, data.inventory, data.bInv, now);
        expect(figures.stats.avgCompletionTime).toBeCloseTo(old.avgCompletionTime, 6);
        expect(figures.stats.retentionRate).toBeCloseTo(old.retentionRate, 6);
        expect({ ...figures.stats, avgCompletionTime: 0, retentionRate: 0 }).toEqual({ ...old, avgCompletionTime: 0, retentionRate: 0 });
        if (['daily', 'weekly', 'monthly', 'all'].includes(tf)) {
          expect(figures.chart.map((c) => ({ revenue: c.revenue, ordersCount: c.ordersCount }))).toEqual(legacyChart(tf, 30, data.orders, now));
        }
      });
    }
  }
});
