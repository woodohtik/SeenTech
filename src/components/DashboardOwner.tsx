import React, { useState, useEffect } from 'react';
import { 
  Users, 
  ShoppingBag, 
  Clock, 
  DollarSign,
  TrendingUp,
  AlertTriangle,
  Package,
  CheckCircle2,
  Info,
  Bell,
  X,
  Download,
  Search,
  ArrowUpDown,
  ExternalLink,
  FileSpreadsheet,
  Store,
  Scissors,
  Calendar,
  Layers,
  BarChart3,
  ChevronRight,
  ChevronDown
} from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { deleteTestDataForTenant } from '../services/trialService';
import { auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { Customer, Order, InventoryItem, AppNotification, OrderStatus, Tenant, BranchInventory } from '../types';
import { STATUS_CONFIG } from './Orders';
import { cn } from '../lib/utils';
import { PriceDisplay } from './PriceDisplay';
import { CurrencySymbol } from './CurrencySymbol';
import { motion, AnimatePresence } from 'motion/react';
import { SmartSelect } from './ui/SmartSelect';
import Header from './Header';
import { useStaff } from '../contexts/StaffContext';
import { usePermissions } from '../hooks/usePermissions';
import { useNavigate } from 'react-router-dom';
import Branding from './Branding';
import { useTranslation } from 'react-i18next';
import DashboardGridCard from './DashboardGridCard';
import * as XLSX from 'xlsx';
import { 
  ComposedChart,
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Bar,
  Cell,
  Legend
} from 'recharts';

interface DashboardProps {
  tenantId: string;
}

const DrillDownModal = ({ 
  drillDown, 
  drillSearch, 
  setDrillSearch, 
  drillSort, 
  setDrillSort, 
  setDrillDown,
  exportToExcel
}: any) => {
  const { t, i18n } = useTranslation();
  if (!drillDown) return null;

  const isRtl = i18n.language !== 'en';
  const dir = isRtl ? 'rtl' : 'ltr';
  const textAlignmentClass = isRtl ? 'text-right' : 'text-left';

  const filteredData = drillDown.data
    .filter((item: any) => 
      Object.values(item).some(val => 
        String(val).toLowerCase().includes(drillSearch.toLowerCase())
      )
    )
    .sort((a: any, b: any) => {
      const valA = a[drillSort.key];
      const valB = b[drillSort.key];
      if (drillSort.dir === 'asc') return valA > valB ? 1 : -1;
      return valA < valB ? 1 : -1;
    });

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
      <motion.div 
        initial={{ scale: 0.95, opacity: 0, y: 20 }} 
        animate={{ scale: 1, opacity: 1, y: 0 }} 
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        className={cn("relative w-full max-w-[clamp(320px,94vw,1100px)] max-h-[90vh] rounded-[var(--radius-card)] bg-[var(--surface)] shadow-2xl flex flex-col my-auto border border-border overflow-hidden", textAlignmentClass)}
        dir={dir}
      >
        {/* Header (Fixed) */}
        <div className="sticky top-0 z-10 flex items-center justify-between p-4 sm:p-6 border-b border-[var(--border)] bg-[var(--surface)] shrink-0 bg-surface-muted/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-brand text-white rounded-2xl shrink-0 shadow-sm">
              <TrendingUp size={20} />
            </div>
            <div>
              <h3 className="text-base sm:text-lg lg:text-xl font-black text-content">{drillDown.title}</h3>
              <p className="text-[10px] text-content-muted font-bold uppercase tracking-widest leading-none mt-0.5">{t('dashboard.drill_down_title')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={() => exportToExcel(filteredData, drillDown.type)}
              className="flex items-center gap-2 bg-success/10 px-4 py-2 rounded-xl border border-success/20 text-xs sm:text-sm font-bold text-success hover:bg-success/20 transition-all cursor-pointer"
            >
              <FileSpreadsheet size={16} />
              {t('dashboard.export_excel')}
            </button>
            <button type="button" onClick={() => setDrillDown(null)} className="p-2 hover:bg-surface-muted rounded-full transition-colors text-content-muted cursor-pointer">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 sm:p-6 bg-surface border-b border-border flex gap-4">
            <div className="flex-1 bg-surface-muted p-3 rounded-xl flex items-center gap-3 border border-transparent focus-within:border-brand/20 transition-all">
              <Search size={18} className="text-content-muted" />
              <input 
                type="text" 
                placeholder={t('dashboard.search_results')} 
                className="bg-transparent border-none focus:ring-0 text-sm w-full font-bold text-content outline-none"
                value={drillSearch}
                onChange={(e) => setDrillSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 overflow-x-auto whitespace-nowrap scrollbar-hide p-4">
            <div className="bg-surface rounded-2xl border border-border overflow-hidden min-w-max">
              <table className="w-full text-right" dir={dir}>
                <thead className="bg-surface-muted text-[10px] font-black text-content-muted uppercase tracking-widest sticky top-0 z-10">
                  <tr>
                    {Object.keys(drillDown.data[0] || {}).filter(k => k !== 'id').map((key, headIdx) => (
                      <th 
                        key={`${key}-${headIdx}`} 
                        className={cn("px-6 py-4 cursor-pointer hover:text-brand transition-colors", textAlignmentClass)}
                        onClick={() => setDrillSort({ key, dir: drillSort.key === key && drillSort.dir === 'asc' ? 'desc' : 'asc' })}
                      >
                        <div className="flex items-center gap-2">
                          {key}
                          <ArrowUpDown size={12} />
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredData.map((row: any, i: number) => (
                    <tr key={row.id || i} className="hover:bg-brand/5 transition-colors">
                      {Object.entries(row).filter(([k]) => k !== 'id').map(([key, val], entryIdx) => (
                        <td key={`${key}-${entryIdx}`} className={cn("px-6 py-4 text-sm font-bold text-content/80", textAlignmentClass)}>
                          {typeof val === 'number' && (
                            key.toLowerCase().includes('amount') || 
                            key.toLowerCase().includes('total') ||
                            key === t('common.amount', 'المبلغ') ||
                            key === t('common.remaining', 'المتبقي') ||
                            key === t('common.total', 'الإجمالي') ||
                            key.includes(t('common.amount')) ||
                            key.includes(t('common.remaining')) ||
                            key.includes(t('common.total'))
                          ) ? <PriceDisplay amount={val} /> : 
                           key === t('common.method', 'طريقة الدفع') || key === t('common.payment_methods.title', 'الطريقة') || key === t('common.payment_method', 'طريقة الدفع:') ? (
                             val === 'cash' ? t('common.payment_methods.cash') :
                             val === 'network' ? t('common.payment_methods.network') :
                             val === 'cash_on_delivery' ? t('common.payment_methods.cash_on_delivery') :
                             val === 'partial' ? t('common.payment_methods.partial') : String(val)
                           ) : key === t('common.status', 'الحالة') ? (
                             val === 'pending' ? t('common.status_pending', 'معلق') :
                             val === 'measurements_taken' ? t('common.status_measurements_taken', 'أخذ المقاسات') :
                             val === 'cutting' ? t('common.status_cutting', 'قص القماش') :
                             val === 'sewing' ? t('common.status_sewing', 'خياطة') :
                             val === 'embroidery' ? t('common.status_embroidery', 'تطريز') :
                             val === 'ironing_packaging' ? t('common.status_ironing_packaging', 'كوي وتغليف') :
                             val === 'ready' ? t('common.status_ready', 'جاهز للاستلام') :
                             val === 'delivered' ? t('common.status_delivered', 'تم التسليم') : val === 'partial_delivered' ? t('common.status_partial_delivered', 'تسليم جزئي') : val === 'cancelled' ? t('common.status_cancelled', 'ملغي') :
                             val === 'in_progress' ? t('common.status_in_progress', 'قيد التنفيذ') : String(val)
                           ) : String(val)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
    </motion.div>
  </div>
  );
};

export default function DashboardOwner({ tenantId }: DashboardProps) {
  const { t, i18n } = useTranslation();
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState({
    customers: 0,
    customersGrowthRate: 0,
    prevCustomers: 0,
    orders: 0,
    ordersGrowthRate: 0,
    prevOrders: 0,
    pending: 0,
    pendingGrowthRate: 0,
    prevPending: 0,
    revenue: 0,
    revenueGrowthRate: 0,
    prevRevenue: 0,
    lowStock: 0,
    receivables: 0,
    avgCompletionTime: 0,
    activeCustomers: 0,
    retentionRate: 0
  });
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [allCustomers, setAllCustomers] = useState<Customer[]>([]);
  const [allInventory, setAllInventory] = useState<InventoryItem[]>([]);
  const [branchInventory, setBranchInventory] = useState<BranchInventory[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);
  const [chartViewMode, setChartViewMode] = useState<'both' | 'revenue' | 'orders'>('both');
  const [statusDistribution, setStatusDistribution] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [drillDown, setDrillDown] = useState<{ type: string, title: string, data: any[] } | null>(null);
  const [drillSearch, setDrillSearch] = useState('');
  const [drillSort, setDrillSort] = useState<{ key: string, dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
  const [revenueRange, setRevenueRange] = useState(7);
  const [growthRate, setGrowthRate] = useState(0);
  const [selectedTimeframe, setSelectedTimeframe] = useState<'all' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom'>('all');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('all');
  const [branches, setBranches] = useState<any[]>([]);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [trialDays, setTrialDays] = useState<number | null>(null);
  const [isTrialPlan, setIsTrialPlan] = useState<boolean>(true);

  const markAsRead = async (id: string) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ status: 'read' })
        .eq('id', id);
      if (error) throw error;
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, status: 'read' } : n));
    } catch (err) {
      console.error('Error marking notification as read:', err);
    }
  };

  const markAllAsRead = async () => {
    if (!tenantId) return;
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ status: 'read' })
        .eq('tenant_id', tenantId)
        .eq('status', 'unread');
      if (error) throw error;
      setNotifications(prev => prev.map(n => ({ ...n, status: 'read' })));
    } catch (err) {
      console.error('Error marking all notifications as read:', err);
    }
  };

  const handleNotificationClick = async (notif: AppNotification) => {
    if (notif.status !== 'read') {
      await markAsRead(notif.id);
    }

    if (notif.type === 'inventory') {
      const itemName = notif.metadata?.item_name || '';
      if (itemName) {
        navigate(`/inventory?filter=low_stock&search=${encodeURIComponent(itemName)}`);
      } else {
        navigate('/inventory?filter=low_stock');
      }
    } else if (notif.type === 'order') {
      const orderId = notif.metadata?.order_id || notif.metadata?.orderId;
      if (orderId) {
        navigate(`/orders?id=${orderId}`);
      } else {
        navigate('/orders');
      }
    } else if (notif.type === 'alert') {
      navigate('/settings?tab=staff');
    } else {
      navigate('/dashboard');
    }

    setIsNotificationsOpen(false);
  };

  useEffect(() => {
    if (tenant) {
      const now = new Date();
      const isTrial = tenant.planId === 'free' || tenant.planId?.includes('trial') || (!tenant.planId && tenant.planId !== 'basic');
      setIsTrialPlan(isTrial);

      if (tenant.subscription_end_date) {
        const subEndDate = new Date(tenant.subscription_end_date);
        const msLeft = subEndDate.getTime() - now.getTime();
        setTrialDays(Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24))));
      } else if (tenant.trial_ends_at) {
        const trialEndDate = new Date(tenant.trial_ends_at);
        const msLeft = trialEndDate.getTime() - now.getTime();
        setTrialDays(Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24))));
      } else if (tenant.createdAt) {
        const createdDate = new Date(tenant.createdAt);
        const diffTime = now.getTime() - createdDate.getTime();
        const diffDays = diffTime / (1000 * 60 * 60 * 24);
        const durationDays = isTrial ? 14 : 365;
        setTrialDays(Math.max(0, durationDays - Math.floor(diffDays)));
      }
    }
  }, [tenant]);

  const { currentStaff } = useStaff();
  const { hasPermission } = usePermissions(currentStaff);

  const hasRevenuePermission = hasPermission('dashboard.revenue');
  const hasOrdersPermission = hasPermission('dashboard.orders') || hasPermission('dashboard.view');
  const hasInventoryPermission = hasPermission('dashboard.inventory') || hasPermission('dashboard.view');
  const hasCustomersPermission = hasPermission('dashboard.customers') || hasPermission('dashboard.view');

  const navigate = useNavigate();
  const isRtl = i18n.language !== 'en';
  const dir = isRtl ? 'rtl' : 'ltr';
  const textAlignmentClass = isRtl ? 'text-right' : 'text-left';

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    try {
      return d.toLocaleDateString(i18n.language === 'ar' ? 'ar-EG-u-nu-latn' : (i18n.language === 'ur' ? 'ur-PK-u-nu-latn' : 'en-US'), {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch (e) {
      return d.toLocaleDateString('en-US');
    }
  };

  useEffect(() => {
    if (!tenantId) return;

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId);
    if (!isUuid) {
      setIsLoading(false);
      return;
    }

    const fetchTenantData = async () => {
      try {
        const { data: tenantData } = await supabase
          .from('tenants')
          .select('*')
          .eq('id', tenantId)
          .single();
        if (tenantData) {
          setTenant({
            id: tenantData.id,
            name: tenantData.name,
            address: tenantData.address,
            phone: tenantData.phone,
            category: tenantData.category,
            inventoryStrategy: tenantData.inventory_strategy,
            defaultLayout: tenantData.default_layout,
            defaultFulfillment: tenantData.default_fulfillment,
            ownerEmail: tenantData.owner_email,
            status: tenantData.status,
            planId: tenantData.plan_id,
            createdAt: tenantData.created_at,
            subscription_end_date: tenantData.subscription_end_date,
            trial_ends_at: tenantData.trial_ends_at
          } as any);
        }

        const { data: branchesData } = await supabase
          .from('branches')
          .select('*')
          .eq('tenant_id', tenantId);
        if (branchesData) {
          setBranches(branchesData.map(b => ({
            id: b.id,
            name: b.name,
            location: b.location,
            phone: b.phone,
            type: b.type,
            tenantId: b.tenant_id,
            isMain: b.is_main
          })));
        }
      } catch (error) {
        console.error('Error fetching tenant/branches:', error);
      }
    };
    fetchTenantData();

    const fetchStats = async () => {
      if (!tenantId) return;
      setIsLoading(true);
      try {
        const [customersRes, ordersRes, inventoryRes, branchInvRes] = await Promise.all([
          supabase.from('customers').select('*').eq('tenant_id', tenantId),
          supabase.from('orders').select('*').eq('tenant_id', tenantId),
          supabase.from('inventory_items').select('*').eq('tenant_id', tenantId),
          supabase.from('branch_inventory').select('*').eq('tenant_id', tenantId)
        ]);

        if (customersRes.error) console.error('Customers query error:', customersRes.error);
        if (ordersRes.error) console.error('Orders query error:', ordersRes.error);
        if (inventoryRes.error) console.error('Inventory query error:', inventoryRes.error);
        if (branchInvRes.error) console.error('Branch Inventory query error:', branchInvRes.error);

        const customers = (customersRes.data || []).map(d => ({
          ...d,
          tenantId: d.tenant_id,
          createdAt: d.created_at
        }) as unknown as Customer);

        let orders = (ordersRes.data || []).map(d => ({
          ...d,
          customerId: d.customer_id || '',
          customerName: d.customer_name || '',
          orderDate: d.order_date || new Date().toISOString(),
          totalAmount: d.total_amount || 0,
          paidAmount: d.paid_amount || 0,
          remainingAmount: d.remaining_amount || 0,
          branchId: d.branch_id || '',
          orderNumber: d.order_number || '',
          createdAt: d.created_at,
          updatedAt: d.updated_at
        }) as unknown as Order);

        if (selectedBranchId !== 'all') {
          orders = orders.filter(o => o.branchId === selectedBranchId);
        }

        const inventory = (inventoryRes.data || []).map(d => ({
          id: d.id,
          name: d.name,
          minThreshold: d.min_threshold || 0,
          tenantId: d.tenant_id,
          quantity: d.quantity || 0
        } as InventoryItem));

        const bInv = (branchInvRes.data || []).map(d => ({
          id: d.id,
          itemId: d.item_id,
          branchId: d.branch_id,
          quantity: d.quantity || 0,
          tenantId: d.tenant_id
        } as BranchInventory));

        setAllOrders(orders);
        setAllInventory(inventory);
        setAllCustomers(customers);
        setBranchInventory(bInv);
        setIsLoading(false);
      } catch (error) {
        console.error('Dashboard Stats Error:', error);
        setIsLoading(false);
      }
    };

    const fetchRecentOrders = async () => {
      if (!hasPermission('orders.view') && !hasPermission('dashboard.orders')) return;
      const { data } = await supabase
        .from('orders')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('order_date', { ascending: false })
        .limit(5);
      if (data) {
        setRecentOrders(data.map(d => ({
          id: d.id,
          customerName: d.customer_name,
          orderDate: d.order_date,
          status: d.status,
          totalAmount: d.total_amount,
          paidAmount: d.paid_amount,
          remainingAmount: d.remaining_amount,
          items: d.items || [],
          deliveryDate: d.delivery_date || d.order_date,
          paymentMethod: d.payment_method || 'cash'
        } as unknown as Order)));
      }
    };

    const fetchNotifications = async () => {
      try {
        // 1. Scan for any real low stock items to create real low stock notifications
        const [invItemsRes, branchInvRes] = await Promise.all([
          supabase.from('inventory_items').select('*').eq('tenant_id', tenantId),
          supabase.from('branch_inventory').select('*').eq('tenant_id', tenantId)
        ]);

        if (invItemsRes.data) {
          const invItems = invItemsRes.data;
          const branchInv = branchInvRes.data || [];
          
          const lowStockItems = invItems.filter(item => {
            const itemBranchInv = branchInv.filter(bi => bi.item_id === item.id);
            const totalQty = itemBranchInv.reduce((sum, bi) => sum + bi.quantity, 0);
            return totalQty <= item.min_threshold;
          });

          // Fetch existing inventory notifications to avoid duplicates
          const { data: existingNotifs } = await supabase
            .from('notifications')
            .select('id, metadata')
            .eq('tenant_id', tenantId)
            .eq('type', 'inventory');

          for (const item of lowStockItems) {
            const itemBranchInv = branchInv.filter(bi => bi.item_id === item.id);
            const totalQty = itemBranchInv.reduce((sum, bi) => sum + bi.quantity, 0);
            
            const title = `تنبيه المخزون: ${item.name}`;
            const message = `الكمية المتبقية من ${item.name} هي ${totalQty} ${item.unit || 'أمتار'} فقط، وهي أقل من حد الأمان المحدد (${item.min_threshold}).`;
            
            const alreadyAlerted = (existingNotifs || []).some(n => {
              const meta = n.metadata || {};
              return meta.item_id === item.id;
            });

            if (!alreadyAlerted) {
              await supabase
                .from('notifications')
                .insert({
                  tenant_id: tenantId,
                  title: title,
                  message: message,
                  type: 'inventory',
                  status: 'unread',
                  created_at: new Date().toISOString(),
                  metadata: { item_id: item.id, item_name: item.name }
                });
            }
          }
        }

        // 2. Fetch the final list of notifications from the DB
        const { data: notifData } = await supabase
          .from('notifications')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false })
          .limit(15);

        if (notifData && notifData.length > 0) {
          setNotifications(notifData.map(d => ({
            id: d.id,
            title: d.title,
            message: d.message,
            type: d.type || 'info',
            createdAt: d.created_at,
            status: d.status,
            metadata: d.metadata || {}
          } as unknown as AppNotification)));
        } else {
          setNotifications([]);
        }
      } catch (err) {
        console.error('Error fetching notifications:', err);
      }
    };

    if (hasPermission('dashboard.view') || hasPermission('orders.view') || hasPermission('dashboard.orders')) {
      fetchStats();
      fetchRecentOrders();
      fetchNotifications();
    }

    // Real-time listeners for Recent Orders and Notifications
    const ordersSubscription = supabase
      .channel('dashboard_updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenantId}` }, () => {
        fetchStats();
        fetchRecentOrders();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `tenant_id=eq.${tenantId}` }, () => {
        fetchNotifications();
      })
      .subscribe();

    const handleDataCleared = () => {
      fetchStats();
      fetchRecentOrders();
      fetchNotifications();
    };
    window.addEventListener('data_cleared', handleDataCleared);

    return () => {
      supabase.removeChannel(ordersSubscription);
      window.removeEventListener('data_cleared', handleDataCleared);
    };
  }, [tenantId, revenueRange, currentStaff?.branchId, selectedBranchId]);

  useEffect(() => {
    const now = new Date();
    let currentPeriodStart: Date | null = null;
    let currentPeriodEnd: Date | null = null;
    let previousPeriodStart: Date | null = null;
    let previousPeriodEnd: Date | null = null;

    if (selectedTimeframe === 'daily') {
      currentPeriodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      currentPeriodEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      previousPeriodStart = new Date(currentPeriodStart);
      previousPeriodStart.setDate(previousPeriodStart.getDate() - 1);
      previousPeriodEnd = new Date(currentPeriodEnd);
      previousPeriodEnd.setDate(previousPeriodEnd.getDate() - 1);
    } else if (selectedTimeframe === 'weekly') {
      currentPeriodStart = new Date();
      currentPeriodStart.setDate(currentPeriodStart.getDate() - 7);
      currentPeriodStart.setHours(0, 0, 0, 0);
      currentPeriodEnd = now;

      previousPeriodStart = new Date(currentPeriodStart);
      previousPeriodStart.setDate(previousPeriodStart.getDate() - 7);
      previousPeriodEnd = new Date(currentPeriodStart);
      previousPeriodEnd.setMilliseconds(previousPeriodEnd.getMilliseconds() - 1);
    } else if (selectedTimeframe === 'monthly') {
      currentPeriodStart = new Date();
      currentPeriodStart.setDate(currentPeriodStart.getDate() - 30);
      currentPeriodStart.setHours(0, 0, 0, 0);
      currentPeriodEnd = now;

      previousPeriodStart = new Date(currentPeriodStart);
      previousPeriodStart.setDate(previousPeriodStart.getDate() - 30);
      previousPeriodEnd = new Date(currentPeriodStart);
      previousPeriodEnd.setMilliseconds(previousPeriodEnd.getMilliseconds() - 1);
    } else if (selectedTimeframe === 'quarterly') {
      currentPeriodStart = new Date();
      currentPeriodStart.setDate(currentPeriodStart.getDate() - 90);
      currentPeriodStart.setHours(0, 0, 0, 0);
      currentPeriodEnd = now;

      previousPeriodStart = new Date(currentPeriodStart);
      previousPeriodStart.setDate(previousPeriodStart.getDate() - 90);
      previousPeriodEnd = new Date(currentPeriodStart);
      previousPeriodEnd.setMilliseconds(previousPeriodEnd.getMilliseconds() - 1);
    } else if (selectedTimeframe === 'yearly') {
      currentPeriodStart = new Date();
      currentPeriodStart.setDate(currentPeriodStart.getDate() - 365);
      currentPeriodStart.setHours(0, 0, 0, 0);
      currentPeriodEnd = now;

      previousPeriodStart = new Date(currentPeriodStart);
      previousPeriodStart.setDate(previousPeriodStart.getDate() - 365);
      previousPeriodEnd = new Date(currentPeriodStart);
      previousPeriodEnd.setMilliseconds(previousPeriodEnd.getMilliseconds() - 1);
    } else if (selectedTimeframe === 'custom') {
      if (customStartDate && customEndDate) {
        currentPeriodStart = new Date(customStartDate);
        currentPeriodStart.setHours(0, 0, 0, 0);
        currentPeriodEnd = new Date(customEndDate);
        currentPeriodEnd.setHours(23, 59, 59, 999);

        const diffMs = currentPeriodEnd.getTime() - currentPeriodStart.getTime();
        previousPeriodStart = new Date(currentPeriodStart.getTime() - diffMs);
        previousPeriodEnd = new Date(currentPeriodStart.getTime() - 1);
      } else {
        currentPeriodStart = new Date();
        currentPeriodStart.setDate(currentPeriodStart.getDate() - 30);
        currentPeriodStart.setHours(0, 0, 0, 0);
        currentPeriodEnd = now;

        previousPeriodStart = new Date(currentPeriodStart);
        previousPeriodStart.setDate(previousPeriodStart.getDate() - 30);
        previousPeriodEnd = new Date(currentPeriodStart);
        previousPeriodEnd.setMilliseconds(previousPeriodEnd.getMilliseconds() - 1);
      }
    }

    const dispRevenue = selectedTimeframe === 'all'
      ? allOrders.reduce((acc, o) => acc + (o.paidAmount || 0), 0)
      : allOrders.filter(o => {
          const d = new Date(o.orderDate || '');
          return d >= currentPeriodStart! && d <= currentPeriodEnd!;
        }).reduce((acc, o) => acc + (o.paidAmount || 0), 0);

    const dispCustomers = selectedTimeframe === 'all'
      ? allCustomers.length
      : allCustomers.filter(c => {
          const d = new Date(c.createdAt || '');
          return d >= currentPeriodStart! && d <= currentPeriodEnd!;
        }).length;

    const dispOrders = selectedTimeframe === 'all'
      ? allOrders.length
      : allOrders.filter(o => {
          const d = new Date(o.orderDate || '');
          return d >= currentPeriodStart! && d <= currentPeriodEnd!;
        }).length;

    const dispPending = selectedTimeframe === 'all'
      ? allOrders.filter(o => !['delivered', 'ready'].includes(o.status)).length
      : allOrders
          .filter(o => !['delivered', 'ready'].includes(o.status))
          .filter(o => {
            const d = new Date(o.orderDate || '');
            return d >= currentPeriodStart! && d <= currentPeriodEnd!;
          }).length;

    let curStart = currentPeriodStart;
    let curEnd = currentPeriodEnd;
    let prevStart = previousPeriodStart;
    let prevEnd = previousPeriodEnd;

    if (selectedTimeframe === 'all') {
      curStart = new Date();
      curStart.setDate(curStart.getDate() - 30);
      curStart.setHours(0, 0, 0, 0);
      curEnd = now;

      prevStart = new Date(curStart);
      prevStart.setDate(prevStart.getDate() - 30);
      prevEnd = new Date(curStart);
      prevEnd.setMilliseconds(prevEnd.getMilliseconds() - 1);
    }

    const curRevenue = allOrders
      .filter(o => {
        const d = new Date(o.orderDate || '');
        return d >= curStart! && d <= curEnd!;
      })
      .reduce((acc, o) => acc + (o.paidAmount || 0), 0);

    const prevRevenue = allOrders
      .filter(o => {
        const d = new Date(o.orderDate || '');
        return d >= prevStart! && d <= prevEnd!;
      })
      .reduce((acc, o) => acc + (o.paidAmount || 0), 0);

    const curCustomersCount = allCustomers.filter(c => {
      const d = new Date(c.createdAt || '');
      return d >= curStart! && d <= curEnd!;
    }).length;

    const prevCustomersCount = allCustomers.filter(c => {
      const d = new Date(c.createdAt || '');
      return d >= prevStart! && d <= prevEnd!;
    }).length;

    const curOrdersCount = allOrders.filter(o => {
      const d = new Date(o.orderDate || '');
      return d >= curStart! && d <= curEnd!;
    }).length;

    const prevOrdersCount = allOrders.filter(o => {
      const d = new Date(o.orderDate || '');
      return d >= prevStart! && d <= prevEnd!;
    }).length;

    const curPendingCount = allOrders
      .filter(o => !['delivered', 'ready'].includes(o.status))
      .filter(o => {
        const d = new Date(o.orderDate || '');
        return d >= curStart! && d <= curEnd!;
      }).length;

    const prevPendingCount = allOrders
      .filter(o => !['delivered', 'ready'].includes(o.status))
      .filter(o => {
        const d = new Date(o.orderDate || '');
        return d >= prevStart! && d <= prevEnd!;
      }).length;

    const calcGrowth = (curr: number, prev: number) => {
      if (prev > 0) {
        return Number((((curr - prev) / prev) * 100).toFixed(1));
      }
      return curr > 0 ? 100 : 0;
    };

    const customersGrowthRate = calcGrowth(curCustomersCount, prevCustomersCount);
    const ordersGrowthRate = calcGrowth(curOrdersCount, prevOrdersCount);
    const pendingGrowthRate = calcGrowth(curPendingCount, prevPendingCount);
    const revenueGrowthRate = calcGrowth(curRevenue, prevRevenue);

    const filteredOrders = selectedTimeframe === 'all'
      ? allOrders
      : allOrders.filter(o => {
          const d = new Date(o.orderDate || '');
          return d >= currentPeriodStart! && d <= currentPeriodEnd!;
        });

    const lowStock = allInventory.filter(item => {
      const itemBranchInv = branchInventory.filter(bi => bi.itemId === item.id);
      const totalQty = itemBranchInv.reduce((sum, bi) => sum + bi.quantity, 0);
      return totalQty <= item.minThreshold;
    }).length;

    const receivables = filteredOrders.reduce((acc, order) => acc + (order.remainingAmount || 0), 0);

    const completedOrders = filteredOrders.filter(o => ['delivered', 'ready'].includes(o.status));
    let totalTimeMs = 0;
    let completionCount = 0;
    completedOrders.forEach(o => {
      const finalHistory = Array.isArray(o.history) 
        ? [...o.history].reverse().find((h: any) => h && ['delivered', 'ready'].includes(h.status))
        : null;
      if (finalHistory) {
        const startTime = new Date(o.orderDate || '').getTime();
        const endTime = new Date(finalHistory.updatedAt || '').getTime();
        if (endTime > startTime) {
          totalTimeMs += (endTime - startTime);
          completionCount++;
        }
      }
    });
    const avgCompletionTime = completionCount > 0 ? (totalTimeMs / (1000 * 60 * 60 * completionCount)) : 0;

    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const activeCustomerIds = new Set(
      filteredOrders
        .filter(o => o.orderDate && new Date(o.orderDate) >= sixtyDaysAgo)
        .map(o => o.customerId)
    );
    const activeCustomers = activeCustomerIds.size;

    const customerOrderCounts: Record<string, number> = {};
    filteredOrders.forEach(o => {
      if (o.customerId) {
        customerOrderCounts[o.customerId] = (customerOrderCounts[o.customerId] || 0) + 1;
      }
    });
    const totalCustomersWithOrders = Object.keys(customerOrderCounts).length;
    const repeatCustomersCount = Object.values(customerOrderCounts).filter(count => count > 1).length;
    const retentionRate = totalCustomersWithOrders > 0 ? (repeatCustomersCount / totalCustomersWithOrders) * 100 : 0;

    setStats({
      customers: dispCustomers,
      customersGrowthRate,
      prevCustomers: prevCustomersCount,
      orders: dispOrders,
      ordersGrowthRate,
      prevOrders: prevOrdersCount,
      pending: dispPending,
      pendingGrowthRate,
      prevPending: prevPendingCount,
      revenue: dispRevenue,
      revenueGrowthRate,
      prevRevenue,
      lowStock,
      receivables,
      avgCompletionTime,
      activeCustomers,
      retentionRate
    });

    setGrowthRate(revenueGrowthRate);

    // --- Chart generation ---
    let chartDataPoints: any[] = [];
    if (selectedTimeframe === 'daily') {
      const intervals = [
        { label: '12 AM - 4 AM', startHour: 0, endHour: 4 },
        { label: '4 AM - 8 AM', startHour: 4, endHour: 8 },
        { label: '8 AM - 12 PM', startHour: 8, endHour: 12 },
        { label: '12 PM - 4 PM', startHour: 12, endHour: 16 },
        { label: '4 PM - 8 PM', startHour: 16, endHour: 20 },
        { label: '8 PM - 12 AM', startHour: 20, endHour: 24 }
      ];
      const arIntervalLabels: Record<string, string> = {
        '12 AM - 4 AM': '12 ص - 4 ص',
        '4 AM - 8 AM': '4 ص - 8 ص',
        '8 AM - 12 PM': '8 ص - 12 م',
        '12 PM - 4 PM': '12 م - 4 م',
        '4 PM - 8 PM': '4 م - 8 م',
        '8 PM - 12 AM': '8 م - 12 ص'
      };
      chartDataPoints = intervals.map(interval => {
        const label = i18n.language === 'ar' ? arIntervalLabels[interval.label] : interval.label;
        const periodOrders = allOrders.filter(o => {
          const d = new Date(o.orderDate || '');
          const isToday = d.toDateString() === now.toDateString();
          if (!isToday) return false;
          const h = d.getHours();
          return h >= interval.startHour && h < interval.endHour;
        });
        return {
          date: label,
          revenue: periodOrders.reduce((sum, o) => sum + (o.paidAmount || 0), 0),
          ordersCount: periodOrders.length
        };
      });
    } else if (selectedTimeframe === 'weekly') {
      const daysOfWeek = Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - i);
        return d.toISOString().split('T')[0];
      }).reverse();
      chartDataPoints = daysOfWeek.map(date => {
        const dayOrders = allOrders.filter(o => {
          const dStr = typeof o.orderDate === 'string' ? o.orderDate : '';
          return dStr.startsWith(date);
        });
        return {
          date: new Date(date).toLocaleDateString(i18n.language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US', { weekday: 'short' }),
          revenue: dayOrders.reduce((sum, o) => sum + (o.paidAmount || 0), 0),
          ordersCount: dayOrders.length
        };
      });
    } else if (selectedTimeframe === 'monthly' || selectedTimeframe === 'all') {
      const rangeDays = selectedTimeframe === 'all' ? revenueRange : 30;
      const days = Array.from({ length: rangeDays }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - i);
        return d.toISOString().split('T')[0];
      }).reverse();
      chartDataPoints = days.map(date => {
        const dayOrders = allOrders.filter(o => {
          const dStr = typeof o.orderDate === 'string' ? o.orderDate : '';
          return dStr.startsWith(date);
        });
        return {
          date: rangeDays > 7 
            ? new Date(date).toLocaleDateString(i18n.language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US', { day: 'numeric', month: 'short' })
            : new Date(date).toLocaleDateString(i18n.language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US', { weekday: 'short' }),
          revenue: dayOrders.reduce((sum, o) => sum + (o.paidAmount || 0), 0),
          ordersCount: dayOrders.length
        };
      });
    } else if (selectedTimeframe === 'quarterly') {
      chartDataPoints = Array.from({ length: 12 }, (_, i) => {
        const startW = new Date();
        startW.setDate(startW.getDate() - (12 - i) * 7);
        const endW = new Date(startW);
        endW.setDate(endW.getDate() + 7);
        const periodOrders = allOrders.filter(o => {
          const d = new Date(o.orderDate || '');
          return d >= startW && d < endW;
        });
        return {
          date: i18n.language === 'ar' ? `أسبوع ${i + 1}` : `W${i + 1}`,
          revenue: periodOrders.reduce((sum, o) => sum + (o.paidAmount || 0), 0),
          ordersCount: periodOrders.length
        };
      });
    } else if (selectedTimeframe === 'yearly') {
      chartDataPoints = Array.from({ length: 12 }, (_, i) => {
        const d = new Date();
        d.setMonth(d.getMonth() - (11 - i));
        const year = d.getFullYear();
        const month = d.getMonth();
        const periodOrders = allOrders.filter(o => {
          const od = new Date(o.orderDate || '');
          return od.getMonth() === month && od.getFullYear() === year;
        });
        return {
          date: d.toLocaleDateString(i18n.language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US', { month: 'short' }),
          revenue: periodOrders.reduce((sum, o) => sum + (o.paidAmount || 0), 0),
          ordersCount: periodOrders.length
        };
      });
    } else if (selectedTimeframe === 'custom') {
      if (currentPeriodStart && currentPeriodEnd) {
        const diffDays = Math.ceil((currentPeriodEnd.getTime() - currentPeriodStart.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays <= 1) {
          const intervals = [
            { label: '12 AM - 4 AM', startHour: 0, endHour: 4 },
            { label: '4 AM - 8 AM', startHour: 4, endHour: 8 },
            { label: '8 AM - 12 PM', startHour: 8, endHour: 12 },
            { label: '12 PM - 4 PM', startHour: 12, endHour: 16 },
            { label: '4 PM - 8 PM', startHour: 16, endHour: 20 },
            { label: '8 PM - 12 AM', startHour: 20, endHour: 24 }
          ];
          const arIntervalLabels: Record<string, string> = {
            '12 AM - 4 AM': '12 ص - 4 ص',
            '4 AM - 8 AM': '4 ص - 8 ص',
            '8 AM - 12 PM': '8 ص - 12 م',
            '12 PM - 4 PM': '12 م - 4 م',
            '4 PM - 8 PM': '4 م - 8 م',
            '8 PM - 12 AM': '8 م - 12 ص'
          };
          chartDataPoints = intervals.map(interval => {
            const label = i18n.language === 'ar' ? arIntervalLabels[interval.label] : interval.label;
            const periodOrders = allOrders.filter(o => {
              const d = new Date(o.orderDate || '');
              if (d < currentPeriodStart! || d > currentPeriodEnd!) return false;
              const h = d.getHours();
              return h >= interval.startHour && h < interval.endHour;
            });
            return {
              date: label,
              revenue: periodOrders.reduce((sum, o) => sum + (o.paidAmount || 0), 0),
              ordersCount: periodOrders.length
            };
          });
        } else if (diffDays <= 14) {
          const days = [];
          const curr = new Date(currentPeriodStart);
          while (curr <= currentPeriodEnd) {
            days.push(curr.toISOString().split('T')[0]);
            curr.setDate(curr.getDate() + 1);
          }
          chartDataPoints = days.map(date => {
            const dayOrders = allOrders.filter(o => {
              const dStr = typeof o.orderDate === 'string' ? o.orderDate : '';
              return dStr.startsWith(date);
            });
            return {
              date: new Date(date).toLocaleDateString(i18n.language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US', { day: 'numeric', month: 'short' }),
              revenue: dayOrders.reduce((sum, o) => sum + (o.paidAmount || 0), 0),
              ordersCount: dayOrders.length
            };
          });
        } else if (diffDays <= 60) {
          const weeksCount = Math.ceil(diffDays / 7);
          chartDataPoints = Array.from({ length: weeksCount }, (_, i) => {
            const startW = new Date(currentPeriodStart!.getTime());
            startW.setDate(startW.getDate() + i * 7);
            const endW = new Date(startW.getTime());
            endW.setDate(endW.getDate() + 7);
            const periodOrders = allOrders.filter(o => {
              const d = new Date(o.orderDate || '');
              return d >= startW && d < endW && d <= currentPeriodEnd!;
            });
            return {
              date: i18n.language === 'ar' ? `أسبوع ${i + 1}` : `W${i + 1}`,
              revenue: periodOrders.reduce((sum, o) => sum + (o.paidAmount || 0), 0),
              ordersCount: periodOrders.length
            };
          });
        } else {
          const monthsCount = Math.ceil(diffDays / 30);
          chartDataPoints = Array.from({ length: monthsCount }, (_, i) => {
            const startM = new Date(currentPeriodStart!.getTime());
            startM.setDate(startM.getDate() + i * 30);
            const endM = new Date(startM.getTime());
            endM.setDate(endM.getDate() + 30);
            const periodOrders = allOrders.filter(o => {
              const d = new Date(o.orderDate || '');
              return d >= startM && d < endM && d <= currentPeriodEnd!;
            });
            return {
              date: startM.toLocaleDateString(i18n.language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US', { month: 'short', year: '2-digit' }),
              revenue: periodOrders.reduce((sum, o) => sum + (o.paidAmount || 0), 0),
              ordersCount: periodOrders.length
            };
          });
        }
      }
    }
    setChartData(chartDataPoints);

    // --- Status Distribution ---
    const statusCounts = filteredOrders.reduce((acc: any, order) => {
      acc[order.status] = (acc[order.status] || 0) + 1;
      return acc;
    }, {});
    const dist = [
      { id: 'pending', name: t('common.status_pending', 'معلق'), value: statusCounts['pending'] || 0, color: 'var(--content-muted)' },
      { id: 'measurements_taken', name: t('common.status_measurements_taken', 'أخذ المقاسات'), value: statusCounts['measurements_taken'] || 0, color: 'var(--color-info)' },
      { id: 'cutting', name: t('common.status_cutting', 'قص القماش'), value: statusCounts['cutting'] || 0, color: 'var(--color-warning)' },
      { id: 'sewing', name: t('common.status_sewing', 'خياطة'), value: statusCounts['sewing'] || 0, color: 'var(--color-brand)' },
      { id: 'embroidery', name: t('common.status_embroidery', 'تطريز'), value: statusCounts['embroidery'] || 0, color: 'var(--color-brand)' },
      { id: 'ironing_packaging', name: t('common.status_ironing_packaging', 'كوي وتغليف'), value: statusCounts['ironing_packaging'] || 0, color: 'var(--color-info)' },
      { id: 'ready', name: t('common.status_ready', 'جاهز للاستلام'), value: statusCounts['ready'] || 0, color: 'var(--color-success)' },
    ];
    setStatusDistribution(dist);

  }, [selectedTimeframe, customStartDate, customEndDate, allOrders, allCustomers, allInventory, branchInventory, revenueRange, i18n.language]);

  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState('all');

  const activeOrdersCount = allOrders.filter(o => !['delivered', 'ready', 'cancelled'].includes(o.status)).length;
  const measurementsCount = allOrders.filter(o => o.status === 'measurements_taken').length;

  const gridItems = [
    { 
      title: t('dashboard.grid.tailoring', 'خياطة وتفصيل'), 
      detail: t('dashboard.grid.tailoring_desc', '{{count}} طلب قيد التنفيذ', { count: activeOrdersCount }), 
      icon: Scissors, 
      color: 'bg-brand',
      onClick: () => navigate('/orders?filter=tailoring') 
    },
    { 
      title: t('dashboard.grid.measurements', 'مواعيد القياس'), 
      detail: t('dashboard.grid.measurements_desc', '{{count}} مواعيد اليوم', { count: measurementsCount }), 
      icon: Calendar, 
      color: 'bg-info',
      onClick: () => navigate('/orders?filter=measurements')
    },
    { 
      title: t('dashboard.grid.inventory', 'إدارة المخزون'), 
      detail: t('dashboard.grid.inventory_desc', '{{count}} مواد ناقصة', { count: stats.lowStock }), 
      icon: Layers, 
      color: 'bg-warning',
      onClick: () => navigate('/inventory')
    },
    { 
      title: t('dashboard.grid.finance', 'التقارير المالية'), 
      detail: stats.revenue > 0 ? (
        <span className="inline-flex items-center gap-1 font-bold">
          <span>{t('dashboard.income_label', 'الدخل')}:</span>
          <PriceDisplay amount={stats.revenue} />
        </span>
      ) : t('dashboard.grid.finance_desc_empty', 'مراجعة أداء الشهر'), 
      icon: BarChart3, 
      color: 'bg-success',
      onClick: () => navigate('/reports')
    }
  ];

  const filters = [
    { id: 'all', label: t('common.all', 'الكل') },
    { id: 'upcoming', label: t('common.upcoming', 'القادمة') },
    { id: 'delivered', label: t('common.delivered', 'تم التسليم') },
    { id: 'pending', label: t('common.pending', 'معلق') },
    { id: 'urgent', label: t('common.urgent', 'عاجل') },
  ];

  const exportToExcel = (data: any[], filename: string) => {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Data");
    XLSX.writeFile(workbook, `${filename}.xlsx`);
  };

  const [isDeleteConfirmVisible, setIsDeleteConfirmVisible] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const deleteTestData = async () => {
    // Instantly close confirm dialog and show immediate response
    setIsDeleteConfirmVisible(false);
    setToast({ 
      message: t('dashboard.deleting_test_data', 'جاري حذف البيانات التجريبية...'), 
      type: 'info' 
    });

    try {
      const result = await deleteTestDataForTenant(tenantId);
      if (result.success) {
        setToast({ 
          message: t('dashboard.delete_test_data_success', `تم حذف البيانات التجريبية بنجاح (${result.deletedCount} سجل)`), 
          type: 'success' 
        });

        // Optimistically clean local state immediately
        setRecentOrders(prev => prev.filter(o => !(o as any).isTest && !(o as any).is_test));
        setAllOrders(prev => prev.filter(o => !(o as any).isTest && !(o as any).is_test));
        setNotifications(prev => prev.filter(n => !(n as any).isTest && !(n as any).is_test));

        // Notify app components to refresh data without forcing a full page reload
        window.dispatchEvent(new CustomEvent('data_cleared'));
      } else {
        setToast({ 
          message: t('dashboard.delete_test_data_error', `حدث خطأ أثناء حذف البيانات: ${result.error || ''}`), 
          type: 'error' 
        });
      }
    } catch (error) {
      setToast({ message: t('dashboard.delete_test_data_error', 'حدث خطأ أثناء حذف البيانات'), type: 'error' });
      handleFirestoreError(error as any, OperationType.DELETE, 'test_data');
    }
  };

  const getComparisonLabel = () => {
    switch (selectedTimeframe) {
      case 'daily':
        return i18n.language === 'ar' ? 'مقارنة بالأمس' : 'vs Yesterday';
      case 'weekly':
        return i18n.language === 'ar' ? 'مقارنة بالأسبوع الماضي' : 'vs Last Week';
      case 'monthly':
        return i18n.language === 'ar' ? 'مقارنة بالشهر الماضي' : 'vs Last Month';
      case 'quarterly':
        return i18n.language === 'ar' ? 'مقارنة بالربع الماضي' : 'vs Last Quarter';
      case 'yearly':
        return i18n.language === 'ar' ? 'مقارنة بالسنة الماضية' : 'vs Last Year';
      case 'custom':
        return i18n.language === 'ar' ? 'مقارنة بالفترة السابقة' : 'vs Previous Period';
      case 'all':
      default:
        return i18n.language === 'ar' ? 'مقارنة بالشهر الماضي' : 'vs Last Month';
    }
  };

  const getComparisonLabelShort = () => {
    switch (selectedTimeframe) {
      case 'daily':
        return i18n.language === 'ar' ? '(الأمس)' : '(Yesterday)';
      case 'weekly':
        return i18n.language === 'ar' ? '(الأسبوع الماضي)' : '(Last Week)';
      case 'monthly':
        return i18n.language === 'ar' ? '(الشهر الماضي)' : '(Last Month)';
      case 'quarterly':
        return i18n.language === 'ar' ? '(الربع الماضي)' : '(Last Quarter)';
      case 'yearly':
        return i18n.language === 'ar' ? '(السنة الماضية)' : '(Last Year)';
      case 'custom':
        return i18n.language === 'ar' ? '(الفترة السابقة)' : '(Prev. Period)';
      case 'all':
      default:
        return i18n.language === 'ar' ? '(الشهر الماضي)' : '(Last Month)';
    }
  };

  const statCards = [
    { 
      label: t('dashboard.total_customers'), 
      value: stats.customers, 
      icon: Users, 
      color: 'bg-brand', 
      trend: stats.customersGrowthRate >= 0 ? `+${stats.customersGrowthRate}%` : `${stats.customersGrowthRate}%`,
      comparisonLabel: getComparisonLabel(),
      prevValue: stats.prevCustomers !== undefined ? `${stats.prevCustomers} ${i18n.language === 'ar' ? 'عميل' : 'customers'}` : undefined,
      visible: hasCustomersPermission,
      onClick: () => setDrillDown({ 
        type: 'customers', 
        title: t('dashboard.total_customers'), 
        data: allCustomers.map(c => ({ id: c.id, [t('common.name')]: c.name, [t('common.phone')]: c.phone, [t('common.date')]: formatDate(c.createdAt) }))
      })
    },
    { 
      label: t('dashboard.total_revenue'), 
      value: <PriceDisplay amount={stats.revenue} />, 
      icon: DollarSign, 
      color: 'bg-success', 
      trend: stats.revenueGrowthRate >= 0 ? `+${stats.revenueGrowthRate}%` : `${stats.revenueGrowthRate}%`,
      comparisonLabel: getComparisonLabel(),
      prevValue: stats.prevRevenue !== undefined ? <PriceDisplay amount={stats.prevRevenue} /> : undefined,
      visible: hasRevenuePermission,
      onClick: () => setDrillDown({ 
        type: 'revenue', 
        title: t('dashboard.total_revenue'), 
        data: allOrders.map(o => ({ id: o.id, [t('common.customers')]: o.customerName, [t('common.amount')]: o.paidAmount, [t('common.date')]: formatDate(o.orderDate), [t('common.status')]: o.status, [t('common.method')]: o.paymentMethod }))
      })
    },
    { 
      label: t('dashboard.receivables'), 
      value: <PriceDisplay amount={(stats as any).receivables || 0} />, 
      icon: AlertTriangle, 
      color: 'bg-danger', 
      trend: t('dashboard.trend.collect', 'تحصيل'),
      visible: hasRevenuePermission,
      onClick: () => setDrillDown({ 
        type: 'receivables', 
        title: t('dashboard.receivables'), 
        data: allOrders.filter(o => (o.remainingAmount || 0) > 0).map(o => ({ id: o.id, [t('common.customers')]: o.customerName, [t('common.remaining')]: o.remainingAmount, [t('common.total')]: o.totalAmount, [t('common.date')]: formatDate(o.orderDate) }))
      })
    },
    { 
      label: t('dashboard.active_orders'), 
      value: stats.pending, 
      icon: Clock, 
      color: 'bg-warning', 
      trend: stats.pendingGrowthRate >= 0 ? `+${stats.pendingGrowthRate}%` : `${stats.pendingGrowthRate}%`,
      comparisonLabel: getComparisonLabel(),
      prevValue: stats.prevPending !== undefined ? `${stats.prevPending} ${i18n.language === 'ar' ? 'طلب' : 'orders'}` : undefined,
      visible: hasOrdersPermission,
      onClick: () => setDrillDown({ 
        type: 'pending_orders', 
        title: t('dashboard.active_orders'), 
        data: allOrders.filter(o => !['delivered', 'ready'].includes(o.status)).map(o => ({ id: o.id, [t('common.customers')]: o.customerName, [t('common.status')]: o.status, [t('common.date')]: formatDate(o.orderDate) }))
      })
    },
    { 
      label: t('dashboard.avg_completion_time'), 
      value: `${(stats as any).avgCompletionTime?.toFixed(1) || 0} ${t('common.hours', 'ساعة')}`, 
      icon: Clock, 
      color: 'bg-info', 
      trend: t('dashboard.trend.performance', 'أداء'),
      visible: hasOrdersPermission,
      onClick: () => setDrillDown({ 
        type: 'completion_time', 
        title: t('dashboard.avg_completion_time'), 
        data: allOrders.filter(o => ['delivered', 'ready'].includes(o.status)).map(o => {
          const finalHistory = o.history && [...o.history].reverse().find(h => ['delivered', 'ready'].includes(h.status));
          const hours = finalHistory ? (new Date(finalHistory.updatedAt).getTime() - new Date(o.orderDate).getTime()) / (1000 * 60 * 60) : 0;
          return { id: o.id, [t('common.customers')]: o.customerName, [t('common.date')]: formatDate(o.orderDate), [t('dashboard.completion_time_value')]: hours.toFixed(1) };
        })
      })
    },
    { 
      label: t('dashboard.active_customers'), 
      value: (stats as any).activeCustomers, 
      icon: Users, 
      color: 'bg-info', 
      trend: t('dashboard.trend.engagement', 'تفاعل'),
      visible: hasCustomersPermission,
      onClick: () => {
        const sixtyDaysAgo = new Date();
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
        const activeIds = new Set(allOrders.filter(o => new Date(o.orderDate) >= sixtyDaysAgo).map(o => o.customerId));
        setDrillDown({ 
          type: 'active_customers', 
          title: t('dashboard.active_customers'), 
          data: allCustomers.filter(c => activeIds.has(c.id)).map(c => ({ id: c.id, [t('common.name')]: c.name, [t('common.phone')]: c.phone, [t('common.date')]: formatDate(c.createdAt) }))
        });
      }
    },
    { 
      label: t('dashboard.customer_retention'), 
      value: `${(stats as any).retentionRate?.toFixed(1) || 0}%`, 
      icon: TrendingUp, 
      color: 'bg-info', 
      trend: t('dashboard.trend.loyalty', 'ولاء'),
      visible: hasCustomersPermission,
      onClick: () => {
        const customerOrderCounts: Record<string, number> = {};
        allOrders.forEach(o => {
          customerOrderCounts[o.customerId] = (customerOrderCounts[o.customerId] || 0) + 1;
        });
        setDrillDown({ 
          type: 'retention', 
          title: t('dashboard.customer_retention'), 
          data: allCustomers.filter(c => (customerOrderCounts[c.id] || 0) > 1).map(c => ({ id: c.id, [t('common.name')]: c.name, [t('common.phone')]: c.phone, [t('dashboard.orders_count')]: customerOrderCounts[c.id] }))
        });
      }
    },
    { 
      label: t('dashboard.inventory_alerts'), 
      value: stats.lowStock, 
      icon: AlertTriangle, 
      color: stats.lowStock > 0 ? 'bg-danger' : 'bg-surface-muted', 
      trend: stats.lowStock > 0 ? t('dashboard.trend.critical', 'هام') : t('dashboard.trend.stable', 'مستقر'),
      isAlert: stats.lowStock > 0,
      visible: hasInventoryPermission,
      onClick: () => setDrillDown({ 
        type: 'low_stock', 
        title: t('dashboard.inventory_alerts'), 
        data: allInventory.flatMap(i => {
          const itemBranchInv = branchInventory.filter(bi => bi.itemId === i.id);
          return itemBranchInv
            .filter(bi => bi.quantity <= i.minThreshold)
            .map(bi => ({
              id: `${bi.branchId}_${i.id}`,
              [t('common.item')]: i.name,
              [t('common.branch')]: branches.find(b => b.id === bi.branchId)?.name || t('inventory.type_warehouse', 'المستودع'),
              [t('common.quantity')]: bi.quantity,
              [t('common.min_threshold')]: i.minThreshold,
              [t('common.unit')]: i.unit
            }));
        })
      })
    },
  ];

  const visibleStatCards = statCards.filter(card => card.visible);

  if (isLoading) {
    return (
      <div className={cn("space-y-8 animate-pulse", textAlignmentClass)} dir={dir}>
        <div className="h-24 bg-surface rounded-3xl border border-border"></div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-32 bg-surface rounded-[2rem] border border-border shadow-sm"></div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="h-[400px] bg-surface rounded-[2.5rem] border border-border"></div>
          <div className="h-[400px] bg-surface rounded-[2.5rem] border border-border"></div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-8", textAlignmentClass)} dir={dir}>
      <Header 
        tenantId={tenantId} 
        title={t('dashboard.title')} 
        subtitle={t('dashboard.subtitle', { name: tenant?.name || t('common.tailor_system') })}
      >
        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 w-full sm:w-auto justify-end">
          {/* Branch Filter */}
          <div className="w-full sm:w-56 shrink-0">
            <SmartSelect
              value={selectedBranchId}
              onChange={setSelectedBranchId}
              options={[
                { value: 'all', label: t('common.all_branches', 'جميع الفروع'), icon: <Store size={16} className="text-brand shrink-0" /> },
                ...branches.map(b => ({ value: b.id, label: b.name, icon: <Store size={16} className="text-brand shrink-0" /> }))
              ]}
            />
          </div>

          {/* Timeframe Filter */}
          <div className="w-full sm:w-48 shrink-0">
            <SmartSelect
              value={selectedTimeframe}
              onChange={(val) => setSelectedTimeframe(val as any)}
              options={[
                { value: 'all', label: i18n.language === 'ar' ? 'كامل القراءات' : 'All Time', icon: <Calendar size={16} className="text-brand shrink-0" /> },
                { value: 'daily', label: i18n.language === 'ar' ? 'يومي' : 'Daily', icon: <Calendar size={16} className="text-brand shrink-0" /> },
                { value: 'weekly', label: i18n.language === 'ar' ? 'أسبوعي' : 'Weekly', icon: <Calendar size={16} className="text-brand shrink-0" /> },
                { value: 'monthly', label: i18n.language === 'ar' ? 'شهري' : 'Monthly', icon: <Calendar size={16} className="text-brand shrink-0" /> },
                { value: 'quarterly', label: i18n.language === 'ar' ? 'ربع سنوي' : 'Quarterly', icon: <Calendar size={16} className="text-brand shrink-0" /> },
                { value: 'yearly', label: i18n.language === 'ar' ? 'سنوي' : 'Yearly', icon: <Calendar size={16} className="text-brand shrink-0" /> },
                { value: 'custom', label: i18n.language === 'ar' ? 'فترة مخصصة' : 'Custom Period', icon: <Calendar size={16} className="text-brand shrink-0" /> },
              ]}
            />
          </div>

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3 justify-between sm:justify-end w-full sm:w-auto">
            <button 
              onClick={() => setIsDeleteConfirmVisible(true)}
              className="flex items-center gap-1.5 sm:gap-2 bg-danger/10 text-danger px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl sm:rounded-2xl font-bold text-xs hover:bg-danger/20 transition-all border border-danger/20 shrink-0"
            >
              <AlertTriangle size={15} />
              {t('dashboard.delete_test_data')}
            </button>
            <div className="bg-surface p-2 sm:p-2.5 rounded-xl sm:rounded-2xl border border-border flex items-center gap-2 sm:gap-3 shadow-sm shrink-0">
              <div className="p-1 sm:p-1.5 bg-success/10 text-success rounded-lg sm:rounded-xl">
                <TrendingUp size={16} />
              </div>
              <div>
                <p className="text-[8px] sm:text-[10px] font-bold text-content-muted uppercase leading-none">
                  {t('dashboard.growth_rate')} {getComparisonLabelShort()}
                </p>
                <div className="flex flex-col sm:flex-row sm:items-center gap-1 mt-0.5 sm:mt-1">
                  <p className={cn(
                    "text-xs sm:text-sm font-black leading-none",
                    growthRate >= 0 ? "text-success" : "text-danger"
                  )}>
                    {growthRate >= 0 ? '+' : ''}{growthRate}%
                  </p>
                  <span className="text-[8px] sm:text-[10px] text-content-muted font-bold whitespace-nowrap">
                    ({i18n.language === 'ar' ? 'السابق:' : 'Prev:'} <PriceDisplay amount={stats.prevRevenue} />)
                  </span>
                </div>
              </div>
            </div>
            <div className="relative shrink-0">
              <button 
                onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
                className="relative p-2 sm:p-3 bg-surface rounded-xl sm:rounded-2xl border border-border shadow-sm hover:bg-surface-muted transition-colors"
              >
                <Bell size={18} className="text-content-muted sm:size-6" />
                {notifications.some(n => n.status === 'unread') && (
                  <span className="absolute top-1.5 right-1.5 sm:top-2 sm:right-2 w-2 h-2 sm:w-3 sm:h-3 bg-danger border-2 border-surface rounded-full" />
                )}
              </button>
              
              <AnimatePresence>
                {isNotificationsOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsNotificationsOpen(false)} />
                    <motion.div 
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute left-0 mt-2 w-72 sm:w-80 bg-surface rounded-3xl shadow-2xl border border-border z-50 overflow-hidden"
                    >
                      <div className="p-4 border-b border-border flex justify-between items-center bg-surface-muted/50">
                        <h4 className="text-sm font-black text-content">{t('dashboard.notifications')}</h4>
                        <div className="flex items-center gap-2">
                          {notifications.some(n => n.status === 'unread') && (
                            <button 
                              onClick={markAllAsRead} 
                              className="text-[10px] font-black text-brand hover:underline cursor-pointer"
                            >
                              {i18n.language === 'ar' ? 'تحديد الكل كمقروء' : 'Mark all as read'}
                            </button>
                          )}
                          <span className="text-[10px] font-bold text-brand bg-brand/10 px-2 py-0.5 rounded-full">
                            {notifications.filter(n => n.status === 'unread').length} {t('dashboard.new_notifications')}
                          </span>
                        </div>
                      </div>
                      <div className="max-h-96 overflow-y-auto p-2 space-y-1">
                        {notifications.length > 0 ? (
                          notifications.map(notif => (
                            <div 
                              key={notif.id} 
                              onClick={() => handleNotificationClick(notif)}
                              className={cn(
                                "p-3 rounded-2xl transition-colors cursor-pointer group flex items-start justify-between",
                                notif.status === 'read' ? "hover:bg-surface-muted/50 opacity-75" : "bg-brand/5 hover:bg-brand/10"
                              )}
                            >
                              <div className="flex gap-3 flex-1">
                                <div className={cn(
                                  "p-2 rounded-xl h-fit",
                                  notif.type === 'inventory' ? "bg-danger/10 text-danger" : "bg-brand/10 text-brand"
                                )}>
                                  {notif.type === 'inventory' ? <AlertTriangle size={16} /> : <Bell size={16} />}
                                </div>
                                <div className="flex-1">
                                  <p className="text-xs font-black text-content group-hover:text-brand transition-colors">{notif.title}</p>
                                  <p className="text-[10px] text-content-muted mt-0.5 leading-relaxed">{notif.message}</p>
                                  <p className="text-[9px] text-content-muted mt-1 font-bold">
                                    {new Date(notif.createdAt).toLocaleTimeString(i18n.language === 'ar' ? 'ar-EG-u-nu-latn' : (i18n.language === 'ur' ? 'ur-PK-u-nu-latn' : 'en-US'), { hour: '2-digit', minute: '2-digit' })}
                                  </p>
                                </div>
                              </div>
                              {notif.status === 'unread' && (
                                <div className="w-2 h-2 rounded-full bg-brand shrink-0 mt-2 self-start animate-pulse" title="unread" />
                              )}
                            </div>
                          ))
                        ) : (
                          <div className="py-8 text-center">
                            <CheckCircle2 size={32} className="text-content-muted/30 mx-auto mb-2" />
                            <p className="text-xs text-content-muted font-bold">{t('dashboard.no_notifications')}</p>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </Header>

      {trialDays !== null && trialDays < 3 && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-amber-500/10 dark:bg-amber-500/5 border border-amber-500/20 rounded-[2rem] p-6 lg:p-8 flex flex-col md:flex-row items-center justify-between gap-6"
        >
          <div className="flex items-center gap-4 text-right" dir="rtl">
            <div className="w-12 h-12 bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded-2xl flex items-center justify-center shrink-0 animate-pulse">
              <AlertTriangle size={24} />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-amber-950 dark:text-amber-200">
                {i18n.language === 'en' ? (isTrialPlan ? 'Trial Period Ending Soon!' : 'Subscription Expiring Soon!') : (isTrialPlan ? 'اقتراب انتهاء الفترة التجريبية!' : 'اقتراب انتهاء الاشتراك!')}
              </h3>
              <p className="text-xs sm:text-sm font-medium text-amber-700/85 dark:text-amber-400/85 mt-1 leading-relaxed">
                {i18n.language === 'en' ? (
                  trialDays === 0 
                  ? (isTrialPlan ? "Your free trial has ended today. Contact support to keep access." : "Your subscription has ended today. Contact support to renew.")
                  : `Only ${trialDays} day${trialDays === 1 ? '' : 's'} remaining. Contact support to upgrade.`
                ) : (
                  trialDays === 0 
                  ? (isTrialPlan ? "لقد انتهت الفترة التجريبية اليوم. يرجى التواصل مع الدعم لتفعيل الحساب ومتابعة أعمالك بسلاسة." : "لقد انتهى الاشتراك اليوم. يرجى التواصل مع الدعم لتجديد الاشتراك.")
                  : `متبقي ${trialDays === 1 ? 'يوم واحد فقط' : (trialDays === 2 ? 'يومان فقط' : `${trialDays} أيام`)} على انتهاء ${isTrialPlan ? 'الفترة التجريبية' : 'الاشتراك'}. يرجى التواصل مع الدعم.`
                )}
              </p>
            </div>
          </div>
          <a 
            href="mailto:nomansa2566512@gmail.com?subject=تفعيل حساب سين"
            className="w-full md:w-auto bg-amber-600 hover:bg-amber-700 text-white px-6 py-3.5 rounded-2xl font-bold text-xs sm:text-sm shadow-lg shadow-amber-900/10 transition-all shrink-0 flex items-center justify-center gap-2 border border-amber-700/20"
          >
            <ExternalLink size={15} />
            {i18n.language === 'en' ? 'Contact Support' : 'تواصل مع الدعم وتفعيل الاشتراك'}
          </a>
        </motion.div>
      )}
      
      {/* Mobile Horizontal Filters */}
      <div className="flex overflow-x-auto gap-2 pb-2 -mx-4 px-4 scrollbar-hide lg:hidden">
        {filters.map((filter) => (
          <button
            key={filter.id}
            onClick={() => setActiveFilter(filter.id)}
            className={cn(
              "whitespace-nowrap px-6 py-2.5 rounded-full text-xs font-black transition-all",
              activeFilter === filter.id 
                ? "bg-brand text-white shadow-lg shadow-brand/20" 
                : "bg-surface border border-border text-content-muted"
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Main Grid Actions - Mobile First */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-2">
        {gridItems.map((item, i) => (
          <motion.div
            key={item.title}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.1 }}
          >
            <DashboardGridCard 
              {...item}
              isActive={i === 0 || i === 1}
            />
          </motion.div>
        ))}
      </div>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {isDeleteConfirmVisible && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 sm:p-6">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm" 
              onClick={() => setIsDeleteConfirmVisible(false)} 
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }} 
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-surface w-full max-w-md rounded-3xl shadow-2xl relative z-10 p-8 text-center border border-border"
            >
              <div className="w-20 h-20 bg-danger/10 text-danger rounded-full flex items-center justify-center mx-auto mb-6">
                <AlertTriangle size={40} />
              </div>
              <h3 className="text-2xl font-black text-content mb-2">{t('dashboard.delete_test_data')}</h3>
              <p className="text-content-muted font-bold mb-8 leading-relaxed">
                {t('dashboard.delete_test_data_desc')}
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={deleteTestData}
                  className="flex-1 bg-danger text-white py-4 rounded-2xl font-black hover:bg-danger/80 transition-all shadow-lg shadow-danger/20"
                >
                  {t('dashboard.yes_delete')}
                </button>
                <button 
                  onClick={() => setIsDeleteConfirmVisible(false)}
                  className="flex-1 bg-surface-muted text-content-muted py-4 rounded-2xl font-black hover:bg-surface-muted/80 transition-all border border-border"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 50, x: '-50%' }}
            className={cn(
              "fixed bottom-8 left-1/2 z-[120] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 border min-w-[300px]",
              toast.type === 'success' ? "bg-success/10 text-success border-success/20" : toast.type === 'info' ? "bg-brand/10 text-brand border-brand/20" : "bg-danger/10 text-danger border-danger/20"
            )}
          >
            {toast.type === 'success' ? <CheckCircle2 size={20} /> : toast.type === 'info' ? <Info size={20} /> : <AlertTriangle size={20} />}
            <span className="font-black text-sm">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Custom Timeframe inputs */}
      {selectedTimeframe === 'custom' && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-surface rounded-2xl border border-border shadow-sm mb-6"
        >
          <div className="flex items-center gap-2">
            <Calendar size={18} className="text-brand animate-pulse" />
            <span className="text-xs sm:text-sm font-black text-content">
              {i18n.language === 'ar' ? 'تحديد فترة مخصصة لاستعراض البيانات' : 'Select custom date range for data review'}
            </span>
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="flex items-center gap-2 flex-1 sm:flex-none">
              <span className="text-xs font-bold text-content-muted">
                {i18n.language === 'ar' ? 'من:' : 'From:'}
              </span>
              <input
                type="date"
                id="custom-start-date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="w-full bg-surface-muted border border-border rounded-xl px-3.5 py-2 text-xs font-bold text-content focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand transition-all"
              />
            </div>
            <div className="flex items-center gap-2 flex-1 sm:flex-none">
              <span className="text-xs font-bold text-content-muted">
                {i18n.language === 'ar' ? 'إلى:' : 'To:'}
              </span>
              <input
                type="date"
                id="custom-end-date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="w-full bg-surface-muted border border-border rounded-xl px-3.5 py-2 text-xs font-bold text-content focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand transition-all"
              />
            </div>
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {visibleStatCards.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            onClick={stat.onClick}
            className="bg-surface p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-border shadow-sm hover:shadow-xl transition-all group cursor-pointer"
          >
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <div className={cn(stat.color, "p-3 sm:p-4 rounded-xl sm:rounded-2xl text-white shadow-lg shadow-current/20 group-hover:scale-110 transition-transform")}>
                <stat.icon className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <span className={cn(
                "text-[10px] sm:text-xs font-black px-2 py-1 rounded-lg",
                stat.trend.startsWith('+') ? "bg-success/10 text-success" : 
                stat.trend.startsWith('-') ? "bg-danger/10 text-danger" :
                (stat.isAlert || stat.trend === t('dashboard.trend.critical', 'هام')) ? "bg-danger/10 text-danger" : "bg-surface-muted text-content-muted"
              )}>
                {stat.trend}
              </span>
            </div>
            <p className="text-content-muted text-[10px] sm:text-xs font-black uppercase tracking-widest">{stat.label}</p>
            <h3 className="text-2xl sm:text-3xl font-black text-content mt-1">
              {typeof stat.value === 'number' ? stat.value.toLocaleString('en-US') : stat.value}
            </h3>
            {stat.comparisonLabel && (
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/40 text-[10px] sm:text-xs">
                <span className="text-content-muted font-bold">
                  {stat.comparisonLabel}
                </span>
                {(stat as any).prevValue !== undefined && (
                  <span className="text-content font-black">
                    {(stat as any).prevValue}
                  </span>
                )}
              </div>
            )}
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
        {/* Revenue Chart */}
        {hasRevenuePermission && (() => {
          const totalPeriodRevenue = chartData.reduce((acc, curr) => acc + (Number(curr.revenue) || 0), 0);
          const totalPeriodOrders = chartData.reduce((acc, curr) => acc + (Number(curr.ordersCount) || 0), 0);
          const avgDailyRevenue = chartData.length > 0 ? Math.round(totalPeriodRevenue / chartData.length) : 0;
          const maxRevenueDay = chartData.length > 0 
            ? chartData.reduce((max, d) => (d.revenue > (max?.revenue || 0) ? d : max), chartData[0]) 
            : { revenue: 0, date: '-' };

          return (
            <div className="lg:col-span-2 bg-surface rounded-2xl sm:rounded-3xl md:rounded-[2.5rem] border border-border shadow-sm p-4 sm:p-6 md:p-8 flex flex-col justify-between transition-all">
              {/* Header with Title and Control Pills */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <div className="flex items-center gap-2.5">
                    <div className="p-2.5 bg-brand/10 text-brand rounded-2xl shrink-0">
                      <TrendingUp size={20} />
                    </div>
                    <div>
                      <h3 className="text-lg sm:text-xl font-black text-content">{t('dashboard.revenue_analysis', 'مخطط تحليل الإيرادات')}</h3>
                      <p className="text-xs sm:text-sm text-content-muted font-medium mt-0.5">
                        {t('dashboard.revenue_analysis_desc', 'مقارنة تفصيلية للأداء المالي وعدد الطلبات خلال الفترة')}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Controls: View Mode & Time Range */}
                <div className="flex flex-wrap items-center gap-2 sm:gap-3 shrink-0">
                  {/* View Mode Toggle */}
                  <div className="bg-surface-muted p-1 rounded-2xl flex items-center border border-border text-xs font-bold">
                    <button
                      type="button"
                      onClick={() => setChartViewMode('both')}
                      className={cn(
                        "px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer",
                        chartViewMode === 'both' ? "bg-surface text-brand shadow-sm font-black" : "text-content-muted hover:text-content"
                      )}
                    >
                      <span>{t('dashboard.chart_both', 'الكل')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setChartViewMode('revenue')}
                      className={cn(
                        "px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer",
                        chartViewMode === 'revenue' ? "bg-surface text-brand shadow-sm font-black" : "text-content-muted hover:text-content"
                      )}
                    >
                      <span className="w-2 h-2 rounded-full bg-brand"></span>
                      <span>{t('dashboard.revenue', 'المبيعات')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setChartViewMode('orders')}
                      className={cn(
                        "px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer",
                        chartViewMode === 'orders' ? "bg-surface text-info shadow-sm font-black" : "text-content-muted hover:text-content"
                      )}
                    >
                      <span className="w-2 h-2 rounded-full bg-info"></span>
                      <span>{t('dashboard.orders', 'الطلبات')}</span>
                    </button>
                  </div>

                  {/* Days Selector */}
                  <div className="bg-surface-muted p-1 rounded-2xl flex items-center border border-border text-xs font-bold">
                    <button
                      type="button"
                      onClick={() => setRevenueRange(7)}
                      className={cn(
                        "px-3 py-1.5 rounded-xl transition-all cursor-pointer",
                        revenueRange === 7 ? "bg-brand text-white shadow-sm font-black" : "text-content-muted hover:text-content"
                      )}
                    >
                      7 {t('common.days', 'أيام')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRevenueRange(30)}
                      className={cn(
                        "px-3 py-1.5 rounded-xl transition-all cursor-pointer",
                        revenueRange === 30 ? "bg-brand text-white shadow-sm font-black" : "text-content-muted hover:text-content"
                      )}
                    >
                      30 {t('common.day', 'يوم')}
                    </button>
                  </div>
                </div>
              </div>

              {/* Quick Summary Metric Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 mb-6">
                <div className="bg-surface-muted/60 border border-border/80 rounded-2xl p-3 flex flex-col justify-between">
                  <span className="text-[10px] font-bold text-content-muted uppercase tracking-wider">{t('dashboard.total_in_period', 'إجمالي الفترة')}</span>
                  <span className="text-sm sm:text-base md:text-lg font-black text-brand mt-1 truncate">
                    <PriceDisplay amount={totalPeriodRevenue} />
                  </span>
                </div>

                <div className="bg-surface-muted/60 border border-border/80 rounded-2xl p-3 flex flex-col justify-between">
                  <span className="text-[10px] font-bold text-content-muted uppercase tracking-wider">{t('dashboard.daily_avg', 'المتوسط اليومي')}</span>
                  <span className="text-sm sm:text-base md:text-lg font-black text-content mt-1 truncate">
                    <PriceDisplay amount={avgDailyRevenue} />
                  </span>
                </div>

                <div className="bg-surface-muted/60 border border-border/80 rounded-2xl p-3 flex flex-col justify-between">
                  <span className="text-[10px] font-bold text-content-muted uppercase tracking-wider">{t('dashboard.peak_day', 'أعلى يوم مبيعات')}</span>
                  <div className="flex items-baseline gap-1 mt-1 truncate">
                    <span className="text-sm sm:text-base md:text-lg font-black text-success">
                      <PriceDisplay amount={maxRevenueDay?.revenue || 0} />
                    </span>
                    {maxRevenueDay?.date && maxRevenueDay.revenue > 0 && (
                      <span className="text-[10px] font-bold text-content-muted truncate">({maxRevenueDay.date})</span>
                    )}
                  </div>
                </div>

                <div className="bg-surface-muted/60 border border-border/80 rounded-2xl p-3 flex flex-col justify-between">
                  <span className="text-[10px] font-bold text-content-muted uppercase tracking-wider">{t('dashboard.period_orders', 'الطلبات الإجمالية')}</span>
                  <span className="text-sm sm:text-base md:text-lg font-black text-info mt-1 truncate">
                    {totalPeriodOrders.toLocaleString('en-US')} <span className="text-xs font-bold text-content-muted">{t('common.order', 'طلب')}</span>
                  </span>
                </div>
              </div>

              {/* Main Graph Area */}
              <div className="h-72 sm:h-80 relative flex-1">
                {(chartData.length === 0 || chartData.every(d => d.revenue === 0 && d.ordersCount === 0)) && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface/90 backdrop-blur-md z-10 p-6 rounded-3xl text-center border border-border/50">
                    <div className="p-4 bg-brand/10 text-brand rounded-full mb-3 border border-brand/20 shadow-sm mx-auto">
                      <DollarSign size={28} />
                    </div>
                    <h4 className="text-base font-black text-content mb-1">{t('dashboard.no_revenue_analytics_yet', 'لا توجد تحليلات مالية بعد')}</h4>
                    <p className="text-xs text-content-muted font-medium max-w-sm mx-auto">{t('dashboard.no_revenue_analytics_yet_desc', 'بمجرد تسجيل مبيعات أو فواتير مدفوعة، ستظهر البيانات التحليلية والرسوم البيانية هنا.')}</p>
                  </div>
                )}

                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 15, right: 10, left: 10, bottom: 5 }}>
                    <defs>
                      <linearGradient id="colorRevenueGlow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.4}/>
                        <stop offset="50%" stopColor="var(--brand)" stopOpacity={0.12}/>
                        <stop offset="100%" stopColor="var(--brand)" stopOpacity={0.0}/>
                      </linearGradient>
                      <linearGradient id="colorOrdersBar" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--info)" stopOpacity={0.8}/>
                        <stop offset="100%" stopColor="var(--info)" stopOpacity={0.3}/>
                      </linearGradient>
                    </defs>
                    
                    <CartesianGrid 
                      strokeDasharray="4 4" 
                      vertical={false} 
                      stroke="var(--border)" 
                      opacity={0.5} 
                    />

                    <XAxis 
                      dataKey="date" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: 'var(--content-muted)', fontSize: 11, fontWeight: 700 }}
                      dy={10}
                    />

                    <YAxis 
                      yAxisId="left"
                      hide={chartViewMode === 'orders'}
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: 'var(--content-muted)', fontSize: 11, fontWeight: 700 }}
                      tickFormatter={(value) => {
                        if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
                        if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
                        return value;
                      }}
                      dx={isRtl ? 10 : -10}
                    />

                    <YAxis 
                      yAxisId="right"
                      orientation="right"
                      hide={chartViewMode === 'revenue'}
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: 'var(--content-muted)', fontSize: 11, fontWeight: 700 }}
                      allowDecimals={false}
                      dx={isRtl ? -10 : 10}
                    />

                    <Tooltip 
                      cursor={{ stroke: 'var(--brand)', strokeWidth: 1.5, strokeDasharray: '4 4', opacity: 0.6 }}
                      content={({ active, payload, label }) => {
                        if (active && payload && payload.length) {
                          const revVal = payload.find(p => p.dataKey === 'revenue')?.value as number || 0;
                          const ordersVal = payload.find(p => p.dataKey === 'ordersCount')?.value as number || 0;
                          const isPeak = revVal > 0 && revVal === maxRevenueDay?.revenue;
                          const sharePct = totalPeriodRevenue > 0 ? ((revVal / totalPeriodRevenue) * 100).toFixed(1) : '0';
                          const avgOrderVal = ordersVal > 0 ? Math.round(revVal / ordersVal) : 0;

                          return (
                            <div className="bg-surface/95 backdrop-blur-md p-4 rounded-2xl shadow-2xl border border-border text-right min-w-[220px] animate-in fade-in zoom-in-95 duration-150">
                              <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-border/60">
                                <span className="text-xs font-black text-content">{label}</span>
                                {isPeak ? (
                                  <span className="text-[10px] font-black bg-success/15 text-success px-2 py-0.5 rounded-full flex items-center gap-1">
                                    🔥 {t('dashboard.peak_day_badge', 'أعلى مبيعات')}
                                  </span>
                                ) : revVal > avgDailyRevenue && revVal > 0 ? (
                                  <span className="text-[10px] font-bold bg-brand/10 text-brand px-2 py-0.5 rounded-full">
                                    📈 {t('dashboard.above_avg', 'فوق المتوسط')}
                                  </span>
                                ) : null}
                              </div>

                              <div className="space-y-2.5">
                                {(chartViewMode === 'both' || chartViewMode === 'revenue') && (
                                  <div className="flex flex-col gap-0.5">
                                    <div className="flex items-center justify-between gap-4 text-xs font-bold">
                                      <div className="flex items-center gap-1.5 text-content-muted">
                                        <span className="w-2.5 h-2.5 rounded-full bg-brand shrink-0"></span>
                                        <span>{t('dashboard.revenue', 'المبيعات')}:</span>
                                      </div>
                                      <span className="font-black text-brand text-sm">
                                        <PriceDisplay amount={revVal} />
                                      </span>
                                    </div>
                                    {totalPeriodRevenue > 0 && (
                                      <div className="text-[10px] font-semibold text-content-muted text-left">
                                        {sharePct}% {t('dashboard.of_total_period', 'من إجمالي الفترة')}
                                      </div>
                                    )}
                                  </div>
                                )}

                                {(chartViewMode === 'both' || chartViewMode === 'orders') && (
                                  <div className="flex flex-col gap-0.5">
                                    <div className="flex items-center justify-between gap-4 text-xs font-bold">
                                      <div className="flex items-center gap-1.5 text-content-muted">
                                        <span className="w-2.5 h-2.5 rounded-full bg-info shrink-0"></span>
                                        <span>{t('dashboard.orders', 'الطلبات')}:</span>
                                      </div>
                                      <span className="font-black text-info text-sm">
                                        {ordersVal} {t('common.order', 'طلب')}
                                      </span>
                                    </div>
                                    {ordersVal > 0 && (
                                      <div className="text-[10px] font-semibold text-content-muted text-left">
                                        {t('dashboard.avg_basket', 'متوسط الطلب')}: <PriceDisplay amount={avgOrderVal} />
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />

                    {(chartViewMode === 'both' || chartViewMode === 'orders') && (
                      <Bar 
                        yAxisId="right"
                        name={t('dashboard.orders', 'الطلبات')}
                        dataKey="ordersCount" 
                        fill="url(#colorOrdersBar)" 
                        radius={[6, 6, 0, 0]} 
                        barSize={18}
                      />
                    )}

                    {(chartViewMode === 'both' || chartViewMode === 'revenue') && (
                      <Area 
                        yAxisId="left"
                        name={t('dashboard.revenue', 'المبيعات')}
                        type="monotone" 
                        dataKey="revenue" 
                        stroke="var(--brand)" 
                        strokeWidth={3.5}
                        fillOpacity={1} 
                        fill="url(#colorRevenueGlow)"
                        activeDot={{ r: 7, strokeWidth: 3, stroke: 'var(--surface)', fill: 'var(--brand)' }}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })()}

        {/* Status Breakdown */}
        {hasOrdersPermission && (
          <div className={cn("bg-surface rounded-2xl sm:rounded-3xl md:rounded-[2.5rem] border border-border shadow-sm p-4 sm:p-6 md:p-8 flex flex-col justify-between", !hasRevenuePermission && "lg:col-span-3")}>
            <div>
              <h3 className="text-xl font-black text-content mb-2">{t('dashboard.status_distribution')}</h3>
              <p className="text-sm text-content-muted font-medium mb-8">{t('dashboard.status_distribution_desc', 'مراحل العمل الحالية في المشغل')}</p>
              
              {allOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="p-4 bg-brand/5 text-brand rounded-full mb-3 border border-brand/10 mx-auto">
                    <Clock size={28} />
                  </div>
                  <h4 className="text-base font-black text-content mb-1">{t('dashboard.no_orders_in_progress', 'لا توجد طلبات جارية')}</h4>
                  <p className="text-xs text-content-muted font-bold max-w-xs mx-auto mb-4">{t('dashboard.no_orders_in_progress_desc', 'كافة مراحل التصنيع والقص والخياطة والقياسات ستظهر هنا بمجرد إنشاء طلب جديد.')}</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {statusDistribution.map((status, idx) => {
                    const maxVal = Math.max(...statusDistribution.map(s => s.value)) || 1;
                    const percentage = (status.value / maxVal) * 100;
                    const config = STATUS_CONFIG[status.id as keyof typeof STATUS_CONFIG];
                    const Icon = config?.icon || Clock;
                    
                    return (
                      <motion.div 
                        key={status.id} 
                        whileHover={{ x: -5 }}
                        className="group cursor-pointer" 
                        onClick={() => setDrillDown({ 
                          type: status.id, 
                          title: `${t('common.orders')}: ${status.name}`,
                          data: allOrders.filter(o => o.status === status.id).map(o => ({
                            id: o.id,
                            [t('common.customers')]: o.customerName,
                            [t('common.amount')]: o.totalAmount,
                            [t('common.date')]: formatDate(o.orderDate),
                            [t('common.status')]: o.status
                          }))
                        })}
                      >
                        <div className="flex justify-between items-center mb-2">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-xl transition-all group-hover:scale-110" style={{ backgroundColor: `${status.color}15`, color: status.color }}>
                              <Icon size={18} />
                            </div>
                            <span className="text-sm font-black text-content/80 group-hover:text-brand transition-colors">{status.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-black text-content">{status.value.toLocaleString('en-US')}</span>
                            <span className="text-[10px] font-bold text-content-muted uppercase tracking-widest">{t('common.order')}</span>
                          </div>
                        </div>
                        <div className="h-2.5 bg-surface-muted rounded-full overflow-hidden shadow-inner relative">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${percentage}%` }}
                            transition={{ duration: 1, delay: idx * 0.1, ease: "easeOut" }}
                            className="h-full rounded-full shadow-sm relative z-10"
                            style={{ backgroundColor: status.color }}
                          />
                          <div className="absolute inset-0 bg-content/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-8 pt-8 border-t border-border grid grid-cols-2 gap-4">
              <div className="bg-brand/5 p-4 rounded-2xl">
                <p className="text-[10px] font-black text-brand uppercase tracking-widest">{t('dashboard.in_progress', 'قيد التنفيذ')}</p>
                <p className="text-xl font-black text-brand">{stats.pending.toLocaleString('en-US')}</p>
              </div>
              <div className="bg-success/10 p-4 rounded-2xl">
                <p className="text-[10px] font-black text-success uppercase tracking-widest">{t('dashboard.ready', 'جاهز')}</p>
                <p className="text-xl font-black text-success">{allOrders.filter(o => o.status === 'ready').length.toLocaleString('en-US')}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
        {/* Recent Orders Table */}
        {hasOrdersPermission && (
          <div className="lg:col-span-2 bg-surface rounded-2xl sm:rounded-3xl md:rounded-[2.5rem] border border-border shadow-sm overflow-hidden">
            <div className="p-4 sm:p-6 md:p-8 border-b border-border flex justify-between items-center">
              <h3 className="text-lg sm:text-xl font-black text-content">{t('dashboard.recent_orders')}</h3>
              <button 
                onClick={() => setDrillDown({ 
                  type: 'all_orders', 
                  title: t('dashboard.all_orders', 'جميع الطلبات'), 
                  data: allOrders.map(o => ({ id: o.id, [t('common.customers')]: o.customerName, [t('common.amount')]: o.totalAmount, [t('common.date')]: formatDate(o.orderDate), [t('common.status')]: o.status }))
                })}
                className="text-brand text-sm font-bold hover:underline"
              >
                {t('dashboard.view_all')}
              </button>
            </div>
            <div className="overflow-x-auto whitespace-nowrap scrollbar-hide">
              <table className={cn("w-full min-w-max", textAlignmentClass)} dir={dir}>
                <thead className="bg-surface-muted/50 text-content-muted text-[10px] uppercase font-black tracking-widest">
                  <tr>
                    <th className={cn("px-8 py-4", textAlignmentClass)}>{t('common.customer', 'العميل')}</th>
                    <th className={cn("px-8 py-4", textAlignmentClass)}>{t('common.status', 'الحالة')}</th>
                    <th className={cn("px-8 py-4", textAlignmentClass)}>{t('common.amount', 'المبلغ')}</th>
                    <th className={cn("px-8 py-4", textAlignmentClass)}>{t('common.date', 'التاريخ')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {recentOrders.length > 0 ? (
                    recentOrders.map((order) => (
                      <React.Fragment key={order.id}>
                        <tr 
                          onClick={() => setExpandedOrder(expandedOrder === order.id ? null : order.id)}
                          className={cn(
                            "hover:bg-brand/5 transition-all duration-200 group cursor-pointer",
                            expandedOrder === order.id && "bg-brand/5"
                          )}
                        >
                          <td className="px-8 py-5">
                            <div className="flex items-center gap-3">
                              <div className={cn(
                                "w-8 h-8 rounded-full flex items-center justify-center text-xs font-black transition-transform group-hover:scale-110",
                                order.status === 'delivered' ? "bg-success/10 text-success" : "bg-brand/10 text-brand"
                              )}>
                                {order.customerName.charAt(0)}
                              </div>
                              <div>
                                <p className="text-sm font-black text-content group-hover:text-brand transition-colors">{order.customerName}</p>
                                <p className="text-[10px] text-content-muted font-bold">#{order.id.slice(-6).toUpperCase()}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-8 py-5">
                            <span className={cn(
                              "px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-wider",
                              order.status === 'delivered' ? "bg-success/10 text-success" :
                              order.status === 'ready' ? "bg-brand/10 text-brand" :
                              order.status === 'cancelled' ? "bg-danger/10 text-danger" :
                              "bg-warning/10 text-warning"
                            )}>
                              {order.status === 'delivered' ? t('common.status_delivered', 'تم التسليم') :
                               order.status === 'ready' ? t('common.status_ready', 'جاهز للاستلام') :
                               order.status === 'measurements_taken' ? t('common.status_measurements_taken', 'أخذ المقاسات') :
                               order.status === 'cutting' ? t('common.status_cutting', 'قص القماش') :
                               order.status === 'sewing' ? t('common.status_sewing', 'خياطة') :
                               order.status === 'embroidery' ? t('common.status_embroidery', 'تطريز') :
                               order.status === 'ironing_packaging' ? t('common.status_ironing_packaging', 'كوي وتغليف') :
                               order.status === 'partial_delivered' ? t('common.status_partial_delivered', 'تسليم جزئي') :
                               order.status === 'cancelled' ? t('common.status_cancelled', 'ملغي') :
                               t('common.status_in_progress', 'قيد التنفيذ')}
                            </span>
                          </td>
                          <td className="px-8 py-5">
                            <p className="text-sm font-black text-content"><PriceDisplay amount={order.totalAmount} /></p>
                            <p className="text-[10px] text-success font-bold">{t('common.paid', 'مدفوع')}: <PriceDisplay amount={order.paidAmount} /></p>
                          </td>
                          <td className="px-8 py-5 text-sm text-content-muted font-bold">
                            <div className="flex items-center justify-between">
                              {formatDate(order.orderDate)}
                              <motion.div
                                animate={{ rotate: expandedOrder === order.id ? 180 : 0 }}
                                className="text-content-muted/30 group-hover:text-brand"
                              >
                                <ArrowUpDown size={14} />
                              </motion.div>
                            </div>
                          </td>
                        </tr>
                        <AnimatePresence>
                          {expandedOrder === order.id && (
                            <tr>
                              <td colSpan={4} className="px-8 py-0">
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  className="overflow-hidden"
                                >
                                  <div className="py-6 grid grid-cols-1 md:grid-cols-3 gap-6 border-t border-border">
                                    <div className="space-y-2">
                                      <p className="text-[10px] font-black text-content-muted uppercase">{t('common.items', 'الأصناف')}</p>
                                      <div className="space-y-1">
                                        {order.items.map((item, idx) => (
                                          <div key={idx} className="flex justify-between text-xs font-bold text-content/70 bg-surface-muted p-2 rounded-lg">
                                            <span>{item.garmentType} ({item.fabric})</span>
                                            <span>x{item.quantity}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                    <div className="space-y-2">
                                      <p className="text-[10px] font-black text-content-muted uppercase">{t('common.appointments', 'مواعيد')}</p>
                                      <div className="space-y-2">
                                        <div className="flex items-center gap-2 text-xs font-bold">
                                          <Clock size={14} className="text-brand/60" />
                                          <span className="text-content-muted">{t('common.delivery_date', 'تاريخ الاستلام:')}</span>
                                          <span className="text-content/80">{formatDate(order.deliveryDate)}</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-xs font-bold">
                                          <DollarSign size={14} className="text-success" />
                                          <span className="text-content-muted">{t('common.payment_method', 'طريقة الدفع:')}</span>
                                          <span className="text-content/80">
                                            {order.paymentMethod === 'cash' ? t('common.payment_methods.cash') :
                                             order.paymentMethod === 'network' ? t('common.payment_methods.network') :
                                             order.paymentMethod === 'cash_on_delivery' ? t('common.payment_methods.cash_on_delivery') : t('common.payment_methods.partial')}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex flex-col justify-end">
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          navigate(`/orders?id=${order.id}`);
                                        }}
                                        className="w-full bg-brand text-white py-3 rounded-xl font-black text-xs flex items-center justify-center gap-2 hover:bg-brand/90 shadow-lg shadow-brand/10 transition-all cursor-pointer"
                                      >
                                        <ExternalLink size={14} />
                                        {t('common.view_details', 'عرض كامل التفاصيل')}
                                      </button>
                                    </div>
                                  </div>
                                </motion.div>
                              </td>
                            </tr>
                          )}
                        </AnimatePresence>
                      </React.Fragment>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="px-8 py-16 text-center">
                        <div className="bg-surface-muted w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border border-border text-content-muted/40">
                          <ShoppingBag size={32} />
                        </div>
                        <h4 className="text-base font-black text-content mb-1">{t('dashboard.no_orders_yet', 'لا توجد طلبات بعد')}</h4>
                        <p className="text-xs text-content-muted font-bold max-w-sm mx-auto">{t('dashboard.no_orders_yet_desc', 'سيتم إدراج أحدث طلبات العملاء وحالات خياطتها وتفصيلها هنا فور إنشائها.')}</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Recent Notifications / Low Stock */}
        <div className="space-y-6">
          <div className="bg-surface rounded-2xl sm:rounded-3xl md:rounded-[2.5rem] border border-border shadow-sm p-4 sm:p-6 md:p-8">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg sm:text-xl font-black text-content">{t('dashboard.notifications', 'التنبيهات')}</h3>
              <span className="bg-danger/10 text-danger text-[10px] font-black px-2 py-1 rounded-lg">{t('common.active', 'نشط')}</span>
            </div>
            <div className="space-y-4">
              {notifications.length > 0 ? (
                notifications.map((notif) => (
                  <div 
                    key={notif.id} 
                    onClick={() => handleNotificationClick(notif)}
                    className={cn(
                      "flex gap-4 p-4 rounded-2xl border transition-all cursor-pointer",
                      notif.status === 'read' 
                        ? "bg-surface-muted/50 border-border opacity-75 hover:bg-surface-muted" 
                        : "bg-brand/5 border-brand/20 hover:bg-brand/10 hover:shadow-sm"
                    )}
                  >
                    <div className={cn(
                      "p-2 rounded-xl h-fit",
                      notif.type === 'inventory' ? "bg-danger/10 text-danger" : "bg-brand/10 text-brand"
                    )}>
                      {notif.type === 'inventory' ? <AlertTriangle size={18} /> : <Bell size={18} />}
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between items-start gap-2">
                        <p className="text-sm font-black text-content">{notif.title}</p>
                        {notif.status === 'unread' && (
                          <span className="bg-brand text-white text-[9px] font-black px-1.5 py-0.5 rounded-full animate-pulse whitespace-nowrap">
                            {i18n.language === 'ar' ? 'جديد' : 'New'}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-content-muted mt-1 leading-relaxed">{notif.message}</p>
                      <p className="text-[9px] text-content-muted/60 mt-2 font-bold">
                        {new Date(notif.createdAt).toLocaleDateString(i18n.language === 'ar' ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-12">
                  <div className="bg-surface-muted w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 size={32} className="text-content-muted/30" />
                  </div>
                  <p className="text-sm font-bold text-content-muted">{t('dashboard.no_new_notifications', 'لا توجد تنبيهات جديدة')}</p>
                </div>
              )}
            </div>
          </div>

          {hasInventoryPermission && (
            <div className="bg-brand rounded-2xl sm:rounded-3xl md:rounded-[2.5rem] p-4 sm:p-6 md:p-8 text-white shadow-xl shadow-brand/20 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform">
                <Package size={120} />
              </div>
              <div className="relative z-10">
                <h4 className="text-lg font-black mb-2">{t('common.inventory', 'المخزون')}</h4>
                <p className="text-white/80 text-sm font-medium mb-6">{t('dashboard.low_stock_materials', 'هناك {{count}} مواد تحتاج لإعادة طلب', { count: stats.lowStock })}</p>
                <button 
                  onClick={() => navigate('/inventory?filter=low_stock')}
                  className="bg-surface text-brand px-6 py-3 rounded-2xl font-black text-sm shadow-lg shadow-black/10 hover:bg-surface-muted transition-colors cursor-pointer"
                >
                  {t('common.manage_inventory', 'إدارة المخزون')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>


      <AnimatePresence>
        {drillDown && (
          <DrillDownModal 
            drillDown={drillDown}
            drillSearch={drillSearch}
            setDrillSearch={setDrillSearch}
            drillSort={drillSort}
            setDrillSort={setDrillSort}
            setDrillDown={setDrillDown}
            exportToExcel={exportToExcel}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
