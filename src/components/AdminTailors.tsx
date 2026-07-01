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

export default function AdminTailors() {
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
      const date = new Date(order.order_date).toLocaleDateString('ar-SA', { day: 'numeric', month: 'short' });
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
      await supabase.from('support_sessions').insert({
        tenant_id: tenantId,
        saas_user_id: dbUser!.id,
        saas_user_name: dbUser?.display_name || dbUser?.email || 'Admin',
        access_type: 'stealth',
        started_at: new Date().toISOString()
      });

      localStorage.setItem('impersonatedTenantId', tenantId);
      localStorage.setItem('tenant_id', tenantId);
      window.location.href = '/dashboard';
    } catch (e) {
      showToast('خطأ أثناء بدء جلسة الدخول المخفي', 'error');
    }
  };

  const handleRequestAccess = async (tenantId: string) => {
    try {
      setLoading(true);
      const { data, error } = await supabase.from('support_access_requests').insert({
        tenant_id: tenantId,
        saas_user_id: dbUser!.id,
        saas_user_name: dbUser?.display_name || dbUser?.email || 'Support Representative',
        status: 'pending',
        requested_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 15 * 60000).toISOString() // 15 mins expiry
      }).select().single();

      if (error) throw error;

      showToast('تم إرسال طلب الدخول للعميل بنجاح بانتظار الموافقة...', 'success');
      
      // Poll for approval...
      const interval = setInterval(async () => {
        const { data: checkData } = await supabase
          .from('support_access_requests')
          .select('status')
          .eq('id', data.id)
          .single();
          
        if (checkData && checkData.status !== 'pending') {
          clearInterval(interval);
          setLoading(false);
          
          if (checkData.status === 'approved') {
            showToast('تمت موافقة العميل! جاري تسجيل الدخول...', 'success');
            
            // Record explicit session
            await supabase.from('support_sessions').insert({
              tenant_id: tenantId,
              saas_user_id: dbUser!.id,
              saas_user_name: dbUser?.display_name || dbUser?.email || 'Support Representative',
              access_type: 'explicit',
              started_at: new Date().toISOString()
            });

            localStorage.setItem('impersonatedTenantId', tenantId);
            localStorage.setItem('tenant_id', tenantId);
            window.location.href = '/dashboard';
          } else {
            showToast('تم رفض طلب الدخول من قبل العميل.', 'error');
          }
        }
      }, 3000);
      
      // Stop polling after 15 minutes
      setTimeout(() => {
        clearInterval(interval);
        setLoading(false);
        showToast('انتهت صلاحية طلب الموافقة', 'error');
      }, 15 * 60000);

    } catch (e) {
      setLoading(false);
      showToast('خطأ أثناء طلب إذن الدخول', 'error');
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
        paymentStatus: info.isTrial ? 'تجربة مجانية' : (tenant.status === 'active' ? 'مدفوع - نشط' : 'غير نشط')
      });
      
    } catch (e) {
      console.error(e);
      setDrawerStats({
        lastLogin: (tenant as any).updatedAt || null,
        branchesCount: 0,
        paymentStatus: 'غير متوفر'
      });
    }
  };

  const handleUpdateTenantPlan = (tenantId: string, newPlanId: string) => {
    setConfirmDialog({
      title: 'هل أنت متأكد من تغيير الباقة؟',
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          const { error } = await supabase
            .from('tenants')
            .update({ plan_id: newPlanId })
            .eq('id', tenantId);
          
          if (error) throw error;
          setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, planId: newPlanId } : t));
          showToast('تم تحديث الباقة بنجاح', 'success');
        } catch (error) {
          console.error("Error updating tenant plan:", error);
          showToast('فشل تحديث الباقة', 'error');
        }
      }
    });
  };

  const handleExtendTrial = (tenantId: string) => {
    setConfirmDialog({
      title: 'هل أنت متأكد من تمديد الفترة التجريبية 14 يوماً؟',
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
          showToast('تم تمديد الفترة التجريبية لـ 14 يوماً إضافياً', 'success');
        } catch (error) {
          console.error("Error extending trial:", error);
          showToast('فشل تمديد الفترة', 'error');
        }
      }
    });
  };

  const handleToggleStatus = async (tenant: Tenant) => {
    const isActive = tenant.status === 'active' || tenant.status === 'onboarding';
    const newStatus = isActive ? 'inactive' : 'active';
    const msg = isActive 
      ? `هل أنت متأكد من تعطيل حساب ${tenant.name}؟ لن يتمكن المستخدم من الدخول للنظام.`
      : `هل أنت متأكد من تفعيل حساب ${tenant.name}؟`;

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

          showToast(`تم ${isActive ? 'تعطيل' : 'تفعيل'} الحساب بنجاح`, 'success');
        } catch (error: any) {
          console.error('Error updating status:', error);
          showToast('حدث خطأ أثناء تحديث حالة الحساب: ' + (error.message || 'خطأ غير معروف'), 'error');
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const handleManualSeed = () => {
    setConfirmDialog({
      title: 'هل تريد إضافة بيانات تجريبية؟ سيتم إضافة خطط ومحلات وطلبات وهمية لتجربة النظام.',
      onConfirm: async () => {
        setConfirmDialog(null);
        setLoading(true);
        const success = await autoSeed();
        setLoading(false);
        if (success) {
          showToast('تمت إضافة البيانات التجريبية بنجاح! يرجى تحديث الصفحة لرؤية التغييرات.', 'success');
          setTimeout(() => window.location.reload(), 1500);
        } else {
          showToast('تمت إضافة البيانات بالفعل أو حدث خطأ أثناء الإضافة.', 'error');
        }
      }
    });
  };

  const handleRenewSubscription = (tenant: Tenant) => {
    setConfirmDialog({
      title: `هل أنت متأكد من تجديد اشتراك ${tenant.name} لمدة سنة إضافية؟`,
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
            timestamp: now
          });

          const updatedTenant = { ...tenant, status: 'active' as const, createdAt: now };
          
          setTenants(prev => prev.map(t => t.id === tenant.id ? updatedTenant : t));
          
          if (selectedTenant?.id === tenant.id) {
            setSelectedTenant(updatedTenant);
          }

          showToast('تم تجديد الاشتراك بنجاح! تم تصفير عداد المدة من اليوم.', 'success');
        } catch (err) {
          console.error(err);
          showToast('فشل تجديد الاشتراك', 'error');
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const handleActivateSubscription = (tenant: Tenant) => {
    setConfirmDialog({
      title: `هل أنت متأكد من تفعيل حساب ${tenant.name}؟`,
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

          showToast('تم تفعيل الحساب بنجاح!', 'success');
        } catch (err: any) {
          console.error(err);
          showToast('فشل التفعيل: ' + (err.message || 'خطأ غير معروف'), 'error');
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const getPlanName = (planId: string) => {
    return plans.find(p => p.id === planId)?.name || 'خطة مخصصة';
  };

  const getSubscriptionInfo = (tenant: Tenant) => {
    const plan = plans.find(p => p.id === tenant.planId);
    const isTrial = !plan || plan.price === 0 || (tenant.planId && typeof tenant.planId === 'string' && tenant.planId.includes('trial'));
    const creationDate = new Date(tenant.createdAt);
    const now = new Date();
    
    // Assume 14 days trial or 365 days pro based on standard logic if duration not in DB
    const durationDays = isTrial ? 14 : 365;
    const expiryDate = new Date(creationDate);
    expiryDate.setDate(expiryDate.getDate() + durationDays);
    
    const diffTime = expiryDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return {
      type: isTrial ? 'تجربة مجانية' : 'اشتراك مدفوع',
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
    { name: 'نشط', value: activeTenantsCount, color: '#10B981' },
    { name: 'غير نشط', value: Math.max(0, totalTenantsCount - activeTenantsCount), color: '#F3F4F6' }
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
     totalRegistrationsData.push({ date: 'الآن', التسجيلات: 0 });
  }

  return (
    <div className="space-y-10">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h2 className="text-3xl font-black text-content flex items-center gap-3">
            <Users className="text-brand" size={32} />
            إدارة المشتركين والنمو
          </h2>
          <p className="text-content-muted font-bold text-sm mt-1">نظرة شاملة على جميع المحلات وإدارة التراخيص والخطط</p>
        </div>
        
        <div className="flex bg-surface rounded-2xl p-1 border border-border shadow-sm">
          <button
            onClick={() => setActiveTab('tenants')}
            className={`px-6 py-2 rounded-xl text-sm font-black transition-all ${
              activeTab === 'tenants' ? 'bg-brand text-white shadow-lg shadow-brand/20' : 'text-content-muted hover:text-content'
            }`}
          >
            إدارة المشتركين
          </button>
          <button
            onClick={() => setActiveTab('subscriptions')}
            className={`px-6 py-2 rounded-xl text-sm font-black transition-all ${
              activeTab === 'subscriptions' ? 'bg-brand text-white shadow-lg shadow-brand/20' : 'text-content-muted hover:text-content'
            }`}
          >
            إدارة الاشتراكات
          </button>
        </div>
      </header>

      {/* Top Graphical Stats Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Subscribers */}
        <div className="bg-surface p-6 rounded-3xl border border-border shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-content-muted text-sm font-medium mb-1">المشتركين النشطين</p>
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
                <Tooltip formatter={(value: any) => [value, 'مشترك']} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Trial Ending Soon */}
        <div className="bg-surface p-6 rounded-3xl border border-border shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-content-muted text-sm font-medium mb-1">تجارب توشك على الانتهاء</p>
              <h3 className="text-4xl font-black text-warning">{trialExpiringTenantsCount}</h3>
            </div>
            <div className="bg-warning/10 w-12 h-12 rounded-2xl flex items-center justify-center text-warning">
              <Clock size={24} />
            </div>
          </div>
          <div className="h-24 mt-2 w-full flex items-end">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[{ name: 'قريباً', value: trialExpiringTenantsCount }]} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <Bar dataKey="value" fill="#F59E0B" radius={[8, 8, 0, 0]} barSize={50} />
                <Tooltip formatter={(value: any) => [value, 'مشترك']} cursor={{fill: 'transparent'}} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Total Registered Subscribers */}
        <div className="bg-surface p-6 rounded-3xl border border-border shadow-sm flex flex-col justify-between">
            <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-content-muted text-sm font-medium mb-1">إجمالي المسجلين</p>
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
                <Area type="monotone" dataKey="التسجيلات" stroke="#4F46E5" strokeWidth={3} fillOpacity={1} fill="url(#colorReg)" />
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
                  placeholder="بحث عن منشأة، إيميل، أو رقم هاتف..."
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
                <option value="all">كافة الحالات</option>
                <option value="active">نشط</option>
                <option value="inactive">معطل</option>
              </AdminIconSelect>
            </div>
            
            <div className="flex gap-2">
              <button className="px-6 py-3 bg-surface-muted border border-border rounded-2xl font-bold text-sm flex items-center gap-2 hover:bg-border transition-all">
                <Download size={18} />
                تصدير البيانات
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-8">
            {/* Tailors List */}
            <div className="space-y-4">
              <h3 className="text-xl font-bold text-content flex items-center gap-2 px-2">
                <ShieldCheck className="text-brand" size={20} />
                المحلات المعتمدة
              </h3>
              <div className="bg-surface rounded-3xl border border-border shadow-sm overflow-hidden">
                <table className="w-full text-right">
                  <thead className="bg-surface-muted text-content-muted text-[10px] font-black uppercase tracking-widest border-b border-border">
                    <tr>
                      <th className="px-8 py-5">المحل</th>
                      <th className="px-8 py-5">المالك الاتصال</th>
                      <th className="px-8 py-5">الباقة</th>
                      <th className="px-8 py-5">الحالة</th>
                      <th className="px-8 py-5 text-left">العمليات</th>
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
                                <div className="text-[10px] text-content-muted font-bold mt-0.5">{tenant.id}</div>
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
                                نشط
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase bg-danger/10 text-danger border border-danger/20">
                                <Ban size={12} />
                                معطل
                              </span>
                            )}
                          </td>
                          <td className="px-8 py-6">
                            <div className="flex items-center justify-start gap-2">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleImpersonate(tenant.id);
                                }}
                                className="p-2 text-content-muted hover:text-emerald-500 hover:bg-emerald-500/5 rounded-xl transition-all"
                                title="عرض واجهة المحل (Impersonate)"
                              >
                                <Globe size={18} />
                              </button>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedTenant(tenant);
                                }}
                                className="p-2 text-content-muted hover:text-brand hover:bg-brand/5 rounded-xl transition-all"
                                title="تعديل"
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
                                title={isActive ? "تعطيل" : "تفعيل"}
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
                <h3 className="text-xl font-black text-content">إدارة تراخيص وخطط المشتركين</h3>
                <p className="text-content-muted text-xs font-bold mt-1">تمديد الفترات التجريبية، ترقية الباقات، وإدارة الفوترة</p>
              </div>
              <div className="w-full sm:w-80">
                <AdminIconInput 
                  type="text" 
                  placeholder="بحث سريع في المشتركين..."
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
                    <th className="px-8 py-5 text-[10px] font-black text-content-muted uppercase tracking-widest text-center">المشترك</th>
                    <th className="px-8 py-5 text-[10px] font-black text-content-muted uppercase tracking-widest text-center">الباقة الحالية</th>
                    <th className="px-8 py-5 text-[10px] font-black text-content-muted uppercase tracking-widest text-center">الفترة المتبقية</th>
                    <th className="px-8 py-5 text-[10px] font-black text-content-muted uppercase tracking-widest text-center">تعديل الباقة</th>
                    <th className="px-8 py-5 text-[10px] font-black text-content-muted uppercase tracking-widest text-left">إجراءات</th>
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
                                متبقي {sub.daysLeft} يوم
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
                                <option value="free">الباقة المجانية (14 يوم)</option>
                                <option value="basic">الأساسية (599/سنة)</option>
                              </AdminIconSelect>
                            </div>
                          </td>

                          <td className="px-8 py-6 text-left">
                            <button
                              onClick={() => handleExtendTrial(tenant.id)}
                              className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-brand text-white hover:bg-brand/90 rounded-2xl text-xs font-black shadow-lg shadow-brand/20 transition-all active:scale-95 group"
                            >
                              <Clock size={16} className="group-hover:rotate-12 transition-transform" />
                              تمديد الفترة
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
                      {selectedTenant.customerId || 'بدون كود'} • {getPlanName(selectedTenant.planId)}
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
                    <p className="text-xs text-content-muted font-bold mb-1">إجمالي المبيعات (30 يوم)</p>
                    <div className="text-2xl font-black text-content">
                      <PriceDisplay amount={tenantStats?.summary.totalSales || 0} />
                    </div>
                  </div>
                  <div className="bg-surface-muted p-6 rounded-3xl border border-border">
                    <p className="text-xs text-content-muted font-bold mb-1">إجمالي الطلبات (30 يوم)</p>
                    <div className="text-2xl font-black text-content">
                      {tenantStats?.summary.totalOrders || 0} طلب
                    </div>
                  </div>
                  <div className="bg-surface-muted p-6 rounded-3xl border border-border">
                    <p className="text-xs text-content-muted font-bold mb-1">عمر الاشتراك</p>
                    <div className="text-2xl font-black text-content">
                      {Math.ceil((new Date().getTime() - new Date(selectedTenant.createdAt).getTime()) / (1000 * 60 * 60 * 24))} يوم
                    </div>
                  </div>
                </div>

                {/* Subscriptions Section */}
                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-content-muted uppercase tracking-wider flex items-center gap-2">
                    <CreditCard size={16} />
                    تفاصيل الاشتراك والمدة
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
                                <p className="text-xs text-content-muted">باقي على انتهاء المدة: {info.daysLeft} يوم</p>
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
                              <span>تاريخ الانضمام: {new Date(selectedTenant.createdAt).toLocaleDateString('ar-SA')}</span>
                              <span>تاريخ الانتهاء المتوقع: {info.expiryDate.toLocaleDateString('ar-SA')}</span>
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
                                تفعيل الاشتراك
                              </button>
                            ) : (
                              <button 
                                onClick={() => handleRenewSubscription(selectedTenant)}
                                disabled={loading}
                                className="w-full md:w-56 bg-brand text-white py-4 rounded-2xl font-bold hover:bg-brand/90 transition-all shadow-lg shadow-brand/10 flex items-center justify-center gap-2"
                              >
                                <Calendar size={20} />
                                تجديد الاشتراك +سنة
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
                       حجم المبيعات اليومي
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
                          لا توجد بيانات مبيعات كافية للعرض
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h4 className="text-sm font-bold text-content-muted uppercase tracking-wider flex items-center gap-2 px-2">
                       <ShoppingBag size={16} />
                       عدد الطلبات اليومية
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
                          لا توجد بيانات طلبات كافية للعرض
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
                      معلومات التواصل
                    </h4>
                    <div className="bg-surface-muted p-4 rounded-2xl border border-border space-y-3 shadow-inner">
                      <div>
                        <p className="text-[10px] text-content-muted font-bold">البريد الإلكتروني</p>
                        <p className="text-sm font-medium text-content">{selectedTenant.ownerEmail}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-content-muted font-bold">رقم الجوال</p>
                        <p className="text-sm font-medium text-content">{selectedTenant.phone}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-content-muted font-bold">العنوان</p>
                        <p className="text-sm font-medium text-content">{selectedTenant.address || 'غير محدد'}</p>
                      </div>
                    </div>
                  </div>

                  {/* Business Info */}
                  <div className="space-y-4">
                    <h4 className="text-sm font-bold text-content-muted uppercase tracking-wider flex items-center gap-2 px-2">
                      <FileText size={16} />
                      التراخيص والضرائب
                    </h4>
                    <div className="bg-surface-muted p-4 rounded-2xl border border-border space-y-3 shadow-inner">
                      <div>
                        <p className="text-[10px] text-content-muted font-bold">السجل التجاري</p>
                        <p className="text-sm font-medium text-content">{selectedTenant.commercialRegister || 'غير متوفر'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-content-muted font-bold">الرقم الضريبي</p>
                        <p className="text-sm font-medium text-content">{selectedTenant.vatNumber || 'غير متوفر'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-content-muted font-bold">تاريخ الانضمام</p>
                        <p className="text-sm font-medium text-content">
                          {new Date(selectedTenant.createdAt).toLocaleDateString('ar-SA')}
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
                  التحليلات العميقة (Analytics)
                </button>
                {(() => {
                  const isActive = selectedTenant.status === 'active' || selectedTenant.status === 'onboarding';
                  return (
                    <button 
                      onClick={() => handleToggleStatus(selectedTenant)}
                      className="flex-1 bg-surface border border-border text-content font-bold py-4 rounded-2xl hover:bg-surface-muted transition-all flex items-center justify-center gap-2"
                    >
                      {isActive ? <ShieldAlert size={20} className="text-danger" /> : <ShieldCheck size={20} className="text-success" />}
                      {isActive ? 'تعطيل الحساب' : 'تفعيل الحساب'}
                    </button>
                  );
                })()}
                <button 
                  onClick={() => setSelectedTenant(null)}
                  className="flex-1 bg-surface-muted text-content-muted font-bold py-4 rounded-2xl hover:bg-border transition-all border border-border"
                >
                  إغلاق التفاصيل
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
              dir="rtl"
            >
              <div className="flex items-center justify-between p-6 border-b border-border bg-surface-muted/30">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-brand/10 text-brand rounded-xl flex items-center justify-center">
                    <History size={20} />
                  </div>
                  <div>
                    <h3 className="font-black text-content text-lg">سجل نشاط المشترك</h3>
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
                        <h4 className="font-bold">تاريخ التسجيل</h4>
                      </div>
                      <p className="text-content font-black text-lg">
                        {new Date(drawerTenant.createdAt).toLocaleDateString('ar-SA', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric'
                        })}
                      </p>
                    </div>

                    <div className="bg-surface-muted/50 rounded-2xl p-5 border border-border">
                      <div className="flex items-center gap-3 mb-4 text-success">
                        <Clock size={18} />
                        <h4 className="font-bold">آخر دخول / نشاط</h4>
                      </div>
                      <p className="text-content font-black text-lg">
                        {drawerStats.lastLogin ? new Date(drawerStats.lastLogin).toLocaleDateString('ar-SA', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        }) : 'لا يوجد سجل'}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-surface-muted/50 rounded-2xl p-4 border border-border h-full flex flex-col justify-center">
                        <div className="flex items-center gap-2 mb-2 text-info">
                          <Store size={16} />
                          <h4 className="font-bold text-sm">الفروع</h4>
                        </div>
                        <p className="text-content font-black text-2xl mt-1">{drawerStats.branchesCount}</p>
                      </div>

                      <div className="bg-surface-muted/50 rounded-2xl p-4 border border-border h-full flex flex-col justify-center">
                        <div className="flex items-center gap-2 mb-2 text-warning">
                          <CreditCard size={16} />
                          <h4 className="font-bold text-sm">حالة الدفع</h4>
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
                  {loading ? 'جاري طلب الدخول...' : 'طلب إذن الدعم الفني'}
                </button>
                
                {(userRole === 'super_admin' || userRole === 'owner' as any) && (
                  <button
                    onClick={() => handleStealthLogin(drawerTenant.id)}
                    disabled={loading}
                    className="w-full bg-slate-900 text-white py-3.5 rounded-xl font-bold hover:bg-black transition-all flex items-center justify-center gap-2 shadow-lg shadow-black/20 disabled:opacity-50"
                  >
                    <ShieldAlert size={18} />
                    دخول مخفي (Stealth Login)
                  </button>
                )}
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
                  تأكيد
                </button>
                <button
                  onClick={() => setConfirmDialog(null)}
                  className="flex-1 bg-surface-muted text-content font-bold py-3 rounded-xl hover:bg-border transition-all border border-border"
                >
                  إلغاء
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
