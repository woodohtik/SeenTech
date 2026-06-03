import React from 'react';
import { BarChart3, TrendingUp, Users, DollarSign, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { PriceDisplay } from './PriceDisplay';
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
  const stats = [
    { label: 'إجمالي الإيرادات', value: <PriceDisplay amount={125400} />, trend: '+12.5%', icon: DollarSign, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'متوسط قيمة العميل (ARPU)', value: <PriceDisplay amount={450} />, trend: '+5.2%', icon: Users, color: 'text-indigo-600', bg: 'bg-indigo-50' },
    { label: 'معدل التجديد', value: '94.2%', trend: '+2.1%', icon: TrendingUp, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'معدل الإلغاء (Churn)', value: '1.8%', trend: '-0.5%', icon: BarChart3, color: 'text-rose-600', bg: 'bg-rose-50' },
  ];

  return (
    <div className="space-y-8 font-sans" dir="rtl">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-gray-900">التقارير المالية</h1>
          <p className="text-gray-500 font-bold mt-1">تحليل الأداء المالي لمنصة Seen</p>
        </div>
        <div className="flex gap-2">
          <button className="px-6 py-2 bg-white border border-gray-100 rounded-xl font-bold text-sm shadow-sm">تصدير PDF</button>
          <button className="px-6 py-2 bg-indigo-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-indigo-100">تحديث البيانات</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className={`${stat.bg} ${stat.color} p-3 rounded-2xl`}>
                <stat.icon size={24} />
              </div>
              <span className={`text-xs font-bold ${stat.trend.startsWith('+') ? 'text-emerald-600' : 'text-rose-600'}`}>
                {stat.trend}
              </span>
            </div>
            <p className="text-gray-400 text-sm font-bold">{stat.label}</p>
            <h3 className="text-2xl font-black text-gray-900 mt-1">{stat.value}</h3>
          </div>
        ))}
      </div>

      <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm">
        <h3 className="text-xl font-black text-gray-900 mb-8">نمو الإيرادات الشهرية</h3>
        <div className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={[
              { month: 'Jan', revenue: 45000 },
              { month: 'Feb', revenue: 52000 },
              { month: 'Mar', revenue: 48000 },
              { month: 'Apr', revenue: 61000 },
              { month: 'May', revenue: 75000 },
              { month: 'Jun', revenue: 89000 },
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
