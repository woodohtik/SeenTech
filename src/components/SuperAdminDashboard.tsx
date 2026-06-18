import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase/client';
import { auth } from '../lib/firebase';
import { Tenant, Order, TailorRequest, AuditLog, EmployeeActivityLog } from '../types';
import { 
  Users, 
  TrendingUp, 
  DollarSign, 
  Activity, 
  AlertCircle, 
  Shield,
  ShoppingBag,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  XCircle,
  LayoutDashboard,
  Server,
  History,
  Settings,
  PieChart as PieChartIcon,
  MousePointer2,
  Lock,
  Globe,
  Database
} from 'lucide-react';
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
  PieChart,
  Cell,
  Legend,
  Pie
} from 'recharts';
import { cn } from '../lib/utils';
import { PriceDisplay } from './PriceDisplay';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { 
  Monitor, 
  ExternalLink, 
  UserPlus, 
  Search as SearchIcon,
  Filter,
  MoreVertical,
  Check,
  Ban,
  Crown,
  AlertTriangle
} from 'lucide-react';
import { SmartSelect } from './ui/SmartSelect';

type TabType = 'overview' | 'financials' | 'tenants' | 'subscriptions' | 'performance' | 'security';

export default function SuperAdminDashboard() {
  const { setImpersonationTenantId } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [planFilter, setPlanFilter] = useState('all');
  const [orders, setOrders] = useState<Order[]>([]);
  const [pendingRequests, setPendingRequests] = useState<TailorRequest[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [activityLogs, setActivityLogs] = useState<EmployeeActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string>('');
  const [userName, setUserName] = useState<string>('');

  // SaaS Prices (Simulated)
  const planPrices: Record<string, number> = {
    'basic': 199,
    'pro': 499,
    'enterprise': 999,
    'free': 0
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [
          { data: tenantsData },
          { data: ordersData },
          { data: saasUserData },
          { data: requestsData },
          { data: auditData },
          { data: activityData }
        ] = await Promise.all([
          supabase.from('tenants').select('*'),
          supabase.from('orders').select('*').order('order_date', { ascending: false }).limit(100),
          supabase.from('saas_users').select('*').eq('uid', auth.currentUser?.uid).single(),
          supabase.from('tailor_requests').select('*').eq('status', 'pending'),
          supabase.from('audit_logs').select('*').order('timestamp', { ascending: false }).limit(20),
          supabase.from('employee_activity_logs').select('*').order('timestamp', { ascending: false }).limit(20)
        ]);

        if (tenantsData) {
          setTenants(tenantsData.map(d => ({
            ...d,
            ownerEmail: d.owner_email,
            createdAt: d.created_at,
            planId: d.plan_id,
            inventoryStrategy: d.inventory_strategy,
            customerId: d.customer_id,
            vatNumber: d.vat_number,
            commercialRegister: d.commercial_register,
            logoUrl: d.logo_url,
            defaultLayout: d.default_layout,
            isTest: d.is_test
          }) as Tenant));
        }
        if (ordersData) {
          setOrders(ordersData.map(d => ({
            ...d,
            customerId: d.customer_id,
            customerName: d.customer_name,
            orderDate: d.order_date,
            totalAmount: d.total_amount,
            paidAmount: d.paid_amount,
            remainingAmount: d.remaining_amount,
            branchId: d.branch_id,
            orderNumber: d.order_number,
            createdAt: d.created_at,
            updatedAt: d.updated_at,
            assignedTo: d.assigned_to,
            tenantId: d.tenant_id
          }) as Order));
        }
        if (requestsData) setPendingRequests(requestsData as any);
        if (auditData) setAuditLogs(auditData as any);
        if (activityData) setActivityLogs(activityData as any);
        
        if (saasUserData) {
          setUserRole(saasUserData.role);
          setUserName(saasUserData.name || auth.currentUser?.email?.split('@')[0] || '');
        } else if (auth.currentUser?.email?.toLowerCase() === "nomansa2566512@gmail.com") {
          setUserRole('super_admin');
          setUserName('Super Admin');
        }
      } catch (error) {
        console.error("Error fetching dashboard data:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // North Star SaaS Metrics
  const activeTenantsCount = tenants.filter(t => t.status === 'active').length;
  const mrr = tenants
    .filter(t => t.status === 'active')
    .reduce((acc, t) => acc + (planPrices[t.planId?.toLowerCase()] || planPrices['basic']), 0);
  
  const arr = mrr * 12;
  const totalPlatformRevenue = orders.reduce((acc, o) => acc + (o.totalAmount || 0), 0);
  const platformCommission = totalPlatformRevenue * 0.05;
  const arpu = activeTenantsCount > 0 ? mrr / activeTenantsCount : 0;

  const handleUpdateTenantStatus = async (tenantId: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from('tenants')
        .update({ status: newStatus })
        .eq('id', tenantId);
      
      if (error) throw error;
      setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, status: newStatus as any } : t));
    } catch (error) {
      console.error("Error updating tenant status:", error);
    }
  };

  const handleUpdateTenantPlan = async (tenantId: string, newPlanId: string) => {
    try {
      const { error } = await supabase
        .from('tenants')
        .update({ plan_id: newPlanId })
        .eq('id', tenantId);
      
      if (error) throw error;
      setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, planId: newPlanId } : t));
    } catch (error) {
      console.error("Error updating tenant plan:", error);
    }
  };

  const handleExtendTrial = async (tenantId: string) => {
    try {
      const today = new Date().toISOString();
      const { error } = await supabase
        .from('tenants')
        .update({ created_at: today })
        .eq('id', tenantId);
      
      if (error) throw error;
      setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, createdAt: today } : t));
    } catch (error) {
      console.error("Error extending trial:", error);
    }
  };

  const handleImpersonate = (tenantId: string) => {
    setImpersonationTenantId(tenantId);
    window.location.href = '/dashboard';
  };

  const filteredTenants = tenants.filter(t => {
    const matchesSearch = t.name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         t.ownerEmail?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
    const matchesPlan = planFilter === 'all' || t.planId?.toLowerCase() === planFilter.toLowerCase();
    return matchesSearch && matchesStatus && matchesPlan;
  });

  const stats = [
    { 
      label: 'إجمالي المشتركين', 
      value: tenants.length, 
      icon: Users, 
      color: 'text-brand', 
      bg: 'bg-brand/10',
      trend: '+12%',
      isPositive: true
    },
    { 
      label: 'الإيرادات المتكررة شهرياً (MRR)', 
      value: <PriceDisplay amount={mrr} />, 
      icon: TrendingUp, 
      color: 'text-emerald-600', 
      bg: 'bg-emerald-500/10',
      trend: '+24%',
      isPositive: true
    },
    { 
      label: 'إيرادات العمولات (5%)', 
      value: <PriceDisplay amount={platformCommission} />, 
      icon: DollarSign, 
      color: 'text-amber-600', 
      bg: 'bg-amber-500/10',
      trend: '+15%',
      isPositive: true
    },
    { 
      label: 'طلبات المراجعة', 
      value: pendingRequests.length, 
      icon: Clock, 
      color: 'text-rose-600', 
      bg: 'bg-rose-500/10',
      trend: pendingRequests.length > 5 ? 'عالي' : 'طبيعي',
      isPositive: pendingRequests.length <= 5
    },
  ];

  // Chart Data Preparation
  const revenueChartData = [
    { name: 'السبت', mrr: 12400, commission: 400 },
    { name: 'الأحد', mrr: 12400, commission: 300 },
    { name: 'الاثنين', mrr: 12800, commission: 600 },
    { name: 'الثلاثاء', mrr: 13200, commission: 800 },
    { name: 'الأربعاء', mrr: 13200, commission: 500 },
    { name: 'الخميس', mrr: 14000, commission: 900 },
    { name: 'الجمعة', mrr: 14500, commission: 1100 },
  ];

  const planDistribution = [
    { name: 'الأساسية', value: tenants.filter(t => t.planId === 'basic').length || 10, color: '#6366f1' },
    { name: 'الاحترافية', value: tenants.filter(t => t.planId === 'pro').length || 15, color: '#10b981' },
    { name: 'المؤسسات', value: tenants.filter(t => t.planId === 'enterprise').length || 5, color: '#f59e0b' },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8 font-sans" dir="rtl">
      {/* Dynamic Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-4xl font-black text-content">لوحة تحكم المنصة 🚀</h2>
          <p className="text-content-muted font-bold mt-1">أهلاً بك {userName}، نراقب الآن أداء {tenants.length} مشغل مسجل</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="hidden lg:flex items-center gap-2 px-5 py-2.5 bg-surface border border-border rounded-2xl shadow-sm">
            <Globe className="text-emerald-500" size={16} />
            <span className="text-xs font-black text-content-muted uppercase tracking-widest leading-none">Global Network: Online</span>
          </div>
          <button className="flex items-center gap-2 px-6 py-3 bg-brand text-white rounded-2xl shadow-lg shadow-brand/20 font-black transition-all hover:scale-105 active:scale-95">
            <Settings size={18} />
            إعدادات المنصة
          </button>
        </div>
      </div>

      {/* Modern Tabs Navigation */}
      <div className="flex flex-wrap items-center gap-2 bg-surface p-2 rounded-[2rem] border border-border shadow-sm inline-flex">
        {[
          { id: 'overview', label: 'الرئيسية', icon: LayoutDashboard },
          { id: 'financials', label: 'المالية', icon: DollarSign },
          { id: 'tenants', label: 'المشتركين', icon: Users },
          { id: 'subscriptions', label: 'إدارة الاشتراكات', icon: Crown },
          { id: 'performance', label: 'الأداء', icon: Server },
          { id: 'security', label: 'الأمان', icon: Shield },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as TabType)}
            className={cn(
              "flex items-center gap-2 px-6 py-3 rounded-2xl text-sm font-black transition-all",
              activeTab === tab.id 
                ? "bg-brand text-white shadow-lg shadow-brand/20" 
                : "text-content-muted hover:bg-surface-muted hover:text-content"
            )}
          >
            <tab.icon size={18} />
            {tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'overview' && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-8"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {stats.map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="bg-surface p-8 rounded-[2.5rem] border border-border shadow-sm hover:shadow-xl hover:shadow-brand/5 transition-all group relative overflow-hidden"
                >
                  <div className="flex justify-between items-start mb-6">
                    <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform", stat.bg, stat.color)}>
                      <stat.icon size={28} />
                    </div>
                    <div className={cn(
                      "flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-black",
                      stat.isPositive ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
                    )}>
                      {stat.isPositive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                      {stat.trend}
                    </div>
                  </div>
                  <div className="text-3xl font-black text-content mb-1">{stat.value}</div>
                  <div className="text-sm font-bold text-content-muted">{stat.label}</div>
                </motion.div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 bg-surface p-8 rounded-[3rem] border border-border shadow-sm">
                <div className="flex items-center justify-between mb-10">
                  <div>
                    <h3 className="text-2xl font-black text-content flex items-center gap-3">
                      <TrendingUp className="text-brand" size={28} />
                      نمو الإيرادات المتكررة
                    </h3>
                    <p className="text-content-muted font-bold text-sm mt-1">تتبع MRR والعمولات المستقطعة أسبوعياً</p>
                  </div>
                  <div className="flex bg-surface-muted p-1.5 rounded-2xl border border-border">
                    <button className="px-4 py-2 bg-brand text-white rounded-xl text-xs font-black shadow-sm">أسبوعي</button>
                    <button className="px-4 py-2 text-content-muted rounded-xl text-xs font-black hover:bg-surface transition-all">شهري</button>
                  </div>
                </div>
                <div className="h-[350px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={revenueChartData}>
                      <defs>
                        <linearGradient id="colorMrr" x1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--bg-brand)" stopOpacity={0.15}/>
                          <stop offset="95%" stopColor="var(--bg-brand)" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 700 }} dy={10} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 700 }} dx={-10} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'white', borderRadius: '24px', border: '1px solid #e2e8f0', padding: '16px', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                        itemStyle={{ fontWeight: 900 }}
                      />
                      <Area type="monotone" dataKey="mrr" name="MRR" stroke="var(--bg-brand)" strokeWidth={4} fillOpacity={1} fill="url(#colorMrr)" />
                      <Area type="monotone" dataKey="commission" name="عمولات" stroke="#f59e0b" strokeWidth={3} fill="transparent" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-surface p-8 rounded-[3rem] border border-border shadow-sm flex flex-col">
                <h3 className="text-xl font-black text-content mb-2 flex items-center gap-2">
                  <PieChartIcon className="text-brand" size={24} />
                  توزيع الباقات
                </h3>
                <p className="text-content-muted font-bold text-sm mb-6">نسبة المشتركين حسب نوع الباقة</p>
                <div className="flex-1 min-h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={planDistribution}
                        cx="50%"
                        cy="50%"
                        innerRadius={80}
                        outerRadius={110}
                        paddingAngle={8}
                        dataKey="value"
                      >
                        {planDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} strokeWidth={0} />
                        ))}
                      </Pie>
                      <Tooltip 
                         contentStyle={{ borderRadius: '20px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                         itemStyle={{ fontWeight: 800 }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-3 mt-4">
                  {planDistribution.map((plan) => (
                    <div key={plan.name} className="flex items-center justify-between p-4 bg-surface-muted rounded-2xl border border-border/50">
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: plan.color }} />
                        <span className="text-sm font-black text-content">{plan.name}</span>
                      </div>
                      <span className="text-sm font-black text-brand">{plan.value} مشترك</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'tenants' && (
          <motion.div
            key="tenants"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-8"
          >
            {/* Filters Bar */}
            <div className="bg-surface p-6 rounded-[2.5rem] border border-border shadow-sm flex flex-col md:flex-row items-center gap-4">
              <div className="relative flex-1 w-full">
                <SearchIcon className="absolute right-4 top-1/2 -translate-y-1/2 text-content-muted" size={18} />
                <input 
                  type="text" 
                  placeholder="ابحث باسم المتجر أو بريد المالك..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-surface-muted border-none rounded-2xl py-3 pr-12 pl-4 text-sm font-bold focus:ring-2 focus:ring-brand transition-all text-content"
                />
              </div>
              
              <div className="flex items-center gap-3 w-full md:w-auto">
                <div className="relative flex-1 md:w-40 min-w-[150px]">
                  <SmartSelect 
                    value={statusFilter}
                    onChange={setStatusFilter}
                    options={[
                      { value: 'all', label: 'كل الحالات' },
                      { value: 'active', label: 'نشط (جاهز)' },
                      { value: 'onboarding', label: 'في التهيئة' },
                      { value: 'inactive', label: 'موقوف' },
                      { value: 'pending', label: 'قيد المراجعة' },
                    ]}
                    className="w-full bg-surface-muted border-none rounded-2xl py-3 px-4 text-xs font-black min-h-[44px] shadow-none"
                  />
                </div>

                <div className="relative flex-1 md:w-40 min-w-[150px]">
                  <SmartSelect 
                    value={planFilter}
                    onChange={setPlanFilter}
                    options={[
                      { value: 'all', label: 'كل الباقات' },
                      { value: 'free', label: 'المجانية' },
                      { value: 'basic', label: 'الأساسية' },
                      { value: 'pro', label: 'الاحترافية' },
                      { value: 'enterprise', label: 'المؤسسات' },
                    ]}
                    className="w-full bg-surface-muted border-none rounded-2xl py-3 px-4 text-xs font-black min-h-[44px] shadow-none"
                  />
                </div>

                <button className="p-3 bg-brand text-white rounded-2xl shadow-lg shadow-brand/10 hover:scale-105 active:scale-95 transition-all">
                  <UserPlus size={20} />
                </button>
              </div>
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block bg-surface rounded-[3rem] border border-border shadow-sm overflow-hidden">
              <table className="w-full text-right">
                <thead>
                  <tr className="bg-surface-muted/50 border-b border-border">
                    <th className="px-8 py-5 text-[10px] font-black text-content-muted uppercase tracking-widest">المشترك</th>
                    <th className="px-8 py-5 text-[10px] font-black text-content-muted uppercase tracking-widest">الباقة</th>
                    <th className="px-8 py-5 text-[10px] font-black text-content-muted uppercase tracking-widest">المبيعات</th>
                    <th className="px-8 py-5 text-[10px] font-black text-content-muted uppercase tracking-widest">تاريخ التسجيل</th>
                    <th className="px-8 py-5 text-[10px] font-black text-content-muted uppercase tracking-widest">الحالة</th>
                    <th className="px-8 py-5 text-[10px] font-black text-content-muted uppercase tracking-widest text-left">العمليات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredTenants.map((tenant) => {
                    const tenantOrders = orders.filter(o => o.tenantId === tenant.id);
                    const totalSales = tenantOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
                    
                    return (
                      <tr key={tenant.id} className="hover:bg-surface-muted/30 transition-all group">
                        <td className="px-8 py-6">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-surface-muted rounded-2xl flex items-center justify-center shrink-0 border border-border">
                              {tenant.logoUrl ? (
                                <img src={tenant.logoUrl} className="w-full h-full object-cover rounded-2xl" />
                              ) : (
                                <Globe className="text-brand/40" size={20} />
                              )}
                            </div>
                            <div>
                              <div className="font-black text-content group-hover:text-brand transition-colors">{tenant.name}</div>
                              <div className="text-[10px] font-bold text-content-muted">{tenant.ownerEmail}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-8 py-6">
                          <span className={cn(
                            "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                            tenant.planId === 'pro' ? "bg-emerald-100 text-emerald-700" :
                            tenant.planId === 'enterprise' ? "bg-brand-50 text-brand" : "bg-gray-100 text-gray-600"
                          )}>
                            {tenant.planId || 'Basic'}
                          </span>
                        </td>
                        <td className="px-8 py-6">
                          <div className="text-sm font-black text-content"><PriceDisplay amount={totalSales} /></div>
                          <div className="text-[10px] font-bold text-content-muted">{tenantOrders.length} طلب</div>
                        </td>
                        <td className="px-8 py-6">
                          <div className="text-sm font-bold text-content-muted">{new Date(tenant.createdAt || new Date()).toLocaleDateString('ar-SA')}</div>
                        </td>
                        <td className="px-8 py-6">
                          {tenant.status === 'active' ? (
                            <span className="flex items-center gap-1 text-emerald-600 font-black text-[10px] uppercase bg-emerald-50 px-2 py-1 rounded-lg">
                              <Check size={12} /> نشط (جاهز)
                            </span>
                          ) : tenant.status === 'onboarding' ? (
                            <span className="flex items-center gap-1 text-amber-600 font-black text-[10px] uppercase bg-amber-50 px-2 py-1 rounded-lg animate-pulse">
                              <Clock size={12} /> في التهيئة
                            </span>
                          ) : tenant.status === 'pending' ? (
                            <span className="flex items-center gap-1 text-blue-600 font-black text-[10px] uppercase bg-blue-50 px-2 py-1 rounded-lg">
                              <Clock size={12} /> قيد المراجعة
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-rose-500 font-black text-[10px] uppercase bg-rose-50 px-2 py-1 rounded-lg">
                              <Ban size={12} /> معطل (موقوف)
                            </span>
                          )}
                        </td>
                        <td className="px-8 py-6">
                          <div className="flex items-center justify-start gap-2">
                            <button 
                              onClick={() => handleImpersonate(tenant.id)}
                              className="flex items-center gap-2 px-4 py-2 bg-brand/5 text-brand rounded-xl text-xs font-black hover:bg-brand hover:text-white transition-all"
                              title="دخول بصفة المالك"
                            >
                              <Monitor size={14} />
                              Login As
                            </button>
                            <button 
                              onClick={() => handleUpdateTenantStatus(tenant.id, (tenant.status === 'active' || tenant.status === 'onboarding') ? 'inactive' : 'active')}
                              className={cn(
                                "p-2 rounded-xl border border-border hover:border-brand/20 transition-all",
                                (tenant.status === 'active' || tenant.status === 'onboarding') ? "text-rose-500 hover:bg-rose-50" : "text-emerald-600 hover:bg-emerald-50"
                              )}
                            >
                              {(tenant.status === 'active' || tenant.status === 'onboarding') ? <Ban size={16} /> : <Check size={16} />}
                            </button>
                            <button className="p-2 text-content-muted hover:bg-surface-muted rounded-xl transition-all">
                              <MoreVertical size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards View */}
            <div className="md:hidden space-y-4">
              {filteredTenants.map((tenant) => {
                const totalSales = orders.filter(o => o.tenantId === tenant.id).reduce((sum, o) => sum + (o.totalAmount || 0), 0);
                return (
                  <div key={tenant.id} className="bg-surface p-6 rounded-[2.5rem] border border-border shadow-sm space-y-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-14 h-14 bg-surface-muted rounded-2xl flex items-center justify-center border border-border">
                          <Globe className="text-brand/40" size={24} />
                        </div>
                        <div>
                          <div className="font-black text-content">{tenant.name}</div>
                          <div className="text-xs font-bold text-content-muted">{tenant.ownerEmail}</div>
                        </div>
                      </div>
                      <span className={cn(
                        "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                        tenant.status === 'active' ? "bg-emerald-100 text-emerald-700" : tenant.status === 'onboarding' ? "bg-amber-100 text-amber-700 animate-pulse" : tenant.status === 'pending' ? "bg-blue-100 text-blue-700" : "bg-rose-100 text-rose-700"
                      )}>
                        {tenant.status === 'active' ? 'جاهز (نشط)' : tenant.status === 'onboarding' ? 'في التهيئة' : tenant.status === 'pending' ? 'قيد المراجعة' : 'معطل'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 py-6 border-y border-border/50">
                      <div>
                        <div className="text-[10px] font-black text-content-muted uppercase tracking-widest mb-1">الباقة</div>
                        <div className="text-sm font-black text-brand uppercase">{tenant.planId || 'Basic'}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-black text-content-muted uppercase tracking-widest mb-1">المبيعات</div>
                        <div className="text-sm font-black text-content"><PriceDisplay amount={totalSales} /></div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-2">
                      <button 
                        onClick={() => handleImpersonate(tenant.id)}
                        className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-brand text-white rounded-2xl text-xs font-bold shadow-lg shadow-brand/20 active:scale-95 transition-all"
                      >
                        <Monitor size={16} />
                        دخول بصفة المشترك
                      </button>
                      <button className="p-3.5 bg-surface-muted text-content-muted rounded-2xl border border-border">
                        <Settings size={20} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {activeTab === 'financials' && (
          <motion.div
            key="financials"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-8"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { label: 'ARPU (متوسط الإيراد لكل مشترك)', value: <PriceDisplay amount={arpu} />, icon: MousePointer2, color: 'text-indigo-600' },
                { label: 'ARR (الإيراد السنوي المتكرر)', value: <PriceDisplay amount={arr} />, icon: TrendingUp, color: 'text-emerald-600' },
                { label: 'LTV (القيمة الحيوية المتوقعة)', value: <PriceDisplay amount={arpu * 24} />, icon: Activity, color: 'text-brand' },
              ].map((m) => (
                <div key={m.label} className="bg-surface p-8 rounded-[2.5rem] border border-border shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                    <m.icon className={m.color} size={20} />
                    <span className="text-sm font-bold text-content-muted uppercase tracking-widest">{m.label}</span>
                  </div>
                  <div className="text-3xl font-black text-content">{m.value}</div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {activeTab === 'subscriptions' && (
          <motion.div
            key="subscriptions"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-8"
          >
            {/* Quick Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {[
                { 
                  label: 'إجمالي الإيرادات المتوقعة', 
                  value: <PriceDisplay amount={mrr} />, 
                  icon: DollarSign, 
                  color: 'text-brand', 
                  bg: 'bg-brand/10',
                  desc: 'بناءً على الباقات الحالية النشطة'
                },
                { 
                  label: 'الاشتراكات المدفوعة النشطة', 
                  value: tenants.filter(t => t.planId === 'pro' || t.planId === 'enterprise').length, 
                  icon: Crown, 
                  color: 'text-amber-600', 
                  bg: 'bg-amber-500/10',
                  desc: 'باقات برو وباقات المؤسسات ككل'
                },
                { 
                  label: 'الحسابات قيد التجربة (14 يوم)', 
                  value: tenants.filter(t => {
                    const diffDays = (new Date().getTime() - new Date(t.createdAt || new Date()).getTime()) / (1000 * 60 * 60 * 24);
                    return diffDays < 14;
                  }).length, 
                  icon: Clock, 
                  color: 'text-blue-600', 
                  bg: 'bg-blue-500/10',
                  desc: 'المشغّلين الذين لم تنتهِ تجربتهم بعد'
                },
                { 
                  label: 'الفترات التجريبية المنتهية', 
                  value: tenants.filter(t => {
                    const diffDays = (new Date().getTime() - new Date(t.createdAt || new Date()).getTime()) / (1000 * 60 * 60 * 24);
                    return diffDays >= 14 && (!t.planId || t.planId === 'basic');
                  }).length, 
                  icon: AlertCircle, 
                  color: 'text-rose-600', 
                  bg: 'bg-rose-500/10',
                  desc: 'متبقي 0 أيام وبحاجة لترقية الباقة'
                },
              ].map((m, idx) => (
                <div key={idx} className="bg-surface p-8 rounded-[2.5rem] border border-border shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-center mb-6">
                      <span className="text-xs font-black text-content-muted uppercase tracking-widest">{m.label}</span>
                      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", m.bg, m.color)}>
                        <m.icon size={20} />
                      </div>
                    </div>
                    <div className="text-3xl font-black text-content mb-1">{m.value}</div>
                  </div>
                  <p className="text-[10px] font-bold text-content-muted mt-3">{m.desc}</p>
                </div>
              ))}
            </div>

            {/* Main Manager Table */}
            <div className="bg-surface rounded-[3rem] border border-border shadow-sm overflow-hidden">
              <div className="p-8 border-b border-border bg-brand/5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h3 className="text-xl font-black text-content">إدارة تراخيص واشتراكات الخياطين</h3>
                  <p className="text-content-muted text-xs font-bold mt-1">تعديل باقات المشغلين، تصفح الأيام المتبقية في التجربة، وتمديد الصلاحية فوراً</p>
                </div>
                <div className="relative w-full sm:w-80">
                  <SearchIcon className="absolute right-4 top-1/2 -translate-y-1/2 text-content-muted" size={16} />
                  <input 
                    type="text" 
                    placeholder="بحث سريع في التراخيص..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-surface-muted/60 border-none rounded-xl py-2.5 pr-10 pl-4 text-xs font-bold focus:ring-2 focus:ring-brand transition-all text-content"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-right min-w-[900px]">
                  <thead>
                    <tr className="bg-surface-muted/30 border-b border-border">
                      <th className="px-8 py-5 text-[10px] font-black text-content-muted uppercase tracking-widest">اسم المتجر والمالك</th>
                      <th className="px-8 py-5 text-[10px] font-black text-content-muted uppercase tracking-widest">الحالة ونوع الباقة الحالية</th>
                      <th className="px-8 py-5 text-[10px] font-black text-content-muted uppercase tracking-widest">عداد الفترة التجريبية (14 يوم)</th>
                      <th className="px-8 py-5 text-[10px] font-black text-content-muted uppercase tracking-widest">تغيير الباقة والترقية</th>
                      <th className="px-8 py-5 text-[10px] font-black text-content-muted uppercase tracking-widest">الإجراءات السريعة على الترخيص</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {tenants
                      .filter(t => t.name?.toLowerCase().includes(searchQuery.toLowerCase()) || t.ownerEmail?.toLowerCase().includes(searchQuery.toLowerCase()))
                      .map(tenant => {
                        const createdDate = new Date(tenant.createdAt || new Date());
                        const now = new Date();
                        const diffTime = now.getTime() - createdDate.getTime();
                        const diffDays = diffTime / (1000 * 60 * 60 * 24);
                        const trialDaysLeft = Math.max(0, 14 - Math.floor(diffDays));
                        const isExpired = diffDays >= 14;

                        return (
                          <tr key={tenant.id} className="hover:bg-surface-muted/20 transition-all">
                            {/* Merchant details */}
                            <td className="px-8 py-6">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-brand/5 border border-brand/10 text-brand rounded-2xl flex items-center justify-center shrink-0">
                                  <Crown size={18} />
                                </div>
                                <div>
                                  <div className="font-black text-sm text-content">{tenant.name}</div>
                                  <div className="text-[10px] font-bold text-content-muted">{tenant.ownerEmail}</div>
                                </div>
                              </div>
                            </td>

                            {/* Plan Badge & Status */}
                            <td className="px-8 py-6">
                              <div className="flex items-center gap-2">
                                <span className={cn(
                                  "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider",
                                  tenant.planId === 'enterprise' ? "bg-amber-100 text-amber-800 border border-amber-200" :
                                  tenant.planId === 'pro' ? "bg-emerald-100 text-emerald-800 border border-emerald-200" :
                                  tenant.planId === 'basic' ? "bg-indigo-100 text-indigo-800 border border-indigo-200" :
                                  "bg-gray-100 text-gray-700"
                                )}>
                                  {tenant.planId === 'enterprise' ? 'باقة المؤسسات' :
                                   tenant.planId === 'pro' ? 'الباقة الاحترافية' :
                                   tenant.planId === 'basic' ? 'الباقة الأساسية' : 'تجريبية مجانية'}
                                </span>
                                <span className={cn(
                                  "text-[10px] font-bold",
                                  tenant.status === 'active' ? "text-emerald-600" : "text-rose-500"
                                )}>
                                  ({tenant.status === 'active' ? 'نشط' : 'موقوف'})
                                </span>
                              </div>
                            </td>

                            {/* Trial countdown */}
                            <td className="px-8 py-6">
                              {!isExpired ? (
                                <div className="flex items-center gap-2">
                                  <div className="w-22 bg-surface-muted h-2 rounded-full overflow-hidden border border-border">
                                    <div 
                                      className="h-full bg-brand rounded-full transition-all" 
                                      style={{ width: `${(trialDaysLeft / 14) * 100}%` }}
                                    />
                                  </div>
                                  <span className="text-xs font-black text-brand">
                                    متبقي {trialDaysLeft} أيام
                                  </span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5 text-rose-500 font-bold text-xs">
                                  <AlertTriangle size={14} className="animate-bounce" />
                                  <span>انتهت التجربة (0 أيام متبقية)</span>
                                </div>
                              )}
                            </td>

                            {/* Set / Change Plan */}
                            <td className="px-8 py-6">
                              <div className="w-48">
                                <SmartSelect
                                  value={tenant.planId || 'free'}
                                  onChange={(val) => handleUpdateTenantPlan(tenant.id, val)}
                                  options={[
                                    { value: 'free', label: 'تجريبية / باقة مجانية (0 ر.س)' },
                                    { value: 'basic', label: 'الأساسية (199 ر.س / شهر)' },
                                    { value: 'pro', label: 'الاحترافية (499 ر.س / شهر)' },
                                    { value: 'enterprise', label: 'المؤسسات (999 ر.س / شهر)' },
                                  ]}
                                  className="w-full bg-surface-muted border-none rounded-xl py-2 px-3 text-xs font-black min-h-[38px] cursor-pointer"
                                />
                              </div>
                            </td>

                            {/* Quick Action Triggers */}
                            <td className="px-8 py-6 text-left">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => handleExtendTrial(tenant.id)}
                                  className="flex items-center gap-1.5 px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-black border border-indigo-200 transition-all"
                                  title="تجديد/تنشيط الفترة التجريبية لـ 14 يوماً من اليوم"
                                >
                                  <Clock size={14} />
                                  تجديد الـ 14 يوماً
                                </button>

                                <button
                                  onClick={() => handleUpdateTenantStatus(tenant.id, tenant.status === 'active' ? 'inactive' : 'active')}
                                  className={cn(
                                    "p-2 rounded-xl border transition-all",
                                    tenant.status === 'active' 
                                      ? "text-rose-500 bg-rose-50 hover:bg-rose-100 border-rose-200" 
                                      : "text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border-emerald-200"
                                  )}
                                  title={tenant.status === 'active' ? 'تعطيل الحساب' : 'تفعيل الحساب'}
                                >
                                  {tenant.status === 'active' ? <Ban size={15} /> : <Check size={15} />}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Plan Configuration Panel / Sandbox rules */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="bg-surface p-8 rounded-[3.5rem] border border-border shadow-sm">
                <h3 className="text-xl font-black text-content flex items-center gap-2">
                  <Crown className="text-amber-500" size={24} />
                  إعدادات الباقات وأوقات التجارب الافتراضية
                </h3>
                <p className="text-content-muted font-bold text-xs mt-1 mb-8">يمكن لفريق السوبر أدمن التحكم في حزم المبيعات ومكتشف الفترة التجريبية العامة</p>
                
                <div className="space-y-6">
                  <div>
                    <label className="block text-xs font-bold text-content-muted mb-2">مدة الفترة التجريبية الافتراضية (أيام)</label>
                    <div className="flex items-center gap-4">
                      <input 
                        type="range" 
                        min="7" 
                        max="60" 
                        defaultValue="14" 
                        className="flex-1 accent-brand"
                      />
                      <span className="text-sm font-black text-brand bg-brand/5 px-4 py-1.5 rounded-xl border border-brand/10">14 يوماً</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 pt-4 border-t border-border">
                    {[
                      { name: 'الباقة الأساسية', price: '199 ر.س' },
                      { name: 'الباقة الاحترافية', price: '499 ر.س' },
                      { name: 'باقة المؤسسات', price: '999 ر.س' },
                    ].map((p, i) => (
                      <div key={i} className="p-4 bg-surface-muted/40 rounded-2xl border border-border text-center">
                        <div className="text-xs font-black text-content">{p.name}</div>
                        <div className="text-sm font-black text-brand mt-1">{p.price}</div>
                        <span className="text-[9px] text-content-muted font-bold block mt-3">سعر افتراضي شهري</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="bg-surface p-8 rounded-[3.5rem] border border-border shadow-sm flex flex-col justify-between">
                <div>
                  <h3 className="text-xl font-black text-content flex items-center gap-2">
                    <Activity className="text-emerald-500" size={24} />
                    تحليلات نسب التجديد والاحتفاظ بالمشتركين
                  </h3>
                  <p className="text-content-muted font-bold text-xs mt-1 mb-6">أداء الاحتفاظ بالمشغلين في نظام سين الذكي</p>
                  
                  <div className="space-y-4">
                    <div className="flex justify-between items-center bg-surface-muted/30 p-4 rounded-2xl">
                      <span className="text-xs font-black text-content">نسبة تجديد الاشتراكات شهرياً</span>
                      <span className="text-sm font-black text-emerald-600">94.8%</span>
                    </div>
                    <div className="flex justify-between items-center bg-surface-muted/30 p-4 rounded-2xl">
                      <span className="text-xs font-black text-content">متوسط عمر العميل على المنصة</span>
                      <span className="text-sm font-black text-brand">11.4 شهر</span>
                    </div>
                  </div>
                </div>

                <div className="bg-brand/5 p-4 rounded-2xl border border-brand/10 flex items-center gap-3 mt-6">
                  <div className="p-2 bg-brand/10 text-brand rounded-xl">
                    <AlertCircle size={18} />
                  </div>
                  <span className="text-[10px] font-black text-brand leading-relaxed">
                    ملاحظة: عمليات تحديث الاشتراكات المسلّطة في هذا التبويب تنعكس فوراً على تجربة المستخدمين وأداء التنبيهات في لوحة قيادتهم.
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'performance' && (
          <motion.div
            key="performance"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-8"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { label: 'CPU Usage', value: '14.2%', icon: Server, color: 'text-emerald-500' },
                { label: 'Database Latency', value: '24ms', icon: Database, color: 'text-blue-500' },
                { label: 'Uptime (30d)', value: '99.99%', icon: Activity, color: 'text-amber-500' },
                { label: 'API Requests/min', value: '4.2k', icon: Globe, color: 'text-brand' },
              ].map((p, i) => (
                <div key={i} className="bg-surface p-8 rounded-[2rem] border border-border shadow-sm">
                   <div className="flex justify-between items-center mb-6">
                    <p className="text-xs font-black text-content-muted uppercase tracking-widest leading-none">{p.label}</p>
                    <p className={cn("text-lg font-black", p.color)}>{p.value}</p>
                  </div>
                  <div className="w-full bg-surface-muted h-2 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: i === 0 ? '14.2%' : i === 1 ? '24%' : i === 2 ? '99%' : '42%' }}
                      className={cn("h-full", p.color.replace('text-', 'bg-'))} 
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-surface p-8 rounded-[3rem] border border-border shadow-sm">
              <h3 className="text-xl font-black text-content mb-8 flex items-center gap-2">
                <History className="text-brand" size={24} />
                سجل نشاط النظام التفصيلي
              </h3>
              <div className="space-y-4">
                {activityLogs.map((log) => (
                  <div key={log.id} className="flex items-center justify-between p-6 bg-surface-muted/30 rounded-3xl border border-border group hover:border-brand/30 transition-all">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-brand/5 text-brand rounded-2xl">
                        <Activity size={20} />
                      </div>
                      <div>
                        <div className="text-sm font-black text-content">
                          قام <span className="text-brand">{log.staffName}</span> بتنفيذ <span className="text-emerald-600">[{log.action}]</span>
                        </div>
                        <div className="text-xs text-content-muted font-bold mt-1 line-clamp-1">{log.details}</div>
                      </div>
                    </div>
                    <div className="text-right">
                       <div className="text-[10px] font-black text-content-muted uppercase tracking-widest">{new Date(log.timestamp).toLocaleTimeString('ar-SA')}</div>
                       <div className="text-[10px] font-bold text-brand mt-1 uppercase tracking-widest leading-none">Branch: {log.branchName || 'Remote'}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'security' && (
          <motion.div
            key="security"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-8"
          >
             <div className="bg-rose-500/5 p-10 rounded-[3rem] border border-rose-500/10 flex items-center gap-8">
               <div className="w-24 h-24 bg-rose-500/10 text-rose-600 rounded-[2.5rem] flex items-center justify-center shrink-0 shadow-lg shadow-rose-100">
                <Shield size={48} />
              </div>
              <div>
                <h3 className="text-2xl font-black text-rose-600 mb-2">مركز مراقبة الأمان والنزاهة</h3>
                <p className="text-rose-600/80 font-bold leading-relaxed max-w-2xl">
                  هذا القسم مخصص لمراقبة الأحداث الأمنية، محاولات الدخول، وتعديلات البيانات الحساسة على مستوى المنصة ككل. أي تغيير في هذا القسم يتم توثيقه في سجل التدقيق الأبدي.
                </p>
              </div>
            </div>

            <div className="bg-surface p-8 rounded-[3rem] border border-border shadow-sm">
              <h3 className="text-xl font-black text-content mb-8 flex items-center gap-2">
                <Lock className="text-rose-600" size={24} />
                سجل التدقيق (Audit Logs)
              </h3>
              <div className="space-y-4">
                {auditLogs.map((log) => (
                  <div key={log.id} className="flex items-start gap-4 p-6 bg-surface-muted/20 rounded-3xl border border-border border-r-4 border-r-rose-400">
                    <div className="p-2 bg-rose-500/10 text-rose-600 rounded-lg">
                      <AlertCircle size={16} />
                    </div>
                    <div>
                      <div className="text-sm font-black text-content">
                        {log.action} - <span className="text-rose-600">{log.performedByEmail}</span>
                      </div>
                      <p className="text-xs text-content-muted font-bold mt-1">{log.details}</p>
                      <div className="mt-3 flex items-center gap-3">
                        <span className="text-[10px] font-black text-content-muted uppercase tracking-widest">{new Date(log.timestamp).toLocaleString('ar-SA')}</span>
                        <span className="w-1 h-1 bg-border rounded-full" />
                        <span className="text-[10px] font-black text-rose-600 uppercase tracking-widest">Type: {log.type}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="sticky bottom-8 z-20 flex justify-center">
        <div className="bg-surface/80 backdrop-blur-xl border border-border p-3 rounded-[2.5rem] shadow-2xl flex items-center gap-3 ring-1 ring-black/5">
          <div className="flex -space-x-4 pr-2 border-l border-border ml-2 rtl:border-l-0 rtl:border-r rtl:ml-0 rtl:mr-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="w-10 h-10 rounded-full border-2 border-surface bg-brand text-white flex items-center justify-center text-xs font-black ring-2 ring-brand/10">
                {i}
              </div>
            ))}
          </div>
          <div className="px-4">
            <p className="text-xs font-black text-content">دعم فني مباشر</p>
            <p className="text-[10px] font-bold text-emerald-500">متواجدون الآن</p>
          </div>
          <button className="px-8 py-3 bg-brand text-white rounded-2xl font-black text-sm shadow-xl shadow-brand/20 hover:scale-105 active:scale-95 transition-all">
            فتح تذكرة دعم
          </button>
        </div>
      </div>
    </div>
  );
}
