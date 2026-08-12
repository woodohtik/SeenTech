import React, { useEffect, useState } from 'react';
import { 
  TrendingUp, 
  DollarSign, 
  Wallet, 
  Receipt, 
  Award, 
  AlertCircle, 
  BarChart2, 
  ArrowUpRight, 
  Scissors, 
  AlertTriangle 
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid 
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase/client';
import { useDirection } from '../../lib/direction';
import { PriceDisplay } from '../PriceDisplay';

interface AdminDashboardProps {
  tenantId: string;
}

interface Financials {
  totalSales: number;
  netProfit: number;
  expenses: number;
  vatDue: number;
}

interface TopTailor {
  id: string;
  name: string;
  completedItems: number;
  commissionEarned: number;
}

interface FabricAlert {
  id: string;
  name: string;
  quantity: number;
  minThreshold: number;
  unit: string;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ tenantId }) => {
  const { t } = useTranslation();
  const { dir } = useDirection();
  const [loading, setLoading] = useState(true);
  const [financials, setFinancials] = useState<Financials>({
    totalSales: 0,
    netProfit: 0,
    expenses: 0,
    vatDue: 0
  });
  const [topTailor, setTopTailor] = useState<TopTailor | null>(null);
  const [fabricAlerts, setFabricAlerts] = useState<FabricAlert[]>([]);
  const [monthlyChartData, setMonthlyChartData] = useState<any[]>([]);

  useEffect(() => {
    let isMounted = true;
    async function fetchAdminData() {
      if (!tenantId) return;
      setLoading(true);

      try {
        // 1. Fetch Orders for Financials & Monthly Charts
        const { data: orders } = await supabase
          .from('orders')
          .select('*')
          .eq('tenant_id', tenantId);

        const list = orders || [];
        const completedSales = list
          .filter(o => o.status !== 'cancelled')
          .reduce((sum, o) => sum + (Number(o.total_amount) || Number(o.total) || 0), 0);

        const vat = list
          .filter(o => o.status !== 'cancelled')
          .reduce((sum, o) => sum + (Number(o.tax_amount) || Number(o.vat) || 0), 0);

        // 2. Fetch Expenses
        const { data: expensesData } = await supabase
          .from('expenses')
          .select('amount')
          .eq('tenant_id', tenantId);

        const totalExp = (expensesData || []).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
        const estProfit = Math.max(0, completedSales - totalExp - vat);

        // 3. Fetch Fabric Inventory Alerts
        const { data: inventory } = await supabase
          .from('inventory_items')
          .select('*')
          .eq('tenant_id', tenantId);

        const alerts: FabricAlert[] = (inventory || [])
          .filter((i: any) => Number(i.quantity) <= Number(i.min_threshold || 10))
          .map((i: any) => ({
            id: i.id,
            name: i.name || t('dashboard.admin.default_fabric_name'),
            quantity: Number(i.quantity) || 0,
            minThreshold: Number(i.min_threshold) || 10,
            unit: i.unit || t('inventory.unit_meter')
          }));

        // 4. Fetch Staff & Tailor Performance
        const { data: staffList } = await supabase
          .from('staff')
          .select('id, name, role')
          .eq('tenant_id', tenantId)
          .eq('role', 'tailor');

        if (staffList && staffList.length > 0) {
          // Count completed items per tailor from order history or items
          const tailorStats = staffList.map(st => {
            const assignedOrders = list.filter(o => 
              o.tailor_id === st.id || 
              (Array.isArray(o.items) && o.items.some((it: any) => it.tailorId === st.id))
            );
            const count = assignedOrders.filter(o => o.status === 'delivered' || o.status === 'ready').length;
            const comm = assignedOrders.reduce((sum, o) => sum + (Number(o.commission) || 0), 0);
            return {
              id: st.id,
              name: st.name,
              completedItems: count,
              commissionEarned: comm
            };
          });

          tailorStats.sort((a, b) => b.completedItems - a.completedItems);
          // Only set top tailor if there is at least one tailor with completed items
          setTopTailor(tailorStats.length > 0 && tailorStats[0].completedItems > 0 ? tailorStats[0] : null);
        } else {
          setTopTailor(null);
        }

        // Calculate actual last 6 months sales and estimated profit chart
        const monthsNames = [
          t('common.months.january'),
          t('common.months.february'),
          t('common.months.march'),
          t('common.months.april'),
          t('common.months.may'),
          t('common.months.june'),
          t('common.months.july'),
          t('common.months.august'),
          t('common.months.september'),
          t('common.months.october'),
          t('common.months.november'),
          t('common.months.december'),
        ];

        const chart = [];
        const now = new Date();
        for (let i = 5; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const mIndex = d.getMonth();
          const year = d.getFullYear();
          
          const monthOrders = list.filter(o => {
            if (o.status === 'cancelled') return false;
            const orderDateStr = o.order_date || o.created_at;
            if (!orderDateStr) return false;
            const oDate = new Date(orderDateStr);
            return oDate.getMonth() === mIndex && oDate.getFullYear() === year;
          });

          const monthlySales = monthOrders.reduce((sum, o) => sum + (Number(o.total_amount) || Number(o.total) || 0), 0);
          const monthlyVat = monthOrders.reduce((sum, o) => sum + (Number(o.tax_amount) || Number(o.vat) || 0), 0);
          const monthlyProfit = Math.max(0, monthlySales - monthlyVat);

          chart.push({
            month: monthsNames[mIndex],
            mbi3at: Math.round(monthlySales),
            arbah: Math.round(monthlyProfit)
          });
        }

        if (isMounted) {
          setFinancials({
            totalSales: completedSales,
            netProfit: estProfit,
            expenses: totalExp,
            vatDue: vat
          });
          setFabricAlerts(alerts);
          setMonthlyChartData(chart);
        }
      } catch (err) {
        console.error('Error loading admin dashboard metrics:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    fetchAdminData();
    return () => { isMounted = false; };
  }, [tenantId, t]);

  if (loading) {
    return <AdminDashboardSkeleton />;
  }

  return (
    <div dir={dir} className="space-y-6 animate-fade-in">
      {/* Top Banner Header */}
      <div className="bg-gradient-to-l from-brand/10 via-surface to-surface p-6 rounded-3xl border border-brand/20 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="inline-block px-3 py-1 rounded-full bg-brand/10 text-brand text-xs font-black mb-2">
            {t('dashboard.admin.badge')}
          </span>
          <h1 className="text-2xl md:text-3xl font-black text-content tracking-tight">
            {t('dashboard.admin.title')}
          </h1>
          <p className="text-sm text-content-muted font-medium mt-1">
            {t('dashboard.admin.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="px-4 py-2.5 bg-surface border border-border rounded-2xl shadow-sm text-xs font-bold text-content flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            {t('dashboard.admin.cloud_connected')}
          </div>
        </div>
      </div>

      {/* Financial Metrics Cards (4 Grid) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Sales */}
        <div className="bg-surface p-5 rounded-3xl border border-border/80 shadow-sm hover:border-brand/30 transition-all group">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-black text-content-muted">{t('dashboard.admin.total_sales')}</span>
            <div className="w-10 h-10 rounded-2xl bg-brand/10 text-brand flex items-center justify-center group-hover:scale-110 transition-transform">
              <TrendingUp size={20} />
            </div>
          </div>
          <div className="text-2xl font-black text-content tracking-tight">
            <PriceDisplay amount={financials.totalSales} />
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-600 font-bold">
            <ArrowUpRight size={14} />
            <span>{t('dashboard.admin.vs_last_month')}</span>
          </div>
        </div>

        {/* Net Profit */}
        <div className="bg-surface p-5 rounded-3xl border border-emerald-500/20 shadow-sm hover:border-emerald-500/40 transition-all group">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-black text-content-muted">{t('dashboard.admin.estimated_net_profit')}</span>
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <DollarSign size={20} />
            </div>
          </div>
          <div className="text-2xl font-black text-emerald-600 tracking-tight">
            <PriceDisplay amount={financials.netProfit} />
          </div>
          <div className="mt-3 text-xs text-content-muted font-medium">
            {t('dashboard.admin.after_expenses_and_tax')}
          </div>
        </div>

        {/* Expenses */}
        <div className="bg-surface p-5 rounded-3xl border border-amber-500/20 shadow-sm hover:border-amber-500/40 transition-all group">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-black text-content-muted">{t('dashboard.admin.operating_expenses')}</span>
            <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Wallet size={20} />
            </div>
          </div>
          <div className="text-2xl font-black text-content tracking-tight">
            <PriceDisplay amount={financials.expenses} />
          </div>
          <div className="mt-3 text-xs text-amber-600 font-bold">
            {t('dashboard.admin.expenses_breakdown')}
          </div>
        </div>

        {/* VAT Due */}
        <div className="bg-surface p-5 rounded-3xl border border-indigo-500/20 shadow-sm hover:border-indigo-500/40 transition-all group">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-black text-content-muted">{t('dashboard.admin.vat_15')}</span>
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Receipt size={20} />
            </div>
          </div>
          <div className="text-2xl font-black text-indigo-600 tracking-tight">
            <PriceDisplay amount={financials.vatDue} />
          </div>
          <div className="mt-3 text-xs text-content-muted font-medium">
            {t('dashboard.admin.vat_due_to_authority')}
          </div>
        </div>
      </div>

      {/* Main Charts & Admin Metrics Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Monthly Sales Chart (2 cols) */}
        <div className="lg:col-span-2 bg-surface p-6 rounded-3xl border border-border shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-black text-content flex items-center gap-2">
                <BarChart2 size={20} className="text-brand" />
                <span>{t('dashboard.admin.monthly_sales_and_profit')}</span>
              </h2>
              <p className="text-xs text-content-muted font-medium mt-0.5">
                {t('dashboard.admin.monthly_chart_desc')}
              </p>
            </div>
            <span className="text-xs font-bold text-brand bg-brand/10 px-3 py-1 rounded-full">
              {t('dashboard.admin.year_2026')}
            </span>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyChartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#6B7280' }} />
                <YAxis tick={{ fontSize: 12, fill: '#6B7280' }} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1F2937', borderRadius: '12px', color: '#FFF', border: 'none' }}
                  formatter={(value: any) => [`${value} ﷼`, '']}
                />
                <Bar dataKey="mbi3at" name={t('common.sales')} fill="#4F46E5" radius={[6, 6, 0, 0]} />
                <Bar dataKey="arbah" name={t('dashboard.admin.profits')} fill="#10B981" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top Tailor & Stock Warnings (1 col) */}
        <div className="space-y-6">
          {/* Top Tailor Card */}
          <div className="bg-surface p-6 rounded-3xl border border-border shadow-sm relative overflow-hidden">
            <div className="absolute -top-6 -left-6 w-24 h-24 bg-amber-500/10 rounded-full blur-xl pointer-events-none"></div>
            
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-black text-amber-600 bg-amber-500/10 px-3 py-1 rounded-full flex items-center gap-1">
                <Award size={14} />
                {t('dashboard.admin.top_tailor')}
              </span>
              <Scissors size={20} className="text-amber-500" />
            </div>

            {topTailor ? (
              <div className="space-y-3">
                <h3 className="text-xl font-black text-content">{topTailor.name}</h3>
                <div className="bg-surface-muted p-4 rounded-2xl border border-border flex items-center justify-between">
                  <div>
                    <div className="text-xs text-content-muted font-bold">{t('dashboard.admin.completed_pieces')}</div>
                    <div className="text-lg font-black text-brand mt-1">{t('dashboard.admin.pieces_count', { pieces: topTailor.completedItems })}</div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-content-muted font-medium">{t('dashboard.admin.no_tailor_data')}</p>
            )}
          </div>

          {/* Low Stock Alerts */}
          <div className="bg-surface p-6 rounded-3xl border border-border shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-black text-content flex items-center gap-2">
                <AlertCircle size={18} className="text-danger" />
                <span>{t('dashboard.admin.low_stock_alerts')}</span>
              </h2>
              <span className="text-xs font-bold bg-danger/10 text-danger px-2.5 py-0.5 rounded-full">
                {t('dashboard.admin.items_count', { items: fabricAlerts.length })}
              </span>
            </div>

            <div className="space-y-2.5">
              {fabricAlerts.map(item => (
                <div key={item.id} className="p-3 bg-danger/5 rounded-2xl border border-danger/20 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={16} className="text-danger shrink-0" />
                    <div>
                      <div className="font-black text-content">{item.name}</div>
                      <div className="text-content-muted font-medium">{t('dashboard.admin.min_threshold', { quantity: item.minThreshold, unit: item.unit })}</div>
                    </div>
                  </div>
                  <div className="text-left font-black text-danger bg-danger/10 px-2.5 py-1 rounded-xl">
                    {t('dashboard.admin.remaining', { quantity: item.quantity, unit: item.unit })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/* Skeleton Loader for Admin Dashboard */
function AdminDashboardSkeleton() {
  const { dir } = useDirection();
  return (
    <div dir={dir} className="space-y-6 animate-pulse">
      <div className="h-28 bg-surface-muted rounded-3xl border border-border"></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-32 bg-surface-muted rounded-3xl border border-border"></div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 h-72 bg-surface-muted rounded-3xl border border-border"></div>
        <div className="h-72 bg-surface-muted rounded-3xl border border-border"></div>
      </div>
    </div>
  );
}

export default AdminDashboard;
