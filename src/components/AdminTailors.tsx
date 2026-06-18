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
  Activity
} from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { handleError, OperationType } from '../lib/firebase';
import { TailorRequest, Tenant } from '../types';
import { motion } from 'motion/react';
import { PriceDisplay } from './PriceDisplay';
import { autoSeed } from '../services/seedService';

export default function AdminTailors() {
  const [requests, setRequests] = useState<TailorRequest[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [requestFilter, setRequestFilter] = useState<'pending' | 'approved' | 'all'>('pending');
  const [platformStats, setPlatformStats] = useState({
    totalTenants: 0,
    totalOrders: 0,
    totalRevenue: 0,
    pendingRequests: 0
  });

  useEffect(() => {
    const fetchRequests = async () => {
      const { data } = await supabase
        .from('tailor_requests')
        .select('*');
      
      if (data) {
        const reqs = data.map(d => ({
          ...d,
          shopName: d.shop_name,
          inventoryStrategy: d.inventory_strategy,
          defaultLayout: d.default_layout,
          defaultFulfillment: d.default_fulfillment,
          createdAt: d.created_at
        }) as unknown as TailorRequest);
        setRequests(reqs);
        setPlatformStats(prev => ({ ...prev, pendingRequests: reqs.filter(r => r.status === 'pending').length }));
      }
    };

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
          createdAt: d.created_at
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

    fetchRequests();
    fetchTenants();
    fetchGlobalStats();

    // Listeners
    const reqChannel = supabase.channel('tailor_requests_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tailor_requests' }, () => fetchRequests())
      .subscribe();

    const tenantChannel = supabase.channel('tenants_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tenants' }, () => fetchTenants())
      .subscribe();

    return () => {
      supabase.removeChannel(reqChannel);
      supabase.removeChannel(tenantChannel);
    };
  }, []);

  const handleApprove = async (request: TailorRequest) => {
    try {
      // Find the tenant associated with this request
      // We can search by owner_uid if tenant_id is missing
      const { data: tenantFound, error: tenantFindError } = await supabase
          .from('tenants')
          .select('id')
          .eq('owner_uid', request.uid)
          .maybeSingle();

      // 1. Update Request Status in Supabase
      const { error: reqError } = await supabase
        .from('tailor_requests')
        .update({ status: 'approved' })
        .eq('id', request.id);
      
      if (reqError) throw reqError;
      
      // 2. Activate Tenant Workspace to 'active' if it exists
      if (tenantFound) {
        const { error: tenantError } = await supabase
          .from('tenants')
          .update({
            status: 'active',
            updated_at: new Date().toISOString()
          })
          .eq('id', tenantFound.id);
        
        if (tenantError) throw tenantError;
      }

      alert(tenantFound ? 'تمت الموافقة على الخياط وتفعيل مساحة العمل (في مرحلة التهيئة) بنجاح' : 'تمت الموافقة على الطلب بنجاح. سيتمكن الخياط الآن من إكمال إعدادات المتجر.');
    } catch (error: any) {
      console.error('Error approving tailor:', error);
      alert('حدث خطأ أثناء الموافقة: ' + (error.message || 'خطأ في الصلاحيات'));
    }
  };

  const handleToggleStatus = async (tenant: Tenant) => {
    const isActive = tenant.status === 'active' || tenant.status === 'onboarding';
    const newStatus = isActive ? 'inactive' : 'active';
    if (confirm(`هل أنت متأكد من ${newStatus === 'active' ? 'تفعيل' : 'تعطيل'} هذا الحساب؟`)) {
      const { error } = await supabase
        .from('tenants')
        .update({ status: newStatus })
        .eq('id', tenant.id);
      
      if (error) {
        alert('حدث خطأ أثناء تحديث الحالة');
      }
    }
  };

  const handleManualSeed = async () => {
    if (!confirm('هل تريد إضافة بيانات تجريبية؟ سيتم إضافة خطط ومحلات وطلبات وهمية لتجربة النظام.')) return;
    setLoading(true);
    const success = await autoSeed();
    setLoading(false);
    if (success) {
      alert('تمت إضافة البيانات التجريبية بنجاح! يرجى تحديث الصفحة لرؤية التغييرات.');
      window.location.reload();
    } else {
      alert('تمت إضافة البيانات بالفعل أو حدث خطأ أثناء الإضافة.');
    }
  };

  const statsCards = [
    { label: 'إجمالي المحلات', value: platformStats.totalTenants, icon: Users, color: 'bg-info' },
    { label: 'إجمالي الطلبات', value: platformStats.totalOrders, icon: ShoppingBag, color: 'bg-brand' },
    { label: 'إجمالي المبيعات', value: <PriceDisplay amount={platformStats.totalRevenue} />, icon: DollarSign, color: 'bg-success' },
    { label: 'طلبات معلقة', value: platformStats.pendingRequests, icon: Clock, color: 'bg-warning' },
  ];

  return (
    <div className="space-y-10">
      <header className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold text-content">إدارة المنصة</h2>
          <p className="text-content-muted mt-1">نظرة شاملة على جميع الخياطين والمحلات المشتركة</p>
        </div>
        <button 
          onClick={handleManualSeed}
          className="bg-brand text-white px-6 py-3 rounded-2xl font-bold hover:bg-brand/90 transition-all shadow-lg shadow-brand/10 flex items-center gap-2"
        >
          <Activity size={20} />
          إضافة بيانات تجريبية
        </button>
      </header>

      {/* Platform Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statsCards.map((stat) => (
          <div key={stat.label} className="bg-surface p-6 rounded-3xl border border-border shadow-sm">
            <div className={`${stat.color} w-12 h-12 rounded-2xl flex items-center justify-center text-white mb-4`}>
              <stat.icon size={24} />
            </div>
            <p className="text-content-muted text-sm font-medium">{stat.label}</p>
            <h3 className="text-2xl font-bold text-content mt-1">{stat.value}</h3>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Onboarding Subscription Requests */}
        <div className="xl:col-span-1 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-xl font-bold text-content flex items-center gap-2">
              <Activity className="text-warning" size={20} />
              طلبات الانضمام
            </h3>
            <span className="text-xs font-bold bg-surface-muted px-2 py-1 rounded-xl border border-border text-content-muted">
              {requests.length} طلب
            </span>
          </div>

          {/* Interactive filter toggle */}
          <div className="flex bg-surface-muted p-1 rounded-2xl border border-border gap-1">
            <button
              onClick={() => setRequestFilter('pending')}
              className={`flex-1 text-center py-2 text-xs font-bold rounded-xl transition-all ${
                requestFilter === 'pending' 
                  ? 'bg-surface text-content shadow-sm border border-border/10' 
                  : 'text-content-muted hover:text-content'
              }`}
            >
              الجديدة ({requests.filter(r => r.status === 'pending').length})
            </button>
            <button
              onClick={() => setRequestFilter('approved')}
              className={`flex-1 text-center py-2 text-xs font-bold rounded-xl transition-all ${
                requestFilter === 'approved' 
                  ? 'bg-surface text-content shadow-sm border border-border/10' 
                  : 'text-content-muted hover:text-content'
              }`}
            >
              المعتمدة ({requests.filter(r => r.status === 'approved').length})
            </button>
            <button
              onClick={() => setRequestFilter('all')}
              className={`flex-1 text-center py-2 text-xs font-bold rounded-xl transition-all ${
                requestFilter === 'all' 
                  ? 'bg-surface text-content shadow-sm border border-border/10' 
                  : 'text-content-muted hover:text-content'
              }`}
            >
              الكل ({requests.length})
            </button>
          </div>

          <div className="space-y-4">
            {requests
              .filter(r => {
                if (requestFilter === 'pending') return r.status === 'pending';
                if (requestFilter === 'approved') return r.status === 'approved';
                return true;
              })
              .map((req) => (
                <motion.div 
                  key={req.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-surface p-5 rounded-3xl border border-border shadow-sm space-y-3"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-bold text-content">{req.name || 'مستخدم بدون اسم'}</h4>
                      <p className="text-xs text-content-muted mt-1">{req.email}</p>
                      <p className="text-xs text-brand font-medium mt-1">{req.phone}</p>
                    </div>
                    <div>
                      {req.status === 'approved' ? (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-success/10 text-success tracking-wide">
                          معتمد
                        </span>
                      ) : req.status === 'rejected' ? (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-danger/10 text-danger tracking-wide">
                          مرفوض
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-warning/10 text-warning tracking-wide animate-pulse">
                          معلق
                        </span>
                      )}
                    </div>
                  </div>

                  {req.status === 'pending' && (
                    <div className="flex gap-2 pt-2 border-t border-border">
                      <button 
                        onClick={() => handleApprove(req)}
                        className="flex-1 bg-success text-white py-2 rounded-2xl text-xs font-bold hover:bg-success/90 transition-colors flex items-center justify-center gap-1"
                      >
                        <UserCheck size={14} />
                        تفعيل
                      </button>
                      <button 
                        onClick={() => supabase.from('tailor_requests').update({ status: 'rejected' }).eq('id', req.id)}
                        className="bg-danger/10 text-danger px-3 rounded-2xl text-xs font-bold hover:bg-danger/20 transition-colors"
                      >
                        رفض
                      </button>
                    </div>
                  )}
                </motion.div>
              ))}

            {requests.filter(r => {
              if (requestFilter === 'pending') return r.status === 'pending';
              if (requestFilter === 'approved') return r.status === 'approved';
              return true;
            }).length === 0 && (
              <div className="bg-surface-muted p-8 rounded-3xl text-center border border-dashed border-border">
                <p className="text-content-muted text-sm">لا توجد طلبات في هذا التبويب</p>
              </div>
            )}
          </div>
        </div>

        {/* Tailors List */}
        <div className="xl:col-span-2 space-y-4">
          <h3 className="text-xl font-bold text-content flex items-center gap-2">
            <ShieldCheck className="text-brand" size={20} />
            المحلات المعتمدة
          </h3>
          <div className="bg-surface rounded-3xl border border-border shadow-sm overflow-x-auto whitespace-nowrap scrollbar-hide">
            <table className="w-full text-right min-w-max">
              <thead className="bg-surface-muted text-content-muted text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-4 font-medium">كود العميل</th>
                  <th className="px-6 py-4 font-medium">المحل / المالك</th>
                  <th className="px-6 py-4 font-medium">التواصل</th>
                  <th className="px-6 py-4 font-medium">الحالة</th>
                  <th className="px-6 py-4 font-medium">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tenants.filter(t => t.status !== 'pending').map((tenant) => {
                  const isActive = tenant.status === 'active' || tenant.status === 'onboarding';
                  return (
                    <tr key={tenant.id} className="hover:bg-surface-muted transition-colors">
                      <td className="px-6 py-4">
                        <span className="text-xs font-black bg-surface-muted px-2 py-1 rounded-lg text-content-muted">
                          {tenant.customerId || 'N/A'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-bold text-content">{tenant.name}</div>
                        <div className="text-xs text-content-muted">{tenant.ownerEmail === "nomansa2566512@gmail.com" ? 'مسؤول المنصة' : 'محل مشترك'}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-content-muted">{tenant.ownerEmail}</div>
                        <div className="text-xs text-content-muted">{tenant.phone}</div>
                      </td>
                      <td className="px-6 py-4">
                        {tenant.status === 'active' ? (
                          <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase bg-success/10 text-success tracking-wider">
                            جاهز (نشط)
                          </span>
                        ) : tenant.status === 'onboarding' ? (
                          <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase bg-amber-500/10 text-amber-600 tracking-wider animate-pulse">
                            في التهيئة
                          </span>
                        ) : (
                          <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase bg-danger/10 text-danger tracking-wider">
                            معطل
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {tenant.ownerEmail !== "nomansa2566512@gmail.com" && (
                          <button 
                            onClick={() => handleToggleStatus(tenant)}
                            className={`p-2 rounded-xl transition-colors ${
                              isActive ? 'text-danger/60 hover:bg-danger/10 hover:text-danger' : 'text-success/60 hover:bg-success/10 hover:text-success'
                            }`}
                            title={isActive ? 'تعطيل الحساب' : 'تفعيل الحساب'}
                          >
                            {isActive ? <ShieldAlert size={20} /> : <ShieldCheck size={20} />}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
