import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase/client';
import { OrderItem, Staff } from '../types';
import { Scissors, Search, FileSpreadsheet, Loader2, DollarSign } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { PriceDisplay } from './PriceDisplay';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';

interface TailorStatementReportProps {
  tenantId: string;
}

interface TailorCommissionData {
  id: string;
  order_id: string;
  name: string;
  garment_type: string;
  calculated_commission: number;
  created_at: string;
}

export default function TailorStatementReport({ tenantId }: TailorStatementReportProps) {
  const [tailors, setTailors] = useState<Staff[]>([]);
  const [selectedTailor, setSelectedTailor] = useState<string>('all');
  const [commissions, setCommissions] = useState<TailorCommissionData[]>([]);
  const [loading, setLoading] = useState(true);
  const { handleError } = useToast();

  useEffect(() => {
    fetchTailors();
    fetchCommissions();
  }, [tenantId, selectedTailor]);

  const fetchTailors = async () => {
    try {
      const { data, error } = await supabase
        .from('staff')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('role', 'tailor');
      
      if (error) throw error;
      
      const parsedTailors = (data || []).map(t => ({
        id: t.id,
        name: t.name,
      })) as Staff[];
      
      setTailors(parsedTailors);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchCommissions = async () => {
    try {
      setLoading(true);
      
      let query = supabase
        .from('order_items')
        .select('id, order_id, name, garment_type, calculated_commission, created_at, assigned_tailor_id, status')
        .eq('tenant_id', tenantId)
        .in('status', ['ready', 'delivered', 'partial_delivered', 'ironing_packaging']) 
        .not('calculated_commission', 'is', null);

      if (selectedTailor !== 'all') {
        query = query.eq('assigned_tailor_id', selectedTailor);
      }

      const { data, error } = await query;
      
      if (error) throw error;
      setCommissions(data || []);
      
    } catch (err: any) {
      handleError(err, 'فشل جلب تفاصيل العمولات');
    } finally {
      setLoading(false);
    }
  };

  const totalCommission = commissions.reduce((sum, item) => sum + (item.calculated_commission || 0), 0);

  const monthlyChartData = useMemo(() => {
    const map = new Map<string, { label: string, total: number, dateVal: number }>();
    commissions.forEach(c => {
      const date = new Date(c.created_at);
      const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const label = date.toLocaleString('ar-SA-u-nu-latn', { month: 'short', year: 'numeric' });
      if (!map.has(yearMonth)) {
        map.set(yearMonth, { label, total: 0, dateVal: new Date(date.getFullYear(), date.getMonth(), 1).getTime() });
      }
      map.get(yearMonth)!.total += (c.calculated_commission || 0);
    });
    return Array.from(map.values())
      .sort((a, b) => a.dateVal - b.dateVal)
      .map(d => ({ name: d.label, total: d.total }));
  }, [commissions]);

  const tailorChartData = useMemo(() => {
    if (selectedTailor !== 'all') return [];
    const map = new Map<string, number>();
    commissions.forEach(c => {
       const tailorName = tailors.find(t => t.id === (c as any).assigned_tailor_id)?.name || 'غير معروف';
       map.set(tailorName, (map.get(tailorName) || 0) + (c.calculated_commission || 0));
    });
    return Array.from(map.entries())
       .map(([name, total]) => ({ name, total }))
       .sort((a, b) => b.total - a.total);
  }, [commissions, tailors, selectedTailor]);

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
            <Scissors size={20} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">كشف حساب الخياطين</h2>
            <p className="text-sm text-gray-500">تفصيل عمولات الخياطين عن القطع المنجزة</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <select
            value={selectedTailor}
            onChange={(e) => setSelectedTailor(e.target.value)}
            className="px-4 py-2 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-bold"
          >
            <option value="all">جميع الخياطين</option>
            {tailors.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-indigo-50/50 p-6 rounded-2xl border border-indigo-100 flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center">
            <DollarSign size={24} />
          </div>
          <div>
            <p className="text-sm font-medium text-indigo-600/80 mb-1">إجمالي العمولات</p>
            <div className="text-2xl font-black text-indigo-900">
              <PriceDisplay amount={totalCommission} />
            </div>
          </div>
        </div>
        
        <div className="bg-emerald-50/50 p-6 rounded-2xl border border-emerald-100 flex items-center gap-4">
          <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center">
            <Scissors size={24} />
          </div>
          <div>
            <p className="text-sm font-medium text-emerald-600/80 mb-1">القطع المنجزة</p>
            <div className="text-2xl font-black text-emerald-900">
              {commissions.length}
            </div>
          </div>
        </div>
      </div>

      {!loading && commissions.length > 0 && (
        <div className={`grid grid-cols-1 ${selectedTailor === 'all' && tailorChartData.length > 0 ? 'lg:grid-cols-2' : ''} gap-6`}>
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
            <h3 className="text-lg font-bold text-gray-900 mb-6">التوجه الشهري للعمولات</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyChartData}>
                  <defs>
                    <linearGradient id="colorCommission" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#4F46E5" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    formatter={(value: number) => [`${value.toFixed(2)} ﷼`, 'العمولات']}
                  />
                  <Area type="monotone" dataKey="total" stroke="#4F46E5" strokeWidth={3} fillOpacity={1} fill="url(#colorCommission)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {selectedTailor === 'all' && tailorChartData.length > 0 && (
            <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
              <h3 className="text-lg font-bold text-gray-900 mb-6">توزيع العمولات حسب الخياط</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={tailorChartData} layout="vertical" margin={{ top: 0, right: 0, left: 40, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f3f4f6" />
                    <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} />
                    <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} />
                    <Tooltip 
                      cursor={{ fill: '#f9fafb' }}
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      formatter={(value: number) => [`${value.toFixed(2)} ﷼`, 'العمولات']}
                    />
                    <Bar dataKey="total" fill="#10B981" radius={[0, 4, 4, 0]} barSize={24} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 flex justify-center">
            <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
          </div>
        ) : commissions.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            لا توجد سجلات عمولات متاحة.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right min-w-max">
              <thead className="bg-gray-50/50">
                <tr>
                  <th className="px-6 py-4 text-xs font-black text-gray-500 uppercase tracking-widest">رقم الطلب</th>
                  <th className="px-6 py-4 text-xs font-black text-gray-500 uppercase tracking-widest">القطعة</th>
                  <th className="px-6 py-4 text-xs font-black text-gray-500 uppercase tracking-widest">الخياط</th>
                  <th className="px-6 py-4 text-xs font-black text-gray-500 uppercase tracking-widest">تاريخ الإنجاز</th>
                  <th className="px-6 py-4 text-xs font-black text-gray-500 uppercase tracking-widest">العمولة المكتسبة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {commissions.map((item) => {
                  const tailor = tailors.find(t => t.id === (item as any).assigned_tailor_id);
                  return (
                    <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-4 font-bold text-gray-900">
                        #{item.order_id.slice(0, 8)}
                      </td>
                      <td className="px-6 py-4 text-gray-700 font-medium">
                        {item.name || item.garment_type || 'قطعة'}
                      </td>
                      <td className="px-6 py-4 text-gray-700 font-medium">
                        {tailor?.name || 'غير معروف'}
                      </td>
                      <td className="px-6 py-4 text-gray-500" dir="ltr">
                        {new Date(item.created_at).toLocaleString('ar-SA-u-nu-latn')}
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-3 py-1 bg-emerald-50 text-emerald-700 font-bold rounded-lg text-sm">
                          <PriceDisplay amount={item.calculated_commission} />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
