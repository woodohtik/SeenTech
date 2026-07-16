import React, { useEffect, useState } from 'react';
import { BarChart3, TrendingUp, Users, DollarSign, RefreshCw } from 'lucide-react';
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
import { useTranslation } from 'react-i18next';

export default function SaaSReports() {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar' || i18n.language === 'ur';

  const [data, setData] = useState<{
    mrr: number;
    arpu: number;
    totalRevenue: number;
    chartData: any[];
    loading: boolean;
  }>({
    mrr: 0,
    arpu: 0,
    totalRevenue: 0,
    chartData: [],
    loading: true
  });

  const fetchData = async () => {
    setData(prev => ({ ...prev, loading: true }));
    try {
      const [
        { data: tenants },
        { data: orders },
        { data: plans }
      ] = await Promise.all([
        supabase.from('tenants').select('id, plan_id, status'),
        supabase.from('orders').select('total_amount, order_date'),
        supabase.from('plans').select('id, price')
      ]);

      if (!tenants || !orders || !plans) return;

      const activeTenants = tenants.filter(t => t.status === 'active');
      const mrr = activeTenants.reduce((acc, t) => {
        const plan = plans.find(p => p.id === t.plan_id);
        return acc + Number(plan?.price || 0);
      }, 0);

      const totalRevenue = orders.reduce((acc, o) => acc + Number(o.total_amount), 0);
      const arpu = activeTenants.length > 0 ? mrr / activeTenants.length : 0;

      // Group by month
      const monthsMap = new Map();
      orders.forEach(o => {
        const date = new Date(o.order_date);
        const month = date.toLocaleDateString(i18n.language === 'en' ? 'en-US' : isRtl ? 'ar-SA' : 'en-US', { month: 'short' });
        monthsMap.set(month, (monthsMap.get(month) || 0) + Number(o.total_amount));
      });

      const chartData = Array.from(monthsMap.entries()).map(([month, revenue]) => ({
        month,
        revenue
      })).slice(-6);

      setData({
        mrr,
        arpu,
        totalRevenue,
        chartData,
        loading: false
      });
    } catch (err) {
      console.error("Error fetching report data:", err);
      setData(prev => ({ ...prev, loading: false }));
    }
  };

  useEffect(() => {
    fetchData();
  }, [i18n.language]);

  if (data.loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <RefreshCw className="animate-spin text-indigo-500 w-12 h-12" />
      </div>
    );
  }

  const stats = [
    { label: t('saas.total_revenue_platform_sales', 'إجمالي الإيرادات (مبيعات المنصة)'), value: <PriceDisplay amount={data.totalRevenue} />, trend: '+12.5%', icon: DollarSign, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: t('saas.average_revenue_per_user', 'متوسط قيمة العميل (ARPU)'), value: <PriceDisplay amount={data.arpu} />, trend: '+5.2%', icon: Users, color: 'text-indigo-600', bg: 'bg-indigo-50' },
    { label: t('saas.recurring_revenue_mrr', 'الإيرادات المتكررة شهرياً (MRR)'), value: <PriceDisplay amount={data.mrr} />, trend: '+2.1%', icon: TrendingUp, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: t('saas.renewal_rate_typical', 'معدل التجديد (نموذجي)'), value: '94.2%', trend: '-0.5%', icon: BarChart3, color: 'text-rose-600', bg: 'bg-rose-50' },
  ];

  return (
    <div className="space-y-8 font-sans" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-900">{t('saas.financial_reports_title', 'التقارير المالية والتحليلات')}</h1>
          <p className="text-gray-500 font-bold mt-1">{t('saas.financial_reports_subtitle', 'تحليل الأداء المالي للمنصة')}</p>
        </div>
        <div className="flex gap-2">
          <button className="px-6 py-2 bg-white border border-gray-100 rounded-xl font-bold text-sm shadow-sm hover:bg-gray-50 transition-colors cursor-pointer">
            {t('saas.export_pdf', 'تصدير PDF')}
          </button>
          <button 
            onClick={fetchData}
            className="px-6 py-2 bg-indigo-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-indigo-100 flex items-center gap-2 hover:bg-indigo-700 transition-all cursor-pointer"
          >
            <RefreshCw size={16} className={data.loading ? "animate-spin" : ""} />
            {t('saas.refresh_data', 'تحديث البيانات')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm transition-all hover:shadow-md">
            <div className="flex items-center justify-between mb-4">
              <div className={`${stat.bg} ${stat.color} p-3 rounded-2xl`}>
                <stat.icon size={24} />
              </div>
              <span className={`text-xs font-bold ${stat.trend.startsWith('+') ? 'text-emerald-600' : 'text-rose-600'}`}>
                {stat.trend}
              </span>
            </div>
            <p className="text-gray-400 text-[10px] font-black uppercase tracking-widest">{stat.label}</p>
            <h3 className="text-2xl font-black text-gray-900 mt-1">{stat.value}</h3>
          </div>
        ))}
      </div>

      <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm">
        <h3 className="text-xl font-black text-gray-900 mb-8">{t('saas.monthly_revenue_growth_platform', 'نمو الإيرادات الشهرية للمنصة')}</h3>
        <div className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.chartData.length > 0 ? data.chartData : [
              { month: t('common.no_data', 'لا توجد بيانات'), revenue: 0 }
            ]}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12, fontWeight: 600}} />
              <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12, fontWeight: 600}} />
              <Tooltip 
                cursor={{fill: '#f8fafc'}} 
                contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} 
                formatter={(value: number) => [ <PriceDisplay amount={value} />, '' ]}
              />
              <Bar dataKey="revenue" fill="#4f46e5" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
