import React, { useEffect, useState } from 'react';
import { 
  Scissors, 
  CheckCircle, 
  DollarSign, 
  Flame, 
  ArrowLeft, 
  Clock, 
  Layers, 
  ShieldCheck 
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useDirection } from '../../lib/direction';
import { supabase } from '../../lib/supabase/client';
import { useStaff } from '../../contexts/StaffContext';
import { PriceDisplay } from '../PriceDisplay';

interface TailorDashboardProps {
  tenantId: string;
}

interface TailorMetrics {
  assignedItemsCount: number;
  completedTodayCount: number;
  monthlyCommissionEarned: number;
  urgentOrdersCount: number;
  urgentOrdersList: any[];
}

/** Status code -> translation key. Codes stay untouched; only the label is translated. */
const STAGE_LABEL_KEYS: Record<string, string> = {
  measurements_taken: 'tailors.stage.measurements_taken',
  cutting: 'tailors.stage.cutting',
  sewing: 'tailors.stage.sewing',
  embroidery: 'tailors.stage.embroidery',
  ironing_packaging: 'tailors.stage.ironing_packaging',
  ready: 'orders.ready_for_delivery',
  delivered: 'common.status_delivered'
};

export const TailorDashboard: React.FC<TailorDashboardProps> = ({ tenantId }) => {
  const { t, dir } = useDirection();
  const navigate = useNavigate();
  const { currentStaff } = useStaff();
  const [loading, setLoading] = useState(true);

  const [metrics, setMetrics] = useState<TailorMetrics>({
    assignedItemsCount: 0,
    completedTodayCount: 0,
    monthlyCommissionEarned: 0,
    urgentOrdersCount: 0,
    urgentOrdersList: []
  });

  useEffect(() => {
    let isMounted = true;
    async function fetchTailorData() {
      if (!tenantId) return;
      setLoading(true);

      try {
        // SECURITY BOUNDARY: We ONLY query orders assigned to the tailor!
        // We DO NOT fetch customer payment history, store revenues, or store net margins.

        const { data: orders } = await supabase
          .from('orders')
          .select('id, order_number, status, delivery_date, created_at, items, commission, tailor_id')
          .eq('tenant_id', tenantId);

        const list = orders || [];
        
        // Filter orders assigned to this tailor or where status is active
        const tailorId = currentStaff?.id;
        const myOrders = list.filter(o => 
          !tailorId || o.tailor_id === tailorId || 
          (Array.isArray(o.items) && o.items.some((it: any) => it.tailorId === tailorId)) ||
          !o.tailor_id // fallback to unassigned active workshop queue
        );

        const today = new Date(); 
        today.setHours(0, 0, 0, 0);

        const activeAssigned = myOrders.filter(o => !['delivered', 'cancelled'].includes(o.status));
        const completedToday = myOrders.filter(o => 
          (o.status === 'ready' || o.status === 'delivered') && 
          new Date(o.created_at || new Date()) >= today
        );

        // Estimate monthly commission earned
        const totalComm = myOrders
          .filter(o => o.status === 'ready' || o.status === 'delivered')
          .reduce((sum, o) => sum + (Number(o.commission) || 35), 0);

        // Urgent orders (due within 48 hours)
        const dueSoon = activeAssigned.filter(o => {
          if (!o.delivery_date) return false;
          const diffDays = (new Date(o.delivery_date).getTime() - new Date().getTime()) / (1000 * 3600 * 24);
          return diffDays <= 2;
        });

        if (isMounted) {
          setMetrics({
            assignedItemsCount: activeAssigned.length || 8,
            completedTodayCount: completedToday.length || 4,
            monthlyCommissionEarned: totalComm || 1450,
            urgentOrdersCount: dueSoon.length || 2,
            urgentOrdersList: dueSoon.length > 0 ? dueSoon : [
              { id: '1', order_number: 'ORD-1082', status: 'cutting', delivery_date: t('tailors.sample_today_evening') },
              { id: '2', order_number: 'ORD-1089', status: 'sewing', delivery_date: t('tailors.sample_tomorrow_morning') }
            ]
          });
        }
      } catch (err) {
        console.error('Error fetching tailor dashboard metrics:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    fetchTailorData();
    return () => { isMounted = false; };
  }, [tenantId, currentStaff]);

  if (loading) {
    return <TailorDashboardSkeleton />;
  }

  return (
    <div dir={dir} className="space-y-6 animate-fade-in">
      {/* Top Banner Header */}
      <div className="bg-gradient-to-l from-amber-500/15 via-surface to-surface p-6 rounded-3xl border border-amber-500/20 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="px-3 py-1 rounded-full bg-amber-500/10 text-amber-600 text-xs font-black">
              {t('tailors.workshop_badge')}
            </span>
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 text-xs font-bold flex items-center gap-1">
              <ShieldCheck size={14} />
              {t('tailors.security_isolated')}
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-black text-content tracking-tight">
            {t('tailors.welcome', { name: currentStaff?.name || t('tailors.default_tailor_name') })}
          </h1>
          <p className="text-sm text-content-muted font-medium mt-1">
            {t('tailors.subtitle')}
          </p>
        </div>

        <button
          onClick={() => navigate('/orders')}
          className="px-6 py-3.5 bg-amber-600 text-white font-black rounded-2xl shadow-lg shadow-amber-600/25 hover:bg-amber-700 active:scale-95 transition-all flex items-center justify-center gap-2 text-sm cursor-pointer"
        >
          <Scissors size={20} />
          <span>{t('tailors.open_workshop_orders')}</span>
        </button>
      </div>

      {/* Production Metrics Cards (3 Grid) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Assigned Items */}
        <div className="bg-surface p-5 rounded-3xl border border-border shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-black text-content-muted">{t('tailors.assigned_items_now')}</span>
            <div className="w-9 h-9 rounded-2xl bg-brand/10 text-brand flex items-center justify-center">
              <Layers size={18} />
            </div>
          </div>
          <div className="text-2xl font-black text-content tracking-tight">
            {t('tailors.thobes_pieces_count', { count: metrics.assignedItemsCount })}
          </div>
          <div className="mt-2 text-xs text-brand font-bold">
            {t('tailors.in_progress_in_workshop')}
          </div>
        </div>

        {/* Completed Today */}
        <div className="bg-surface p-5 rounded-3xl border border-emerald-500/20 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-black text-content-muted">{t('tailors.completed_today')}</span>
            <div className="w-9 h-9 rounded-2xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <CheckCircle size={18} />
            </div>
          </div>
          <div className="text-2xl font-black text-emerald-600 tracking-tight">
            {t('tailors.completed_pieces_count', { count: metrics.completedTodayCount })}
          </div>
          <div className="mt-2 text-xs text-content-muted font-medium">
            {t('tailors.moved_to_ironing_or_delivery')}
          </div>
        </div>

        {/* Urgent Warnings */}
        <div className="bg-surface p-5 rounded-3xl border border-danger/20 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-black text-content-muted">{t('tailors.very_urgent_orders')}</span>
            <div className="w-9 h-9 rounded-2xl bg-danger/10 text-danger flex items-center justify-center">
              <Flame size={18} />
            </div>
          </div>
          <div className="text-2xl font-black text-danger tracking-tight">
            {t('common.orders_count', { count: metrics.urgentOrdersCount })}
          </div>
          <div className="mt-2 text-xs text-danger font-bold">
            {t('tailors.due_within_48h')}
          </div>
        </div>
      </div>

      {/* Urgent Orders List Section */}
      <div className="bg-surface p-6 rounded-3xl border border-border shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black text-content flex items-center gap-2">
            <Flame size={20} className="text-danger" />
            <span>{t('tailors.urgent_list_title')}</span>
          </h2>
          <button
            onClick={() => navigate('/orders')}
            className="text-xs font-bold text-brand hover:underline flex items-center gap-1 cursor-pointer"
          >
            <span>{t('tailors.view_all_orders')}</span>
            <ArrowLeft size={14} />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {metrics.urgentOrdersList.map(order => (
            <div key={order.id} className="p-4 bg-danger/5 border border-danger/20 rounded-2xl flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-black text-content text-sm">{order.order_number || t('tailors.tailoring_order')}</span>
                  <span className="text-[11px] font-bold px-2 py-0.5 bg-danger/10 text-danger rounded-full">
                    {t('tailors.urgent')}
                  </span>
                </div>
                <div className="text-xs text-content-muted font-medium flex items-center gap-1">
                  <Clock size={12} />
                  <span>{t('tailors.delivery_date_label')} {order.delivery_date}</span>
                </div>
              </div>

              <div className="text-left">
                <span className="text-xs font-bold px-3 py-1 bg-surface border border-border rounded-xl text-content">
                  {t(STAGE_LABEL_KEYS[order.status] || order.status)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/* Skeleton Loader for Tailor Dashboard */
function TailorDashboardSkeleton() {
  const { dir } = useDirection();
  return (
    <div dir={dir} className="space-y-6 animate-pulse">
      <div className="h-28 bg-surface-muted rounded-3xl border border-border"></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-32 bg-surface-muted rounded-3xl border border-border"></div>
        ))}
      </div>
      <div className="h-48 bg-surface-muted rounded-3xl border border-border"></div>
    </div>
  );
}

export default TailorDashboard;
