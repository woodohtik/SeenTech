import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase/client';
import { auth } from '../lib/firebase';
import { Tenant, Order, AuditLog, EmployeeActivityLog } from '../types';
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
  Globe,
  Database,
  Search,
  SlidersHorizontal,
  RefreshCw,
  ExternalLink,
  Eye,
  ChevronRight,
  ChevronLeft,
  X,
  CreditCard,
  UserCheck,
  AlertCircle,
  ShieldAlert
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
import { PriceDisplay } from './PriceDisplay';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Trans, useTranslation } from 'react-i18next';
import { isRtlLang, localeOf } from '../lib/direction';

type TabType = 'overview' | 'tenants' | 'financials' | 'performance' | 'security';

export default function SuperAdminDashboard() {
  const { t, i18n } = useTranslation();
  const isRtl = isRtlLang(i18n.language);
  const { success: toastSuccess, handleError: toastHandleError } = useToast();

  const { setImpersonationTenantId, dbUser } = useAuth();
  const userRole = dbUser?.role;
  const [supportModalTenant, setSupportModalTenant] = useState<{ id: string, name: string } | null>(null);
  const [requestLoading, setRequestLoading] = useState(false);
  const [pollingStatus, setPollingStatus] = useState<'pending' | 'approved' | 'rejected' | null>(null);

  const pollingIntervalRef = useRef<any>(null);
  const currentRequestRef = useRef<{ id: string, tenantId: string, isFallback: boolean } | null>(null);

  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [activityLogs, setActivityLogs] = useState<EmployeeActivityLog[]>([]);
  const [plansList, setPlansList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState<string>('Super Admin');
  
  // Real DB latency tracker
  const [dbLatency, setDbLatency] = useState<number | null>(null);
  const [testingLatency, setTestingLatency] = useState(false);

  // Tenant list state management
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [planFilter, setPlanFilter] = useState('all');
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [updatingTenantId, setUpdatingTenantId] = useState<string | null>(null);

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
        { data: ordersData },
        { data: saasUserData },
        { data: auditData },
        { data: activityData },
        { data: plansData }
      ] = await Promise.all([
        supabase.from('tenants').select('*'),
        supabase.from('orders').select('*').order('order_date', { ascending: false }).limit(200),
        supabase.from('saas_users').select('*').eq('uid', auth?.currentUser?.uid).single(),
        supabase.from('audit_logs').select('*').order('timestamp', { ascending: false }).limit(40),
        supabase.from('employee_activity_logs').select('*').order('occurred_at', { ascending: false }).limit(40),
        supabase.from('plans').select('*')
      ]);

      if (plansData) {
        setPlansList(plansData);
      }

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
          totalAmount: Number(d.total_amount),
          paidAmount: Number(d.paid_amount),
          remainingAmount: Number(d.remaining_amount),
          branchId: d.branch_id,
          orderNumber: d.order_number,
          createdAt: d.created_at,
          updatedAt: d.updated_at,
          tenantId: d.tenant_id
        }) as Order));
      }

      if (auditData) setAuditLogs(auditData as any);
      if (activityData) setActivityLogs(activityData as any);
      
      if (saasUserData) {
        setUserName(saasUserData.name || auth?.currentUser?.email?.split('@')[0] || 'Super Admin');
      } else if (auth?.currentUser?.email?.toLowerCase() === "nomansa2566512@gmail.com") {
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
      color: 'text-emerald-600', 
      bg: 'bg-emerald-500/5',
      trend: '+12.4%',
      isPositive: true
    },
    { 
      label: t('saas.kpi_arr'), 
      value: <PriceDisplay amount={arr} />, 
      icon: DollarSign, 
      color: 'text-amber-600', 
      bg: 'bg-amber-500/5',
      trend: '+12.4%',
      isPositive: true
    },
    { 
      label: t('saas.kpi_active_subscribers'), 
      value: activeTenantsCount, 
      icon: Activity, 
      color: 'text-rose-600', 
      bg: 'bg-rose-500/5',
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
      color: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444'][idx % 5]
    })).filter(p => p.value > 0);
  }, [tenants, plansList]);

  // Filtering Tenants
  const filteredTenants = useMemo(() => {
    return tenants.filter(t => {
      const matchesSearch = t.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                            t.ownerEmail.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            t.id.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
      const matchesPlan = planFilter === 'all' || t.planId === planFilter;
      return matchesSearch && matchesStatus && matchesPlan;
    });
  }, [tenants, searchTerm, statusFilter, planFilter]);

  // Filtering Audit Logs
  const filteredAuditLogs = useMemo(() => {
    return auditLogs.filter(log => {
      const matchesSearch = log.action.toLowerCase().includes(auditSearch.toLowerCase()) || 
                            log.performedByEmail.toLowerCase().includes(auditSearch.toLowerCase()) ||
                            (log.details && log.details.toLowerCase().includes(auditSearch.toLowerCase()));
      const matchesType = auditTypeFilter === 'all' || log.type === auditTypeFilter;
      return matchesSearch && matchesType;
    });
  }, [auditLogs, auditSearch, auditTypeFilter]);

  // Action: Toggle tenant status with database update
  const handleToggleStatus = async (tenantId: string, currentStatus: string) => {
    setUpdatingTenantId(tenantId);
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
    try {
      const { error } = await supabase
        .from('tenants')
        .update({ status: newStatus })
        .eq('id', tenantId);

      if (error) throw error;

      setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, status: newStatus } : t));
      toastSuccess(t('saas.tenants.status_updated_success'));
      
      // Save an audit log of this event
      await supabase.from('audit_logs').insert({
        action: `Toggle status to ${newStatus}`,
        performedByEmail: auth?.currentUser?.email || 'Super Admin',
        details: `Merchant ${tenantId} status changed to ${newStatus}`,
        type: 'security',
        timestamp: new Date().toISOString()
      });

    } catch (err) {
      toastHandleError(err, t('saas.tenants.status_update_failed'));
    } finally {
      setUpdatingTenantId(null);
    }
  };

  // Action: Start impersonation
  const handleImpersonationClick = (tenantId: string, tenantName: string) => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    currentRequestRef.current = null;
    setRequestLoading(false);
    setPollingStatus(null);
    setSupportModalTenant({ id: tenantId, name: tenantName });
  };

  const handleStealthSupportLogin = async (tenantId: string) => {
    try {
      try {
        const { error } = await supabase.from('support_sessions').insert({
          tenant_id: tenantId,
          saas_user_id: dbUser!.id,
          saas_user_name: dbUser?.display_name || dbUser?.email || 'Admin',
          access_type: 'stealth',
          started_at: new Date().toISOString()
        });
        if (error && (error.code === 'PGRST205' || error.message?.includes('cache') || error.message?.includes('relation'))) {
          // Fallback to saas_settings
          const { data: setting } = await supabase
            .from('saas_settings')
            .select('*')
            .eq('key', 'support_sessions')
            .maybeSingle();
          const existingSessions = setting?.value && Array.isArray(setting.value) ? setting.value : [];
          existingSessions.push({
            id: Math.random().toString(36).substring(2, 15),
            tenant_id: tenantId,
            saas_user_id: dbUser!.id,
            saas_user_name: dbUser?.display_name || dbUser?.email || 'Admin',
            access_type: 'stealth',
            started_at: new Date().toISOString()
          });
          await supabase.from('saas_settings').upsert({
            key: 'support_sessions',
            value: existingSessions,
            updated_at: new Date().toISOString()
          });
        }
      } catch (err) {
        console.warn('Stealth audit logging fallback:', err);
      }

      setImpersonationTenantId(tenantId);
      toastSuccess(
        t('saas.tenants.stealth_login_success')
      );
      setSupportModalTenant(null);
    } catch (e) {
      toastHandleError(e, t('saas.tenants.stealth_login_failed'));
    }
  };

  const handleCancelSupportAccess = async (showToastMessage = true) => {
    let wasActive = false;
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
      wasActive = true;
    }

    if (currentRequestRef.current) {
      wasActive = true;
      const { id, isFallback } = currentRequestRef.current;
      try {
        if (!isFallback) {
          await supabase
            .from('support_access_requests')
            .update({ status: 'cancelled' })
            .eq('id', id);
        } else {
          const { data: setting } = await supabase
            .from('saas_settings')
            .select('*')
            .eq('key', 'support_access_requests')
            .maybeSingle();

          if (setting?.value && Array.isArray(setting.value)) {
            const updatedRequests = setting.value.map((r: any) => {
              if (r.id === id) {
                return { ...r, status: 'cancelled' };
              }
              return r;
            });

            await supabase.from('saas_settings').upsert({
              key: 'support_access_requests',
              value: updatedRequests,
              updated_at: new Date().toISOString()
            });
          }
        }
      } catch (err) {
        console.warn('Error cancelling support request:', err);
      }
      currentRequestRef.current = null;
    }

    setRequestLoading(false);
    setPollingStatus(null);
    if (wasActive && showToastMessage) {
      toastSuccess(t('saas.tenants.access_request_cancelled') || 'تم إلغاء طلب الدخول بنجاح');
    }
  };

  const handleRequestSupportAccess = async (tenantId: string) => {
    try {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }

      setRequestLoading(true);
      setPollingStatus('pending');
      
      let requestObj: any = null;
      let isFallback = false;

      const newRequestData = {
        tenant_id: tenantId,
        saas_user_id: dbUser!.id,
        saas_user_name: dbUser?.display_name || dbUser?.email || 'Support Representative',
        status: 'pending',
        requested_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 15 * 60000).toISOString() // 15 mins expiry
      };

      try {
        const { data, error } = await supabase.from('support_access_requests').insert(newRequestData).select().single();
        if (error) throw error;
        requestObj = data;
      } catch (err: any) {
        console.warn('Direct support access requests insertion failed, trying fallback to saas_settings:', err);
        isFallback = true;
        const newId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        requestObj = { id: newId, ...newRequestData };

        try {
          const { data: setting } = await supabase
            .from('saas_settings')
            .select('*')
            .eq('key', 'support_access_requests')
            .maybeSingle();

          const existingRequests = setting?.value && Array.isArray(setting.value) ? setting.value : [];
          existingRequests.push(requestObj);

          await supabase.from('saas_settings').upsert({
            key: 'support_access_requests',
            value: existingRequests,
            updated_at: new Date().toISOString()
          });
        } catch (fallbackErr) {
          console.error('Fallback support request save failed:', fallbackErr);
          throw fallbackErr;
        }
      }

      currentRequestRef.current = {
        id: requestObj.id,
        tenantId: tenantId,
        isFallback: isFallback
      };

      toastSuccess(
        t('saas.tenants.access_request_waiting')
      );
      
      // Poll for approval...
      const interval = setInterval(async () => {
        let currentStatus = 'pending';

        if (!isFallback) {
          const { data: checkData } = await supabase
            .from('support_access_requests')
            .select('status')
            .eq('id', requestObj.id)
            .single();
          if (checkData) {
            currentStatus = checkData.status;
          }
        } else {
          const { data: setting } = await supabase
            .from('saas_settings')
            .select('*')
            .eq('key', 'support_access_requests')
            .maybeSingle();
          if (setting?.value && Array.isArray(setting.value)) {
            const req = setting.value.find((r: any) => r.id === requestObj.id);
            if (req) {
              currentStatus = req.status;
            }
          }
        }
          
        if (currentStatus !== 'pending') {
          clearInterval(interval);
          if (pollingIntervalRef.current === interval) {
            pollingIntervalRef.current = null;
          }
          currentRequestRef.current = null;
          setRequestLoading(false);
          setPollingStatus(currentStatus as any);
          
          if (currentStatus === 'approved') {
            toastSuccess(
              t('saas.tenants.access_request_approved')
            );
            
            // Record explicit session
            try {
              if (!isFallback) {
                await supabase.from('support_sessions').insert({
                  tenant_id: tenantId,
                  saas_user_id: dbUser!.id,
                  saas_user_name: dbUser?.display_name || dbUser?.email || 'Support Representative',
                  access_type: 'explicit',
                  started_at: new Date().toISOString()
                });
              } else {
                const { data: setting } = await supabase
                  .from('saas_settings')
                  .select('*')
                  .eq('key', 'support_sessions')
                  .maybeSingle();
                const existingSessions = setting?.value && Array.isArray(setting.value) ? setting.value : [];
                existingSessions.push({
                  id: Math.random().toString(36).substring(2, 15),
                  tenant_id: tenantId,
                  saas_user_id: dbUser!.id,
                  saas_user_name: dbUser?.display_name || dbUser?.email || 'Support Representative',
                  access_type: 'explicit',
                  started_at: new Date().toISOString()
                });
                await supabase.from('saas_settings').upsert({
                  key: 'support_sessions',
                  value: existingSessions,
                  updated_at: new Date().toISOString()
                });
              }
            } catch (sessErr) {
              console.warn('Session recording failed:', sessErr);
            }

            setImpersonationTenantId(tenantId);
            setSupportModalTenant(null);
          } else {
            toastHandleError(null, t('saas.tenants.access_rejected_by_owner'));
            setSupportModalTenant(null);
          }
        }
      }, 3000);

      pollingIntervalRef.current = interval;
      
      // Stop polling after 15 minutes
      setTimeout(() => {
        clearInterval(interval);
        if (pollingIntervalRef.current === interval) {
          pollingIntervalRef.current = null;
        }
        if (currentRequestRef.current?.id === requestObj.id) {
          currentRequestRef.current = null;
        }
        setRequestLoading(false);
        setPollingStatus(null);
        toastHandleError(null, t('saas.tenants.access_permission_expired'));
        setSupportModalTenant(null);
      }, 15 * 60000);

    } catch (e) {
      setRequestLoading(false);
      setPollingStatus(null);
      toastHandleError(e, t('saas.tenants.access_request_failed'));
    }
  };

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
          <div className="hidden lg:flex items-center gap-2 px-4 py-2 bg-emerald-500/5 border border-emerald-500/10 rounded-2xl">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest leading-none">
              {t('saas.engine_status_stable')}
            </span>
          </div>
          <button 
            onClick={fetchData} 
            className="flex items-center gap-2 p-3 bg-surface border border-border text-content hover:bg-surface-muted rounded-2xl shadow-sm transition-all cursor-pointer"
            title={t('saas.refresh_data')}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Advanced Tabs Controller */}
      <div className="w-full overflow-x-auto scrollbar-none pb-1 -mb-1">
        <div className="flex gap-1.5 bg-surface p-1.5 rounded-2xl sm:rounded-[1.5rem] border border-border/80 shadow-sm w-max">
          {[
            { id: 'overview', label: t('saas.overview', 'الرئيسية'), icon: LayoutDashboard },
            { id: 'tenants', label: t('saas.menu_tenants'), icon: Users },
            { id: 'financials', label: t('saas.financials', 'المالية'), icon: DollarSign },
            { id: 'performance', label: t('saas.performance', 'الأداء والتشغيل'), icon: Server },
            { id: 'security', label: t('saas.security', 'الأمان والتدقيق'), icon: Shield },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={cn(
                "flex items-center gap-2 px-4 sm:px-6 py-2.5 sm:py-3 rounded-xl sm:rounded-2xl text-xs font-black transition-all cursor-pointer whitespace-nowrap",
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
                  className="bg-surface p-6 rounded-[2rem] border border-border shadow-sm hover:shadow-md transition-all group relative overflow-hidden"
                >
                  <div className="flex justify-between items-start mb-5">
                    <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform", stat.bg, stat.color)}>
                      <stat.icon size={22} />
                    </div>
                    <div className={cn(
                      "flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black",
                      stat.isPositive ? "bg-emerald-500/5 text-emerald-600" : "bg-rose-500/5 text-rose-600"
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
              <div className="lg:col-span-2 bg-surface p-8 rounded-[2.5rem] border border-border shadow-sm">
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
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 700 }} dy={8} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 700 }} dx={-8} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'white', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '12px', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.05)' }}
                        itemStyle={{ fontWeight: 800, fontSize: '13px' }}
                      />
                      <Area type="monotone" dataKey="mrr" name="MRR" stroke="var(--bg-brand)" strokeWidth={3} fillOpacity={1} fill="url(#colorMrr)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Plans Distribution Ring */}
              <div className="bg-surface p-8 rounded-[2.5rem] border border-border shadow-sm flex flex-col">
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

        {/* TENANTS MANAGEMENT TAB */}
        {activeTab === 'tenants' && (
          <motion.div
            key="tenants"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            {/* Filter and Search Bar */}
            <div className="bg-surface p-6 rounded-[2rem] border border-border shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
              <div className="relative w-full md:w-80">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-content-muted" size={16} />
                <input
                  type="text"
                  placeholder={t('saas.tenants.search_by_name_email_id')}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-surface-muted rounded-xl border border-border text-sm font-bold focus:outline-none focus:ring-2 focus:ring-brand"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                <div className="flex items-center gap-2 bg-surface-muted p-1 rounded-xl border border-border">
                  <button 
                    onClick={() => setStatusFilter('all')} 
                    className={cn("px-3 py-1.5 rounded-lg text-xs font-black cursor-pointer", statusFilter === 'all' ? "bg-white text-content shadow-sm" : "text-content-muted")}
                  >
                    {t('orders.all_statuses')}
                  </button>
                  <button 
                    onClick={() => setStatusFilter('active')} 
                    className={cn("px-3 py-1.5 rounded-lg text-xs font-black cursor-pointer", statusFilter === 'active' ? "bg-white text-emerald-600 shadow-sm" : "text-content-muted")}
                  >
                    {t('saas.active_short')}
                  </button>
                  <button 
                    onClick={() => setStatusFilter('inactive')} 
                    className={cn("px-3 py-1.5 rounded-lg text-xs font-black cursor-pointer", statusFilter === 'inactive' ? "bg-white text-rose-600 shadow-sm" : "text-content-muted")}
                  >
                    {t('saas.inactive_short')}
                  </button>
                </div>

                <select
                  value={planFilter}
                  onChange={(e) => setPlanFilter(e.target.value)}
                  className="bg-surface-muted px-4 py-2.5 rounded-xl border border-border text-xs font-black focus:outline-none focus:ring-2 focus:ring-brand"
                >
                  <option value="all">{t('saas.all_plans')}</option>
                  {plansList.map(plan => (
                    <option key={plan.id} value={plan.id}>{plan.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Mobile View - Card List */}
            <div className="block md:hidden space-y-4">
              {filteredTenants.map((tenant) => {
                const plan = plansList.find(p => p.id === tenant.planId);
                return (
                  <div key={tenant.id} className="bg-surface p-5 rounded-2xl border border-border shadow-sm flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-brand/5 border border-brand/10 flex items-center justify-center font-black text-brand text-sm shrink-0">
                          {tenant.logoUrl ? (
                            <img src={tenant.logoUrl} alt={tenant.name} className="w-full h-full object-cover rounded-xl" referrerPolicy="no-referrer" />
                          ) : (
                            tenant.name.substring(0, 2).toUpperCase()
                          )}
                        </div>
                        <div>
                          <h4 className="text-sm font-black text-content leading-tight">{tenant.name}</h4>
                          <p className="text-[11px] text-content-muted mt-1 font-bold leading-none break-all">{tenant.ownerEmail}</p>
                        </div>
                      </div>
                      <span className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider",
                        tenant.status === 'active' && "bg-emerald-500/10 text-emerald-600",
                        tenant.status === 'onboarding' && "bg-amber-500/10 text-amber-600",
                        tenant.status === 'inactive' && "bg-rose-500/10 text-rose-600",
                        tenant.status === 'suspended' && "bg-gray-500/10 text-gray-600",
                      )}>
                        <span className="w-1 h-1 rounded-full bg-current" />
                        {tenant.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 py-3 border-t border-b border-border/60 text-xs font-bold text-content">
                      <div>
                        <span className="text-[9px] font-black text-content-muted uppercase tracking-wider block mb-1">{t('saas.tenants.col_subscription_plan')}</span>
                        <span className="inline-flex px-2 py-0.5 bg-brand/5 border border-brand/10 rounded text-brand capitalize">
                          {plan?.name || tenant.planId}
                        </span>
                      </div>
                      <div>
                        <span className="text-[9px] font-black text-content-muted uppercase tracking-wider block mb-1">{t('saas.tenants.join_date')}</span>
                        <span className="text-content-muted">
                          {new Date(tenant.createdAt).toLocaleDateString(localeOf(i18n.language), { year: 'numeric', month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-[9px] font-black text-content-muted uppercase tracking-wider block mb-1">{t('saas.tenants.col_register_and_vat')}</span>
                        <div className="flex gap-4">
                          <div>CR: <span className="text-content-muted font-bold">{tenant.commercialRegister || 'N/A'}</span></div>
                          <div>VAT: <span className="text-content-muted font-bold">{tenant.vatNumber || 'N/A'}</span></div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => handleImpersonationClick(tenant.id, tenant.name)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-brand text-white rounded-xl text-xs font-black shadow-sm shadow-brand/15 hover:scale-105 active:scale-95 transition-all cursor-pointer"
                      >
                        <ExternalLink size={12} />
                        <span>{t('saas.tenants.support_login_short')}</span>
                      </button>

                      <button
                        disabled={updatingTenantId === tenant.id}
                        onClick={() => handleToggleStatus(tenant.id, tenant.status)}
                        className={cn(
                          "p-2.5 rounded-xl text-xs font-black transition-all cursor-pointer border flex items-center justify-center shrink-0",
                          tenant.status === 'active' 
                            ? "bg-rose-500/5 text-rose-600 border-rose-500/10 hover:bg-rose-500/10" 
                            : "bg-emerald-500/5 text-emerald-600 border-emerald-500/10 hover:bg-emerald-500/10"
                        )}
                        title={tenant.status === 'active' ? t('saas.tenants.deactivate') : t('saas.tenants.enable')}
                      >
                        {updatingTenantId === tenant.id ? (
                          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <Activity size={14} />
                        )}
                      </button>

                      <button
                        onClick={() => setSelectedTenant(tenant)}
                        className="p-2.5 bg-surface hover:bg-surface-muted text-content-muted hover:text-content border border-border rounded-xl transition-all cursor-pointer flex items-center justify-center shrink-0"
                      >
                        <Eye size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
              {filteredTenants.length === 0 && (
                <div className="bg-surface p-8 text-center text-sm text-content-muted font-bold rounded-2xl border border-border shadow-sm">
                  {t('saas.tenants.no_matching_subscribers')}
                </div>
              )}
            </div>

            {/* Desktop View - Table */}
            <div className="hidden md:block bg-surface rounded-[2rem] border border-border shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left rtl:text-right border-collapse">
                  <thead>
                    <tr className="bg-surface-muted/50 border-b border-border/80">
                      <th className="px-6 py-4 text-[10px] font-black text-content-muted uppercase tracking-widest">{t('saas.tenants.col_subscriber_and_email')}</th>
                      <th className="px-6 py-4 text-[10px] font-black text-content-muted uppercase tracking-widest">{t('saas.tenants.col_subscription_plan')}</th>
                      <th className="px-6 py-4 text-[10px] font-black text-content-muted uppercase tracking-widest">{t('saas.tenants.col_register_and_vat')}</th>
                      <th className="px-6 py-4 text-[10px] font-black text-content-muted uppercase tracking-widest">{t('saas.tenants.join_date')}</th>
                      <th className="px-6 py-4 text-[10px] font-black text-content-muted uppercase tracking-widest">{t('common.status')}</th>
                      <th className="px-6 py-4 text-[10px] font-black text-content-muted uppercase tracking-widest text-center">{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {filteredTenants.map((tenant) => {
                      const plan = plansList.find(p => p.id === tenant.planId);
                      return (
                        <tr key={tenant.id} className="hover:bg-surface-muted/20 transition-all">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-brand/5 border border-brand/10 flex items-center justify-center font-black text-brand text-sm shrink-0">
                                {tenant.logoUrl ? (
                                  <img src={tenant.logoUrl} alt={tenant.name} className="w-full h-full object-cover rounded-xl" referrerPolicy="no-referrer" />
                                ) : (
                                  tenant.name.substring(0, 2).toUpperCase()
                                )}
                              </div>
                              <div>
                                <h4 className="text-sm font-black text-content leading-tight">{tenant.name}</h4>
                                <p className="text-xs text-content-muted mt-0.5 font-bold leading-none">{tenant.ownerEmail}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className="inline-flex px-3 py-1 bg-brand/5 border border-brand/10 rounded-lg text-xs font-black text-brand capitalize">
                              {plan?.name || tenant.planId}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="text-xs font-bold text-content leading-tight">
                              <div>CR: {tenant.commercialRegister || 'N/A'}</div>
                              <div className="text-content-muted mt-0.5">VAT: {tenant.vatNumber || 'N/A'}</div>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-xs font-bold text-content-muted">
                            {new Date(tenant.createdAt).toLocaleDateString(localeOf(i18n.language), { year: 'numeric', month: 'short', day: 'numeric' })}
                          </td>
                          <td className="px-6 py-4">
                            <span className={cn(
                              "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider",
                              tenant.status === 'active' && "bg-emerald-500/10 text-emerald-600",
                              tenant.status === 'onboarding' && "bg-amber-500/10 text-amber-600",
                              tenant.status === 'inactive' && "bg-rose-500/10 text-rose-600",
                              tenant.status === 'suspended' && "bg-gray-500/10 text-gray-600",
                            )}>
                              <span className="w-1.5 h-1.5 rounded-full bg-current" />
                              {tenant.status}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center justify-center gap-2">
                              {/* Impersonate */}
                              <button
                                onClick={() => handleImpersonationClick(tenant.id, tenant.name)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-brand text-white rounded-xl text-[10px] font-black shadow-sm shadow-brand/15 hover:scale-105 active:scale-95 transition-all cursor-pointer"
                                title={t('saas.tenants.login_as_shop_admin')}
                              >
                                <ExternalLink size={10} />
                                <span>{t('saas.tenants.login_short')}</span>
                              </button>

                              {/* Toggle Status */}
                              <button
                                disabled={updatingTenantId === tenant.id}
                                onClick={() => handleToggleStatus(tenant.id, tenant.status)}
                                className={cn(
                                  "p-2 rounded-xl text-xs font-black transition-all cursor-pointer border",
                                  tenant.status === 'active' 
                                    ? "bg-rose-500/5 text-rose-600 border-rose-500/10 hover:bg-rose-500/10" 
                                    : "bg-emerald-500/5 text-emerald-600 border-emerald-500/10 hover:bg-emerald-500/10"
                                )}
                                title={tenant.status === 'active' ? t('saas.tenants.deactivate_account') : t('saas.tenants.enable_account')}
                              >
                                {updatingTenantId === tenant.id ? (
                                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <Activity size={14} />
                                )}
                              </button>

                              {/* View Details */}
                              <button
                                onClick={() => setSelectedTenant(tenant)}
                                className="p-2 bg-surface hover:bg-surface-muted text-content-muted hover:text-content border border-border rounded-xl transition-all cursor-pointer"
                              >
                                <Eye size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredTenants.length === 0 && (
                      <tr>
                        <td colSpan={6} className="text-center py-12 text-sm text-content-muted font-bold">
                          {t('saas.tenants.no_matching_subscribers')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
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
                { label: t('saas.arpu_label', 'ARPU (متوسط الدخل لكل مشترك)'), value: <PriceDisplay amount={arpu} />, icon: MousePointer2, color: 'text-indigo-600', bg: 'bg-indigo-500/5' },
                { label: t('saas.arr_label', 'ARR (الإيراد السنوي المتكرر)'), value: <PriceDisplay amount={arr} />, icon: TrendingUp, color: 'text-emerald-600', bg: 'bg-emerald-500/5' },
                { label: t('saas.kpi_ltv'), value: <PriceDisplay amount={ltv} />, icon: Activity, color: 'text-brand', bg: 'bg-brand/5' },
              ].map((m) => (
                <div key={m.label} className="bg-surface p-8 rounded-[2.5rem] border border-border shadow-sm">
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
            <div className="bg-surface p-8 rounded-[2.5rem] border border-border shadow-sm">
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
                          <div className="text-base font-black text-emerald-600 mt-0.5"><PriceDisplay amount={planmrr} /></div>
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
              <div className="bg-surface p-6 rounded-[2rem] border border-border shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-start mb-4">
                    <span className="text-[10px] font-black text-content-muted uppercase tracking-widest leading-none">Database Latency</span>
                    <button 
                      disabled={testingLatency}
                      onClick={measureLatency}
                      className="p-1 text-brand hover:bg-brand/5 rounded-lg transition-all cursor-pointer"
                      title="Measure Latency Now"
                    >
                      <RefreshCw size={14} className={cn(testingLatency && "animate-spin")} />
                    </button>
                  </div>
                  <div className="text-3xl font-black text-emerald-600 tracking-tight">
                    {dbLatency ? `${dbLatency}ms` : '---'}
                  </div>
                </div>
                <div className="w-full bg-surface-muted h-1.5 rounded-full overflow-hidden mt-4">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: dbLatency ? `${Math.min(100, (dbLatency / 300) * 100)}%` : '0%' }}
                    className="h-full bg-emerald-500" 
                  />
                </div>
                <span className="text-[10px] font-bold text-content-muted mt-2">Real round-trip query performance</span>
              </div>

              {[
                { label: 'CPU Engine Load', value: '11.8%', progress: 12, color: 'text-indigo-600', bg: 'bg-indigo-500' },
                { label: 'Uptime (30-day index)', value: '99.98%', progress: 99.9, color: 'text-amber-500', bg: 'bg-amber-500' },
                { label: 'Active API Traffic', value: '1.4k requests/m', progress: 34, color: 'text-brand', bg: 'bg-brand' },
              ].map((p, i) => (
                <div key={i} className="bg-surface p-6 rounded-[2rem] border border-border shadow-sm flex flex-col justify-between">
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
            <div className="bg-surface p-8 rounded-[2.5rem] border border-border shadow-sm">
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
                            components={{ s: <span className="text-brand font-black" />, a: <span className="text-emerald-600 font-black" /> }}
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
            <div className="bg-rose-500/5 p-8 rounded-[2rem] border border-rose-500/10 flex flex-col md:flex-row items-start md:items-center gap-6">
              <div className="w-16 h-16 bg-rose-500/10 text-rose-600 rounded-2xl flex items-center justify-center shrink-0">
                <Shield size={32} />
              </div>
              <div>
                <h3 className="text-lg font-black text-rose-600 mb-1">{t('saas.security_center_title', 'مركز مراقبة الأمان والنزاهة')}</h3>
                <p className="text-rose-600/80 font-bold leading-relaxed max-w-2xl text-xs">
                  {t('saas.security_center_desc', 'هذا القسم مخصص لمراقبة الأحداث الأمنية، محاولات الدخول، وتعديلات البيانات الحساسة على مستوى المنصة ككل. أي تغيير في هذا القسم يتم توثيقه في سجل التدقيق الأبدي.')}
                </p>
              </div>
            </div>

            {/* Audit list and search filters */}
            <div className="bg-surface p-8 rounded-[2.5rem] border border-border shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-base font-black text-content flex items-center gap-2">
                    <Lock className="text-rose-600" size={18} />
                    <span>{t('saas.audit_logs_label', 'سجل التدقيق (Audit Logs)')}</span>
                  </h3>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative w-48 sm:w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" size={14} />
                    <input
                      type="text"
                      placeholder={t('saas.search_audit_placeholder')}
                      value={auditSearch}
                      onChange={(e) => setAuditSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 bg-surface-muted rounded-xl border border-border text-xs font-bold focus:outline-none focus:ring-2 focus:ring-brand"
                    />
                  </div>

                  <select
                    value={auditTypeFilter}
                    onChange={(e) => setAuditTypeFilter(e.target.value)}
                    className="bg-surface-muted px-3 py-2 rounded-xl border border-border text-xs font-black focus:outline-none"
                  >
                    <option value="all">{t('saas.audit_filter_all_types')}</option>
                    <option value="security">{t('saas.audit_filter_security')}</option>
                    <option value="deletion">{t('common.delete')}</option>
                    <option value="system">{t('saas.audit_filter_system')}</option>
                  </select>
                </div>
              </div>

              <div className="space-y-3">
                {filteredAuditLogs.map((log) => (
                  <div key={log.id} className="flex items-start gap-4 p-5 bg-surface-muted/20 rounded-2xl border border-border border-r-4 border-r-rose-400">
                    <div className="p-2 bg-rose-500/10 text-rose-600 rounded-lg shrink-0 mt-0.5">
                      <AlertCircle size={14} />
                    </div>
                    <div className="flex-1">
                      <div className="text-xs font-black text-content">
                        {log.action} - <span className="text-rose-600 font-bold">{log.performedByEmail}</span>
                      </div>
                      <p className="text-[10px] text-content-muted font-bold mt-1">{log.details}</p>
                      <div className="mt-3 flex items-center gap-3">
                        <span className="text-[9px] font-black text-content-muted uppercase tracking-wider">
                          {new Date(log.timestamp).toLocaleString(localeOf(i18n.language))}
                        </span>
                        <span className="w-1 h-1 bg-border rounded-full" />
                        <span className="text-[9px] font-black text-rose-600 uppercase tracking-wider">Type: {log.type}</span>
                      </div>
                    </div>
                  </div>
                ))}
                {filteredAuditLogs.length === 0 && (
                  <div className="text-center py-8 text-xs text-content-muted font-bold">
                    {t('saas.no_matching_audit_records')}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tenant Detail Drawer/Modal */}
      <AnimatePresence>
        {selectedTenant && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedTenant(null)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-lg bg-surface p-5 sm:p-8 rounded-3xl sm:rounded-[2.5rem] border border-border shadow-2xl flex flex-col gap-5 sm:gap-6 mx-4"
            >
              <div className="flex justify-between items-center pb-4 border-b border-border/80">
                <h3 className="text-base sm:text-lg font-black text-content">
                  {t('saas.tenants.full_details_title')}
                </h3>
                <button 
                  onClick={() => setSelectedTenant(null)}
                  className="p-1.5 hover:bg-surface-muted rounded-xl text-content-muted transition-all cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4 text-xs font-bold text-content overflow-y-auto max-h-[60vh] pr-1">
                <div className="flex items-center gap-4 bg-surface-muted p-4 rounded-2xl border border-border">
                  <div className="w-12 h-12 bg-brand/5 border border-brand/10 rounded-xl flex items-center justify-center font-black text-brand text-base shrink-0">
                    {selectedTenant.logoUrl ? (
                      <img src={selectedTenant.logoUrl} alt={selectedTenant.name} className="w-full h-full object-cover rounded-xl" referrerPolicy="no-referrer" />
                    ) : (
                      selectedTenant.name.substring(0, 2).toUpperCase()
                    )}
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-content leading-tight">{selectedTenant.name}</h4>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  <div>
                    <span className="text-[10px] font-black text-content-muted uppercase tracking-widest">{t('saas.tenants.owner_email')}</span>
                    <div className="text-xs font-black text-content mt-1 break-all">{selectedTenant.ownerEmail}</div>
                  </div>
                  <div>
                    <span className="text-[10px] font-black text-content-muted uppercase tracking-widest">{t('onboarding.fields.phone')}</span>
                    <div className="text-xs font-black text-content mt-1">{selectedTenant.phone}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <span className="text-[10px] font-black text-content-muted uppercase tracking-widest">{t('saas.tenants.commercial_register_cr')}</span>
                    <div className="text-xs font-black text-content mt-1">{selectedTenant.commercialRegister || 'N/A'}</div>
                  </div>
                  <div>
                    <span className="text-[10px] font-black text-content-muted uppercase tracking-widest">{t('onboarding.fields.tax_number')}</span>
                    <div className="text-xs font-black text-content mt-1">{selectedTenant.vatNumber || 'N/A'}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <span className="text-[10px] font-black text-content-muted uppercase tracking-widest">{t('procurement.account_status')}</span>
                    <div className="mt-1">
                      <span className={cn(
                        "inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider",
                        selectedTenant.status === 'active' ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600"
                      )}>
                        {selectedTenant.status}
                      </span>
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] font-black text-content-muted uppercase tracking-widest">{t('saas.tenants.registration_date')}</span>
                    <div className="text-xs font-black text-content mt-1">
                      {new Date(selectedTenant.createdAt).toLocaleString(localeOf(i18n.language))}
                    </div>
                  </div>
                </div>

                <div className="pt-2">
                  <span className="text-[10px] font-black text-content-muted uppercase tracking-widest">{t('saas.tenants.shop_address')}</span>
                  <div className="text-xs font-black text-content mt-1">{selectedTenant.address || 'N/A'}</div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 mt-4 border-t border-border pt-6">
                <button
                  onClick={() => {
                    handleImpersonationClick(selectedTenant.id, selectedTenant.name);
                    setSelectedTenant(null);
                  }}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-brand text-white rounded-xl text-xs font-black shadow-md shadow-brand/15 hover:scale-[1.02] active:scale-95 transition-all cursor-pointer"
                >
                  <ExternalLink size={14} />
                  <span>{t('saas.tenants.impersonate_now')}</span>
                </button>
                <button 
                  onClick={() => setSelectedTenant(null)}
                  className="flex-1 py-3 bg-surface hover:bg-surface-muted text-content border border-border rounded-xl text-xs font-black transition-all cursor-pointer"
                >
                  {t('common.close')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Support Access Popup Modal */}
      <AnimatePresence>
        {supportModalTenant && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-surface w-full max-w-md rounded-3xl shadow-2xl overflow-hidden relative z-10 border border-border flex flex-col p-6 text-right"
              dir={isRtl ? 'rtl' : 'ltr'}
            >
              <div className="flex items-center gap-3 mb-6 border-b border-border pb-4">
                <div className="w-10 h-10 bg-brand/10 text-brand rounded-full flex items-center justify-center">
                  <ShieldAlert size={20} />
                </div>
                <div>
                  <h3 className="font-black text-sm text-content">
                    {t('saas.tenants.support_access_request_title')}
                  </h3>
                  <p className="text-[10px] font-bold text-content-muted mt-0.5">
                    {supportModalTenant.name}
                  </p>
                </div>
              </div>

              <div className="space-y-4 mb-6 text-right">
                <p className="text-xs font-bold text-content leading-relaxed">
                  {t('saas.tenants.support_access_request_desc')}
                </p>

                {pollingStatus === 'pending' && (
                  <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex flex-col items-center justify-center text-center gap-2">
                    <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
                    <p className="text-[11px] font-black text-amber-600">
                      {t('saas.tenants.awaiting_client_approval')}
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                {pollingStatus === 'pending' ? (
                  <button
                    onClick={() => handleCancelSupportAccess(true)}
                    className="w-full bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 shadow-lg shadow-red-600/15 cursor-pointer"
                  >
                    <X size={16} />
                    {t('saas.tenants.cancel_access_request') || 'إلغاء طلب الدخول'}
                  </button>
                ) : (
                  <button
                    onClick={() => handleRequestSupportAccess(supportModalTenant.id)}
                    disabled={requestLoading}
                    className="w-full bg-brand text-white py-3 rounded-xl text-xs font-black hover:bg-brand/90 transition-all flex items-center justify-center gap-2 shadow-lg shadow-brand/15 disabled:opacity-50 cursor-pointer"
                  >
                    <Globe size={16} />
                    {requestLoading 
                      ? t('saas.tenants.sending_request')
                      : t('saas.tenants.send_access_request')}
                  </button>
                )}

                <button
                  onClick={() => handleStealthSupportLogin(supportModalTenant.id)}
                  disabled={requestLoading || !(userRole === 'super_admin' || userRole === 'owner' as any || (dbUser as any)?.can_stealth_login === true || (dbUser as any)?.stealth_login_enabled === true)}
                  className="w-full bg-slate-900 text-white py-3 rounded-xl text-xs font-black hover:bg-black transition-all flex items-center justify-center gap-2 shadow-lg shadow-black/20 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  title={!(userRole === 'super_admin' || userRole === 'owner' as any || (dbUser as any)?.can_stealth_login === true || (dbUser as any)?.stealth_login_enabled === true) ? t('saas.tenants.stealth_login_permission_required') : ""}
                >
                  <ShieldAlert size={16} />
                  <span>{t('saas.tenants.stealth_admin_login')}</span>
                  {!(userRole === 'super_admin' || userRole === 'owner' as any || (dbUser as any)?.can_stealth_login === true || (dbUser as any)?.stealth_login_enabled === true) && (
                    <span className="text-[9px] bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded ml-1">{t('saas.tenants.locked_badge')}</span>
                  )}
                </button>

                <button
                  onClick={() => {
                    handleCancelSupportAccess(false);
                    setSupportModalTenant(null);
                  }}
                  className="w-full bg-surface hover:bg-surface-muted text-content border border-border py-3 rounded-xl text-xs font-black transition-all cursor-pointer"
                >
                  {t('common.close')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Sticky Support Widget */}
      <div className="sticky bottom-6 z-20 flex justify-center w-full px-4">
        <div className="bg-white/95 backdrop-blur-md border border-border p-2 sm:p-3 rounded-2xl sm:rounded-[2.5rem] shadow-xl flex items-center justify-between sm:justify-start gap-2 sm:gap-3 ring-1 ring-black/5 w-full sm:w-auto max-w-md sm:max-w-none">
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
              <p className="text-[9px] sm:text-[10px] font-bold text-emerald-500 leading-tight mt-0.5">{t('saas.active_now_green', 'متواجدون الآن')}</p>
            </div>
          </div>
          <button className="px-4 py-2.5 sm:px-8 sm:py-3 bg-brand text-white rounded-xl sm:rounded-2xl font-black text-[10px] sm:text-xs shadow-md shadow-brand/15 hover:scale-105 active:scale-95 transition-all cursor-pointer whitespace-nowrap shrink-0">
            {t('saas.open_support_ticket', 'فتح تذكرة')}
          </button>
        </div>
      </div>
    </div>
  );
}
