import React, { useState, useEffect } from 'react';
import { 
  CheckCircle, 
  XCircle, 
  Clock, 
  UserCheck,
  UserX,
  Mail,
  Phone,
  Users,
  ShoppingBag,
  DollarSign,
  ShieldAlert,
  ShieldCheck,
  Activity,
  Calendar,
  CreditCard,
  ExternalLink,
  MapPin,
  FileText,
  BadgeCheck,
  X,
  TrendingUp,
  History,
  Search,
  Download,
  Globe,
  Store,
  Ban,
  Edit,
  Crown,
  Filter
} from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { handleError, OperationType } from '../lib/firebase';
import { useNavigate } from 'react-router-dom';
import { TailorRequest, Tenant, Plan, Order } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { PriceDisplay } from './PriceDisplay';
import { cn } from '../lib/utils';
import { autoSeed } from '../services/seedService';
import { AdminIconInput } from './ui/AdminIconInput';
import { AdminIconSelect } from './ui/AdminIconSelect';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { useDirection } from '../lib/direction';
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
  Cell,
  PieChart,
  Pie
} from 'recharts';
import { localeOf } from '../lib/direction';
import i18n from '../i18n/config';

export default function AdminTailors() {
  const { t } = useTranslation();
  const { dir } = useDirection();
  const { dbUser } = useAuth();
  const userRole = dbUser?.role;
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'tenants' | 'subscriptions'>('tenants');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [drawerTenant, setDrawerTenant] = useState<Tenant | null>(null);
  const [drawerStats, setDrawerStats] = useState<{
    lastLogin: string | null;
    branchesCount: number;
    paymentStatus: string;
  } | null>(null);
  const [tenantStats, setTenantStats] = useState<{
    ordersData: { date: string, sales: number, count: number }[],
    summary: { totalOrders: number, totalSales: number }
  } | null>(null);
  const [platformStats, setPlatformStats] = useState({
    totalTenants: 0,
    totalOrders: 0,
    totalRevenue: 0
  });

  const [toast, setToast] = useState<{message: string, type: 'success'|'error'} | null>(null);
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const [confirmDialog, setConfirmDialog] = useState<{title: string, onConfirm: () => void} | null>(null);

  useEffect(() => {
    const fetchTenants = async () => {
      const { data } = await supabase
        .from('tenants')
        .select('*');
      
      if (data) {
        const ts = data.map(d => ({
          ...d,
          customerId: d.customer_id,
          ownerEmail: d.owner_email,
          vatNumber: d.vat_number,
          inventoryStrategy: d.inventory_strategy,
          createdAt: d.created_at,
          planId: d.plan_id,
          commercialRegister: d.commercial_register
        }) as unknown as Tenant);
        setTenants(ts);
        setPlatformStats(prev => ({ ...prev, totalTenants: ts.length }));
      }
    };

    const fetchGlobalStats = async () => {
      try {
        const { data: orders } = await supabase
          .from('orders')
          .select('paid_amount');
        
        if (orders) {
          const revenue = orders.reduce((acc, curr: any) => acc + (curr.paid_amount || 0), 0);
          setPlatformStats(prev => ({
            ...prev,
            totalOrders: orders.length,
            totalRevenue: revenue
          }));
        }
      } catch (error) {
        handleError(error as any, OperationType.LIST, 'orders_global');
      }
    };

    const fetchPlans = async () => {
      const { data } = await supabase.from('plans').select('*');
      if (data) setPlans(data);
    };

    fetchTenants();
    fetchGlobalStats();
    fetchPlans();

    // Listeners
    const tenantChannel = supabase.channel('tenants_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tenants' }, () => fetchTenants())
      .subscribe();

    return () => {
      supabase.removeChannel(tenantChannel);
    };
  }, []);

  useEffect(() => {
    if (selectedTenant) {
      fetchTenantPerformance(selectedTenant.id);
    } else {
      setTenantStats(null);
    }
  }, [selectedTenant]);

  const fetchTenantPerformance = async (tenantId: string) => {
    // Fetch last 30 days orders
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: orders, error } = await supabase
      .from('orders')
      .select('total_amount, order_date')
      .eq('tenant_id', tenantId)
      .gte('order_date', thirtyDaysAgo.toISOString())
      .order('order_date', { ascending: true });

    if (error) {
      console.error('Error fetching tenant performance:', error);
      return;
    }

    // Process data for charts
    const dailyMap = new Map<string, { sales: number, count: number }>();
    let totalSales = 0;

    orders?.forEach(order => {
      const date = new Date(order.order_date).toLocaleDateString(localeOf(i18n.language), { day: 'numeric', month: 'short' });
      const current = dailyMap.get(date) || { sales: 0, count: 0 };
      dailyMap.set(date, {
        sales: current.sales + Number(order.total_amount),
        count: current.count + 1
      });
      totalSales += Number(order.total_amount);
    });

    const ordersData = Array.from(dailyMap.entries()).map(([date, stats]) => ({
      date,
      sales: stats.sales,
      count: stats.count
    }));

    setTenantStats({
      ordersData,
      summary: {
        totalOrders: orders?.length || 0,
        totalSales
      }
    });
  };

  const handleStealthLogin = async (tenantId: string) => {
    try {
      // Record stealth session in Audit logs (support_sessions)
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

      localStorage.setItem('impersonatedTenantId', tenantId);
      localStorage.setItem('tenant_id', tenantId);
      window.location.href = '/dashboard';
    } catch (e) {
      showToast(t('saas.tenants.stealth_login_error'), 'error');
    }
  };

  const handleRequestAccess = async (tenantId: string) => {
    try {
      setLoading(true);
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
        console.warn('Direct support access requests insertion failed in AdminTailors, trying fallback:', err);
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

      showToast(t('saas.tenants.access_request_sent'), 'success');
      
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
          // Check from saas_settings fallback
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
          setLoading(false);
          
          if (currentStatus === 'approved') {
            showToast(t('saas.tenants.access_approved'), 'success');
            
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

            localStorage.setItem('impersonatedTenantId', tenantId);
            localStorage.setItem('tenant_id', tenantId);
            window.location.href = '/dashboard';
          } else {
            showToast(t('saas.tenants.access_rejected'), 'error');
          }
        }
      }, 3000);
      
      // Stop polling after 15 minutes
      setTimeout(() => {
        clearInterval(interval);
        setLoading(false);
        showToast(t('saas.tenants.access_request_expired'), 'error');
      }, 15 * 60000);

    } catch (e) {
      setLoading(false);
      showToast(t('saas.tenants.access_request_error'), 'error');
    }
  };

  const handleImpersonate = (tenantId: string) => {
    localStorage.setItem('impersonatedTenantId', tenantId);
    localStorage.setItem('tenant_id', tenantId);
    window.location.href = '/dashboard';
  };

  const openTenantDrawer = async (tenant: Tenant) => {
    setDrawerTenant(tenant);
    setDrawerStats(null); // Reset while loading
    
    try {
      // Fetch branches count
      const { count: branchesCount, error: branchesError } = await supabase
        .from('branches')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenant.id);
        
      if (branchesError) throw branchesError;

      // Fetch last login from audit_logs or assume from updated_at / recent orders for MVP if auth log not accessible
      const { data: recentOrder } = await supabase
        .from('orders')
        .select('created_at')
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const info = getSubscriptionInfo(tenant);
      
      setDrawerStats({
        lastLogin: recentOrder?.created_at || (tenant as any).updatedAt || null, 
        branchesCount: branchesCount || 0,
        paymentStatus: info.isTrial ? t('billing.plans.free.badge') : (tenant.status === 'active' ? t('saas.tenants.payment_paid_active') : t('saas.status_inactive'))
      });
      
    } catch (e) {
      console.error(e);
      setDrawerStats({
        lastLogin: (tenant as any).updatedAt || null,
        branchesCount: 0,
        paymentStatus: t('common.not_available')
      });
    }
  };

  const handleUpdateTenantPlan = (tenantId: string, newPlanId: string) => {
    if (dbUser?.role !== 'super_admin') {
      showToast(t('saas.unauthorized_action'), 'error');
      return;
    }
    setConfirmDialog({
      title: t('saas.tenants.confirm_change_plan'),
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          const today = new Date().toISOString();
          const { error } = await supabase
            .from('tenants')
            .update({ plan_id: newPlanId, created_at: today })
            .eq('id', tenantId);
          
          if (error) throw error;
          setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, planId: newPlanId, createdAt: today } : t));
          showToast(t('saas.tenants.plan_updated'), 'success');
        } catch (error) {
          console.warn("Error updating tenant plan:", error);
          showToast(t('saas.tenants.plan_update_failed'), 'error');
        }
      }
    });
  };

  const handleExtendTrial = (tenantId: string) => {
    if (dbUser?.role !== 'super_admin') {
      showToast(t('saas.unauthorized_action'), 'error');
      return;
    }
    setConfirmDialog({
      title: t('saas.tenants.confirm_extend_trial'),
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          const today = new Date().toISOString();
          const { error } = await supabase
            .from('tenants')
            .update({ created_at: today })
            .eq('id', tenantId);
          
          if (error) throw error;
          setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, createdAt: today } : t));
          showToast(t('saas.tenants.trial_extended'), 'success');
        } catch (error) {
          console.warn("Error extending trial:", error);
          showToast(t('saas.tenants.trial_extend_failed'), 'error');
        }
      }
    });
  };

  const handleToggleStatus = async (tenant: Tenant) => {
    if (dbUser?.role !== 'super_admin') {
      showToast(t('saas.unauthorized_action'), 'error');
      return;
    }
    const isActive = tenant.status === 'active' || tenant.status === 'onboarding';
    const newStatus = isActive ? 'inactive' : 'active';
    const msg = isActive 
      ? t('saas.tenants.confirm_deactivate_account', { name: tenant.name })
      : t('saas.tenants.confirm_activate_account', { name: tenant.name });

    setConfirmDialog({
      title: msg,
      onConfirm: async () => {
        setConfirmDialog(null);
        setLoading(true);
        try {
          const { error } = await supabase
            .from('tenants')
            .update({ 
              status: newStatus,
              updated_at: new Date().toISOString()
            })
            .eq('id', tenant.id);
          
          if (error) throw error;

          setTenants(prev => prev.map(t => t.id === tenant.id ? { ...t, status: newStatus as any } : t));
          
          if (selectedTenant?.id === tenant.id) {
            setSelectedTenant(prev => prev ? { ...prev, status: newStatus as any } : null);
          }

          showToast(isActive ? t('saas.tenants.account_deactivated') : t('saas.tenants.account_activated'), 'success');
        } catch (error: any) {
          console.error('Error updating status:', error);
          showToast(t('saas.tenants.status_update_error', { details: error.message || t('orders.unknown_error') }), 'error');
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const handleManualSeed = () => {
    setConfirmDialog({
      title: t('saas.tenants.confirm_seed_demo_data'),
      onConfirm: async () => {
        setConfirmDialog(null);
        setLoading(true);
        const success = await autoSeed();
        setLoading(false);
        if (success) {
          showToast(t('saas.tenants.seed_success'), 'success');
          setTimeout(() => window.location.reload(), 1500);
        } else {
          showToast(t('saas.tenants.seed_already_done'), 'error');
        }
      }
    });
  };

  const handleRenewSubscription = (tenant: Tenant) => {
    if (dbUser?.role !== 'super_admin') {
      showToast(t('saas.unauthorized_action'), 'error');
      return;
    }
    setConfirmDialog({
      title: t('saas.tenants.confirm_renew_subscription', { name: tenant.name }),
      onConfirm: async () => {
        setConfirmDialog(null);
        setLoading(true);
        try {
          const now = new Date().toISOString();
          const { error } = await supabase
            .from('tenants')
            .update({ 
              status: 'active',
              created_at: now,
              updated_at: now
            })
            .eq('id', tenant.id);
          
          if (error) throw error;
          
          await supabase.from('audit_logs').insert({
            action: 'renew_subscription',
            target_tenant_id: tenant.id,
            details: `Renewed subscription for ${tenant.name}. Clock reset to ${now}`,
            occurred_at: now
          });

          const updatedTenant = { ...tenant, status: 'active' as const, createdAt: now };
          
          setTenants(prev => prev.map(t => t.id === tenant.id ? updatedTenant : t));
          
          if (selectedTenant?.id === tenant.id) {
            setSelectedTenant(updatedTenant);
          }

          showToast(t('saas.tenants.renew_success'), 'success');
        } catch (err) {
          console.error(err);
          showToast(t('saas.tenants.renew_failed'), 'error');
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const handleActivateSubscription = (tenant: Tenant) => {
    if (dbUser?.role !== 'super_admin') {
      showToast(t('saas.unauthorized_action'), 'error');
      return;
    }
    setConfirmDialog({
      title: t('saas.tenants.confirm_activate_account', { name: tenant.name }),
      onConfirm: async () => {
        setConfirmDialog(null);
        setLoading(true);
        try {
          const { error } = await supabase
            .from('tenants')
            .update({ 
              status: 'active',
              updated_at: new Date().toISOString()
            })
            .eq('id', tenant.id);
          
          if (error) throw error;

          setTenants(prev => prev.map(t => t.id === tenant.id ? { ...t, status: 'active' } : t));
          
          if (selectedTenant?.id === tenant.id) {
            setSelectedTenant({ ...selectedTenant, status: 'active' });
          }

          showToast(t('saas.tenants.activate_success'), 'success');
        } catch (err: any) {
          console.error(err);
          showToast(t('saas.tenants.activate_failed', { details: err.message || t('orders.unknown_error') }), 'error');
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const getPlanName = (planId: string) => {
    return plans.find(p => p.id === planId)?.name || t('saas.tenants.custom_plan');
  };

  const getSubscriptionInfo = (tenant: Tenant) => {
    const plan = plans.find(p => p.id === tenant.planId);
    const isTrial = tenant.planId === 'free' || 
                    (!plan && tenant.planId !== 'basic') || 
                    (plan && plan.price === 0) || 
                    (tenant.planId && typeof tenant.planId === 'string' && tenant.planId.includes('trial'));
    const creationDate = new Date(tenant.createdAt);
    const now = new Date();
    
    // Assume 14 days trial or 365 days pro based on standard logic if duration not in DB
    const durationDays = isTrial ? 14 : 365;
    const expiryDate = new Date(creationDate);
    expiryDate.setDate(expiryDate.getDate() + durationDays);
    
    const diffTime = expiryDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return {
      type: isTrial ? t('billing.plans.free.badge') : t('saas.tenants.paid_subscription'),
      isTrial,
      daysLeft: Math.max(0, diffDays),
      expiryDate,
      progress: Math.min(100, Math.max(0, ( (durationDays - diffDays) / durationDays ) * 100))
    };
  };

  // Derived analytical metrics
  const activeTenantsCount = tenants.filter(t => t.status === 'active' || t.status === 'onboarding').length;
  const trialExpiringTenantsCount = tenants.filter(t => {
    const info = getSubscriptionInfo(t);
    return info.isTrial && info.daysLeft <= 3 && t.status !== 'inactive';
  }).length;
  const totalTenantsCount = tenants.length;

  const pieData = [
    { name: t('common.active'), value: activeTenantsCount, color: '#10B981' },
    { name: t('saas.status_inactive'), value: Math.max(0, totalTenantsCount - activeTenantsCount), color: '#F3F4F6' }
  ];

  const monthlyDataMap = tenants.reduce((acc, t) => {
    const d = new Date(t.createdAt);
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    acc[m] = (acc[m] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  const totalRegistrationsData = Object.entries(monthlyDataMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, التسجيلات: count }));

  if (totalRegistrationsData.length === 0) {
     totalRegistrationsData.push({ date: t('saas.tenants.now'), التسجيلات: 0 });
  }

  return (
    <div className="space-y-10">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h2 className="text-3xl font-black text-content flex items-center gap-3">
            <Users className="text-brand" size={32} />
            {t('saas.tenants.title')}
          </h2>
          <p className="text-content-muted font-bold text-sm mt-1">{t('saas.tenants.subtitle')}</p>
        </div>
        
        <div className="flex bg-surface rounded-2xl p-1 border border-border shadow-sm">
          <button
            onClick={() => setActiveTab('tenants')}
            className={`px-6 py-2 rounded-xl text-sm font-black transition-all ${
              activeTab === 'tenants' ? 'bg-brand text-white shadow-lg shadow-brand/20' : 'text-content-muted hover:text-content'
            }`}
          >
            {t('saas.menu_tenants')}
          </button>
          <button
            onClick={() => setActiveTab('subscriptions')}
            className={`px-6 py-2 rounded-xl text-sm font-black transition-all ${
              activeTab === 'subscriptions' ? 'bg-brand text-white shadow-lg shadow-brand/20' : 'text-content-muted hover:text-content'
            }`}
          >
            {t('saas.tenants.tab_subscriptions')}
          </button>
        </div>
      </header>

      {/* Top Graphical Stats Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Subscribers */}
        <div className="bg-surface p-6 rounded-3xl border border-border shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-content-muted text-sm font-medium mb-1">{t('saas.tenants.active_subscribers')}</p>
              <h3 className="text-4xl font-black text-content">{activeTenantsCount}</h3>
            </div>
            <div className="bg-success/10 w-12 h-12 rounded-2xl flex items-center justify-center text-success">
              <BadgeCheck size={24} />
            </div>
          </div>
          <div className="h-24 mt-2 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  innerRadius={30}
                  outerRadius={40}
                  paddingAngle={5}
                  dataKey="value"
                  stroke="none"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: any) => [value, t('saas.tenant_count_label')]} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Trial Ending Soon */}
        <div className="bg-surface p-6 rounded-3xl border border-border shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-content-muted text-sm font-medium mb-1">{t('saas.tenants.trials_ending_soon')}</p>
              <h3 className="text-4xl font-black text-warning">{trialExpiringTenantsCount}</h3>
            </div>
            <div className="bg-warning/10 w-12 h-12 rounded-2xl flex items-center justify-center text-warning">
              <Clock size={24} />
            </div>
          </div>
          <div className="h-24 mt-2 w-full flex items-end">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[{ name: t('common.coming_soon'), value: trialExpiringTenantsCount }]} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <Bar dataKey="value" fill="#F59E0B" radius={[8, 8, 0, 0]} barSize={50} />
                <Tooltip formatter={(value: any) => [value, t('saas.tenant_count_label')]} cursor={{fill: 'transparent'}} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Total Registered Subscribers */}
        <div className="bg-surface p-6 rounded-3xl border border-border shadow-sm flex flex-col justify-between">
            <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-content-muted text-sm font-medium mb-1">{t('saas.tenants.total_registered')}</p>
              <h3 className="text-4xl font-black text-content">{totalTenantsCount}</h3>
            </div>
            <div className="bg-brand/10 w-12 h-12 rounded-2xl flex items-center justify-center text-brand">
              <Users size={24} />
            </div>
          </div>
          <div className="h-24 mt-2 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={totalRegistrationsData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorReg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#4F46E5" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <Tooltip wrapperStyle={{ outline: 'none' }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}/>
                <Area type="monotone" dataKey="التسجيلات" name={t('saas.tenants.registrations')} stroke="#4F46E5" strokeWidth={3} fillOpacity={1} fill="url(#colorReg)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {activeTab === 'tenants' ? (
        <motion.div
          key="tenants-tab"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-10"
        >
          {/* Filters & Actions */}
          <div className="bg-surface p-6 rounded-[2.5rem] border border-border shadow-sm flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex flex-1 gap-4 w-full md:w-auto">
              <div className="flex-1 max-w-sm">
                <AdminIconInput 
                  type="text"
                  placeholder={t('saas.tenants.search_placeholder')}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  startIcon={Search}
                  className="rounded-2xl"
                />
              </div>
              <AdminIconSelect 
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                startIcon={Filter}
                className="w-auto"
              >
                <option value="all">{t('saas.tenants.all_statuses')}</option>
                <option value="active">{t('common.active')}</option>
                <option value="inactive">{t('settings_page.staff.permissions.disabled')}</option>
              </AdminIconSelect>
            </div>
            
            <div className="flex gap-2">

              <button className="px-6 py-3 bg-surface-muted border border-border rounded-2xl font-bold text-sm flex items-center gap-2 hover:bg-border transition-all">
                <Download size={18} />
                {t('saas.tenants.export_data')}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-8">
            {/* Tailors List */}
            <div className="space-y-4">
              <h3 className="text-xl font-bold text-content flex items-center gap-2 px-2">
                <ShieldCheck className="text-brand" size={20} />
                {t('saas.tenants.approved_shops')}
              </h3>
              <div className="bg-surface rounded-3xl border border-border shadow-sm overflow-hidden">
                <table className="w-full text-right">
                  <thead className="bg-surface-muted text-content-muted text-[10px] font-black uppercase tracking-widest border-b border-border">
                    <tr>
                      <th className="px-8 py-5">{t('saas.tenants.col_shop')}</th>
                      <th className="px-8 py-5">{t('saas.tenants.col_owner_contact')}</th>
                      <th className="px-8 py-5">{t('saas.tenants.col_plan')}</th>
                      <th className="px-8 py-5">{t('common.status')}</th>
                      <th className="px-8 py-5 text-left">{t('saas.tenants.col_operations')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {tenants
                      .filter(t => {
                        const matchesSearch = t.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                                            t.ownerEmail.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                            t.phone?.includes(searchTerm);
                        const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
                        return matchesSearch && matchesStatus;
                      })
                      .map((tenant) => {
                      const isActive = tenant.status === 'active' || tenant.status === 'onboarding';
                      return (
                        <tr 
                          key={tenant.id} 
                          className="hover:bg-surface-muted/30 transition-all cursor-pointer group"
                          onClick={() => setSelectedTenant(tenant)}
                        >
                          <td className="px-8 py-6">
                            <div className="flex items-center gap-4">
                              <div className="w-12 h-12 bg-surface-muted rounded-2xl flex items-center justify-center shrink-0 border border-border group-hover:scale-110 transition-transform duration-500">
                                {tenant.logoUrl ? (
                                  <img src={tenant.logoUrl} className="w-full h-full object-cover rounded-2xl" />
                                ) : (
                                  <Store className="text-brand/40" size={24} />
                                )}
                              </div>
                              <div>
                                <div 
                                  className="font-black text-content hover:text-brand transition-colors cursor-pointer"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openTenantDrawer(tenant);
                                  }}
                                >
                                  {tenant.name}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-8 py-6">
                            <div className="text-sm font-bold text-content">{tenant.ownerEmail}</div>
                            <div className="text-[10px] text-brand font-black mt-0.5">{tenant.phone}</div>
                          </td>
                          <td className="px-8 py-6">
                            <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase bg-brand/5 text-brand border border-brand/10">
                              {getPlanName(tenant.planId)}
                            </span>
                          </td>
                          <td className="px-8 py-6 text-center">
                            {isActive ? (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase bg-success/10 text-success border border-success/20">
                                <BadgeCheck size={12} />
                                {t('common.active')}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase bg-danger/10 text-danger border border-danger/20">
                                <Ban size={12} />
                                {t('settings_page.staff.permissions.disabled')}
                              </span>
                            )}
                          </td>
                          <td className="px-8 py-6">
                            <div className="flex items-center justify-start gap-2">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openTenantDrawer(tenant);
                                }}
                                className="p-2 text-content-muted hover:text-emerald-500 hover:bg-emerald-500/5 rounded-xl transition-all"
                                title={t('saas.tenants.view_shop_ui')}
                              >
                                <Globe size={18} />
                              </button>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedTenant(tenant);
                                }}
                                className="p-2 text-content-muted hover:text-brand hover:bg-brand/5 rounded-xl transition-all"
                                title={t('common.edit')}
                              >
                                <Edit size={18} />
                              </button>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleStatus(tenant);
                                }}
                                className={cn(
                                  "p-2 rounded-xl transition-all",
                                  isActive ? "text-danger hover:bg-danger/5" : "text-success hover:bg-success/5"
                                )}
                                title={isActive ? t('saas.tenants.deactivate') : t('saas.tenants.activate')}
                              >
                                {isActive ? <Ban size={18} /> : <BadgeCheck size={18} />}
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
          </div>
        </motion.div>
      ) : (
        <motion.div
           key="subscriptions-tab"
           initial={{ opacity: 0, y: 10 }}
           animate={{ opacity: 1, y: 0 }}
           className="space-y-10"
        >

          <div className="bg-surface rounded-[3rem] border border-border shadow-sm overflow-hidden">
            <div className="p-8 border-b border-border bg-brand/5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h3 className="text-xl font-black text-content">{t('saas.tenants.licenses_title')}</h3>
                <p className="text-content-muted text-xs font-bold mt-1">{t('saas.tenants.licenses_subtitle')}</p>
              </div>
              <div className="w-full sm:w-80">
                <AdminIconInput 
                  type="text" 
                  placeholder={t('saas.tenants.quick_search_placeholder')}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  startIcon={Search}
                  className="rounded-xl bg-surface-muted/60"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right min-w-[900px]">
                <thead>
                  <tr className="bg-surface-muted/30 border-b border-border">
                    <th className="px-8 py-5 text-[10px] font-black text-content-muted uppercase tracking-widest text-center">{t('saas.tenants.col_subscriber')}</th>
                    <th className="px-8 py-5 text-[10px] font-black text-content-muted uppercase tracking-widest text-center">{t('saas.tenants.col_current_plan')}</th>
                    <th className="px-8 py-5 text-[10px] font-black text-content-muted uppercase tracking-widest text-center">{t('saas.tenants.col_remaining_period')}</th>
                    <th className="px-8 py-5 text-[10px] font-black text-content-muted uppercase tracking-widest text-center">{t('saas.tenants.col_change_plan')}</th>
                    <th className="px-8 py-5 text-[10px] font-black text-content-muted uppercase tracking-widest text-left">{t('shift_history.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tenants
                    .filter(t => t.name.toLowerCase().includes(searchTerm.toLowerCase()) || t.ownerEmail.toLowerCase().includes(searchTerm.toLowerCase()))
                    .map(tenant => {
                      const sub = getSubscriptionInfo(tenant);

                      return (
                        <tr key={tenant.id} className="hover:bg-surface-muted/20 transition-all">
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

                          <td className="px-8 py-6 text-center">
                            <span className={cn(
                              "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider",
                              tenant.planId === 'basic' ? "bg-indigo-100 text-indigo-800 border border-indigo-200" :
                              tenant.planId === 'free' ? "bg-emerald-100 text-emerald-800 border border-emerald-200" :
                              "bg-gray-100 text-gray-700 shadow-sm"
                            )}>
                              {getPlanName(tenant.planId)}
                            </span>
                          </td>

                          <td className="px-8 py-6">
                            <div className="flex items-center gap-3">
                              <div className="flex-1 bg-surface-muted h-2.5 rounded-full overflow-hidden border border-border max-w-[120px]">
                                <div 
                                  className={cn("h-full rounded-full transition-all duration-700", sub.daysLeft < 7 ? "bg-danger shadow-[0_0_8px_rgba(239,68,68,0.4)]" : "bg-brand shadow-[0_0_8px_rgba(var(--brand-rgb),0.4)]")}
                                  style={{ width: `${sub.progress}%` }}
                                />
                              </div>
                              <span className={cn("text-xs font-black min-w-[60px]", sub.daysLeft < 7 ? "text-danger animate-pulse" : "text-brand")}>
                                {t('saas.tenants.days_left', { days: sub.daysLeft })}
                              </span>
                            </div>
                          </td>

                          <td className="px-8 py-6 text-center">
                            <div className="w-48 mx-auto">
                              <AdminIconSelect
                                startIcon={Crown}
                                value={tenant.planId || 'free'}
                                onChange={(e) => handleUpdateTenantPlan(tenant.id, e.target.value)}
                                className="w-full bg-surface-muted border-none rounded-xl text-xs font-black min-h-[38px]"
                              >
                                <option value="free">{t('saas.tenants.plan_option_free')}</option>
                                <option value="basic">{t('saas.tenants.plan_option_basic')}</option>
                              </AdminIconSelect>
                            </div>
                          </td>

                          <td className="px-8 py-6 text-left">
                            <button
                              onClick={() => handleExtendTrial(tenant.id)}
                              className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-brand text-white hover:bg-brand/90 rounded-2xl text-xs font-black shadow-lg shadow-brand/20 transition-all active:scale-95 group"
                            >
                              <Clock size={16} className="group-hover:rotate-12 transition-transform" />
                              {t('saas.tenants.extend_period')}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* Tenant Detail Modal */}
      <AnimatePresence>
        {selectedTenant && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedTenant(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-surface w-full max-w-4xl rounded-[2.5rem] shadow-2xl overflow-hidden relative z-10 border border-border flex flex-col max-h-[90vh]"
            >
              {/* Header */}
              <div className="p-8 border-b border-border flex justify-between items-start bg-surface-muted/50">
                <div className="flex gap-4">
                  <div className="bg-brand/10 w-16 h-16 rounded-3xl flex items-center justify-center text-brand">
                    <ShoppingBag size={32} />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold text-content">{selectedTenant.name}</h3>
                    <p className="text-content-muted flex items-center gap-1 mt-1">
                      <BadgeCheck size={16} className="text-success" />
                      {selectedTenant.customerId || t('saas.tenants.no_code')} • {getPlanName(selectedTenant.planId)}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedTenant(null)}
                  className="p-2 hover:bg-surface-muted rounded-full text-content-muted transition-colors"
                >
                  <X size={24} />
                </button>
              </div>

              {/* Scrollable Content */}
              <div className="overflow-y-auto flex-1 p-8 space-y-8 custom-scrollbar">
                
                {/* Statistics Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-surface-muted p-6 rounded-3xl border border-border">
                    <p className="text-xs text-content-muted font-bold mb-1">{t('saas.tenants.total_sales_30d')}</p>
                    <div className="text-2xl font-black text-content">
                      <PriceDisplay amount={tenantStats?.summary.totalSales || 0} />
                    </div>
                  </div>
                  <div className="bg-surface-muted p-6 rounded-3xl border border-border">
                    <p className="text-xs text-content-muted font-bold mb-1">{t('saas.tenants.total_orders_30d')}</p>
                    <div className="text-2xl font-black text-content">
                      {t('saas.tenants.orders_value', { value: tenantStats?.summary.totalOrders || 0 })}
                    </div>
                  </div>
                  <div className="bg-surface-muted p-6 rounded-3xl border border-border">
                    <p className="text-xs text-content-muted font-bold mb-1">{t('saas.tenants.subscription_age')}</p>
                    <div className="text-2xl font-black text-content">
                      {t('saas.tenants.days_value', { days: Math.ceil((new Date().getTime() - new Date(selectedTenant.createdAt).getTime()) / (1000 * 60 * 60 * 24)) })}
                    </div>
                  </div>
                </div>

                {/* Subscriptions Section */}
                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-content-muted uppercase tracking-wider flex items-center gap-2">
                    <CreditCard size={16} />
                    {t('saas.tenants.subscription_details')}
                  </h4>
                  <div className="bg-surface-muted p-6 rounded-3xl border border-border relative overflow-hidden">
                    {(() => {
                      const info = getSubscriptionInfo(selectedTenant);
                      return (
                        <div className="flex flex-col md:flex-row gap-8 items-center">
                          <div className="flex-1 space-y-2">
                            <div className="flex justify-between items-end">
                              <div>
                                <p className="text-sm font-bold text-content">{info.type}</p>
                                <p className="text-xs text-content-muted">{t('saas.tenants.remaining_until_expiry', { days: info.daysLeft })}</p>
                              </div>
                              <span className={`text-xs font-black uppercase tracking-widest ${info.isTrial ? 'text-warning' : 'text-success'}`}>
                                {info.isTrial ? 'TRIAL' : 'PREMIUM'}
                              </span>
                            </div>
                            <div className="h-3 w-full bg-border rounded-full overflow-hidden">
                              <motion.div 
                                initial={{ width: 0 }}
                                animate={{ width: `${info.progress}%` }}
                                className={`h-full ${info.isTrial ? 'bg-warning' : 'bg-success'}`}
                              />
                            </div>
                            <div className="flex justify-between items-center text-[10px] text-content-muted font-bold">
                              <span>{t('saas.tenants.join_date_value', { date: new Date(selectedTenant.createdAt).toLocaleDateString(localeOf(i18n.language)) })}</span>
                              <span>{t('saas.tenants.expected_expiry_value', { date: info.expiryDate.toLocaleDateString(localeOf(i18n.language)) })}</span>
                            </div>
                          </div>
                          <div className="w-full md:w-auto">
                            {selectedTenant.status !== 'active' ? (
                              <button 
                                onClick={() => handleActivateSubscription(selectedTenant)}
                                disabled={loading}
                                className="w-full md:w-56 bg-success text-white py-4 rounded-2xl font-bold hover:bg-success/90 transition-all shadow-lg shadow-success/10 flex items-center justify-center gap-2"
                              >
                                <UserCheck size={20} />
                                {t('saas.tenants.activate_subscription')}
                              </button>
                            ) : (
                              <button 
                                onClick={() => handleRenewSubscription(selectedTenant)}
                                disabled={loading}
                                className="w-full md:w-56 bg-brand text-white py-4 rounded-2xl font-bold hover:bg-brand/90 transition-all shadow-lg shadow-brand/10 flex items-center justify-center gap-2"
                              >
                                <Calendar size={20} />
                                {t('saas.tenants.renew_subscription_year')}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Performance Charts */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h4 className="text-sm font-bold text-content-muted uppercase tracking-wider flex items-center gap-2 px-2">
                       <TrendingUp size={16} />
                       {t('saas.tenants.daily_sales_volume')}
                    </h4>
                    <div className="bg-surface-muted p-4 rounded-3xl border border-border h-64">
                      {tenantStats?.ordersData && tenantStats.ordersData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={tenantStats.ordersData}>
                            <defs>
                              <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#1e40af" stopOpacity={0.1}/>
                                <stop offset="95%" stopColor="#1e40af" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" />
                            <XAxis 
                              dataKey="date" 
                              axisLine={false} 
                              tickLine={false} 
                              tick={{fontSize: 10, fill: '#6b7280'}}
                            />
                            <YAxis 
                              axisLine={false} 
                              tickLine={false} 
                              tick={{fontSize: 10, fill: '#6b7280'}}
                            />
                            <Tooltip 
                              contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                            />
                            <Area 
                              type="monotone" 
                              dataKey="sales" 
                              stroke="#3b82f6" 
                              fillOpacity={1} 
                              fill="url(#colorSales)" 
                              strokeWidth={3}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex items-center justify-center text-content-muted text-sm italic border border-dashed border-border rounded-xl">
                          {t('saas.tenants.no_sales_data')}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h4 className="text-sm font-bold text-content-muted uppercase tracking-wider flex items-center gap-2 px-2">
                       <ShoppingBag size={16} />
                       {t('saas.tenants.daily_orders_count')}
                    </h4>
                    <div className="bg-surface-muted p-4 rounded-3xl border border-border h-64">
                      {tenantStats?.ordersData && tenantStats.ordersData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={tenantStats.ordersData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" />
                            <XAxis 
                              dataKey="date" 
                              axisLine={false} 
                              tickLine={false} 
                              tick={{fontSize: 10, fill: '#6b7280'}}
                            />
                            <YAxis 
                              axisLine={false} 
                              tickLine={false} 
                              tick={{fontSize: 10, fill: '#6b7280'}}
                            />
                            <Tooltip 
                              contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                            />
                            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                              {tenantStats.ordersData.map((_entry, index) => (
                                <Cell key={`cell-${index}`} fill="#10b981" fillOpacity={0.8} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex items-center justify-center text-content-muted text-sm italic border border-dashed border-border rounded-xl">
                          {t('saas.tenants.no_orders_data')}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Contact Info */}
                  <div className="space-y-4">
                    <h4 className="text-sm font-bold text-content-muted uppercase tracking-wider flex items-center gap-2 px-2">
                      <Mail size={16} />
                      {t('saas.tenants.contact_info')}
                    </h4>
                    <div className="bg-surface-muted p-4 rounded-2xl border border-border space-y-3 shadow-inner">
                      <div>
                        <p className="text-[10px] text-content-muted font-bold">{t('common.email')}</p>
                        <p className="text-sm font-medium text-content">{selectedTenant.ownerEmail}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-content-muted font-bold">{t('login.phone')}</p>
                        <p className="text-sm font-medium text-content">{selectedTenant.phone}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-content-muted font-bold">{t('procurement.address')}</p>
                        <p className="text-sm font-medium text-content">{selectedTenant.address || t('orders.not_specified')}</p>
                      </div>
                    </div>
                  </div>

                  {/* Business Info */}
                  <div className="space-y-4">
                    <h4 className="text-sm font-bold text-content-muted uppercase tracking-wider flex items-center gap-2 px-2">
                      <FileText size={16} />
                      {t('saas.tenants.licenses_and_taxes')}
                    </h4>
                    <div className="bg-surface-muted p-4 rounded-2xl border border-border space-y-3 shadow-inner">
                      <div>
                        <p className="text-[10px] text-content-muted font-bold">{t('saas.tenants.commercial_register')}</p>
                        <p className="text-sm font-medium text-content">{selectedTenant.commercialRegister || t('common.not_available')}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-content-muted font-bold">{t('customers.trn')}</p>
                        <p className="text-sm font-medium text-content">{selectedTenant.vatNumber || t('common.not_available')}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-content-muted font-bold">{t('saas.tenants.join_date')}</p>
                        <p className="text-sm font-medium text-content">
                          {new Date(selectedTenant.createdAt).toLocaleDateString(localeOf(i18n.language))}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="p-8 border-t border-border bg-surface-muted/30 flex gap-3">
                <button 
                  onClick={() => {
                    navigate(`/admin/tailors/${selectedTenant.id}/analytics`);
                  }}
                  className="flex-1 bg-brand text-white font-bold py-4 rounded-2xl hover:bg-brand/90 transition-all flex items-center justify-center gap-2"
                >
                  <Activity size={20} />
                  {t('saas.tenants.deep_analytics')}
                </button>
                {(() => {
                  const isActive = selectedTenant.status === 'active' || selectedTenant.status === 'onboarding';
                  return (
                    <button 
                      onClick={() => handleToggleStatus(selectedTenant)}
                      className="flex-1 bg-surface border border-border text-content font-bold py-4 rounded-2xl hover:bg-surface-muted transition-all flex items-center justify-center gap-2"
                    >
                      {isActive ? <ShieldAlert size={20} className="text-danger" /> : <ShieldCheck size={20} className="text-success" />}
                      {isActive ? t('saas.tenants.deactivate_account') : t('saas.tenants.activate_account')}
                    </button>
                  );
                })()}
                <button 
                  onClick={() => setSelectedTenant(null)}
                  className="flex-1 bg-surface-muted text-content-muted font-bold py-4 rounded-2xl hover:bg-border transition-all border border-border"
                >
                  {t('saas.tenants.close_details')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Tenant Activity Drawer */}
      <AnimatePresence>
        {drawerTenant && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDrawerTenant(null)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[90]"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 bottom-0 w-full max-w-sm bg-surface shadow-2xl z-[100] border-l border-border flex flex-col"
              dir={dir}
            >
              <div className="flex items-center justify-between p-6 border-b border-border bg-surface-muted/30">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-brand/10 text-brand rounded-xl flex items-center justify-center">
                    <History size={20} />
                  </div>
                  <div>
                    <h3 className="font-black text-content text-lg">{t('saas.tenants.activity_log_title')}</h3>
                    <p className="text-xs text-content-muted font-bold mt-0.5">{drawerTenant.name}</p>
                  </div>
                </div>
                <button
                  onClick={() => setDrawerTenant(null)}
                  className="p-2 hover:bg-surface-muted rounded-full transition-colors text-content-muted"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 flex-1 overflow-y-auto space-y-6">
                {!drawerStats ? (
                  <div className="flex items-center justify-center py-12">
                    <Activity className="animate-spin text-brand" size={32} />
                  </div>
                ) : (
                  <>
                    <div className="bg-surface-muted/50 rounded-2xl p-5 border border-border">
                      <div className="flex items-center gap-3 mb-4 text-brand">
                        <Calendar size={18} />
                        <h4 className="font-bold">{t('saas.tenants.registration_date')}</h4>
                      </div>
                      <p className="text-content font-black text-lg">
                        {new Date(drawerTenant.createdAt).toLocaleDateString(localeOf(i18n.language), {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric'
                        })}
                      </p>
                    </div>

                    <div className="bg-surface-muted/50 rounded-2xl p-5 border border-border">
                      <div className="flex items-center gap-3 mb-4 text-success">
                        <Clock size={18} />
                        <h4 className="font-bold">{t('saas.tenants.last_login_activity')}</h4>
                      </div>
                      <p className="text-content font-black text-lg">
                        {drawerStats.lastLogin ? new Date(drawerStats.lastLogin).toLocaleDateString(localeOf(i18n.language), {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        }) : t('saas.tenants.no_record')}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-surface-muted/50 rounded-2xl p-4 border border-border h-full flex flex-col justify-center">
                        <div className="flex items-center gap-2 mb-2 text-info">
                          <Store size={16} />
                          <h4 className="font-bold text-sm">{t('common.branches._')}</h4>
                        </div>
                        <p className="text-content font-black text-2xl mt-1">{drawerStats.branchesCount}</p>
                      </div>

                      <div className="bg-surface-muted/50 rounded-2xl p-4 border border-border h-full flex flex-col justify-center">
                        <div className="flex items-center gap-2 mb-2 text-warning">
                          <CreditCard size={16} />
                          <h4 className="font-bold text-sm">{t('orders.payment_status')}</h4>
                        </div>
                        <p className="text-content font-bold text-sm mt-1">{drawerStats.paymentStatus}</p>
                      </div>
                    </div>
                  </>
                )}
              </div>
              
              <div className="p-6 border-t border-border bg-surface-muted/30 space-y-3">
                <button
                  onClick={() => handleRequestAccess(drawerTenant.id)}
                  disabled={loading}
                  className="w-full bg-brand text-white py-3.5 rounded-xl font-bold hover:bg-brand/90 transition-all flex items-center justify-center gap-2 shadow-lg shadow-brand/20 disabled:opacity-50"
                >
                  <Globe size={18} />
                  {loading ? t('saas.tenants.requesting_access') : t('saas.tenants.request_support_access')}
                </button>
                
                <button
                  onClick={() => handleStealthLogin(drawerTenant.id)}
                  disabled={loading || !(userRole === 'super_admin' || userRole === 'owner' as any || (dbUser as any)?.can_stealth_login === true || (dbUser as any)?.stealth_login_enabled === true)}
                  className="w-full bg-slate-900 text-white py-3.5 rounded-xl font-bold hover:bg-black transition-all flex items-center justify-center gap-2 shadow-lg shadow-black/20 disabled:opacity-40 disabled:cursor-not-allowed"
                  title={!(userRole === 'super_admin' || userRole === 'owner' as any || (dbUser as any)?.can_stealth_login === true || (dbUser as any)?.stealth_login_enabled === true) ? t('saas.tenants.stealth_login_permission_required') : ""}
                >
                  <ShieldAlert size={18} />
                  {t('saas.tenants.stealth_login')}
                  {!(userRole === 'super_admin' || userRole === 'owner' as any || (dbUser as any)?.can_stealth_login === true || (dbUser as any)?.stealth_login_enabled === true) && (
                    <span className="text-[10px] bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded ml-1">{t('saas.tenants.locked_badge')}</span>
                  )}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
            className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 font-bold text-sm min-w-[300px] justify-center text-white ${toast.type === 'success' ? 'bg-success' : 'bg-danger'}`}
          >
            {toast.type === 'success' ? <CheckCircle size={20} /> : <XCircle size={20} />}
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirm Dialog */}
      <AnimatePresence>
        {confirmDialog && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setConfirmDialog(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-surface w-full max-w-md rounded-3xl shadow-2xl overflow-hidden relative z-10 border border-border flex flex-col p-8 text-center"
            >
              <div className="mx-auto w-16 h-16 bg-brand/10 text-brand rounded-full flex items-center justify-center mb-6">
                <ShieldAlert size={32} />
              </div>
              <h3 className="text-xl font-bold text-content mb-8 leading-relaxed">
                {confirmDialog.title}
              </h3>
              <div className="flex gap-4">
                <button
                  onClick={confirmDialog.onConfirm}
                  className="flex-1 bg-brand text-white py-3 rounded-xl font-bold hover:bg-brand/90 transition-all shadow-lg shadow-brand/20"
                >
                  {t('common.confirm')}
                </button>
                <button
                  onClick={() => setConfirmDialog(null)}
                  className="flex-1 bg-surface-muted text-content font-bold py-3 rounded-xl hover:bg-border transition-all border border-border"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
