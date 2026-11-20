/**
 * The owner dashboard's figures (seen-performance-first-open-login-task.md
 * Phase 4.3).
 *
 * buildDashboardPlan decides every period and chart boundary exactly as
 * DashboardOwner.tsx always has (browser-local time, today's hours, weeks
 * counted back from now, UTC day prefixes for the daily bars). The
 * database (public.get_dashboard_stats) sums each boundary; this file
 * turns those sums back into the cards, the chart and the status bars.
 *
 * statsFromRows computes the very same result from full rows, the way the
 * page used to: used when the database function is not there yet, and as
 * the reference the SQL is checked against.
 */

export type Timeframe = 'all' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';

export interface TimeRange {
  s: string; // ISO
  e: string; // ISO
  inc: boolean; // end inclusive
}

export type ChartLabel =
  | { kind: 'interval'; key: string }
  | { kind: 'weekday'; date: string }
  | { kind: 'dayMonth'; date: string }
  | { kind: 'week'; n: number }
  | { kind: 'month'; date: string }
  | { kind: 'monthYear'; date: string };

export interface DashboardPlan {
  /** null = all time. */
  filter: TimeRange | null;
  cur: TimeRange;
  prev: TimeRange;
  chart: Array<{ label: ChartLabel; range: TimeRange }>;
  activeSince: string;
}

const iso = (d: Date) => d.toISOString();
const inclusive = (s: Date, e: Date): TimeRange => ({ s: iso(s), e: iso(e), inc: true });
const halfOpen = (s: Date, e: Date): TimeRange => ({ s: iso(s), e: iso(e), inc: false });

/** A UTC calendar day: what `orderDate.startsWith('YYYY-MM-DD')` matched. */
const utcDay = (date: string): TimeRange => {
  const s = new Date(`${date}T00:00:00.000Z`);
  return halfOpen(s, new Date(s.getTime() + 86_400_000));
};

const INTERVALS = [
  { label: '12 AM - 4 AM', startHour: 0, endHour: 4 },
  { label: '4 AM - 8 AM', startHour: 4, endHour: 8 },
  { label: '8 AM - 12 PM', startHour: 8, endHour: 12 },
  { label: '12 PM - 4 PM', startHour: 12, endHour: 16 },
  { label: '4 PM - 8 PM', startHour: 16, endHour: 20 },
  { label: '8 PM - 12 AM', startHour: 20, endHour: 24 },
];

function hourRanges(dayStart: Date, clampStart?: Date, clampEnd?: Date) {
  return INTERVALS.map((iv) => {
    let s = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), iv.startHour);
    let e = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), iv.endHour);
    if (clampStart && s < clampStart) s = clampStart;
    if (clampEnd && e.getTime() > clampEnd.getTime() + 1) e = new Date(clampEnd.getTime() + 1);
    return { label: { kind: 'interval', key: iv.label } as ChartLabel, range: halfOpen(s, e) };
  });
}

export function buildDashboardPlan(opts: {
  timeframe: Timeframe;
  customStartDate?: string;
  customEndDate?: string;
  revenueRange: number;
  now?: Date;
}): DashboardPlan {
  const now = opts.now ?? new Date();
  const tf = opts.timeframe;
  let curStart: Date;
  let curEnd: Date;
  let prevStart: Date;
  let prevEnd: Date;

  const backDays = (n: number) => { const d = new Date(now); d.setDate(d.getDate() - n); d.setHours(0, 0, 0, 0); return d; };
  const rolling = (n: number) => {
    curStart = backDays(n);
    curEnd = now;
    prevStart = new Date(curStart);
    prevStart.setDate(prevStart.getDate() - n);
    prevEnd = new Date(curStart.getTime() - 1);
  };

  if (tf === 'daily') {
    curStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    curEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    prevStart = new Date(curStart); prevStart.setDate(prevStart.getDate() - 1);
    prevEnd = new Date(curEnd); prevEnd.setDate(prevEnd.getDate() - 1);
  } else if (tf === 'weekly') rolling(7);
  else if (tf === 'quarterly') rolling(90);
  else if (tf === 'yearly') rolling(365);
  else if (tf === 'custom' && opts.customStartDate && opts.customEndDate) {
    curStart = new Date(opts.customStartDate); curStart.setHours(0, 0, 0, 0);
    curEnd = new Date(opts.customEndDate); curEnd.setHours(23, 59, 59, 999);
    const diffMs = curEnd.getTime() - curStart.getTime();
    prevStart = new Date(curStart.getTime() - diffMs);
    prevEnd = new Date(curStart.getTime() - 1);
  } else rolling(30); // monthly, all, and custom without both dates

  const filter = tf === 'all' ? null : inclusive(curStart!, curEnd!);

  // Growth on the "all" view compares the last 30 days with the 30 before.
  let cur = inclusive(curStart!, curEnd!);
  let prev = inclusive(prevStart!, prevEnd!);
  if (tf === 'all') {
    const s = backDays(30);
    const ps = new Date(s); ps.setDate(ps.getDate() - 30);
    cur = inclusive(s, now);
    prev = inclusive(ps, new Date(s.getTime() - 1));
  }

  const isoDayBack = (i: number) => { const d = new Date(now); d.setDate(d.getDate() - i); return d.toISOString().split('T')[0]; };
  let chart: DashboardPlan['chart'] = [];
  if (tf === 'daily') {
    chart = hourRanges(now);
  } else if (tf === 'weekly') {
    chart = Array.from({ length: 7 }, (_, i) => isoDayBack(i)).reverse()
      .map((date) => ({ label: { kind: 'weekday', date } as ChartLabel, range: utcDay(date) }));
  } else if (tf === 'monthly' || tf === 'all') {
    const rangeDays = tf === 'all' ? opts.revenueRange : 30;
    chart = Array.from({ length: rangeDays }, (_, i) => isoDayBack(i)).reverse()
      .map((date) => ({ label: { kind: rangeDays > 7 ? 'dayMonth' : 'weekday', date } as ChartLabel, range: utcDay(date) }));
  } else if (tf === 'quarterly') {
    chart = Array.from({ length: 12 }, (_, i) => {
      const s = new Date(now); s.setDate(s.getDate() - (12 - i) * 7);
      const e = new Date(s); e.setDate(e.getDate() + 7);
      return { label: { kind: 'week', n: i + 1 } as ChartLabel, range: halfOpen(s, e) };
    });
  } else if (tf === 'yearly') {
    chart = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now); d.setMonth(d.getMonth() - (11 - i));
      const s = new Date(d.getFullYear(), d.getMonth(), 1);
      const e = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      return { label: { kind: 'month', date: d.toISOString() } as ChartLabel, range: halfOpen(s, e) };
    });
  } else if (tf === 'custom') {
    // Without both dates the old code still drew this chart, from the
    // default last-30-days period set above.
    const start = curStart!;
    const end = curEnd!;
    const diffDays = Math.ceil((end.getTime() - start.getTime()) / 86_400_000);
    if (diffDays <= 1) {
      chart = hourRanges(start, start, end);
    } else if (diffDays <= 14) {
      const days: string[] = [];
      const c = new Date(start);
      while (c <= end) { days.push(c.toISOString().split('T')[0]); c.setDate(c.getDate() + 1); }
      chart = days.map((date) => ({ label: { kind: 'dayMonth', date } as ChartLabel, range: utcDay(date) }));
    } else {
      const step = diffDays <= 60 ? 7 : 30;
      const count = Math.ceil(diffDays / step);
      chart = Array.from({ length: count }, (_, i) => {
        const s = new Date(start.getTime()); s.setDate(s.getDate() + i * step);
        let e = new Date(s.getTime()); e.setDate(e.getDate() + step);
        // `d < endW && d <= periodEnd`
        if (e.getTime() > end.getTime() + 1) e = new Date(end.getTime() + 1);
        const label: ChartLabel = step === 7 ? { kind: 'week', n: i + 1 } : { kind: 'monthYear', date: s.toISOString() };
        return { label, range: halfOpen(s, e) };
      });
    }
  }

  const activeSince = new Date(now); activeSince.setDate(activeSince.getDate() - 60);
  return { filter, cur, prev, chart, activeSince: iso(activeSince) };
}

/** What get_dashboard_stats returns (and statsFromRows reproduces). */
export interface DashboardStatsResult {
  ranges: Array<{ orders: number; paid: number; pending: number; customers: number }>;
  filtered: {
    orders: number; paid: number; remaining: number; pending: number; customers: number;
    completion_hours: number; completion_count: number;
    active_customers: number; customers_with_orders: number; repeat_customers: number;
    status_counts: Record<string, number>;
  };
  totals: { orders: number; in_progress: number; measurements_taken: number; ready: number };
  low_stock: number;
  customers_total: number;
}

/** The ranges sent to the database: cur, prev, then the chart's. */
export function planRanges(plan: DashboardPlan): TimeRange[] {
  return [plan.cur, plan.prev, ...plan.chart.map((c) => c.range)];
}

const growth = (curr: number, prev: number) =>
  prev > 0 ? Number((((curr - prev) / prev) * 100).toFixed(1)) : curr > 0 ? 100 : 0;

export interface DashboardFigures {
  stats: {
    customers: number; customersGrowthRate: number; prevCustomers: number;
    orders: number; ordersGrowthRate: number; prevOrders: number;
    pending: number; pendingGrowthRate: number; prevPending: number;
    revenue: number; revenueGrowthRate: number; prevRevenue: number;
    lowStock: number; receivables: number; avgCompletionTime: number;
    activeCustomers: number; retentionRate: number;
  };
  chart: Array<{ label: ChartLabel; revenue: number; ordersCount: number }>;
  statusCounts: Record<string, number>;
  totals: DashboardStatsResult['totals'];
}

/** The cards, chart and status bars, from one result. Same formulas as before. */
export function figuresFrom(plan: DashboardPlan, r: DashboardStatsResult): DashboardFigures {
  const [cur, prev, ...chart] = r.ranges;
  const f = r.filtered;
  return {
    stats: {
      customers: f.customers,
      customersGrowthRate: growth(cur.customers, prev.customers),
      prevCustomers: prev.customers,
      orders: f.orders,
      ordersGrowthRate: growth(cur.orders, prev.orders),
      prevOrders: prev.orders,
      pending: f.pending,
      pendingGrowthRate: growth(cur.pending, prev.pending),
      prevPending: prev.pending,
      revenue: f.paid,
      revenueGrowthRate: growth(cur.paid, prev.paid),
      prevRevenue: prev.paid,
      lowStock: r.low_stock,
      receivables: f.remaining,
      avgCompletionTime: f.completion_count > 0 ? f.completion_hours / f.completion_count : 0,
      activeCustomers: f.active_customers,
      retentionRate: f.customers_with_orders > 0 ? (f.repeat_customers / f.customers_with_orders) * 100 : 0,
    },
    chart: plan.chart.map((c, i) => ({ label: c.label, revenue: chart[i]?.paid ?? 0, ordersCount: chart[i]?.orders ?? 0 })),
    statusCounts: f.status_counts,
    totals: r.totals,
  };
}

// ---------------------------------------------------------------------------
// The same result from full rows (fallback and reference).

export interface RowOrder {
  status: string; orderDate: string; paidAmount: number; remainingAmount: number;
  customerId: string; history?: Array<{ status?: string; updatedAt?: string }>;
}
export interface RowCustomer { createdAt?: string | null }
export interface RowItem { id: string; minThreshold: number }
export interface RowBranchItem { itemId: string; quantity: number }

const inRange = (t: number, r: TimeRange) => {
  const s = Date.parse(r.s); const e = Date.parse(r.e);
  return t >= s && (t < e || (r.inc && t === e));
};

export function statsFromRows(
  plan: DashboardPlan,
  rows: { orders: RowOrder[]; customers: RowCustomer[]; inventory: RowItem[]; bInv: RowBranchItem[] },
): DashboardStatsResult {
  const orders = rows.orders.map((o) => ({ ...o, t: new Date(o.orderDate || '').getTime() }));
  const custTimes = rows.customers.map((c) => new Date(c.createdAt || '').getTime());
  const sum = (xs: typeof orders, k: 'paidAmount' | 'remainingAmount') => xs.reduce((a, o) => a + (o[k] || 0), 0);
  const isPending = (o: RowOrder) => !['delivered', 'ready'].includes(o.status);

  const ranges = planRanges(plan).map((r) => {
    const os = orders.filter((o) => inRange(o.t, r));
    return {
      orders: os.length,
      paid: sum(os, 'paidAmount'),
      pending: os.filter(isPending).length,
      customers: custTimes.filter((t) => inRange(t, r)).length,
    };
  });

  const f = plan.filter ? orders.filter((o) => inRange(o.t, plan.filter!)) : orders;
  let hours = 0; let count = 0;
  f.filter((o) => ['delivered', 'ready'].includes(o.status)).forEach((o) => {
    const last = Array.isArray(o.history) ? [...o.history].reverse().find((h) => h && ['delivered', 'ready'].includes(h.status || '')) : null;
    if (last) {
      const end = new Date(last.updatedAt || '').getTime();
      if (end > o.t) { hours += (end - o.t) / 3_600_000; count++; }
    }
  });
  const activeSince = Date.parse(plan.activeSince);
  const perCustomer: Record<string, number> = {};
  f.forEach((o) => { if (o.customerId) perCustomer[o.customerId] = (perCustomer[o.customerId] || 0) + 1; });
  const statusCounts: Record<string, number> = {};
  f.forEach((o) => { statusCounts[o.status] = (statusCounts[o.status] || 0) + 1; });

  return {
    ranges,
    filtered: {
      orders: f.length,
      paid: sum(f, 'paidAmount'),
      remaining: sum(f, 'remainingAmount'),
      pending: f.filter(isPending).length,
      customers: plan.filter ? custTimes.filter((t) => inRange(t, plan.filter!)).length : rows.customers.length,
      completion_hours: hours,
      completion_count: count,
      active_customers: new Set(f.filter((o) => o.t >= activeSince).map((o) => o.customerId)).size,
      customers_with_orders: Object.keys(perCustomer).length,
      repeat_customers: Object.values(perCustomer).filter((n) => n > 1).length,
      status_counts: statusCounts,
    },
    totals: {
      orders: orders.length,
      in_progress: orders.filter((o) => !['delivered', 'ready', 'cancelled'].includes(o.status)).length,
      measurements_taken: orders.filter((o) => o.status === 'measurements_taken').length,
      ready: orders.filter((o) => o.status === 'ready').length,
    },
    low_stock: rows.inventory.filter((i) => {
      const qty = rows.bInv.filter((b) => b.itemId === i.id).reduce((a, b) => a + b.quantity, 0);
      return qty <= i.minThreshold;
    }).length,
    customers_total: rows.customers.length,
  };
}
