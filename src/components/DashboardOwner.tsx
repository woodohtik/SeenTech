import { StatGrid } from './ui/StatGrid';
import React, { useState, useEffect, lazy, Suspense } from 'react';
import { AutoGrid } from './ui/AutoGrid';
import { StatBadge, StatCard, StatIcon } from './ui/StatCard';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  Calendar,
  ChevronRight,
  ChevronDown
} from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { readTenantRow } from '../lib/tenantRow';
import { deleteTestDataForTenant } from '../services/trialService';
import { handleFirestoreError, OperationType } from '../lib/appErrors';
import { saveLastKnown, getLastKnown } from '../lib/offline/lastKnownCache';
import { isNetworkFailure } from '../lib/offline/outbox';
import { Customer, Order, InventoryItem, AppNotification, OrderStatus, Tenant, BranchInventory } from '../types';

/** PostgREST's answer when an RPC does not exist on this database yet. */
function isMissingFunctionError(error: any): boolean {
  const code = String(error?.code || '');
  return code === 'PGRST202' || code === '42883';
}

/** numeric columns arrive as numbers, but make sure. */
function normalizeStatsResult(d: any): DashboardStatsResult {
  const num = (v: any) => Number(v) || 0;
  return {
    ranges: (d.ranges || []).map((r: any) => ({ orders: num(r.orders), paid: num(r.paid), pending: num(r.pending), customers: num(r.customers) })),
    filtered: {
      orders: num(d.filtered?.orders), paid: num(d.filtered?.paid), remaining: num(d.filtered?.remaining),
      pending: num(d.filtered?.pending), customers: num(d.filtered?.customers),
      completion_hours: num(d.filtered?.completion_hours), completion_count: num(d.filtered?.completion_count),
      active_customers: num(d.filtered?.active_customers), customers_with_orders: num(d.filtered?.customers_with_orders),
      repeat_customers: num(d.filtered?.repeat_customers), status_counts: d.filtered?.status_counts || {},
    },
    totals: { orders: num(d.totals?.orders), in_progress: num(d.totals?.in_progress), measurements_taken: num(d.totals?.measurements_taken), ready: num(d.totals?.ready) },
    low_stock: num(d.low_stock),
    customers_total: num(d.customers_total),
  };
}

interface DashboardStatsData {
  customers: Customer[];
  orders: Order[];
  inventory: InventoryItem[];
  bInv: BranchInventory[];
}
import { STATUS_CONFIG, getOrderStatusDisplay } from './orderStatusConfig';
import { buildDashboardPlan, figuresFrom, planRanges, statsFromRows, type ChartLabel, type DashboardFigures, type DashboardStatsResult } from './dashboard/dashboardStats';
import { useVerticalConfig } from '../hooks/useVerticalConfig';
import { isOrdersModuleOn } from '../services/verticalService';
import { useVerticalTerms } from '../hooks/useVerticalTerms';
import { getOrderPhase, isFinishedPhase, finishedStageKeys, getStageLabel } from '../utils/orderStage';
import { cn } from '../lib/utils';
import { PriceDisplay } from './PriceDisplay';
import { CurrencySymbol } from './CurrencySymbol';
import { motion, AnimatePresence } from 'motion/react';
import { SmartSelect } from './ui/SmartSelect';
import { DatePicker } from './ui/DatePicker';
import { IconInput } from './ui/IconInput';
import Header from './Header';
import { useStaff } from '../contexts/StaffContext';
import { usePermissions } from '../hooks/usePermissions';
import { useNavigate } from 'react-router-dom';
import Branding from './Branding';
import { useTranslation } from 'react-i18next';
import DashboardGridCard from './DashboardGridCard';
// xlsx (~425KB) loads only when an export is asked for (seen-performance-
// first-open-login-task.md Phase 4) -- see exportToExcel.

// recharts (~340KB) loads with the chart only, after the page has drawn
// (seen-performance-first-open-login-task.md, "charts on demand").
const RevenueChart = lazy(() => import('./dashboard/RevenueChart'));
import { localeOf } from '../lib/direction';
import i18n from '../i18n/config';
import { SUPPORT_EMAIL } from '../constants/support';
import { explainOr } from '../lib/userFacingError';

interface DashboardProps {
  tenantId: string;
}

/** Maps the internal 4-hour bucket code to its translation key. */
const INTERVAL_LABEL_KEYS: Record<string, string> = {
  '12 AM - 4 AM': 'dashboard.chart.interval_12am_4am',
  '4 AM - 8 AM': 'dashboard.chart.interval_4am_8am',
  '8 AM - 12 PM': 'dashboard.chart.interval_8am_12pm',
  '12 PM - 4 PM': 'dashboard.chart.interval_12pm_4pm',
  '4 PM - 8 PM': 'dashboard.chart.interval_4pm_8pm',
  '8 PM - 12 AM': 'dashboard.chart.interval_8pm_12am'
};

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
        <div className="sticky top-0 z-10 flex items-center justify-between p-4 main-640:p-6 border-b border-[var(--border)] bg-[var(--surface)] shrink-0 bg-surface-muted/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-brand text-white rounded-2xl shrink-0 shadow-sm">
              <TrendingUp size={20} />
            </div>
            <div>
              <h3 className="text-base main-640:text-lg main-900:text-xl font-black text-content">{drillDown.title}</h3>
              <p className="text-sm text-content-muted font-bold uppercase leading-none mt-0.5">{t('dashboard.drill_down_title')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={() => exportToExcel(filteredData, drillDown.type)}
              className="flex items-center gap-2 bg-[var(--seen-success-bg)] px-4 py-2 rounded-xl border border-success/20 text-sm font-bold text-success hover:bg-success/20 transition-all cursor-pointer"
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
          <div className="p-4 main-640:p-6 bg-surface border-b border-border flex gap-4">
            <IconInput
              type="text"
              startIcon={Search}
              placeholder={t('dashboard.search_results')}
              value={drillSearch}
              onChange={(e) => setDrillSearch(e.target.value)}
              containerClassName="flex-1"
            />
          </div>

          <div className="flex-1 overflow-x-auto whitespace-nowrap scrollbar-hide p-4">
            <div className="bg-surface rounded-2xl border border-border overflow-hidden min-w-max">
              <table className="w-full text-right" dir={dir}>
                <thead className="bg-surface-muted text-sm font-black text-content-muted uppercase sticky top-0 z-10">
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
  // The shop's stages: the figures count by each order's phase
  // (seen-verticals-readiness-task.md Phase 2).
  const { workflowStages, isLegacyVertical, modules: verticalModules } = useVerticalConfig();
  const tv = useVerticalTerms();
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

  const queryClient = useQueryClient();
  const isUuidTenantId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId || '');

  // seen-performance-first-open-login-task.md Phase 4.3: the cards, chart
  // and status bars come from public.get_dashboard_stats, which sums in the
  // database the very boundaries this page always used (dashboard/
  // dashboardStats.ts builds them). The page used to download every
  // customer, order and stock row for this -- and PostgREST stopped at 1000
  // rows, so big shops saw wrong numbers.
  //
  // Full rows are now read only for the drill-down lists, when one is
  // opened (getDashboardRows), paged past that 1000-row cap -- and as the
  // fallback where the function is not deployed yet.
  const loadDashboardRows = React.useCallback(async (): Promise<DashboardStatsData> => {
    const PAGE = 1000;
    const readAll = async (make: () => any): Promise<any[]> => {
      const out: any[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await make().range(from, from + PAGE - 1);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < PAGE) return out;
      }
    };
    const [customersRows, ordersRows, inventoryRows, branchInvRows] = await Promise.all([
      readAll(() => supabase.from('customers').select('*').eq('tenant_id', tenantId).order('id')),
      readAll(() => supabase.from('orders').select('*').eq('tenant_id', tenantId).order('id')),
      readAll(() => supabase.from('inventory_items').select('*').eq('tenant_id', tenantId).order('id')),
      readAll(() => supabase.from('branch_inventory').select('*').eq('tenant_id', tenantId).order('id')),
    ]);

    const customers = customersRows.map(d => ({
      ...d,
      tenantId: d.tenant_id,
      createdAt: d.created_at
    }) as unknown as Customer);

    const allOrdersUnfiltered = ordersRows.map(d => ({
      ...d,
      // status_key (نص حر لأي نشاط) يتقدّم على status (enum قديم) متى وُجد — انظر Orders.tsx.
      status: d.status_key || d.status,
      // Where the order stands whatever the vertical calls the stage (Phase 2).
      phase: getOrderPhase({ status_key: d.status_key, status: d.status }, workflowStages),
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

    const orders = selectedBranchId !== 'all'
      ? allOrdersUnfiltered.filter(o => o.branchId === selectedBranchId)
      : allOrdersUnfiltered;

    const inventory = inventoryRows.map(d => ({
      id: d.id,
      name: d.name,
      minThreshold: d.min_threshold || 0,
      tenantId: d.tenant_id,
      quantity: d.quantity || 0,
      unit: d.unit,
    } as InventoryItem));

    const bInv = branchInvRows.map(d => ({
      id: d.id,
      itemId: d.item_id,
      branchId: d.branch_id,
      quantity: d.quantity || 0,
      tenantId: d.tenant_id
    } as BranchInventory));

    return { customers, orders, inventory, bInv };
  }, [tenantId, selectedBranchId, workflowStages]);

  const getDashboardRows = React.useCallback(
    () => queryClient.fetchQuery({ queryKey: ['dashboard_rows', tenantId, selectedBranchId, workflowStages.length], queryFn: loadDashboardRows, staleTime: 30_000 }),
    [queryClient, tenantId, selectedBranchId, loadDashboardRows],
  );

  const figuresKey = [tenantId, selectedBranchId, selectedTimeframe, customStartDate, customEndDate, revenueRange].join('|');
  const dashboardFiguresQuery = useQuery<DashboardFigures>({
    queryKey: ['dashboard_stats', tenantId, selectedBranchId, selectedTimeframe, customStartDate, customEndDate, revenueRange],
    queryFn: async () => {
      const plan = buildDashboardPlan({ timeframe: selectedTimeframe, customStartDate, customEndDate, revenueRange });
      const { data, error } = await supabase.rpc('get_dashboard_stats' as any, {
        p_tenant_id: tenantId,
        p_branch_id: selectedBranchId !== 'all' ? selectedBranchId : null,
        p_ranges: planRanges(plan),
        p_filter: plan.filter,
        p_active_since: plan.activeSince,
      });
      let result: DashboardStatsResult;
      if (!error && data && typeof data === 'object' && !Array.isArray(data)) {
        result = normalizeStatsResult(data);
      } else if (error && !isMissingFunctionError(error)) {
        throw error;
      } else {
        // The function is not on this database yet: the same figures from the rows.
        result = statsFromRows(plan, await getDashboardRows(), finishedStageKeys(workflowStages));
      }
      const figures = figuresFrom(plan, result);
      // An honest "last known" view when offline -- now a few KB of figures, not every row.
      saveLastKnown(tenantId, 'dashboard_figures', { key: figuresKey, figures });
      return figures;
    },
    enabled: !!tenantId && isUuidTenantId,
    staleTime: 30_000,
    initialData: () => {
      if (!tenantId) return undefined;
      const cached = getLastKnown<{ key: string; figures: DashboardFigures }>(tenantId, 'dashboard_figures')?.data;
      return cached && cached.key === figuresKey ? cached.figures : undefined;
    },
    // The saved figures show at once but count as already stale, so they are
    // refreshed on every open. (The old rows cache counted as fresh for 30s,
    // which kept a stale "0 orders" on screen after a reload.)
    initialDataUpdatedAt: 0,
  });
  const dashboardTotals = dashboardFiguresQuery.data?.totals;
  const isLoading = dashboardFiguresQuery.isLoading;

  // A drill-down list needs the rows themselves; they are read when one is opened.
  const openDrill = React.useCallback(async (build: (rows: DashboardStatsData) => { type: string; title: string; data: any[] }) => {
    try {
      setDrillDown(build(await getDashboardRows()));
    } catch (err) {
      console.error('Dashboard drill-down rows failed:', err);
      setToast({ message: t('offline.showing_cached_dashboard', 'يتم عرض بيانات مخزَّنة من آخر اتصال، قد لا تكون محدَّثة.'), type: 'info' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getDashboardRows]);

  useEffect(() => {
    if (!dashboardFiguresQuery.error) return;
    console.error('Dashboard Stats Error:', dashboardFiguresQuery.error);
    if (isNetworkFailure(dashboardFiguresQuery.error) && dashboardFiguresQuery.data) {
      setToast({ message: t('offline.showing_cached_dashboard', 'يتم عرض بيانات مخزَّنة من آخر اتصال، قد لا تكون محدَّثة.'), type: 'info' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardFiguresQuery.error]);

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
  // A shop that takes no orders (a fabric store) shows no order cards (Phase 6).
  const hasOrdersPermission = (hasPermission('dashboard.orders') || hasPermission('dashboard.view')) && isOrdersModuleOn(verticalModules);
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
      return d.toLocaleDateString(localeOf(i18n.language), {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch (e) {
      return d.toLocaleDateString(localeOf(i18n.language));
    }
  };

  useEffect(() => {
    if (!tenantId) return;

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId);
    if (!isUuid) {
      return;
    }

    const fetchTenantData = async () => {
      try {
        // Phase 5 of seen-offline-coverage-and-performance-task.md: tenants
        // and branches are independent reads (neither depends on the
        // other's result) -- were fetched sequentially before, adding a
        // whole extra network round trip to the first screen after login
        // for no reason. Promise.all matches the pattern already used a
        // few lines below in fetchStats.
        const [tenantRes, branchesRes] = await Promise.all([
          readTenantRow(tenantId), // shared read (lib/tenantRow)
          supabase.from('branches').select('*').eq('tenant_id', tenantId),
        ]);
        const { data: tenantData } = tenantRes;
        const { data: branchesData } = branchesRes;

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

    // Dashboard stats themselves are owned by the useQuery above; the three
    // call sites below just invalidate its cache instead of re-running a
    // local fetch function.
    const invalidateStats = () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard_stats', tenantId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard_rows', tenantId] });
    };
    let orderChangeTimer: number | null = null;

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
        // 1. Scan for any real low stock items to create real low stock notifications.
        // Only the low items come back (get_low_stock_items, seen-performance-
        // first-open-login-task.md Phase 4.3) instead of every stock row; the
        // old two full reads remain the fallback where it is not deployed yet.
        let lowStockItems: Array<{ id: string; name: string; unit?: string; min_threshold: number; quantity: number }> | null = null;
        const lowRes = await supabase.rpc('get_low_stock_items' as any, { p_tenant_id: tenantId, p_limit: 500 });
        if (!lowRes.error && Array.isArray(lowRes.data)) {
          lowStockItems = (lowRes.data as any[]).map((r) => ({ ...r, min_threshold: Number(r.min_threshold) || 0, quantity: Number(r.quantity) || 0 }));
        } else if (lowRes.error && isMissingFunctionError(lowRes.error)) {
          const [invItemsRes, branchInvRes] = await Promise.all([
            supabase.from('inventory_items').select('*').eq('tenant_id', tenantId),
            supabase.from('branch_inventory').select('*').eq('tenant_id', tenantId)
          ]);
          if (invItemsRes.data) {
            const branchInv = branchInvRes.data || [];
            lowStockItems = invItemsRes.data
              .map((item: any) => ({
                ...item,
                quantity: branchInv.filter((bi: any) => bi.item_id === item.id).reduce((sum: number, bi: any) => sum + bi.quantity, 0),
              }))
              .filter((item: any) => item.quantity <= item.min_threshold);
          }
        }

        if (lowStockItems) {

          // Fetch existing inventory notifications to avoid duplicates
          const { data: existingNotifs } = await supabase
            .from('notifications')
            .select('id, metadata')
            .eq('tenant_id', tenantId)
            .eq('type', 'inventory');

          for (const item of lowStockItems) {
            const totalQty = item.quantity;
            
            const title = t('dashboard.inventory_alert_title', { item: item.name });
            const message = t('dashboard.inventory_alert_message', {
              item: item.name,
              qty: totalQty,
              unit: item.unit || t('inventory.unit_meters'),
              threshold: item.min_threshold
            });
            
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
      // Stats themselves are already fetched declaratively by the useQuery
      // above (enabled/queryKey) -- no manual call needed here.
      fetchRecentOrders();
      fetchNotifications();
    }

    // Real-time listeners for Recent Orders and Notifications
    const ordersSubscription = supabase
      .channel('dashboard_updates')
      // Phase 4 of seen-performance-first-open-login-task.md: a burst of order
      // changes (a sale writes several rows) refreshes once, two seconds
      // after the last one, instead of reloading everything per change.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenantId}` }, () => {
        if (orderChangeTimer) window.clearTimeout(orderChangeTimer);
        orderChangeTimer = window.setTimeout(() => {
          orderChangeTimer = null;
          invalidateStats();
          fetchRecentOrders();
        }, 2000);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `tenant_id=eq.${tenantId}` }, () => {
        fetchNotifications();
      })
      .subscribe();

    const handleDataCleared = () => {
      invalidateStats();
      fetchRecentOrders();
      fetchNotifications();
    };
    window.addEventListener('data_cleared', handleDataCleared);

    return () => {
      if (orderChangeTimer) window.clearTimeout(orderChangeTimer);
      supabase.removeChannel(ordersSubscription);
      window.removeEventListener('data_cleared', handleDataCleared);
    };
  }, [tenantId, revenueRange, currentStaff?.branchId, selectedBranchId]);

  // The figures (cards, chart, status bars) as the page shows them. The
  // numbers come from get_dashboard_stats; labels are made here, as before.
  useEffect(() => {
    const figures = dashboardFiguresQuery.data;
    if (!figures) return;
    const locale = localeOf(i18n.language);
    const chartLabel = (label: ChartLabel): string => {
      switch (label.kind) {
        case 'interval': return t(INTERVAL_LABEL_KEYS[label.key]);
        case 'weekday': return new Date(label.date).toLocaleDateString(locale, { weekday: 'short' });
        case 'dayMonth': return new Date(label.date).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
        case 'week': return t('dashboard.chart.week_n', { n: label.n });
        case 'month': return new Date(label.date).toLocaleDateString(locale, { month: 'short' });
        case 'monthYear': return new Date(label.date).toLocaleDateString(locale, { month: 'short', year: '2-digit' });
      }
    };

    setStats(figures.stats);
    setGrowthRate(figures.stats.revenueGrowthRate);
    setChartData(figures.chart.map((c) => ({ date: chartLabel(c.label), revenue: c.revenue, ordersCount: c.ordersCount })));

    // --- Status Distribution ---
    const statusCounts: Record<string, number> = figures.statusCounts || {};
    // لمستأجري mens_tailoring: نفس القائمة الثابتة حرفياً. لأي نشاط آخر: من
    // مراحل عمله الفعلية غير الختامية (workflowStages)، بدل قائمة الخياطة الثابتة.
    const dist = isLegacyVertical || workflowStages.length === 0 ? [
      { id: 'pending', name: t('common.status_pending', 'معلق'), value: statusCounts['pending'] || 0, color: 'var(--content-muted)' },
      { id: 'measurements_taken', name: t('common.status_measurements_taken', 'أخذ المقاسات'), value: statusCounts['measurements_taken'] || 0, color: 'var(--color-info)' },
      { id: 'cutting', name: t('common.status_cutting', 'قص القماش'), value: statusCounts['cutting'] || 0, color: 'var(--color-warning)' },
      { id: 'sewing', name: t('common.status_sewing', 'خياطة'), value: statusCounts['sewing'] || 0, color: 'var(--color-brand)' },
      { id: 'embroidery', name: t('common.status_embroidery', 'تطريز'), value: statusCounts['embroidery'] || 0, color: 'var(--color-brand)' },
      { id: 'ironing_packaging', name: t('common.status_ironing_packaging', 'كوي وتغليف'), value: statusCounts['ironing_packaging'] || 0, color: 'var(--color-info)' },
      { id: 'ready', name: t('common.status_ready', 'جاهز للاستلام'), value: statusCounts['ready'] || 0, color: 'var(--color-success)' },
    ] : (() => {
      const DIST_COLORS = ['var(--color-info)', 'var(--color-warning)', 'var(--color-brand)', 'var(--color-success)', 'var(--content-muted)'];
      return workflowStages
        .filter((s) => !s.is_terminal)
        .map((s, idx) => ({ id: s.stage_key, name: s.label_ar, value: statusCounts[s.stage_key] || 0, color: DIST_COLORS[idx % DIST_COLORS.length] }));
    })();
    setStatusDistribution(dist);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardFiguresQuery.data, i18n.language, isLegacyVertical, workflowStages]);

  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState('all');

  const activeOrdersCount = dashboardTotals?.in_progress ?? 0;
  const measurementsCount = dashboardTotals?.measurements_taken ?? 0;

  const gridItems = [
    { 
      title: tv('dashboard.grid.tailoring', 'خياطة وتفصيل'),
      detail: t('dashboard.grid.tailoring_desc', '{{count}} طلب قيد التنفيذ', { count: activeOrdersCount }),
      icon: 'seen-sewing-machine' as const,
      color: 'bg-brand',
      onClick: () => navigate('/orders?filter=tailoring')
    },
    { 
      title: t('dashboard.grid.measurements', 'مواعيد القياس'), 
      detail: t('dashboard.grid.measurements_desc', '{{count}} مواعيد اليوم', { count: measurementsCount }),
      icon: 'seen-tape-measure' as const,
      color: 'bg-info',
      onClick: () => navigate('/orders?filter=measurements')
    },
    { 
      title: t('dashboard.grid.inventory', 'إدارة المخزون'), 
      detail: t('dashboard.grid.inventory_desc', '{{count}} مواد ناقصة', { count: stats.lowStock }),
      icon: 'seen-fabric-bolt' as const,
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
      icon: 'chart-bar' as const,
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

  const exportToExcel = async (data: any[], filename: string) => {
    const XLSX = await import('xlsx');
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
          message: t('dashboard.delete_test_data_success', { count: result.deletedCount }), 
          type: 'success' 
        });

        // Optimistically clean local state immediately
        setRecentOrders(prev => prev.filter(o => !(o as any).isTest && !(o as any).is_test));
        // The figures are recounted by the database (the data_cleared handler refetches them).
        queryClient.invalidateQueries({ queryKey: ['dashboard_stats', tenantId] });
        queryClient.invalidateQueries({ queryKey: ['dashboard_rows', tenantId] });
        setNotifications(prev => prev.filter(n => !(n as any).isTest && !(n as any).is_test));

        // Notify app components to refresh data without forcing a full page reload
        window.dispatchEvent(new CustomEvent('data_cleared'));
      } else {
        setToast({ 
          message: explainOr(result.error, t('dashboard.delete_test_data_error')), 
          type: 'error' 
        });
      }
    } catch (error) {
      setToast({ message: t('dashboard.delete_test_data_error'), type: 'error' });
      handleFirestoreError(error as any, OperationType.DELETE, 'test_data');
    }
  };

  const getComparisonLabel = () => {
    switch (selectedTimeframe) {
      case 'daily':
        return t('dashboard.comparison.vs_yesterday');
      case 'weekly':
        return t('dashboard.comparison.vs_last_week');
      case 'monthly':
        return t('dashboard.comparison.vs_last_month');
      case 'quarterly':
        return t('dashboard.comparison.vs_last_quarter');
      case 'yearly':
        return t('dashboard.comparison.vs_last_year');
      case 'custom':
        return t('dashboard.comparison.vs_previous_period');
      case 'all':
      default:
        return t('dashboard.comparison.vs_last_month');
    }
  };

  const getComparisonLabelShort = () => {
    switch (selectedTimeframe) {
      case 'daily':
        return t('dashboard.comparison.short_yesterday');
      case 'weekly':
        return t('dashboard.comparison.short_last_week');
      case 'monthly':
        return t('dashboard.comparison.short_last_month');
      case 'quarterly':
        return t('dashboard.comparison.short_last_quarter');
      case 'yearly':
        return t('dashboard.comparison.short_last_year');
      case 'custom':
        return t('dashboard.comparison.short_previous_period');
      case 'all':
      default:
        return t('dashboard.comparison.short_last_month');
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
      prevValue: stats.prevCustomers !== undefined ? t('dashboard.prev_customers_value', { n: stats.prevCustomers }) : undefined,
      visible: hasCustomersPermission,
      onClick: () => openDrill((r) => ({ 
        type: 'customers', 
        title: t('dashboard.total_customers'), 
        data: r.customers.map(c => ({ id: c.id, [t('common.name')]: c.name, [t('common.phone')]: c.phone, [t('common.date')]: formatDate(c.createdAt) }))
      }))
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
      onClick: () => openDrill((r) => ({ 
        type: 'revenue', 
        title: t('dashboard.total_revenue'), 
        data: r.orders.map(o => ({ id: o.id, [t('common.customers')]: o.customerName, [t('common.amount')]: o.paidAmount, [t('common.date')]: formatDate(o.orderDate), [t('common.status')]: o.status, [t('common.method')]: o.paymentMethod }))
      }))
    },
    { 
      label: t('dashboard.receivables'), 
      value: <PriceDisplay amount={(stats as any).receivables || 0} />, 
      icon: AlertTriangle, 
      color: 'bg-danger', 
      trend: t('dashboard.trend.collect', 'تحصيل'),
      visible: hasRevenuePermission,
      onClick: () => openDrill((r) => ({ 
        type: 'receivables', 
        title: t('dashboard.receivables'), 
        data: r.orders.filter(o => (o.remainingAmount || 0) > 0).map(o => ({ id: o.id, [t('common.customers')]: o.customerName, [t('common.remaining')]: o.remainingAmount, [t('common.total')]: o.totalAmount, [t('common.date')]: formatDate(o.orderDate) }))
      }))
    },
    { 
      label: t('dashboard.active_orders'), 
      value: stats.pending, 
      icon: Clock, 
      color: 'bg-warning', 
      trend: stats.pendingGrowthRate >= 0 ? `+${stats.pendingGrowthRate}%` : `${stats.pendingGrowthRate}%`,
      comparisonLabel: getComparisonLabel(),
      prevValue: stats.prevPending !== undefined ? t('dashboard.prev_orders_value', { n: stats.prevPending }) : undefined,
      visible: hasOrdersPermission,
      onClick: () => openDrill((r) => ({ 
        type: 'pending_orders', 
        title: t('dashboard.active_orders'), 
        data: r.orders.filter(o => !isFinishedPhase(getOrderPhase(o as any, workflowStages))).map(o => ({ id: o.id, [t('common.customers')]: o.customerName, [t('common.status')]: getStageLabel(o.status, workflowStages, i18n.language), [t('common.date')]: formatDate(o.orderDate) }))
      }))
    },
    { 
      label: t('dashboard.avg_completion_time'), 
      value: `${(stats as any).avgCompletionTime?.toFixed(1) || 0} ${t('common.hours', 'ساعة')}`, 
      icon: Clock, 
      color: 'bg-info', 
      trend: t('dashboard.trend.performance', 'أداء'),
      visible: hasOrdersPermission,
      onClick: () => openDrill((r) => ({ 
        type: 'completion_time', 
        title: t('dashboard.avg_completion_time'), 
        data: r.orders.filter(o => isFinishedPhase(getOrderPhase(o as any, workflowStages))).map(o => {
          const finished = finishedStageKeys(workflowStages);
          const finalHistory = o.history && [...o.history].reverse().find(h => finished.has(h.status));
          const hours = finalHistory ? (new Date(finalHistory.updatedAt).getTime() - new Date(o.orderDate).getTime()) / (1000 * 60 * 60) : 0;
          return { id: o.id, [t('common.customers')]: o.customerName, [t('common.date')]: formatDate(o.orderDate), [t('dashboard.completion_time_value')]: hours.toFixed(1) };
        })
      }))
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
        openDrill((r) => {
          const activeIds = new Set(r.orders.filter(o => new Date(o.orderDate) >= sixtyDaysAgo).map(o => o.customerId));
          return ({ 
          type: 'active_customers', 
          title: t('dashboard.active_customers'), 
          data: r.customers.filter(c => activeIds.has(c.id)).map(c => ({ id: c.id, [t('common.name')]: c.name, [t('common.phone')]: c.phone, [t('common.date')]: formatDate(c.createdAt) }))
          });
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
        openDrill((r) => {
          const customerOrderCounts: Record<string, number> = {};
          r.orders.forEach(o => {
            customerOrderCounts[o.customerId] = (customerOrderCounts[o.customerId] || 0) + 1;
          });
          return ({ 
            type: 'retention', 
            title: t('dashboard.customer_retention'), 
            data: r.customers.filter(c => (customerOrderCounts[c.id] || 0) > 1).map(c => ({ id: c.id, [t('common.name')]: c.name, [t('common.phone')]: c.phone, [t('dashboard.orders_count')]: customerOrderCounts[c.id] }))
          });
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
      onClick: () => openDrill((r) => ({ 
        type: 'low_stock', 
        title: t('dashboard.inventory_alerts'), 
        data: r.inventory.flatMap(i => {
          const itemBranchInv = r.bInv.filter(bi => bi.itemId === i.id);
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
      }))
    },
  ];

  const visibleStatCards = statCards.filter(card => card.visible);

  if (isLoading) {
    return (
      <div className={cn("space-y-8 animate-pulse", textAlignmentClass)} dir={dir}>
        <div className="h-24 bg-surface rounded-3xl border border-border"></div>
        <div className="grid grid-cols-1 main-720:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-32 bg-surface rounded-2xl border border-border shadow-sm"></div>
          ))}
        </div>
        <div className="grid grid-cols-1 main-900:grid-cols-2 gap-8">
          <div className="h-[400px] bg-surface rounded-2xl border border-border"></div>
          <div className="h-[400px] bg-surface rounded-2xl border border-border"></div>
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
        <div className="flex flex-col main-640:flex-row flex-wrap items-stretch main-640:items-center gap-3 w-full main-640:w-auto justify-end">
          {/* Branch Filter */}
          <div className="w-full main-640:w-56 shrink-0">
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
          <div className="w-full main-640:w-48 shrink-0">
            <SmartSelect
              value={selectedTimeframe}
              onChange={(val) => setSelectedTimeframe(val as any)}
              options={[
                { value: 'all', label: t('dashboard.timeframe.all_time'), icon: <Calendar size={16} className="text-brand shrink-0" /> },
                { value: 'daily', label: t('dashboard.timeframe.daily'), icon: <Calendar size={16} className="text-brand shrink-0" /> },
                { value: 'weekly', label: t('saas.weekly'), icon: <Calendar size={16} className="text-brand shrink-0" /> },
                { value: 'monthly', label: t('saas.monthly'), icon: <Calendar size={16} className="text-brand shrink-0" /> },
                { value: 'quarterly', label: t('dashboard.timeframe.quarterly'), icon: <Calendar size={16} className="text-brand shrink-0" /> },
                { value: 'yearly', label: t('dashboard.timeframe.yearly'), icon: <Calendar size={16} className="text-brand shrink-0" /> },
                { value: 'custom', label: t('dashboard.timeframe.custom'), icon: <Calendar size={16} className="text-brand shrink-0" /> },
              ]}
            />
          </div>

          <div className="flex flex-wrap main-640:flex-nowrap items-center gap-2 main-640:gap-3 justify-between main-640:justify-end w-full main-640:w-auto">
            <button 
              onClick={() => setIsDeleteConfirmVisible(true)}
              className="flex items-center gap-1.5 main-640:gap-2 bg-[var(--seen-danger-bg)] text-danger px-3 main-640:px-4 py-2 main-640:py-2.5 rounded-xl main-640:rounded-2xl font-bold text-sm hover:bg-danger/15 transition-all border border-danger/20 shrink-0"
            >
              <AlertTriangle size={15} />
              {t('dashboard.delete_test_data')}
            </button>
            {hasRevenuePermission && (
              <div className="bg-surface p-2 main-640:p-2.5 rounded-xl main-640:rounded-2xl border border-border flex items-center gap-2 main-640:gap-3 shadow-sm shrink-0">
                <div className="p-1 main-640:p-1.5 bg-[var(--seen-success-bg)] text-success rounded-lg main-640:rounded-xl">
                  <TrendingUp size={16} />
                </div>
                <div className="min-w-0">
                  <p className="m-0 text-sm font-bold leading-[1.5] text-content-muted">
                    {t('dashboard.growth_rate')} {getComparisonLabelShort()}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <p dir="ltr" className={cn(
                      "m-0 text-sm font-black leading-[1.5] tabular-nums",
                      growthRate >= 0 ? "text-success" : "text-danger"
                    )}>
                      {growthRate >= 0 ? '+' : ''}{growthRate}%
                    </p>
                    <span className="text-sm text-content-muted font-bold whitespace-nowrap">
                      ({t('dashboard.prev_label')} <PriceDisplay amount={stats.prevRevenue} />)
                    </span>
                  </div>
                </div>
              </div>
            )}
            <div className="relative shrink-0">
              <button 
                type="button"
                aria-label={t('dashboard.notifications')}
                aria-expanded={isNotificationsOpen}
                onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
                className="relative p-2 main-640:p-3 bg-surface rounded-xl main-640:rounded-2xl border border-border shadow-sm hover:bg-surface-muted transition-colors"
              >
                <Bell size={18} className="text-content-muted main-640:size-6" />
                {notifications.some(n => n.status === 'unread') && (
                  <span className="absolute top-1.5 right-1.5 main-640:top-2 main-640:right-2 w-2 h-2 main-640:w-3 main-640:h-3 bg-danger border-2 border-surface rounded-full" />
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
                      className="absolute left-0 mt-2 w-72 main-640:w-80 bg-surface rounded-3xl shadow-2xl border border-border z-50 overflow-hidden"
                    >
                      <div className="p-4 border-b border-border flex justify-between items-center bg-surface-muted/50">
                        <h4 className="text-sm font-black text-content">{t('dashboard.notifications')}</h4>
                        <div className="flex items-center gap-2">
                          {notifications.some(n => n.status === 'unread') && (
                            <button 
                              onClick={markAllAsRead} 
                              className="text-sm font-black text-brand hover:underline cursor-pointer"
                            >
                              {t('saas.mark_all_read')}
                            </button>
                          )}
                          <span className="text-sm font-bold text-brand bg-brand/10 px-2 py-0.5 rounded-full">
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
                                  notif.type === 'inventory' ? "bg-[var(--seen-danger-bg)] text-danger" : "bg-brand/10 text-brand"
                                )}>
                                  {notif.type === 'inventory' ? <AlertTriangle size={16} /> : <Bell size={16} />}
                                </div>
                                <div className="flex-1">
                                  <p className="text-sm font-black text-content group-hover:text-brand transition-colors">{notif.title}</p>
                                  <p className="text-sm text-content-muted mt-0.5 leading-relaxed">{notif.message}</p>
                                  <p className="text-sm text-content-muted mt-1 font-bold">
                                    {new Date(notif.createdAt).toLocaleTimeString(localeOf(i18n.language), { hour: '2-digit', minute: '2-digit' })}
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
                            <p className="text-sm text-content-muted font-bold">{t('dashboard.no_notifications')}</p>
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
          className="bg-amber-500/10 dark:bg-amber-500/5 border border-amber-500/20 rounded-2xl p-6 main-900:p-8 flex flex-col main-720:flex-row items-center justify-between gap-6"
        >
          <div className={cn("flex items-center gap-4", textAlignmentClass)} dir={dir}>
            <div className="w-12 h-12 bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded-2xl flex items-center justify-center shrink-0 animate-pulse">
              <AlertTriangle size={24} />
            </div>
            <div>
              <h3 className="text-base main-640:text-lg font-black text-amber-950 dark:text-amber-200">
                {isTrialPlan ? t('subscription.trial_ending_soon') : t('subscription.subscription_expiring_soon')}
              </h3>
              <p className="text-sm font-medium text-amber-700/85 dark:text-amber-400/85 mt-1 leading-relaxed">
                {trialDays === 0
                  ? (isTrialPlan ? t('subscription.trial_ended_today') : t('subscription.subscription_ended_today'))
                  : (isTrialPlan
                      ? t('subscription.trial_days_remaining', { count: trialDays })
                      : t('subscription.subscription_days_remaining', { count: trialDays }))}
              </p>
            </div>
          </div>
          <a 
            href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(t('subscription.activation_email_subject'))}`}
            className="w-full main-720:w-auto bg-amber-600 hover:bg-amber-700 text-white px-6 py-3.5 rounded-2xl font-bold text-sm shadow-lg shadow-amber-900/10 transition-all shrink-0 flex items-center justify-center gap-2 border border-amber-700/20"
          >
            <ExternalLink size={15} />
            {t('subscription.contact_support_activate')}
          </a>
        </motion.div>
      )}
      
      {/* Mobile Horizontal Filters */}
      <div className="flex overflow-x-auto gap-2 pb-2 -mx-4 px-4 scrollbar-hide main-900:hidden">
        {filters.map((filter) => (
          <button
            key={filter.id}
            onClick={() => setActiveFilter(filter.id)}
            className={cn(
              "whitespace-nowrap px-6 py-2.5 rounded-full text-sm font-black transition-all",
              activeFilter === filter.id 
                ? "bg-brand text-white shadow-lg shadow-brand/20" 
                : "bg-surface border border-border text-content-muted"
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Action cards: as many columns of at least 220px as the content has room for, four at most. */}
      <AutoGrid min={220} maxColumns={4} className="mt-2">
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
      </AutoGrid>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {isDeleteConfirmVisible && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 main-640:p-6">
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
              <div className="w-20 h-20 bg-[var(--seen-danger-bg)] text-danger rounded-full flex items-center justify-center mx-auto mb-6">
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
              toast.type === 'success' ? "bg-[var(--seen-success-bg)] text-success border-success/20" : toast.type === 'info' ? "bg-brand/10 text-brand border-brand/20" : "bg-[var(--seen-danger-bg)] text-danger border-danger/20"
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
          className="flex flex-col main-640:flex-row main-640:items-center justify-between gap-4 p-4 bg-surface rounded-2xl border border-border shadow-sm mb-6"
        >
          <div className="flex items-center gap-2">
            <Calendar size={18} className="text-brand animate-pulse" />
            <span className="text-sm font-black text-content">
              {t('dashboard.custom_range_hint')}
            </span>
          </div>
          <div className="flex items-center gap-3 w-full main-640:w-auto">
            <div className="flex-1 main-640:flex-none main-640:min-w-[150px]">
              <DatePicker
                id="custom-start-date"
                value={customStartDate}
                onChange={setCustomStartDate}
                placeholder={t('common.from_label')}
              />
            </div>
            <div className="flex-1 main-640:flex-none main-640:min-w-[150px]">
              <DatePicker
                id="custom-end-date"
                value={customEndDate}
                onChange={setCustomEndDate}
                placeholder={t('common.to_label')}
              />
            </div>
          </div>
        </motion.div>
      )}

      {/* Number cards: columns of at least 200px, four at most (seen-responsive-layout-task.md Phase 2). */}
      <StatGrid>
        {visibleStatCards.map((stat) => (
          <StatCard
            key={stat.label}
            onClick={stat.onClick}
            label={stat.label}
            value={typeof stat.value === 'number' ? stat.value.toLocaleString(localeOf(i18n.language)) : stat.value}
            icon={<StatIcon className={stat.color}><stat.icon className="h-6 w-6" /></StatIcon>}
            badge={
              <StatBadge tone={
                stat.trend.startsWith('+') ? 'success'
                  : stat.trend.startsWith('-') || stat.isAlert || stat.trend === t('dashboard.trend.critical', 'هام') ? 'danger'
                  : 'neutral'
              }>
                <span dir={/^[+-]?\d/.test(stat.trend) ? 'ltr' : undefined} className="tabular-nums">{stat.trend}</span>
              </StatBadge>
            }
            footer={stat.comparisonLabel ? (
              <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="min-w-0">{stat.comparisonLabel}</span>
                {(stat as any).prevValue !== undefined && (
                  <span className="whitespace-nowrap font-bold text-content tabular-nums">{(stat as any).prevValue}</span>
                )}
              </div>
            ) : undefined}
          />
        ))}
      </StatGrid>

      <div className="grid grid-cols-1 main-900:grid-cols-3 gap-6 main-640:gap-8">
        {/* Revenue Chart */}
        {hasRevenuePermission && (() => {
          const totalPeriodRevenue = chartData.reduce((acc, curr) => acc + (Number(curr.revenue) || 0), 0);
          const totalPeriodOrders = chartData.reduce((acc, curr) => acc + (Number(curr.ordersCount) || 0), 0);
          const avgDailyRevenue = chartData.length > 0 ? Math.round(totalPeriodRevenue / chartData.length) : 0;
          const maxRevenueDay = chartData.length > 0 
            ? chartData.reduce((max, d) => (d.revenue > (max?.revenue || 0) ? d : max), chartData[0]) 
            : { revenue: 0, date: '-' };

          return (
            <div className="main-900:col-span-2 bg-surface rounded-2xl border border-border shadow-sm p-4 main-640:p-6 main-720:p-8 flex flex-col justify-between transition-all">
              {/* Header with Title and Control Pills */}
              <div className="flex flex-col main-640:flex-row main-640:items-center justify-between gap-4 mb-6">
                <div>
                  <div className="flex items-center gap-2.5">
                    <div className="p-2.5 bg-brand/10 text-brand rounded-2xl shrink-0">
                      <TrendingUp size={20} />
                    </div>
                    <div>
                      <h3 className="text-lg main-640:text-xl font-black text-content">{t('dashboard.revenue_analysis', 'مخطط تحليل الإيرادات')}</h3>
                      <p className="text-sm text-content-muted font-medium mt-0.5">
                        {t('dashboard.revenue_analysis_desc', 'مقارنة تفصيلية للأداء المالي وعدد الطلبات خلال الفترة')}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Controls: View Mode & Time Range */}
                <div className="flex flex-wrap items-center gap-2 main-640:gap-3 shrink-0">
                  {/* View Mode Toggle */}
                  <div className="bg-surface-muted p-1 rounded-2xl flex items-center border border-border text-sm font-bold">
                    <button
                      type="button"
                      onClick={() => setChartViewMode('both')}
                      className={cn(
                        "min-w-12 justify-center px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer",
                        chartViewMode === 'both' ? "bg-surface text-brand shadow-sm font-black" : "text-content-muted hover:text-content"
                      )}
                    >
                      <span>{t('dashboard.chart_both', 'الكل')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setChartViewMode('revenue')}
                      className={cn(
                        "min-w-12 justify-center px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer",
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
                        "min-w-12 justify-center px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer",
                        chartViewMode === 'orders' ? "bg-surface text-info shadow-sm font-black" : "text-content-muted hover:text-content"
                      )}
                    >
                      <span className="w-2 h-2 rounded-full bg-info"></span>
                      <span>{t('dashboard.orders', 'الطلبات')}</span>
                    </button>
                  </div>

                  {/* Days Selector */}
                  <div className="bg-surface-muted p-1 rounded-2xl flex items-center border border-border text-sm font-bold">
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
              <AutoGrid min={150} maxColumns={4} className="mb-6" style={{ ['--auto-grid-gap' as string]: '0.75rem' }}>
                <div className="bg-surface-muted/60 border border-border/80 rounded-2xl p-3 flex flex-col justify-between">
                  <span className="text-sm font-bold text-content-muted">{t('dashboard.total_in_period', 'إجمالي الفترة')}</span>
                  <span className="text-sm main-640:text-base main-720:text-lg font-black text-brand mt-1 truncate">
                    <PriceDisplay amount={totalPeriodRevenue} />
                  </span>
                </div>

                <div className="bg-surface-muted/60 border border-border/80 rounded-2xl p-3 flex flex-col justify-between">
                  <span className="text-sm font-bold text-content-muted">{t('dashboard.daily_avg', 'المتوسط اليومي')}</span>
                  <span className="text-sm main-640:text-base main-720:text-lg font-black text-content mt-1 truncate">
                    <PriceDisplay amount={avgDailyRevenue} />
                  </span>
                </div>

                <div className="bg-surface-muted/60 border border-border/80 rounded-2xl p-3 flex flex-col justify-between">
                  <span className="text-sm font-bold text-content-muted">{t('dashboard.peak_day', 'أعلى يوم مبيعات')}</span>
                  <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-1">
                    <span className="text-sm main-640:text-base main-720:text-lg font-black text-success">
                      <PriceDisplay amount={maxRevenueDay?.revenue || 0} />
                    </span>
                    {maxRevenueDay?.date && maxRevenueDay.revenue > 0 && (
                      <span className="text-sm font-bold text-content-muted">({maxRevenueDay.date})</span>
                    )}
                  </div>
                </div>

                <div className="bg-surface-muted/60 border border-border/80 rounded-2xl p-3 flex flex-col justify-between">
                  <span className="text-sm font-bold text-content-muted">{t('dashboard.period_orders', 'الطلبات الإجمالية')}</span>
                  <span className="text-sm main-640:text-base main-720:text-lg font-black text-info mt-1 truncate">
                    {totalPeriodOrders.toLocaleString(localeOf(i18n.language))} <span className="text-sm font-bold text-content-muted">{t('common.order', 'طلب')}</span>
                  </span>
                </div>
              </AutoGrid>

              {/* Main Graph Area */}
              <div className="h-72 main-640:h-80 relative flex-1">
                {(chartData.length === 0 || chartData.every(d => d.revenue === 0 && d.ordersCount === 0)) && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface/90 backdrop-blur-md z-10 p-6 rounded-3xl text-center border border-border/50">
                    <div className="p-4 bg-brand/10 text-brand rounded-full mb-3 border border-brand/20 shadow-sm mx-auto">
                      <DollarSign size={28} />
                    </div>
                    <h4 className="text-base font-black text-content mb-1">{t('dashboard.no_revenue_analytics_yet', 'لا توجد تحليلات مالية بعد')}</h4>
                    <p className="text-sm text-content-muted font-medium max-w-sm mx-auto">{t('dashboard.no_revenue_analytics_yet_desc', 'بمجرد تسجيل مبيعات أو فواتير مدفوعة، ستظهر البيانات التحليلية والرسوم البيانية هنا.')}</p>
                  </div>
                )}

                <Suspense fallback={null}>
                  <RevenueChart
                    chartData={chartData}
                    chartViewMode={chartViewMode}
                    isRtl={isRtl}
                    maxRevenueDay={maxRevenueDay}
                    totalPeriodRevenue={totalPeriodRevenue}
                    avgDailyRevenue={avgDailyRevenue}
                    t={t}
                  />
                </Suspense>
              </div>
            </div>
          );
        })()}

        {/* Status Breakdown */}
        {hasOrdersPermission && (
          <div className={cn("bg-surface rounded-2xl border border-border shadow-sm p-4 main-640:p-6 main-720:p-8 flex flex-col justify-between", !hasRevenuePermission && "main-900:col-span-3")}>
            <div>
              <h3 className="text-xl font-black text-content mb-2">{t('dashboard.status_distribution')}</h3>
              <p className="text-sm text-content-muted font-medium mb-8">{t('dashboard.status_distribution_desc', 'مراحل العمل الحالية في المشغل')}</p>
              
              {(dashboardTotals?.orders ?? 0) === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="p-4 bg-brand/5 text-brand rounded-full mb-3 border border-brand/10 mx-auto">
                    <Clock size={28} />
                  </div>
                  <h4 className="text-base font-black text-content mb-1">{t('dashboard.no_orders_in_progress', 'لا توجد طلبات جارية')}</h4>
                  <p className="text-sm text-content-muted font-bold max-w-xs mx-auto mb-4">{t('dashboard.no_orders_in_progress_desc', 'كافة مراحل التصنيع والقص والخياطة والقياسات ستظهر هنا بمجرد إنشاء طلب جديد.')}</p>
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
                        onClick={() => openDrill((r) => ({ 
                          type: status.id, 
                          title: `${t('common.orders')}: ${status.name}`,
                          data: r.orders.filter(o => o.status === status.id).map(o => ({
                            id: o.id,
                            [t('common.customers')]: o.customerName,
                            [t('common.amount')]: o.totalAmount,
                            [t('common.date')]: formatDate(o.orderDate),
                            [t('common.status')]: o.status
                          }))
                        }))}
                      >
                        <div className="flex justify-between items-center mb-2">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-xl transition-all group-hover:scale-110" style={{ backgroundColor: `${status.color}15`, color: status.color }}>
                              <Icon size={18} />
                            </div>
                            <span className="text-sm font-black text-content/80 group-hover:text-brand transition-colors">{status.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-black text-content">{status.value.toLocaleString(localeOf(i18n.language))}</span>
                            <span className="text-sm font-bold text-content-muted uppercase">{t('common.order')}</span>
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
                <p className="text-sm font-black text-brand uppercase">{t('dashboard.in_progress', 'قيد التنفيذ')}</p>
                <p className="text-xl font-black text-brand">{stats.pending.toLocaleString(localeOf(i18n.language))}</p>
              </div>
              <div className="bg-success/10 p-4 rounded-2xl">
                <p className="text-sm font-black text-success uppercase">{t('dashboard.ready', 'جاهز')}</p>
                <p className="text-xl font-black text-success">{(dashboardTotals?.ready ?? 0).toLocaleString(localeOf(i18n.language))}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 main-900:grid-cols-3 gap-6 main-640:gap-8">
        {/* Recent Orders Table */}
        {hasOrdersPermission && (
          <div className="main-900:col-span-2 bg-surface rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="p-4 main-640:p-6 main-720:p-8 border-b border-border flex justify-between items-center">
              <h3 className="text-lg main-640:text-xl font-black text-content">{t('dashboard.recent_orders')}</h3>
              <button 
                onClick={() => openDrill((r) => ({ 
                  type: 'all_orders', 
                  title: t('dashboard.all_orders', 'جميع الطلبات'), 
                  data: r.orders.map(o => ({ id: o.id, [t('common.customers')]: o.customerName, [t('common.amount')]: o.totalAmount, [t('common.date')]: formatDate(o.orderDate), [t('common.status')]: o.status }))
                }))}
                className="text-brand text-sm font-bold hover:underline inline-flex items-center min-h-11 px-2 -mx-2 -my-3"
              >
                {t('dashboard.view_all')}
              </button>
            </div>
            <div className="overflow-x-auto whitespace-nowrap scrollbar-hide">
              <table className={cn("w-full min-w-max", textAlignmentClass)} dir={dir}>
                <thead className="bg-surface-muted/50 text-content-muted text-sm uppercase font-black">
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
                                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-black transition-transform group-hover:scale-110",
                                order.status === 'delivered' ? "bg-[var(--seen-success-bg)] text-success" : "bg-brand/10 text-brand"
                              )}>
                                {order.customerName.charAt(0)}
                              </div>
                              <div>
                                <p className="text-sm font-black text-content group-hover:text-brand transition-colors">{order.customerName}</p>
                                <p className="text-sm text-content-muted font-bold">#{order.id.slice(-6).toUpperCase()}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-8 py-5">
                            <span className={cn(
                              "px-3 py-1 rounded-xl text-sm font-black uppercase",
                              getOrderStatusDisplay(order.status, workflowStages).bgColor,
                              getOrderStatusDisplay(order.status, workflowStages).color
                            )}>
                              {t(getOrderStatusDisplay(order.status, workflowStages).labelKey)}
                            </span>
                          </td>
                          <td className="px-8 py-5">
                            <p className="text-sm font-black text-content"><PriceDisplay amount={order.totalAmount} /></p>
                            <p className="text-sm text-success font-bold">{t('common.paid', 'مدفوع')}: <PriceDisplay amount={order.paidAmount} /></p>
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
                                  <div className="py-6 grid grid-cols-1 main-720:grid-cols-3 gap-6 border-t border-border">
                                    <div className="space-y-2">
                                      <p className="text-sm font-black text-content-muted uppercase">{t('common.items', 'الأصناف')}</p>
                                      <div className="space-y-1">
                                        {order.items.map((item, idx) => (
                                          <div key={idx} className="flex justify-between text-sm font-bold text-content/70 bg-surface-muted p-2 rounded-lg">
                                            <span>{item.garmentType} ({item.fabric})</span>
                                            <span>x{item.quantity}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                    <div className="space-y-2">
                                      <p className="text-sm font-black text-content-muted uppercase">{t('common.appointments', 'مواعيد')}</p>
                                      <div className="space-y-2">
                                        <div className="flex items-center gap-2 text-sm font-bold">
                                          <Clock size={14} className="text-brand/60" />
                                          <span className="text-content-muted">{t('common.delivery_date', 'تاريخ الاستلام:')}</span>
                                          <span className="text-content/80">{formatDate(order.deliveryDate)}</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-sm font-bold">
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
                                        className="w-full bg-brand text-white py-3 rounded-xl font-black text-sm flex items-center justify-center gap-2 hover:bg-brand/90 shadow-lg shadow-brand/10 transition-all cursor-pointer"
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
                        <div className="bg-surface-muted w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border border-border text-content-muted/80">
                          <ShoppingBag size={32} />
                        </div>
                        <h4 className="text-base font-black text-content mb-1">{t('dashboard.no_orders_yet', 'لا توجد طلبات بعد')}</h4>
                        <p className="text-sm text-content-muted font-bold max-w-sm mx-auto">{t('dashboard.no_orders_yet_desc', 'سيتم إدراج أحدث طلبات العملاء وحالات خياطتها وتفصيلها هنا فور إنشائها.')}</p>
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
          <div className="bg-surface rounded-2xl border border-border shadow-sm p-4 main-640:p-6 main-720:p-8">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg main-640:text-xl font-black text-content">{t('dashboard.notifications', 'التنبيهات')}</h3>
              <span className="bg-[var(--seen-danger-bg)] text-danger text-sm font-black px-2 py-1 rounded-lg">{t('common.active', 'نشط')}</span>
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
                      notif.type === 'inventory' ? "bg-[var(--seen-danger-bg)] text-danger" : "bg-brand/10 text-brand"
                    )}>
                      {notif.type === 'inventory' ? <AlertTriangle size={18} /> : <Bell size={18} />}
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between items-start gap-2">
                        <p className="text-sm font-black text-content">{notif.title}</p>
                        {notif.status === 'unread' && (
                          <span className="bg-brand text-white text-sm font-black px-1.5 py-0.5 rounded-full animate-pulse whitespace-nowrap">
                            {t('common.new')}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-content-muted mt-1 leading-relaxed">{notif.message}</p>
                      <p className="text-sm text-content-muted/80 mt-2 font-bold">
                        {new Date(notif.createdAt).toLocaleDateString(localeOf(i18n.language), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
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
            <div className="bg-brand rounded-2xl p-4 main-640:p-6 main-720:p-8 text-white shadow-xl shadow-brand/20 relative overflow-hidden group">
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
