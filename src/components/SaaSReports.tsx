import React, { useEffect, useState } from 'react';
import { TrendingUp, Users, DollarSign, RefreshCw } from 'lucide-react';
import { PriceDisplay } from './PriceDisplay';
import { supabase } from '../lib/supabase/client';
import { 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar
} from 'recharts';
import type { TooltipValueType } from 'recharts';
import { useTranslation } from 'react-i18next';
import { useToast } from '../contexts/ToastContext';

import { isRtlLang, localeOf } from '../lib/direction';

export default function SaaSReports() {
  const { t, i18n } = useTranslation();
  const { handleError } = useToast();
  const isRtl = isRtlLang(i18n.language);

  const [data, setData] = useState<{
    mrr: number;
    arpu: number;
    totalRevenue: number;
    /** % change vs the previous month, from the real monthly revenue series -- null when there isn't a prior month to compare against. */
    revenueTrendPct: number | null;
    chartData: any[];
    loading: boolean;
  }>({
    mrr: 0,
    arpu: 0,
    totalRevenue: 0,
    revenueTrendPct: null,
    chartData: [],
    loading: true
  });

  const fetchData = async () => {
    setData(prev => ({ ...prev, loading: true }));
    try {
      const [
        { data: tenants },
        { data: revenueReport, error: revenueError },
        { data: plans }
      ] = await Promise.all([
        supabase.from('tenants').select('id, plan_id, status'),
        // SUM/GROUP BY تُحسَب في SQL (get_saas_revenue_report) بدل جلب كل
        // صف من orders (أكبر جدول في المخطط) إلى المتصفح في كل مرة.
        supabase.rpc('get_saas_revenue_report'),
        supabase.from('plans').select('id, price')
      ]);

      if (!tenants || !plans || !revenueReport || revenueError) {
        // Postgrest resolves with {data: null, error} rather than throwing --
        // this used to leave `loading` stuck true forever (an endless
        // spinner with no explanation) instead of reaching the catch below.
        setData(prev => ({ ...prev, loading: false }));
        handleError(revenueError || new Error('tenants/revenue/plans query returned null'), t('saas.reports_load_failed', 'تعذّر تحميل تقارير وتحليلات النظام'));
        return;
      }

      const activeTenants = tenants.filter(t => t.status === 'active');
      // P6 (PLATFORM-18): the server's figures -- revenue is what shops paid
      // Seen (it was the shops' own sales), MRR is the monthly share of the
      // shops on an active paid subscription (it summed a yearly price for
      // every shop, locked and trial included).
      const mrr = Number(revenueReport.mrr) || 0;
      const payingShops = Number(revenueReport.paying_shops) || 0;
      const totalRevenue = Number(revenueReport.total_revenue) || 0;
      const arpu = payingShops > 0 ? mrr / payingShops : 0;

      const monthly: { month_start: string; revenue: number }[] = revenueReport.monthly || [];
      const chartData = monthly.map(m => ({
        month: new Date(m.month_start).toLocaleDateString(localeOf(i18n.language), { month: 'short' }),
        revenue: Number(m.revenue) || 0
      })).slice(-6);

      // Bug report (sprint 2 reports engine, 2026-11-17): this card used to
      // show a hardcoded "+12.5%" no matter what the real numbers were --
      // the monthly series already has real month-over-month data, so
      // compute the actual change instead. Null (not 0%) when there's no
      // prior month or it was zero, so the UI can honestly omit the trend
      // rather than claim a 0% or infinite change that never happened.
      const lastTwoMonths = monthly.slice(-2);
      const revenueTrendPct = lastTwoMonths.length === 2 && Number(lastTwoMonths[0].revenue) > 0
        ? ((Number(lastTwoMonths[1].revenue) - Number(lastTwoMonths[0].revenue)) / Number(lastTwoMonths[0].revenue)) * 100
        : null;

      setData({
        mrr,
        arpu,
        totalRevenue,
        revenueTrendPct,
        chartData,
        loading: false
      });
    } catch (err) {
      console.error("Error fetching report data:", err);
      setData(prev => ({ ...prev, loading: false }));
      handleError(err, t('saas.reports_load_failed', 'تعذّر تحميل تقارير وتحليلات النظام'));
    }
  };

  useEffect(() => {
    fetchData();
  }, [i18n.language]);

  if (data.loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <RefreshCw className="animate-spin text-brand w-12 h-12" />
      </div>
    );
  }

  // Bug report (sprint 2 reports engine, 2026-11-17): a 4th card here used
  // to show a hardcoded "94.2%" renewal rate -- there is no churn/renewal
  // tracking anywhere in the schema to back a real number, and the
  // founder's call (2026-11-17) was to show only real data rather than
  // build that tracking now, so the card is gone rather than faked.
  // mrr/arpu are current-snapshot calculations (today's active tenants ×
  // today's plan prices) with no historical series to diff against, so
  // they get no trend at all -- only totalRevenue has a real monthly
  // series behind it.
  const stats: { label: string; value: React.ReactNode; trend: number | null; icon: typeof DollarSign; color: string; bg: string }[] = [
    { label: t('saas.total_revenue_platform_sales'), value: <PriceDisplay amount={data.totalRevenue} />, trend: data.revenueTrendPct, icon: DollarSign, color: 'text-success', bg: 'bg-success/10' },
    { label: t('saas.average_revenue_per_user'), value: <PriceDisplay amount={data.arpu} />, trend: null, icon: Users, color: 'text-info', bg: 'bg-info/10' },
    { label: t('saas.recurring_revenue_mrr'), value: <PriceDisplay amount={data.mrr} />, trend: null, icon: TrendingUp, color: 'text-brand', bg: 'bg-brand/10' },
  ];

  return (
    <div className="space-y-8 font-sans" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex flex-col main-720:flex-row justify-between items-start main-720:items-center gap-4">
        <div>
          <h2 className="text-3xl font-black text-content">{t('saas.financial_reports_title')}</h2>
          <p className="text-content-muted font-bold mt-1">{t('saas.financial_reports_subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchData}
            className="px-6 py-2 bg-brand text-white rounded-xl font-bold text-sm shadow-lg shadow-brand/20 flex items-center gap-2 hover:bg-brand/90 transition-all cursor-pointer"
          >
            <RefreshCw size={16} className={data.loading ? "animate-spin" : ""} />
            {t('saas.refresh_data')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 main-720:grid-cols-2 main-900:grid-cols-3 gap-6">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-surface p-6 rounded-2xl border border-border shadow-sm transition-all">
            <div className="flex items-center justify-between mb-4">
              <div className={`${stat.bg} ${stat.color} p-3 rounded-2xl`}>
                <stat.icon size={24} />
              </div>
              {stat.trend !== null && (
                <span className={`text-sm font-bold ${stat.trend >= 0 ? 'text-success' : 'text-danger'}`}>
                  {stat.trend >= 0 ? '+' : ''}{stat.trend.toFixed(1)}%
                </span>
              )}
            </div>
            <p className="text-content-muted text-sm font-black uppercase">{stat.label}</p>
            <h3 className="text-2xl font-black text-content mt-1">{stat.value}</h3>
          </div>
        ))}
      </div>

      <div className="bg-surface p-8 rounded-2xl border border-border shadow-sm">
        <h3 className="text-xl font-black text-content mb-8">{t('saas.monthly_revenue_growth_platform')}</h3>
        <div className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.chartData.length > 0 ? data.chartData : [
              { month: t('common.no_data'), revenue: 0 }
            ]}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: 'var(--content-muted)', fontSize: 14, fontWeight: 600 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--content-muted)', fontSize: 14, fontWeight: 600 }} />
              <Tooltip
                cursor={{ fill: 'var(--surface-muted)' }}
                contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                formatter={(value?: TooltipValueType) => [ <PriceDisplay amount={Number(value) || 0} />, '' ]}
              />
              <Bar dataKey="revenue" fill="var(--brand)" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
