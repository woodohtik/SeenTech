/**
 * The dashboard's revenue / orders chart, in its own chunk: recharts is
 * ~340KB of JavaScript that used to download and run before the dashboard
 * could draw anything (seen-performance-first-open-login-task.md, "charts
 * on demand"). DashboardOwner loads this with React.lazy and keeps the
 * chart's box (and its empty state) on screen meanwhile.
 * Moved verbatim from DashboardOwner.tsx; the values it read from the page
 * are props now.
 */
import type { TFunction } from 'i18next';
import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Bar,
} from 'recharts';
import { PriceDisplay } from '../PriceDisplay';

export type RevenueChartProps = {
  chartData: Array<{ date: string; revenue: number; ordersCount: number }>;
  chartViewMode: 'both' | 'revenue' | 'orders';
  isRtl: boolean;
  maxRevenueDay: { date?: string; revenue: number } | null | undefined;
  totalPeriodRevenue: number;
  avgDailyRevenue: number;
  t: TFunction;
};

export default function RevenueChart({
  chartData,
  chartViewMode,
  isRtl,
  maxRevenueDay,
  totalPeriodRevenue,
  avgDailyRevenue,
  t,
}: RevenueChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={chartData} margin={{ top: 15, right: 10, left: 10, bottom: 5 }}>
        <defs>
          {/* The revenue area's fade-to-transparent is this screen's one deliberate
              gradient (seen-design-professionalization-task.md Phase 2 #5); the
              orders bar below uses a flat fill instead of a second gradient. */}
          <linearGradient id="colorRevenueGlow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.4}/>
            <stop offset="50%" stopColor="var(--brand)" stopOpacity={0.12}/>
            <stop offset="100%" stopColor="var(--brand)" stopOpacity={0.0}/>
          </linearGradient>
        </defs>

        <CartesianGrid 
          strokeDasharray="4 4" 
          vertical={false} 
          stroke="var(--border)" 
          opacity={0.5} 
        />

        <XAxis 
          dataKey="date" 
          axisLine={false} 
          tickLine={false} 
          tick={{ fill: 'var(--content-muted)', fontSize: 14, fontWeight: 700 }}
          dy={10}
        />

        <YAxis 
          yAxisId="left"
          hide={chartViewMode === 'orders'}
          axisLine={false} 
          tickLine={false} 
          tick={{ fill: 'var(--content-muted)', fontSize: 14, fontWeight: 700 }}
          tickFormatter={(value) => {
            if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
            if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
            return value;
          }}
          dx={isRtl ? 10 : -10}
        />

        <YAxis 
          yAxisId="right"
          orientation="right"
          hide={chartViewMode === 'revenue'}
          axisLine={false} 
          tickLine={false} 
          tick={{ fill: 'var(--content-muted)', fontSize: 14, fontWeight: 700 }}
          allowDecimals={false}
          dx={isRtl ? -10 : 10}
        />

        <Tooltip 
          cursor={{ stroke: 'var(--brand)', strokeWidth: 1.5, strokeDasharray: '4 4', opacity: 0.6 }}
          content={({ active, payload, label }) => {
            if (active && payload && payload.length) {
              const revVal = payload.find(p => p.dataKey === 'revenue')?.value as number || 0;
              const ordersVal = payload.find(p => p.dataKey === 'ordersCount')?.value as number || 0;
              const isPeak = revVal > 0 && revVal === maxRevenueDay?.revenue;
              const sharePct = totalPeriodRevenue > 0 ? ((revVal / totalPeriodRevenue) * 100).toFixed(1) : '0';
              const avgOrderVal = ordersVal > 0 ? Math.round(revVal / ordersVal) : 0;

              return (
                <div className="bg-surface/95 backdrop-blur-md p-4 rounded-2xl shadow-2xl border border-border text-right min-w-[220px] animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-border/60">
                    <span className="text-sm font-black text-content">{label}</span>
                    {isPeak ? (
                      <span className="text-sm font-black bg-success/15 text-success px-2 py-0.5 rounded-full flex items-center gap-1">
                        🔥 {t('dashboard.peak_day_badge', 'أعلى مبيعات')}
                      </span>
                    ) : revVal > avgDailyRevenue && revVal > 0 ? (
                      <span className="text-sm font-bold bg-brand/10 text-brand px-2 py-0.5 rounded-full">
                        📈 {t('dashboard.above_avg', 'فوق المتوسط')}
                      </span>
                    ) : null}
                  </div>

                  <div className="space-y-2.5">
                    {(chartViewMode === 'both' || chartViewMode === 'revenue') && (
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center justify-between gap-4 text-sm font-bold">
                          <div className="flex items-center gap-1.5 text-content-muted">
                            <span className="w-2.5 h-2.5 rounded-full bg-brand shrink-0"></span>
                            <span>{t('dashboard.revenue', 'المبيعات')}:</span>
                          </div>
                          <span className="font-black text-brand text-sm">
                            <PriceDisplay amount={revVal} />
                          </span>
                        </div>
                        {totalPeriodRevenue > 0 && (
                          <div className="text-sm font-semibold text-content-muted text-left">
                            {sharePct}% {t('dashboard.of_total_period', 'من إجمالي الفترة')}
                          </div>
                        )}
                      </div>
                    )}

                    {(chartViewMode === 'both' || chartViewMode === 'orders') && (
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center justify-between gap-4 text-sm font-bold">
                          <div className="flex items-center gap-1.5 text-content-muted">
                            <span className="w-2.5 h-2.5 rounded-full bg-info shrink-0"></span>
                            <span>{t('dashboard.orders', 'الطلبات')}:</span>
                          </div>
                          <span className="font-black text-info text-sm">
                            {ordersVal} {t('common.order', 'طلب')}
                          </span>
                        </div>
                        {ordersVal > 0 && (
                          <div className="text-sm font-semibold text-content-muted text-left">
                            {t('dashboard.avg_basket', 'متوسط الطلب')}: <PriceDisplay amount={avgOrderVal} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            }
            return null;
          }}
        />

        {(chartViewMode === 'both' || chartViewMode === 'orders') && (
          <Bar 
            yAxisId="right"
            name={t('dashboard.orders', 'الطلبات')}
            dataKey="ordersCount"
            fill="var(--info)"
            fillOpacity={0.75}
            radius={[6, 6, 0, 0]}
            barSize={18}
          />
        )}

        {(chartViewMode === 'both' || chartViewMode === 'revenue') && (
          <Area 
            yAxisId="left"
            name={t('dashboard.revenue', 'المبيعات')}
            type="monotone" 
            dataKey="revenue" 
            stroke="var(--brand)" 
            strokeWidth={3.5}
            fillOpacity={1} 
            fill="url(#colorRevenueGlow)"
            activeDot={{ r: 7, strokeWidth: 3, stroke: 'var(--surface)', fill: 'var(--brand)' }}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
