import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase/client';
import { Tenant, AuditLog, EmployeeActivityLog } from '../types';
import { 
  Users, 
  TrendingUp, 
  DollarSign, 
  Activity, 
  Shield,
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
  Database,
  Search,
  SlidersHorizontal,
  RefreshCw,
  ChevronRight,
  ChevronLeft,
  X,
  CreditCard,
  UserCheck,
  AlertCircle,
  Plus,
  Trash2,
  Tag
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Cell,
  Pie
} from 'recharts';
import { cn } from '../lib/utils';
import { SmartSelect } from './ui/SmartSelect';
import { IconInput } from './ui/IconInput';
import { PriceDisplay } from './PriceDisplay';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { Trans, useTranslation } from 'react-i18next';
import { isRtlLang, localeOf } from '../lib/direction';
import { validatePlanForm, PlanFormInput, PlanFormField } from '../utils/planValidation';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { Coupon, fetchCoupons, createCoupon, setCouponActive, deleteCoupon } from '../services/couponService';

type TabType = 'overview' | 'financials' | 'performance' | 'security' | 'plans' | 'coupons';

export default function SuperAdminDashboard() {
  const { t, i18n } = useTranslation();
  const isRtl = isRtlLang(i18n.language);
  const { success: toastSuccess, error: toastError, handleError: toastHandleError } = useToast();
  const { confirm } = useConfirm();

  const { dbUser, user: currentAuthUser } = useAuth();
  const userRole = dbUser?.role;

  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [activityLogs, setActivityLogs] = useState<EmployeeActivityLog[]>([]);
  // seen-admin-reengineering-task.md بند 4 -- ترقيم صفحات فعلي بدل .limit()
  // ثابت بلا .range(): كل خلاصة تحمل صفحتها الخاصة، بحد أقصى معروف
  // (auditLogsTotal/activityLogsTotal) لتعطيل "التالي" عند آخر صفحة.
  const AUDIT_PAGE_SIZE = 20;
  const ACTIVITY_PAGE_SIZE = 20;
  const [auditPage, setAuditPage] = useState(0);
  const [auditLogsTotal, setAuditLogsTotal] = useState(0);
  const [activityPage, setActivityPage] = useState(0);
  const [activityLogsTotal, setActivityLogsTotal] = useState(0);
  const [plansList, setPlansList] = useState<any[]>([]);
  const [planModalMode, setPlanModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingPlan, setEditingPlan] = useState<any | null>(null);
  const [couponsList, setCouponsList] = useState<Coupon[]>([]);
  const [couponModalOpen, setCouponModalOpen] = useState(false);
  const [updatingCouponId, setUpdatingCouponId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState<string>('Super Admin');
  
  // Real DB latency tracker
  const [dbLatency, setDbLatency] = useState<number | null>(null);
  const [testingLatency, setTestingLatency] = useState(false);


  // Security audit trail filter
  const [auditSearch, setAuditSearch] = useState('');
  const [auditTypeFilter, setAuditTypeFilter] = useState('all');

  const measureLatency = async () => {
    setTestingLatency(true);
    const start = performance.now();
    try {
      await supabase.from('plans').select('id').limit(1);
      const end = performance.now();
      setDbLatency(Math.round(end - start));
    } catch (e) {
      console.error("Error measuring latency:", e);
    } finally {
      setTestingLatency(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [
        { data: tenantsData },
        { data: saasUserData },
        { data: plansData },
        couponsData
      ] = await Promise.all([
        supabase.from('tenants').select('*'),
        supabase.from('saas_users').select('*').eq('uid', currentAuthUser?.id).single(),
        supabase.from('plans').select('*'),
        fetchCoupons().catch((e) => { console.error('Error fetching coupons:', e); return []; })
      ]);

      if (plansData) {
        setPlansList(plansData);
      }
      setCouponsList(couponsData);

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
          isTest: d.is_test,
          assistantEnabled: d.assistant_enabled !== false,
          trashedAt: d.trashed_at,
          trashedBy: d.trashed_by
        }) as Tenant));
      }

      if (saasUserData) {
        setUserName(saasUserData.name || currentAuthUser?.email?.split('@')[0] || 'Super Admin');
      } else if (currentAuthUser?.email?.toLowerCase() === "nomansa2566512@gmail.com") {
        setUserName('Noman Saed');
      }

      // Initial latency test
      const start = performance.now();
      await supabase.from('plans').select('id').limit(1);
      setDbLatency(Math.round(performance.now() - start));

    } catch (error) {
      console.error("Error fetching super admin dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [i18n.language]);

  // seen-admin-reengineering-task.md بند 4 -- خلاصتان منفصلتان بترقيم صفحات
  // فعلي (.range()) بدل .limit() ثابت بلا أي تنقّل، كل واحدة بصفحتها الخاصة
  // لأنهما تُعرَضان في تبويبين مختلفين (الأمان/الأداء) ولا داعي لتحميل إحداهما
  // عند تقليب صفحات الأخرى.
  const fetchAuditLogsPage = async (page: number, search: string, typeFilter: string) => {
    const from = page * AUDIT_PAGE_SIZE;
    const to = from + AUDIT_PAGE_SIZE - 1;
    let query = supabase
      .from('audit_logs')
      .select('*', { count: 'exact' })
      .order('occurred_at', { ascending: false });
    if (search.trim()) {
      const term = `%${search.trim()}%`;
      query = query.or(`action.ilike.${term},performed_by_email.ilike.${term},details.ilike.${term}`);
    }
    if (typeFilter !== 'all') {
      query = query.eq('type', typeFilter);
    }
    const { data, count, error } = await query.range(from, to);
    if (error) {
      console.error('Error fetching audit logs page:', error);
      return;
    }
    setAuditLogsTotal(count || 0);
    setAuditLogs((data || []).map(d => ({
      id: String(d.id),
      action: d.action,
      performedBy: d.performed_by,
      performedByEmail: d.performed_by_email,
      tenantId: d.tenant_id,
      targetTenantId: d.target_tenant_id,
      details: d.details,
      type: d.type,
      timestamp: d.occurred_at,
    }) as AuditLog));
  };

  const fetchActivityLogsPage = async (page: number) => {
    const from = page * ACTIVITY_PAGE_SIZE;
    const to = from + ACTIVITY_PAGE_SIZE - 1;
    const { data, count, error } = await supabase
      .from('employee_activity_logs')
      .select('*', { count: 'exact' })
      .order('occurred_at', { ascending: false })
      .range(from, to);
    if (error) {
      console.error('Error fetching activity logs page:', error);
      return;
    }
    setActivityLogsTotal(count || 0);
    setActivityLogs((data || []) as any);
  };

  const debouncedAuditSearch = useDebouncedValue(auditSearch, 250);
  useEffect(() => { setAuditPage(0); }, [debouncedAuditSearch, auditTypeFilter]);
  useEffect(() => {
    fetchAuditLogsPage(auditPage, debouncedAuditSearch, auditTypeFilter);
  }, [auditPage, debouncedAuditSearch, auditTypeFilter]);

  useEffect(() => { fetchActivityLogsPage(activityPage); }, [activityPage]);

  // docs/superpowers/plans/2026-10-20-plans-management.md (Task 2/4)
  const handleTogglePlanActive = async (plan: any) => {
    const { error } = await supabase.from('plans').update({ is_active: !plan.is_active }).eq('id', plan.id);
    if (error) {
      toastHandleError(error, t('saas.plans_toggle_failed'));
      return;
    }
    toastSuccess(t('saas.plans_toggle_success'));
    await fetchData();
  };

  const handleDeletePlan = async (plan: any) => {
    // Fresh-reviewer finding: counting from the already-loaded `tenants`
    // state (fetched once, with its own fetch error swallowed, and capped
    // at PostgREST's default row limit) could read 0 subscribers when the
    // real count is not -- the one check this whole feature exists for.
    // A live, exact count sidesteps all three failure modes at once.
    const { count: subscriberCount, error: countError } = await supabase
      .from('tenants')
      .select('id', { count: 'exact', head: true })
      .eq('plan_id', plan.id);
    if (countError) {
      toastHandleError(countError, t('saas.plan_delete_failed'));
      return;
    }
    if ((subscriberCount || 0) > 0) {
      toastError(t('saas.plan_delete_blocked', { count: subscriberCount }));
      return;
    }
    if (!(await confirm({ description: t('saas.plan_delete_confirm', { name: plan.name }), danger: true }))) return;

    const { error } = await supabase.from('plans').delete().eq('id', plan.id);
    if (error) {
      toastHandleError(error, t('saas.plan_delete_failed'));
      return;
    }
    toastSuccess(t('saas.plan_delete_success'));
    await fetchData();
  };

  const handleToggleCouponActive = async (coupon: Coupon) => {
    setUpdatingCouponId(coupon.id);
    try {
      await setCouponActive(coupon.id, !coupon.is_active);
      toastSuccess(t('saas.coupon_toggle_success', 'تم تحديث حالة الكوبون'));
      await fetchData();
    } catch (err) {
      toastHandleError(err, t('saas.coupon_toggle_failed', 'تعذّر تحديث حالة الكوبون'));
    } finally {
      setUpdatingCouponId(null);
    }
  };

  const handleDeleteCoupon = async (coupon: Coupon) => {
    if (!(await confirm({ description: t('saas.coupon_delete_confirm', { code: coupon.code, defaultValue: `حذف كوبون "${coupon.code}" نهائياً؟ الطلبات التي استخدمته سابقاً تحتفظ بسجلّها.` }), danger: true }))) return;
    setUpdatingCouponId(coupon.id);
    try {
      await deleteCoupon(coupon.id);
      toastSuccess(t('saas.coupon_delete_success', 'تم حذف الكوبون'));
      await fetchData();
    } catch (err) {
      toastHandleError(err, t('saas.coupon_delete_failed', 'تعذّر حذف الكوبون'));
    } finally {
      setUpdatingCouponId(null);
    }
  };

  // Real Dynamic Calculations (Zero Fallback Policy)
  const activeTenantsCount = useMemo(() => {
    return tenants.filter(t => t.status === 'active' || t.status === 'onboarding').length;
  }, [tenants]);

  const mrr = useMemo(() => {
    return tenants
      .filter(t => t.status === 'active' || t.status === 'onboarding')
      .reduce((acc, t) => {
        const plan = plansList.find(p => p.id === t.planId);
        return acc + (plan?.price || 0);
      }, 0);
  }, [tenants, plansList]);

  const arr = useMemo(() => mrr * 12, [mrr]);
  const arpu = useMemo(() => activeTenantsCount > 0 ? mrr / activeTenantsCount : 0, [mrr, activeTenantsCount]);
  const ltv = useMemo(() => arpu * 24, [arpu]); // Assumes 24 months average retention

  // Growth calculations vs last month
  const tenantsGrowth = useMemo(() => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const newTenantsCount = tenants.filter(t => new Date(t.createdAt) >= thirtyDaysAgo).length;
    const baseCount = tenants.length - newTenantsCount;
    if (baseCount === 0) return tenants.length > 0 ? '100%' : '0%';
    return `+${((newTenantsCount / baseCount) * 100).toFixed(1)}%`;
  }, [tenants]);

  // Main KPI cards
  const stats = useMemo(() => [
    { 
      label: t('saas.total_subscribers'), 
      value: tenants.length, 
      icon: Users, 
      color: 'text-brand', 
      bg: 'bg-brand/5',
      trend: tenantsGrowth,
      isPositive: true
    },
    { 
      label: t('saas.kpi_mrr'), 
      value: <PriceDisplay amount={mrr} />, 
      icon: TrendingUp, 
      color: 'text-success',
      bg: 'bg-success/5',
      trend: '+12.4%',
      isPositive: true
    },
    { 
      label: t('saas.kpi_arr'), 
      value: <PriceDisplay amount={arr} />, 
      icon: DollarSign, 
      color: 'text-warning',
      bg: 'bg-warning/5',
      trend: '+12.4%',
      isPositive: true
    },
    { 
      label: t('saas.kpi_active_subscribers'), 
      value: activeTenantsCount, 
      icon: Activity, 
      color: 'text-danger',
      bg: 'bg-danger/5',
      trend: t('saas.stable'),
      isPositive: true
    },
  ], [tenants, mrr, arr, activeTenantsCount, tenantsGrowth, t, i18n.language]);

  // Realistic historical chart dataset calculated on real subscription join dates
  const displayRevenueData = useMemo(() => {
    const monthsNames = [
      t('common.months.january'), t('common.months.february'), t('common.months.march'),
      t('common.months.may'), t('common.months.june'), t('common.months.july'),
      t('common.months.august'), t('common.months.september'), t('common.months.october'),
      t('common.months.november'), t('common.months.december')
    ];
    
    const chart = [];
    const now = new Date();
    
    // Sort tenants by creation date
    const sortedTenants = [...tenants].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mIndex = d.getMonth();
      const year = d.getFullYear();
      
      // Calculate active MRR up to that specific historical month boundary
      const activeUpToMonth = sortedTenants.filter(t => {
        const created = new Date(t.createdAt);
        return created <= new Date(year, mIndex + 1, 0) && (t.status === 'active' || t.status === 'onboarding');
      });

      const monthlyMrr = activeUpToMonth.reduce((acc, t) => {
        const plan = plansList.find(p => p.id === t.planId);
        return acc + (plan?.price || 0);
      }, 0);

      chart.push({
        name: monthsNames[mIndex] || `M${mIndex + 1}`,
        mrr: monthlyMrr,
      });
    }
    return chart;
  }, [tenants, plansList, t]);

  // Distribution chart
  const planDistribution = useMemo(() => {
    return plansList.map((plan, idx) => ({
      name: plan.name,
      value: tenants.filter(t => t.planId === plan.id).length,
      // 4th entry (purple) has no matching semantic token -- kept literal for a
      // variable-length plan list where each slice needs a distinct hue.
      color: ['var(--brand)', 'var(--success)', 'var(--warning)', '#8b5cf6', 'var(--danger)'][idx % 5]
    })).filter(p => p.value > 0);
  }, [tenants, plansList]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[450px] gap-4">
        <div className="relative w-14 h-14">
          <div className="absolute inset-0 rounded-full border-4 border-brand/20"></div>
          <div className="absolute inset-0 rounded-full border-4 border-brand border-t-transparent animate-spin"></div>
        </div>
        <p className="text-content-muted text-sm font-black animate-pulse">
          {t('saas.loading_console', 'جاري تحميل لوحة التحكم...')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 font-sans" dir={isRtl ? 'rtl' : 'ltr'}>
      
      {/* Visual Elegant Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-border/60">
        <div>
          <h2 className="text-3xl font-black text-content tracking-tight">{t('saas.platform_dashboard_title', 'لوحة تحكم المنصة 🚀')}</h2>
          <p className="text-content-muted font-bold mt-1 text-sm">
            {t('saas.console_welcome_line', { name: userName, count: tenants.length })}
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="hidden lg:flex items-center gap-2 px-4 py-2 bg-success/5 border border-success/10 rounded-2xl">
            <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
            <span className="text-[10px] font-black text-success uppercase tracking-widest leading-none">
              {t('saas.engine_status_stable')}
            </span>
          </div>
          <button
            onClick={fetchData}
            className="flex items-center gap-2 p-3 bg-surface border border-border text-content hover:bg-surface-muted rounded-xl shadow-sm transition-all cursor-pointer"
            title={t('saas.refresh_data')}
            aria-label={t('saas.refresh_data')}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Advanced Tabs Controller */}
      <div className="w-full overflow-x-auto scrollbar-none pb-1 -mb-1">
        <div className="flex gap-1.5 bg-surface p-1.5 rounded-2xl border border-border/80 shadow-sm w-max">
          {[
            { id: 'overview', label: t('saas.overview', 'الرئيسية'), icon: LayoutDashboard },
            { id: 'financials', label: t('saas.financials', 'المالية'), icon: DollarSign },
            { id: 'performance', label: t('saas.performance', 'الأداء والتشغيل'), icon: Server },
            { id: 'security', label: t('saas.security', 'الأمان والتدقيق'), icon: Shield },
            { id: 'plans', label: t('saas.menu_plans', 'الباقات'), icon: CreditCard },
            { id: 'coupons', label: t('saas.menu_coupons', 'كوبونات الخصم'), icon: Tag },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={cn(
                "flex items-center gap-2 px-4 sm:px-6 py-2.5 sm:py-3 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap",
                activeTab === tab.id 
                  ? "bg-brand text-white shadow-md shadow-brand/15" 
                  : "text-content-muted hover:bg-surface-muted hover:text-content"
              )}
            >
              <tab.icon size={15} className="shrink-0" />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait">
        
        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-8"
          >
            {/* KPI grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {stats.map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="bg-surface p-6 rounded-2xl border border-border shadow-sm transition-all group relative overflow-hidden"
                >
                  <div className="flex justify-between items-start mb-5">
                    <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform", stat.bg, stat.color)}>
                      <stat.icon size={22} />
                    </div>
                    <div className={cn(
                      "flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black",
                      stat.isPositive ? "bg-success/5 text-success" : "bg-danger/5 text-danger"
                    )}>
                      {stat.isPositive ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                      <span>{stat.trend}</span>
                    </div>
                  </div>
                  <div className="text-2xl font-black text-content mb-1 tracking-tight">{stat.value}</div>
                  <div className="text-xs font-bold text-content-muted">{stat.label}</div>
                </motion.div>
              ))}
            </div>

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              
              {/* MRR Timeline Chart */}
              <div className="lg:col-span-2 bg-surface p-8 rounded-2xl border border-border shadow-sm">
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h3 className="text-lg font-black text-content flex items-center gap-2">
                      <TrendingUp className="text-brand" size={20} />
                      <span>{t('saas.recurring_revenue_growth', 'نمو الإيرادات المتكررة')}</span>
                    </h3>
                    <p className="text-content-muted font-bold text-xs mt-1">
                      {t('saas.mrr_chart_subtitle')}
                    </p>
                  </div>
                </div>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={displayRevenueData}>
                      <defs>
                        <linearGradient id="colorMrr" x1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--bg-brand)" stopOpacity={0.12}/>
                          <stop offset="95%" stopColor="var(--bg-brand)" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'var(--content-muted)', fontSize: 11, fontWeight: 700 }} dy={8} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--content-muted)', fontSize: 11, fontWeight: 700 }} dx={-8} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'var(--surface)', borderRadius: '16px', border: '1px solid var(--border)', padding: '12px', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.05)' }}
                        itemStyle={{ fontWeight: 800, fontSize: '13px' }}
                      />
                      <Area type="monotone" dataKey="mrr" name="MRR" stroke="var(--bg-brand)" strokeWidth={3} fillOpacity={1} fill="url(#colorMrr)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Plans Distribution Ring */}
              <div className="bg-surface p-8 rounded-2xl border border-border shadow-sm flex flex-col">
                <h3 className="text-lg font-black text-content mb-1 flex items-center gap-2">
                  <PieChartIcon className="text-brand" size={20} />
                  <span>{t('saas.plan_distribution', 'توزيع الباقات')}</span>
                </h3>
                <p className="text-content-muted font-bold text-xs mb-6">
                  {t('saas.plan_distribution_subtitle')}
                </p>
                
                <div className="flex-1 min-h-[220px] relative flex items-center justify-center">
                  <div className="absolute flex flex-col items-center">
                    <span className="text-xs text-content-muted font-black">{t('saas.active_short')}</span>
                    <span className="text-2xl font-black text-content mt-0.5">{activeTenantsCount}</span>
                  </div>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={planDistribution}
                        cx="50%"
                        cy="50%"
                        innerRadius={65}
                        outerRadius={90}
                        paddingAngle={6}
                        dataKey="value"
                      >
                        {planDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} strokeWidth={0} />
                        ))}
                      </Pie>
                      <Tooltip 
                         contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.05)' }}
                         itemStyle={{ fontWeight: 800, fontSize: '12px' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="space-y-2 mt-4">
                  {planDistribution.map((plan) => (
                    <div key={plan.name} className="flex items-center justify-between p-3 bg-surface-muted rounded-xl border border-border/40">
                      <div className="flex items-center gap-2.5">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: plan.color }} />
                        <span className="text-xs font-black text-content capitalize">{plan.name}</span>
                      </div>
                      <span className="text-xs font-black text-brand">{plan.value} {t('saas.tenant_count_label', 'عملاء')}</span>
                    </div>
                  ))}
                  {planDistribution.length === 0 && (
                    <div className="text-center text-xs text-content-muted font-bold py-4">
                      {t('saas.no_subscription_data')}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* FINANCIALS TAB */}
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
                { label: t('saas.arpu_label', 'ARPU (متوسط الدخل لكل مشترك)'), value: <PriceDisplay amount={arpu} />, icon: MousePointer2, color: 'text-info', bg: 'bg-info/5' },
                { label: t('saas.arr_label', 'ARR (الإيراد السنوي المتكرر)'), value: <PriceDisplay amount={arr} />, icon: TrendingUp, color: 'text-success', bg: 'bg-success/5' },
                { label: t('saas.kpi_ltv'), value: <PriceDisplay amount={ltv} />, icon: Activity, color: 'text-brand', bg: 'bg-brand/5' },
              ].map((m) => (
                <div key={m.label} className="bg-surface p-8 rounded-2xl border border-border shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                    <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", m.bg, m.color)}>
                      <m.icon size={20} />
                    </div>
                    <span className="text-xs font-black text-content-muted uppercase tracking-widest">{m.label}</span>
                  </div>
                  <div className="text-3xl font-black text-content tracking-tight">{m.value}</div>
                </div>
              ))}
            </div>

            {/* Plans comparison overview */}
            <div className="bg-surface p-8 rounded-2xl border border-border shadow-sm">
              <h3 className="text-lg font-black text-content mb-2">{t('saas.plans_performance_title')}</h3>
              <p className="text-content-muted font-bold text-xs mb-6">
                {t('saas.plans_performance_subtitle')}
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {plansList.map((plan) => {
                  const subscriberCount = tenants.filter(t => t.planId === plan.id && (t.status === 'active' || t.status === 'onboarding')).length;
                  const planmrr = subscriberCount * (plan.price || 0);
                  return (
                    <div key={plan.id} className="p-6 bg-surface-muted rounded-2xl border border-border flex flex-col justify-between">
                      <div>
                        <span className="text-[10px] font-black text-content-muted uppercase tracking-widest">Plan Name</span>
                        <h4 className="text-base font-black text-content mt-1 capitalize">{plan.name}</h4>
                        <div className="text-xs text-content-muted font-bold mt-2">
                          Price: <PriceDisplay amount={plan.price} /> / Mo
                        </div>
                      </div>
                      <div className="border-t border-border mt-6 pt-4 flex items-center justify-between">
                        <div>
                          <span className="text-[10px] font-black text-content-muted uppercase tracking-widest">{t('saas.kpi_active_subscribers')}</span>
                          <div className="text-base font-black text-content mt-0.5">{subscriberCount}</div>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] font-black text-content-muted uppercase tracking-widest">Monthly Yield</span>
                          <div className="text-base font-black text-success mt-0.5"><PriceDisplay amount={planmrr} /></div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}

        {/* PERFORMANCE & TELEMETRY TAB */}
        {activeTab === 'performance' && (
          <motion.div
            key="performance"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-8"
          >
            {/* Real measurement grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              
              {/* Latency measurement */}
              <div className="bg-surface p-6 rounded-2xl border border-border shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-start mb-4">
                    <span className="text-[10px] font-black text-content-muted uppercase tracking-widest leading-none">Database Latency</span>
                    <button
                      disabled={testingLatency}
                      onClick={measureLatency}
                      className="p-1 text-brand hover:bg-brand/5 rounded-lg transition-all cursor-pointer"
                      title="Measure Latency Now"
                      aria-label="Measure Latency Now"
                    >
                      <RefreshCw size={14} className={cn(testingLatency && "animate-spin")} />
                    </button>
                  </div>
                  <div className="text-3xl font-black text-success tracking-tight">
                    {dbLatency ? `${dbLatency}ms` : '---'}
                  </div>
                </div>
                <div className="w-full bg-surface-muted h-1.5 rounded-full overflow-hidden mt-4">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: dbLatency ? `${Math.min(100, (dbLatency / 300) * 100)}%` : '0%' }}
                    className="h-full bg-success" 
                  />
                </div>
                <span className="text-[10px] font-bold text-content-muted mt-2">Real round-trip query performance</span>
              </div>

              {[
                { label: 'CPU Engine Load', value: '11.8%', progress: 12, color: 'text-info', bg: 'bg-info' },
                { label: 'Uptime (30-day index)', value: '99.98%', progress: 99.9, color: 'text-warning', bg: 'bg-warning' },
                { label: 'Active API Traffic', value: '1.4k requests/m', progress: 34, color: 'text-brand', bg: 'bg-brand' },
              ].map((p, i) => (
                <div key={i} className="bg-surface p-6 rounded-2xl border border-border shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start mb-4">
                      <span className="text-[10px] font-black text-content-muted uppercase tracking-widest leading-none">{p.label}</span>
                    </div>
                    <div className={cn("text-3xl font-black tracking-tight", p.color)}>
                      {p.value}
                    </div>
                  </div>
                  <div className="w-full bg-surface-muted h-1.5 rounded-full overflow-hidden mt-4">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${p.progress}%` }}
                      className={cn("h-full", p.bg)} 
                    />
                  </div>
                  <span className="text-[10px] font-bold text-content-muted mt-2">Simulated telemetry sensor</span>
                </div>
              ))}
            </div>

            {/* System logs flow */}
            <div className="bg-surface p-8 rounded-2xl border border-border shadow-sm">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h3 className="text-lg font-black text-content flex items-center gap-2">
                    <History className="text-brand" size={20} />
                    <span>{t('saas.system_activity_log', 'سجل نشاط النظام التفصيلي')}</span>
                  </h3>
                  <p className="text-content-muted font-bold text-xs mt-1">
                    {t('saas.activity_log_subtitle')}
                  </p>
                </div>
              </div>
              
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                {activityLogs.map((log) => (
                  <div key={log.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 bg-surface-muted/30 rounded-xl border border-border/80 group hover:border-brand/20 transition-all gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-brand/5 text-brand rounded-lg flex items-center justify-center shrink-0">
                        <Activity size={16} />
                      </div>
                      <div>
                        <div className="text-xs font-black text-content">
                          <Trans
                            i18nKey="saas.activity_log_entry"
                            values={{ staff: log.staffName, action: log.action }}
                            components={{ s: <span className="text-brand font-black" />, a: <span className="text-success font-black" /> }}
                          />
                        </div>
                        <p className="text-[10px] text-content-muted font-bold mt-1 leading-none">{log.details}</p>
                      </div>
                    </div>
                    <div className="text-right rtl:text-right ltr:text-left shrink-0">
                      <span className="text-[9px] font-black text-content-muted uppercase tracking-wider block">
                        {new Date(log.timestamp || '').toLocaleTimeString(localeOf(i18n.language))}
                      </span>
                      <span className="text-[9px] font-bold text-brand mt-1 uppercase tracking-wider block">
                        Shop ID: {log.tenantId}
                      </span>
                    </div>
                  </div>
                ))}
                {activityLogs.length === 0 && (
                  <div className="text-center py-8 text-xs text-content-muted font-bold">
                    {t('saas.no_activity_logs')}
                  </div>
                )}
              </div>

              {activityLogsTotal > ACTIVITY_PAGE_SIZE && (
                <div className="flex items-center justify-between pt-4 mt-4 border-t border-border/60">
                  <button
                    disabled={activityPage === 0}
                    onClick={() => setActivityPage(p => Math.max(0, p - 1))}
                    className="px-3 py-1.5 rounded-xl text-xs font-black bg-surface-muted hover:bg-border disabled:opacity-40 disabled:cursor-not-allowed text-content-muted transition-all cursor-pointer"
                  >
                    {t('saas.pagination_prev', 'السابق')}
                  </button>
                  <span className="text-[10px] font-black text-content-muted uppercase tracking-wider">
                    {t('saas.pagination_page_of', { page: activityPage + 1, total: Math.max(1, Math.ceil(activityLogsTotal / ACTIVITY_PAGE_SIZE)) })}
                  </span>
                  <button
                    disabled={(activityPage + 1) * ACTIVITY_PAGE_SIZE >= activityLogsTotal}
                    onClick={() => setActivityPage(p => p + 1)}
                    className="px-3 py-1.5 rounded-xl text-xs font-black bg-surface-muted hover:bg-border disabled:opacity-40 disabled:cursor-not-allowed text-content-muted transition-all cursor-pointer"
                  >
                    {t('saas.pagination_next', 'التالي')}
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* SECURITY TAB */}
        {activeTab === 'security' && (
          <motion.div
            key="security"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-8"
          >
            {/* Security Alert Header */}
            <div className="bg-danger/5 p-8 rounded-2xl border border-danger/10 flex flex-col md:flex-row items-start md:items-center gap-6">
              <div className="w-16 h-16 bg-danger/10 text-danger rounded-2xl flex items-center justify-center shrink-0">
                <Shield size={32} />
              </div>
              <div>
                <h3 className="text-lg font-black text-danger mb-1">{t('saas.security_center_title', 'مركز مراقبة الأمان والنزاهة')}</h3>
                <p className="text-danger/80 font-bold leading-relaxed max-w-2xl text-xs">
                  {t('saas.security_center_desc', 'هذا القسم مخصص لمراقبة الأحداث الأمنية، محاولات الدخول، وتعديلات البيانات الحساسة على مستوى المنصة ككل. أي تغيير في هذا القسم يتم توثيقه في سجل التدقيق الأبدي.')}
                </p>
              </div>
            </div>

            {/* Audit list and search filters */}
            <div className="bg-surface p-8 rounded-2xl border border-border shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-base font-black text-content flex items-center gap-2">
                    <Lock className="text-danger" size={18} />
                    <span>{t('saas.audit_logs_label', 'سجل التدقيق (Audit Logs)')}</span>
                  </h3>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <IconInput
                    type="text"
                    startIcon={Search}
                    placeholder={t('saas.search_audit_placeholder')}
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    containerClassName="w-full sm:w-64"
                  />

                  <SmartSelect
                    value={auditTypeFilter}
                    onChange={(v) => setAuditTypeFilter(v)}
                    className="w-auto min-w-[160px] rounded-xl px-3 py-2 text-xs"
                    options={[
                      { value: 'all', label: t('saas.audit_filter_all_types') },
                      { value: 'security', label: t('saas.audit_filter_security') },
                      { value: 'deletion', label: t('common.delete') },
                      { value: 'system', label: t('saas.audit_filter_system') },
                    ]}
                  />
                </div>
              </div>

              <div className="space-y-3">
                {auditLogs.map((log) => (
                  <div key={log.id} className="flex items-start gap-4 p-5 bg-surface-muted/20 rounded-2xl border border-border border-r-4 border-r-rose-400">
                    <div className="p-2 bg-danger/10 text-danger rounded-lg shrink-0 mt-0.5">
                      <AlertCircle size={14} />
                    </div>
                    <div className="flex-1">
                      <div className="text-xs font-black text-content">
                        {log.action} - <span className="text-danger font-bold">{log.performedByEmail}</span>
                      </div>
                      <p className="text-[10px] text-content-muted font-bold mt-1">{log.details}</p>
                      <div className="mt-3 flex items-center gap-3">
                        <span className="text-[9px] font-black text-content-muted uppercase tracking-wider">
                          {new Date(log.timestamp).toLocaleString(localeOf(i18n.language))}
                        </span>
                        <span className="w-1 h-1 bg-border rounded-full" />
                        <span className="text-[9px] font-black text-danger uppercase tracking-wider">{t('common.type')}: {log.type}</span>
                      </div>
                    </div>
                  </div>
                ))}
                {auditLogs.length === 0 && (
                  <div className="text-center py-8 text-xs text-content-muted font-bold">
                    {t('saas.no_matching_audit_records')}
                  </div>
                )}
              </div>

              {auditLogsTotal > AUDIT_PAGE_SIZE && (
                <div className="flex items-center justify-between pt-4 mt-4 border-t border-border/60">
                  <button
                    disabled={auditPage === 0}
                    onClick={() => setAuditPage(p => Math.max(0, p - 1))}
                    className="px-3 py-1.5 rounded-xl text-xs font-black bg-surface-muted hover:bg-border disabled:opacity-40 disabled:cursor-not-allowed text-content-muted transition-all cursor-pointer"
                  >
                    {t('saas.pagination_prev', 'السابق')}
                  </button>
                  <span className="text-[10px] font-black text-content-muted uppercase tracking-wider">
                    {t('saas.pagination_page_of', { page: auditPage + 1, total: Math.max(1, Math.ceil(auditLogsTotal / AUDIT_PAGE_SIZE)) })}
                  </span>
                  <button
                    disabled={(auditPage + 1) * AUDIT_PAGE_SIZE >= auditLogsTotal}
                    onClick={() => setAuditPage(p => p + 1)}
                    className="px-3 py-1.5 rounded-xl text-xs font-black bg-surface-muted hover:bg-border disabled:opacity-40 disabled:cursor-not-allowed text-content-muted transition-all cursor-pointer"
                  >
                    {t('saas.pagination_next', 'التالي')}
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* PLANS TAB */}
        {activeTab === 'plans' && (
          <motion.div
            key="plans"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            <div className="bg-surface p-6 rounded-2xl border border-border shadow-sm flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-content">{t('saas.plans_tab_title')}</h3>
                <p className="text-content-muted font-bold text-xs mt-1">{t('saas.plans_tab_subtitle')}</p>
              </div>
              <button
                onClick={() => setPlanModalMode('create')}
                className="bg-brand text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-brand/90 transition-all cursor-pointer"
              >
                {t('saas.plans_new_button')}
              </button>
            </div>

            <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-muted text-[10px] font-black text-content-muted uppercase tracking-widest border-b border-border">
                    <th className="p-4 text-start">{t('saas.plans_col_name')}</th>
                    <th className="p-4 text-center">{t('saas.plans_col_price')}</th>
                    <th className="p-4 text-center">{t('saas.plans_col_max_staff')}</th>
                    <th className="p-4 text-center">{t('saas.plans_col_max_orders')}</th>
                    <th className="p-4 text-center">{t('saas.plans_col_features')}</th>
                    <th className="p-4 text-center">{t('saas.plans_col_status')}</th>
                    <th className="p-4 text-center">{t('saas.plans_col_actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {plansList.map((plan) => (
                    <tr key={plan.id}>
                      <td className="p-4 font-bold text-content">{plan.name}</td>
                      <td className="p-4 text-center font-mono"><PriceDisplay amount={plan.price} /></td>
                      <td className="p-4 text-center font-mono">{plan.max_staff}</td>
                      <td className="p-4 text-center">
                        <span className="font-mono">{plan.max_orders}</span>
                        <span className="block text-[9px] text-content-muted font-bold mt-0.5">{t('saas.plans_max_orders_hint')}</span>
                      </td>
                      <td className="p-4 text-center text-content-muted font-bold">{(plan.features || []).length}</td>
                      <td className="p-4 text-center">
                        <button
                          onClick={() => handleTogglePlanActive(plan)}
                          className={cn(
                            "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wide cursor-pointer",
                            plan.is_active ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
                          )}
                        >
                          {plan.is_active ? t('saas.plans_status_active') : t('saas.plans_status_inactive')}
                        </button>
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => { setEditingPlan(plan); setPlanModalMode('edit'); }}
                            className="p-2 text-content-muted hover:text-content bg-surface-muted hover:bg-border rounded-xl transition-all cursor-pointer"
                          >
                            <Settings size={14} />
                          </button>
                          <button
                            onClick={() => handleDeletePlan(plan)}
                            className="p-2 text-content-muted hover:text-danger bg-surface-muted hover:bg-danger/10 rounded-xl transition-all cursor-pointer"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}

        {/* COUPONS TAB */}
        {activeTab === 'coupons' && (
          <motion.div
            key="coupons"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            <div className="bg-surface p-6 rounded-2xl border border-border shadow-sm flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-content">{t('saas.coupons_tab_title', 'كوبونات الخصم')}</h3>
                <p className="text-content-muted font-bold text-xs mt-1">{t('saas.coupons_tab_subtitle', 'أنشئ كود خصم تعطيه لعميل عند الاتفاق على تخفيض سعر اشتراكه')}</p>
              </div>
              <button
                onClick={() => setCouponModalOpen(true)}
                className="bg-brand text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-brand/90 transition-all cursor-pointer"
              >
                {t('saas.coupons_new_button', 'كوبون جديد')}
              </button>
            </div>

            <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-muted text-[10px] font-black text-content-muted uppercase tracking-widest border-b border-border">
                    <th className="p-4 text-start">{t('saas.coupons_col_code', 'الكود')}</th>
                    <th className="p-4 text-center">{t('saas.coupons_col_discount', 'الخصم')}</th>
                    <th className="p-4 text-center">{t('saas.coupons_col_restriction', 'مخصَّص لـ')}</th>
                    <th className="p-4 text-center">{t('saas.coupons_col_usage', 'الاستخدام')}</th>
                    <th className="p-4 text-center">{t('saas.coupons_col_expiry', 'الانتهاء')}</th>
                    <th className="p-4 text-center">{t('saas.plans_col_status', 'الحالة')}</th>
                    <th className="p-4 text-center">{t('saas.plans_col_actions', 'إجراءات')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {couponsList.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-10 text-center text-content-muted font-bold text-sm">
                        {t('saas.coupons_empty', 'لا توجد كوبونات بعد')}
                      </td>
                    </tr>
                  )}
                  {couponsList.map((coupon) => {
                    const restrictedTenant = coupon.restricted_tenant_id
                      ? tenants.find((tn) => tn.id === coupon.restricted_tenant_id)
                      : null;
                    const restrictedPlan = coupon.plan_id
                      ? plansList.find((p) => p.id === coupon.plan_id)
                      : null;
                    const expired = !!coupon.expires_at && new Date(coupon.expires_at) < new Date();
                    return (
                      <tr key={coupon.id}>
                        <td className="p-4 font-mono font-black text-content dir-ltr">{coupon.code}</td>
                        <td className="p-4 text-center font-mono text-brand font-black">
                          {coupon.discount_type === 'percentage' ? `${coupon.discount_value}%` : <PriceDisplay amount={coupon.discount_value} />}
                        </td>
                        <td className="p-4 text-center text-xs font-bold text-content-muted">
                          {restrictedTenant ? restrictedTenant.name : t('saas.coupons_restriction_any_tenant', 'أي تاجر')}
                          {restrictedPlan && <span className="block text-[10px] mt-0.5">{restrictedPlan.name}</span>}
                        </td>
                        <td className="p-4 text-center font-mono">
                          {coupon.redemption_count}{coupon.max_redemptions != null ? ` / ${coupon.max_redemptions}` : ''}
                        </td>
                        <td className={cn("p-4 text-center text-xs font-bold", expired ? "text-danger" : "text-content-muted")}>
                          {coupon.expires_at ? new Date(coupon.expires_at).toLocaleDateString(localeOf(i18n.language)) : t('saas.coupons_no_expiry', 'بلا انتهاء')}
                        </td>
                        <td className="p-4 text-center">
                          <button
                            onClick={() => handleToggleCouponActive(coupon)}
                            disabled={updatingCouponId === coupon.id}
                            className={cn(
                              "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wide cursor-pointer disabled:opacity-50",
                              coupon.is_active ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
                            )}
                          >
                            {coupon.is_active ? t('saas.plans_status_active', 'فعّالة') : t('saas.plans_status_inactive', 'معطّلة')}
                          </button>
                        </td>
                        <td className="p-4 text-center">
                          <button
                            onClick={() => handleDeleteCoupon(coupon)}
                            disabled={updatingCouponId === coupon.id}
                            className="p-2 text-content-muted hover:text-danger bg-surface-muted hover:bg-danger/10 rounded-xl transition-all cursor-pointer disabled:opacity-50"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sticky Support Widget */}
      <div className="sticky bottom-6 z-20 flex justify-center w-full px-4">
        <div className="bg-white/95 backdrop-blur-md border border-border p-2 sm:p-3 rounded-2xl shadow-xl flex items-center justify-between sm:justify-start gap-2 sm:gap-3 ring-1 ring-black/5 w-full sm:w-auto max-w-md sm:max-w-none">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden sm:flex -space-x-4 pr-2 border-l border-border ml-2 rtl:border-l-0 rtl:border-r rtl:ml-0 rtl:mr-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="w-8 h-8 sm:w-10 sm:h-10 rounded-full border-2 border-surface bg-brand text-white flex items-center justify-center text-[10px] sm:text-xs font-black ring-2 ring-brand/10">
                  {i}
                </div>
              ))}
            </div>
            <div className="px-2 sm:px-4">
              <p className="text-[11px] sm:text-xs font-black text-content leading-tight">{t('saas.live_tech_support', 'دعم فني مباشر')}</p>
              <p className="text-[9px] sm:text-[10px] font-bold text-success leading-tight mt-0.5">{t('saas.active_now_green', 'متواجدون الآن')}</p>
            </div>
          </div>
          <button className="px-4 py-2.5 sm:px-8 sm:py-3 bg-brand text-white rounded-xl font-black text-[10px] sm:text-xs shadow-md shadow-brand/15 hover:scale-105 active:scale-95 transition-all cursor-pointer whitespace-nowrap shrink-0">
            {t('saas.open_support_ticket', 'فتح تذكرة')}
          </button>
        </div>
      </div>

      {planModalMode && (
        <PlanFormModal
          mode={planModalMode}
          plan={planModalMode === 'edit' ? editingPlan : null}
          onClose={() => { setPlanModalMode(null); setEditingPlan(null); }}
          onSaved={fetchData}
        />
      )}

      {couponModalOpen && (
        <CouponFormModal
          tenants={tenants}
          plans={plansList}
          onClose={() => setCouponModalOpen(false)}
          onSaved={fetchData}
        />
      )}
    </div>
  );
}

/**
 * docs/superpowers/plans/2026-10-20-plans-management.md (Task 3) --
 * create/edit modal for a single plans row. id is only editable on
 * create (immutable PK once tenants.plan_id can reference it).
 */
const PlanFormModal = ({
  mode,
  plan,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  plan: any | null;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const { t } = useTranslation();
  const { success: toastSuccess, handleError: toastHandleError } = useToast();

  const [id, setId] = useState(plan?.id || '');
  const [name, setName] = useState(plan?.name || '');
  const [price, setPrice] = useState(plan ? String(plan.price) : '0');
  const [maxStaff, setMaxStaff] = useState(plan ? String(plan.max_staff) : '1');
  const [maxOrders, setMaxOrders] = useState(plan ? String(plan.max_orders) : '0');
  const [features, setFeatures] = useState<string[]>(plan?.features?.length ? plan.features : ['']);
  const [isActive, setIsActive] = useState<boolean>(plan?.is_active ?? true);
  const [errors, setErrors] = useState<Partial<Record<PlanFormField, string>>>({});
  const [saving, setSaving] = useState(false);

  // Fresh-reviewer finding: errors used to render raw codes ("required",
  // "invalid") verbatim -- translate every code through one path, including
  // the duplicate-id case, which used to set a pre-translated string here
  // instead of a code like every other field.
  const fieldErrorText = (code?: string): string | undefined => {
    if (!code) return undefined;
    return t(code === 'duplicate_id' ? 'saas.plan_duplicate_id' : `saas.plan_error_${code}`);
  };

  const handleFeatureChange = (index: number, value: string) => {
    setFeatures((prev) => prev.map((f, i) => (i === index ? value : f)));
  };
  const handleFeatureRemove = (index: number) => {
    setFeatures((prev) => prev.filter((_, i) => i !== index));
  };
  const handleFeatureAdd = () => {
    setFeatures((prev) => [...prev, '']);
  };

  const handleSubmit = async () => {
    const input: PlanFormInput = { id, name, price, maxStaff, maxOrders };
    const result = validatePlanForm(input, mode === 'edit');
    if (!result.valid) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setSaving(true);

    const payload = {
      name: name.trim(),
      price: Number(price),
      max_staff: Number(maxStaff),
      max_orders: Number(maxOrders),
      features: features.map((f) => f.trim()).filter(Boolean),
      is_active: isActive,
    };

    if (mode === 'create') {
      const { error } = await supabase.from('plans').insert({ id, ...payload });
      if (error) {
        setSaving(false);
        if ((error as any).code === '23505') {
          setErrors({ id: 'duplicate_id' });
          return;
        }
        toastHandleError(error, t('saas.plan_save_failed'));
        return;
      }
      toastSuccess(t('saas.plan_create_success'));
    } else {
      const { error } = await supabase.from('plans').update(payload).eq('id', plan.id);
      if (error) {
        setSaving(false);
        toastHandleError(error, t('saas.plan_save_failed'));
        return;
      }
      toastSuccess(t('saas.plan_update_success'));
    }

    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        className="bg-surface w-full max-w-lg rounded-3xl shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-4 sm:p-6 border-b border-border flex justify-between items-center bg-surface-muted/50">
          <h2 className="text-lg font-black text-content">
            {t(mode === 'create' ? 'saas.plan_modal_title_create' : 'saas.plan_modal_title_edit')}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-surface rounded-full transition-colors">
            <X size={20} className="text-content-muted" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto">
          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-content-muted uppercase tracking-widest">{t('saas.plan_field_id')}</label>
            <input
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value)}
              readOnly={mode === 'edit'}
              className={cn(
                "w-full bg-surface border border-border rounded-xl px-3.5 py-2.5 text-sm font-bold outline-none",
                mode === 'edit' && "bg-surface-muted text-content-muted cursor-not-allowed",
                errors.id && "border-danger"
              )}
            />
            {mode === 'edit' && <p className="text-[10px] text-content-muted font-bold">{t('saas.plan_field_id_locked_hint')}</p>}
            {errors.id && <p className="text-[10px] text-danger font-bold">{fieldErrorText(errors.id)}</p>}
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-content-muted uppercase tracking-widest">{t('saas.plan_field_name')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={cn("w-full bg-surface border border-border rounded-xl px-3.5 py-2.5 text-sm font-bold outline-none", errors.name && "border-danger")}
            />
            {errors.name && <p className="text-[10px] text-danger font-bold">{fieldErrorText(errors.name)}</p>}
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-content-muted uppercase tracking-widest">{t('saas.plan_field_price')}</label>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className={cn("w-full bg-surface border border-border rounded-xl px-3.5 py-2.5 text-sm font-bold outline-none", errors.price && "border-danger")}
            />
            {errors.price && <p className="text-[10px] text-danger font-bold">{fieldErrorText(errors.price)}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-content-muted uppercase tracking-widest">{t('saas.plan_field_max_staff')}</label>
              <input
                type="number"
                value={maxStaff}
                onChange={(e) => setMaxStaff(e.target.value)}
                className={cn("w-full bg-surface border border-border rounded-xl px-3.5 py-2.5 text-sm font-bold outline-none", errors.maxStaff && "border-danger")}
              />
              <p className="text-[9px] text-content-muted font-bold">{t('saas.plan_field_max_staff_hint')}</p>
              {errors.maxStaff && <p className="text-[10px] text-danger font-bold">{fieldErrorText(errors.maxStaff)}</p>}
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-content-muted uppercase tracking-widest">{t('saas.plan_field_max_orders')}</label>
              <input
                type="number"
                value={maxOrders}
                onChange={(e) => setMaxOrders(e.target.value)}
                className={cn("w-full bg-surface border border-border rounded-xl px-3.5 py-2.5 text-sm font-bold outline-none", errors.maxOrders && "border-danger")}
              />
              <p className="text-[9px] text-content-muted font-bold">{t('saas.plan_field_max_orders_hint')}</p>
              {errors.maxOrders && <p className="text-[10px] text-danger font-bold">{fieldErrorText(errors.maxOrders)}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-content-muted uppercase tracking-widest">{t('saas.plan_field_features')}</label>
            <div className="space-y-2">
              {features.map((feature, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={feature}
                    onChange={(e) => handleFeatureChange(index, e.target.value)}
                    placeholder={t('saas.plan_feature_placeholder')}
                    className="flex-1 bg-surface border border-border rounded-xl px-3.5 py-2 text-sm font-bold outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleFeatureRemove(index)}
                    className="p-2 text-content-muted hover:text-danger bg-surface-muted hover:bg-danger/10 rounded-xl transition-all cursor-pointer shrink-0"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={handleFeatureAdd}
              className="flex items-center gap-1.5 text-xs font-bold text-brand hover:text-brand/80 transition-colors mt-1"
            >
              <Plus size={14} />
              {t('saas.plan_feature_add')}
            </button>
          </div>

          <div className="flex items-center justify-between bg-surface-muted p-3.5 rounded-xl border border-border">
            <label className="text-xs font-black text-content">{t('saas.plan_field_active')}</label>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              <div className="w-12 h-6 bg-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand"></div>
            </label>
          </div>
        </div>

        <div className="sticky bottom-0 shrink-0 p-4 sm:p-6 border-t border-border bg-surface flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-surface-muted text-content hover:bg-surface border border-border rounded-xl font-bold text-sm transition-all cursor-pointer"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-6 py-2.5 bg-brand hover:bg-brand/90 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-brand/20 cursor-pointer disabled:opacity-60 disabled:cursor-wait"
          >
            {t('saas.plan_save')}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

/** الموظف (سوبر أدمن) يُنشئ كوبون خصم ليُعطيه لعميل عند التفاوض على
 * اشتراكه -- إما عام (restrictedTenantId فارغ) أو مخصَّص لتاجر واحد بعينه.
 * التحقق النهائي (الصلاحية، الحد، تاريخ الانتهاء) يحدث دوماً في
 * create_subscription_request على الخادم؛ هذا النموذج تحقق أساسي فقط. */
const CouponFormModal = ({
  tenants,
  plans,
  onClose,
  onSaved,
}: {
  tenants: Tenant[];
  plans: any[];
  onClose: () => void;
  onSaved: () => void;
}) => {
  const { t } = useTranslation();
  const { success: toastSuccess, handleError: toastHandleError } = useToast();

  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed'>('percentage');
  const [discountValue, setDiscountValue] = useState('10');
  const [restrictedTenantId, setRestrictedTenantId] = useState('');
  const [planId, setPlanId] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const discountTypeOptions = [
    { value: 'percentage', label: t('saas.coupon_field_type_percentage', 'نسبة %') },
    { value: 'fixed', label: t('saas.coupon_field_type_fixed', 'مبلغ ثابت (ر.س)') },
  ];
  const tenantOptions = [
    { value: '', label: t('saas.coupons_restriction_any_tenant', 'أي تاجر (كوبون عام)') },
    ...tenants.filter((tn) => !tn.trashedAt).map((tn) => ({ value: tn.id, label: tn.name })),
  ];
  const planOptions = [
    { value: '', label: t('saas.coupon_field_plan_any', 'كل الباقات') },
    ...plans.map((p) => ({ value: p.id, label: p.name })),
  ];

  const handleSubmit = async () => {
    const value = Number(discountValue);
    if (!value || value <= 0) {
      setError(t('saas.coupon_error_value_required', 'أدخل قيمة خصم أكبر من صفر'));
      return;
    }
    if (discountType === 'percentage' && value > 100) {
      setError(t('saas.coupon_error_percentage_max', 'نسبة الخصم لا يمكن أن تتجاوز 100%'));
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await createCoupon({
        code: code.trim() || undefined,
        discount_type: discountType,
        discount_value: value,
        restricted_tenant_id: restrictedTenantId || null,
        plan_id: planId || null,
        max_redemptions: maxRedemptions ? Number(maxRedemptions) : null,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        notes: notes.trim() || null,
      });
      toastSuccess(t('saas.coupon_create_success', 'تم إنشاء الكوبون'));
      onSaved();
      onClose();
    } catch (err) {
      toastHandleError(err, t('saas.coupon_create_failed', 'تعذّر إنشاء الكوبون'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        className="bg-surface w-full max-w-lg rounded-3xl shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-4 sm:p-6 border-b border-border flex justify-between items-center bg-surface-muted/50">
          <h2 className="text-lg font-black text-content">{t('saas.coupon_modal_title', 'كوبون خصم جديد')}</h2>
          <button onClick={onClose} className="p-2 hover:bg-surface rounded-full transition-colors">
            <X size={20} className="text-content-muted" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto">
          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-content-muted uppercase tracking-widest">{t('saas.coupon_field_code', 'الكود')}</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t('saas.coupon_field_code_placeholder', 'اتركه فارغاً لإنشاء كود تلقائي')}
              className="w-full bg-surface border border-border rounded-xl px-3.5 py-2.5 text-sm font-bold outline-none dir-ltr text-left"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-content-muted uppercase tracking-widest">{t('saas.coupon_field_discount_type', 'نوع الخصم')}</label>
              <SmartSelect options={discountTypeOptions} value={discountType} onChange={(v) => setDiscountType(v as 'percentage' | 'fixed')} />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-content-muted uppercase tracking-widest">{t('saas.coupon_field_discount_value', 'القيمة')}</label>
              <input
                type="number"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                className="w-full bg-surface border border-border rounded-xl px-3.5 py-2.5 text-sm font-bold outline-none"
              />
            </div>
          </div>
          {error && <p className="text-[11px] text-danger font-bold">{error}</p>}

          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-content-muted uppercase tracking-widest">{t('saas.coupon_field_tenant', 'مخصَّص لتاجر (اختياري)')}</label>
            <SmartSelect options={tenantOptions} value={restrictedTenantId} onChange={setRestrictedTenantId} searchPlaceholder={t('common.search')} />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-content-muted uppercase tracking-widest">{t('saas.coupon_field_plan', 'مخصَّص لباقة (اختياري)')}</label>
            <SmartSelect options={planOptions} value={planId} onChange={setPlanId} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-content-muted uppercase tracking-widest">{t('saas.coupon_field_max_redemptions', 'الحد الأقصى للاستخدام')}</label>
              <input
                type="number"
                value={maxRedemptions}
                onChange={(e) => setMaxRedemptions(e.target.value)}
                placeholder={t('saas.coupon_field_unlimited', 'بلا حد')}
                className="w-full bg-surface border border-border rounded-xl px-3.5 py-2.5 text-sm font-bold outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-content-muted uppercase tracking-widest">{t('saas.coupon_field_expiry', 'تاريخ الانتهاء')}</label>
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full bg-surface border border-border rounded-xl px-3.5 py-2.5 text-sm font-bold outline-none"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-content-muted uppercase tracking-widest">{t('saas.coupon_field_notes', 'ملاحظة داخلية (اختياري)')}</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('saas.coupon_field_notes_placeholder', 'مثال: خصم مكالمة مع فاطمة - عرض رمضان')}
              className="w-full bg-surface border border-border rounded-xl px-3.5 py-2.5 text-sm font-bold outline-none resize-none"
            />
          </div>
        </div>

        <div className="sticky bottom-0 shrink-0 p-4 sm:p-6 border-t border-border bg-surface flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-surface-muted text-content hover:bg-surface border border-border rounded-xl font-bold text-sm transition-all cursor-pointer"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-6 py-2.5 bg-brand hover:bg-brand/90 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-brand/20 cursor-pointer disabled:opacity-60 disabled:cursor-wait"
          >
            {t('saas.coupon_save', 'إنشاء الكوبون')}
          </button>
        </div>
      </motion.div>
    </div>
  );
};
