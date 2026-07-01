import React, { useEffect, useState } from 'react';
import { BarChart3, TrendingUp, Users, DollarSign, ArrowUpRight, ArrowDownRight, RefreshCw } from 'lucide-react';
import { PriceDisplay } from './PriceDisplay';
import { supabase } from '../lib/supabase/client';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell
} from 'recharts';

export default function SaaSReports() {
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
        const month = date.toLocaleDateString('en-US', { month: 'short' });
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
  }, []);

  if (data.loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <RefreshCw className="animate-spin text-indigo-500 w-12 h-12" />
      </div>
    );
  }

  const stats = [
    { label: 'إجمالي الإيرادات (Platform Sales)', value: <PriceDisplay amount={data.totalRevenue} />, trend: '+12.5%', icon: DollarSign, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'متوسط قيمة العميل (ARPU)', value: <PriceDisplay amount={data.arpu} />, trend: '+5.2%', icon: Users, color: 'text-indigo-600', bg: 'bg-indigo-50' },
    { label: 'الإيرادات المتكررة (MRR)', value: <PriceDisplay amount={data.mrr} />, trend: '+2.1%', icon: TrendingUp, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'معدل التجديد (نموذجي)', value: '94.2%', trend: '-0.5%', icon: BarChart3, color: 'text-rose-600', bg: 'bg-rose-50' },
  ];

  return (
    <div className="space-y-8 font-sans" dir="rtl">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-gray-900">التقارير المالية</h1>
          <p className="text-gray-500 font-bold mt-1">تحليل الأداء المالي لمنصة Seen</p>
        </div>
        <div className="flex gap-2">
          <button className="px-6 py-2 bg-white border border-gray-100 rounded-xl font-bold text-sm shadow-sm group">
            تصدير PDF
          </button>
          <button 
            onClick={fetchData}
            className="px-6 py-2 bg-indigo-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-indigo-100 flex items-center gap-2 hover:bg-indigo-700 transition-all"
          >
            <RefreshCw size={16} className={data.loading ? "animate-spin" : ""} />
            تحديث البيانات
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
        <h3 className="text-xl font-black text-gray-900 mb-8">نمو الإيرادات الشهرية المنصة</h3>
        <div className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.chartData.length > 0 ? data.chartData : [
              { month: 'لا توجد بيانات', revenue: 0 }
            ]}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12, fontWeight: 600}} />
              <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12, fontWeight: 600}} />
              <Tooltip 
                cursor={{fill: '#f8fafc'}} 
                contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} 
                formatter={(value: number) => <PriceDisplay amount={value} />}
              />
              <Bar dataKey="revenue" fill="#4f46e5" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
