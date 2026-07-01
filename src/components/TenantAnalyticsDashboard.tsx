import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase/client';
import { motion } from 'motion/react';
import { 
  ArrowRight, 
  Users, 
  Activity, 
  Clock, 
  DollarSign, 
  TrendingUp, 
  TrendingDown, 
  HeartPulse, 
  Database,
  Calendar,
  AlertTriangle,
  Briefcase
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from 'react-i18next';

interface AnalyticsData {
  tenant: any;
  staff: {
    total: number;
    activeNow: { id: string; name: string; lastSeen: string }[];
    avgWorkHours: number;
  };
  finance: {
    totalRevenue: number;
    avgOrderValue: number;
    dailyAvg: number;
    monthlyAvg: number;
    trend: 'up' | 'down';
    trendValue: number;
  };
  health: {
    score: number;
    ordersCount: number;
    plan: string;
    expiresAt: string;
    churnRisk: 'low' | 'medium' | 'high';
  };
}

export default function TenantAnalyticsDashboard() {
  const { tenantId } = useParams();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AnalyticsData | null>(null);

  useEffect(() => {
    if (tenantId) {
      fetchAnalytics();
    }
  }, [tenantId]);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      // 1. Fetch Tenant Details
      const { data: tenant } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', tenantId)
        .single();
        
      if (!tenant) throw new Error('Tenant not found');

      // 2. Fetch Staff Data
      const { data: staffList } = await supabase
        .from('staff')
        .select('id, name, created_at')
        .eq('tenant_id', tenantId);
        
      // Fetch recent activity for active presence
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      
      const { data: recentActivity } = await supabase
        .from('employee_activity_logs')
        .select('staff_id, staff_name, timestamp, action')
        .eq('tenant_id', tenantId)
        .gte('timestamp', yesterday.toISOString())
        .order('timestamp', { ascending: false });

      // Determine active staff (logged in / had activity within last 2 hours)
      const twoHoursAgo = new Date();
      twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);
      
      const activeStaffMap = new Map();
      if (recentActivity) {
        recentActivity.forEach(log => {
          if (new Date(log.timestamp) >= twoHoursAgo && log.staff_id) {
            if (!activeStaffMap.has(log.staff_id)) {
              activeStaffMap.set(log.staff_id, {
                id: log.staff_id,
                name: log.staff_name,
                lastSeen: log.timestamp
              });
            }
          }
        });
      }

      // Fetch shifts for avg work hours (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const { data: shifts } = await supabase
        .from('shifts')
        .select('opened_at, closed_at')
        .eq('tenant_id', tenantId)
        .gte('opened_at', thirtyDaysAgo.toISOString())
        .not('closed_at', 'is', null);

      let totalShiftHours = 0;
      let validShiftsCount = 0;
      
      if (shifts && shifts.length > 0) {
        shifts.forEach(shift => {
          if (shift.closed_at && shift.opened_at) {
            const diffMs = new Date(shift.closed_at).getTime() - new Date(shift.opened_at).getTime();
            const diffHrs = diffMs / (1000 * 60 * 60);
            if (diffHrs > 0 && diffHrs < 24) { // Filter out anomalies 
              totalShiftHours += diffHrs;
              validShiftsCount++;
            }
          }
        });
      }
      
      const avgWorkHours = validShiftsCount > 0 ? (totalShiftHours / validShiftsCount) : 0;

      // 3. Financial Analytics
      const { data: orders } = await supabase
        .from('orders')
        .select('final_total, created_at')
        .eq('tenant_id', tenantId)
        .gte('created_at', thirtyDaysAgo.toISOString());

      let totalRevenue = 0;
      if (orders) {
        totalRevenue = orders.reduce((sum, order) => sum + (order.final_total || 0), 0);
      }
      
      const ordersCount = orders ? orders.length : 0;
      const avgOrderValue = ordersCount > 0 ? totalRevenue / ordersCount : 0;
      // Daily avg over last 30 days
      const dailyAvg = totalRevenue / 30;
      const monthlyAvg = totalRevenue;

      // Calculate health score (0-100)
      // Criteria: Active staff, Recent orders, Setup age
      let score = 50; // Base score
      if (activeStaffMap.size > 0) score += 20;
      if (ordersCount > 10) score += 10;
      if (ordersCount > 50) score += 10;
      if (avgWorkHours > 4) score += 10;
      
      // Cap at 100
      score = Math.min(score, 100);

      let churnRisk: 'low' | 'medium' | 'high' = 'high';
      if (score >= 80) churnRisk = 'low';
      else if (score >= 50) churnRisk = 'medium';

      setData({
        tenant,
        staff: {
          total: staffList ? staffList.length : 0,
          activeNow: Array.from(activeStaffMap.values()),
          avgWorkHours
        },
        finance: {
          totalRevenue,
          avgOrderValue,
          dailyAvg,
          monthlyAvg,
          trend: totalRevenue > 0 ? 'up' : 'down',
          trendValue: 12.5 // Mock trend value for UI purposes
        },
        health: {
          score,
          ordersCount,
          plan: tenant.plan_id || 'Free Trial',
          expiresAt: tenant.subscription_end_date || new Date(new Date().setMonth(new Date().getMonth() + 1)).toISOString(),
          churnRisk
        }
      });

    } catch (error) {
      console.error('Error fetching tenant analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-surface p-6 rounded-[2rem] border border-border shadow-sm">
        <div className="flex items-center gap-4">
          <Link 
            to="/admin/tailors"
            className="w-10 h-10 flex items-center justify-center rounded-2xl bg-surface-muted hover:bg-black/5 text-content-muted transition-colors"
          >
            <ArrowRight size={20} className="rtl:-scale-x-100" />
          </Link>
          <div>
            <h1 className="text-2xl font-black text-content flex items-center gap-3">
              {data.tenant.name || data.tenant.store_name}
              {data.health.churnRisk === 'high' && (
                <span className="flex items-center gap-1.5 px-2.5 py-1 bg-danger/10 text-danger text-xs rounded-lg font-bold">
                  <AlertTriangle size={14} />
                  خطر الانسحاب
                </span>
              )}
            </h1>
            <p className="text-sm font-medium text-content-muted mt-1 font-mono">ID: {tenantId}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
           <div className="px-4 py-2 bg-brand/10 text-brand font-black rounded-xl text-sm">
             {data.health.plan.toUpperCase()}
           </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        
        {/* Left/Main Column - Wide Data */}
        <div className="xl:col-span-2 space-y-6">
          
          {/* Financial Analytics Grid */}
          <div>
            <h2 className="text-lg font-black text-content mb-4 flex items-center gap-2">
              <DollarSign className="text-brand" size={20} />
              التحليلات المالية (آخر 30 يوم)
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatCard 
                title="إجمالي الإيرادات" 
                value={`${data.finance.totalRevenue.toLocaleString()} ر.س`}
                trend={data.finance.trend}
                trendValue={data.finance.trendValue}
                icon={TrendingUp}
                color="text-success"
                bg="bg-success/10"
              />
              <StatCard 
                title="متوسط الدخل اليومي" 
                value={`${data.finance.dailyAvg.toLocaleString(undefined, { maximumFractionDigits: 0 })} ر.س`}
                icon={Calendar}
                color="text-brand"
                bg="bg-brand/10"
              />
              <StatCard 
                title="متوسط قيمة الفاتورة" 
                value={`${data.finance.avgOrderValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} ر.س`}
                icon={Briefcase}
                color="text-indigo-500"
                bg="bg-indigo-500/10"
              />
            </div>
          </div>

          {/* Team Analytics Grid */}
          <div>
            <h2 className="text-lg font-black text-content mb-4 flex items-center gap-2 mt-8">
              <Users className="text-brand" size={20} />
              فريق العمل ونشاط النظام
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <StatCard 
                title="إجمالي الموظفين" 
                value={data.staff.total.toString()}
                icon={Users}
                color="text-blue-500"
                bg="bg-blue-500/10"
              />
              <StatCard 
                title="متوسط ساعات العمل للوردية" 
                value={`${data.staff.avgWorkHours.toFixed(1)} ساعة`}
                icon={Clock}
                color="text-amber-500"
                bg="bg-amber-500/10"
              />
            </div>
          </div>
          
        </div>

        {/* Right Column - Side Panels */}
        <div className="space-y-6">
          
          {/* Health Score Card */}
          <div className="bg-surface rounded-[2rem] border border-border p-6 shadow-sm relative overflow-hidden">
             <div className="absolute top-0 right-0 w-32 h-32 bg-brand/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl"></div>
             
             <h3 className="font-black text-content flex items-center gap-2 mb-6 relative z-10">
               <HeartPulse className="text-danger" size={20} />
               صحة الحساب (Health Score)
             </h3>

             <div className="flex flex-col items-center justify-center mb-6 relative z-10">
               <div className="w-32 h-32 rounded-full border-[12px] border-surface-muted flex items-center justify-center relative">
                 <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
                    <circle 
                      cx="50" cy="50" r="44" 
                      fill="none" 
                      stroke="currentColor" 
                      strokeWidth="12" 
                      className={data.health.score >= 80 ? 'text-success' : data.health.score >= 50 ? 'text-warning' : 'text-danger'}
                      strokeDasharray={`${(data.health.score / 100) * 276.46} 276.46`}
                      strokeLinecap="round"
                    />
                 </svg>
                 <span className="text-3xl font-black text-content">{data.health.score}</span>
               </div>
               <span className="text-sm font-bold text-content-muted mt-3">
                 {data.health.score >= 80 ? 'صحة ممتازة' : data.health.score >= 50 ? 'صحة متوسطة' : 'يحتاج للتدخل'}
               </span>
             </div>

             <div className="space-y-4 relative z-10">
                <div className="flex justify-between items-center p-3 bg-surface-muted rounded-xl">
                  <span className="text-sm text-content-muted font-bold">حجم الطلبات</span>
                  <span className="font-black text-content">{data.health.ordersCount} طلب</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-surface-muted rounded-xl">
                  <span className="text-sm text-content-muted font-bold">موعد التجديد</span>
                  <span className="font-black text-content font-mono">{new Date(data.health.expiresAt).toLocaleDateString('en-GB')}</span>
                </div>
             </div>
          </div>

          {/* Active Sessions Panel */}
          <div className="bg-surface rounded-[2rem] border border-border p-6 shadow-sm">
            <h3 className="font-black text-content flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Activity className="text-success" size={20} />
                المتصلون الآن
              </div>
              <span className="bg-success/10 text-success text-xs font-black px-2.5 py-1 rounded-lg">
                {data.staff.activeNow.length} نشط
              </span>
            </h3>

            {data.staff.activeNow.length === 0 ? (
              <div className="text-center py-8 text-content-muted">
                <Users className="mx-auto mb-2 opacity-50" size={32} />
                <p className="text-sm font-bold">لا يوجد موظفين متصلين حالياً</p>
              </div>
            ) : (
              <div className="space-y-3">
                {data.staff.activeNow.map((staff, idx) => (
                  <div key={idx} className="flex items-center gap-3 p-3 bg-surface-muted rounded-2xl">
                    <div className="relative">
                      <div className="w-10 h-10 bg-brand/10 text-brand rounded-full flex items-center justify-center font-bold">
                        {staff.name.charAt(0)}
                      </div>
                      <span className="absolute bottom-0 right-0 w-3 h-3 bg-success border-2 border-white rounded-full animate-pulse"></span>
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-content">{staff.name}</h4>
                      <p className="text-xs text-content-muted flex items-center gap-1">
                        <Clock size={10} />
                        آخر نشاط: {new Date(staff.lastSeen).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

// Helper Card Component
function StatCard({ 
  title, 
  value, 
  icon: Icon, 
  color, 
  bg, 
  trend, 
  trendValue 
}: { 
  title: string; 
  value: string; 
  icon: any; 
  color: string; 
  bg: string; 
  trend?: 'up' | 'down'; 
  trendValue?: number 
}) {
  return (
    <div className="bg-surface rounded-[2rem] border border-border p-6 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
      <div className="flex justify-between items-start mb-4">
        <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110", bg, color)}>
          <Icon size={24} />
        </div>
        {trend && (
          <div className={cn("flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg", 
            trend === 'up' ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
          )}>
            {trend === 'up' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            <span dir="ltr">{trendValue}%</span>
          </div>
        )}
      </div>
      <div>
        <p className="text-sm font-bold text-content-muted mb-1">{title}</p>
        <h4 className="text-2xl font-black text-content" dir="auto">{value}</h4>
      </div>
    </div>
  );
}
