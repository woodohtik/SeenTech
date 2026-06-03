import React, { useState, useEffect } from 'react';
import { cn } from '../lib/utils';
import { PriceDisplay } from './PriceDisplay';
import Branding from './Branding';
import POS from './POS';
import SalesRecord from './SalesRecord';
import SalesReturns from './SalesReturns';
import TaxInvoices from './TaxInvoices';
import CreditNotes from './CreditNotes';
import ShiftManager from './ShiftManager';
import ShiftClosingModal from './ShiftClosingModal';
import CashOperationsModal from './CashOperationsModal';
import ShiftHistory from './ShiftHistory';
import { supabase } from '../lib/supabase/client';
import { Shift } from '../types';
import { Monitor, FileText, RotateCcw, DollarSign, History, Clock, Wallet, X, Coins, TrendingUp, Plus, TrendingDown } from 'lucide-react';
import { useStaff } from '../contexts/StaffContext';
import { usePermissions } from '../hooks/usePermissions';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';

export default function Sales({ tenantId }: { tenantId: string }) {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar' || i18n.language === 'ur';
  const { currentStaff } = useStaff();
  const { hasPermission } = usePermissions(currentStaff);
  const canManageShifts = hasPermission('shifts.manage');

  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [activeTopTab, setActiveTopTab] = useState<'pos' | 'returns' | 'shifts'>('pos');
  const [activeSubTab, setActiveSubTab] = useState<string>('pos_main');
  
  const [isClosingModalOpen, setIsClosingModalOpen] = useState(false);
  const [isCashOperationsModalOpen, setIsCashOperationsModalOpen] = useState(false);
  const [cashDrawerBalance, setCashDrawerBalance] = useState<number>(0);
  const [isCashDrawerDetailsOpen, setIsCashDrawerDetailsOpen] = useState(false);
  const [cashDrawerBreakdown, setCashDrawerBreakdown] = useState({
    opening: 0,
    sales: 0,
    deposits: 0,
    withdrawals: 0,
    returns: 0,
    total: 0
  });

  // Fetch Cash Drawer balance in real-time
  const fetchCashDrawerBalance = async () => {
    if (!activeShift?.id) return;
    try {
      // 1. Fetch current shift Details
      const { data: shift, error: shiftErr } = await supabase
        .from('shifts')
        .select('*')
        .eq('id', activeShift.id)
        .maybeSingle();

      if (shiftErr) throw shiftErr;
      if (!shift) return;

      // Fetch shift entries for this shift
      const { data: entries, error: entriesErr } = await supabase
        .from('shift_entries')
        .select('*')
        .eq('shift_id', activeShift.id);

      if (!entriesErr && entries) {
        shift.deposits = entries
          .filter((e: any) => e.entry_type === 'deposit')
          .map((e: any) => ({ id: e.id, amount: Number(e.amount), reason: e.reason, time: e.occurred_at }));

        shift.payouts = entries
          .filter((e: any) => e.entry_type === 'payout')
          .map((e: any) => ({ id: e.id, amount: Number(e.amount), reason: e.reason, time: e.occurred_at }));
      }

      // 2. Fetch all orders for this shift
      const { data: orders, error: ordersErr } = await supabase
        .from('orders')
        .select('*')
        .eq('shift_id', activeShift.id);

      if (ordersErr) throw ordersErr;

      let cashSales = 0;
      let cashReturns = 0;

      (orders || []).forEach(order => {
        if (order.status === 'cancelled') {
          if (order.payment_method === 'cash') {
            cashReturns += (order.paid_amount || 0);
          }
        } else {
          if (order.payment_method === 'cash') {
            cashSales += (order.paid_amount || 0);
          }
        }
      });

      // Calculate totals
      const opening = Number(shift.opening_balance || 0);
      
      // Calculate deposits from shift.deposits
      let customDeposits = 0;
      if (Array.isArray(shift.deposits)) {
        customDeposits = shift.deposits.reduce((sum: number, d: any) => sum + Number(d.amount || 0), 0);
      } else if (typeof shift.deposits === 'string') {
        try {
          const parsed = JSON.parse(shift.deposits);
          if (Array.isArray(parsed)) {
            customDeposits = parsed.reduce((sum: number, d: any) => sum + Number(d.amount || 0), 0);
          }
        } catch (_) {}
      }

      // Calculate payouts/expenses from shift.payouts
      let customPayouts = 0;
      if (Array.isArray(shift.payouts)) {
        customPayouts = shift.payouts.reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
      } else if (typeof shift.payouts === 'string') {
        try {
          const parsed = JSON.parse(shift.payouts);
          if (Array.isArray(parsed)) {
            customPayouts = parsed.reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
          }
        } catch (_) {}
      }

      const totalInDrawer = opening + cashSales + customDeposits - cashReturns - customPayouts;
      setCashDrawerBalance(totalInDrawer);
      setCashDrawerBreakdown({
        opening,
        sales: cashSales,
        deposits: customDeposits,
        withdrawals: customPayouts,
        returns: cashReturns,
        total: totalInDrawer
      });
    } catch (err) {
      console.error('Error calculating cash drawer balance in Sales module:', err);
    }
  };

  // Real-time listener for current shift updates and orders in Sales header
  useEffect(() => {
    if (!activeShift?.id) return;

    fetchCashDrawerBalance();

    const ordersChannel = supabase
      .channel(`sales-header-orders-${activeShift.id}`)
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'orders',
        filter: `shift_id=eq.${activeShift.id}`
      }, () => {
        fetchCashDrawerBalance();
      })
      .subscribe();

    const shiftsChannel = supabase
      .channel(`sales-header-shifts-${activeShift.id}`)
      .on('postgres_changes', { 
        event: 'UPDATE', 
        schema: 'public', 
        table: 'shifts',
        filter: `id=eq.${activeShift.id}`
      }, () => {
        fetchCashDrawerBalance();
      })
      .subscribe();

    const shiftEntriesChannel = supabase
      .channel(`sales-header-entries-${activeShift.id}`)
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'shift_entries',
        filter: `shift_id=eq.${activeShift.id}`
      }, () => {
        fetchCashDrawerBalance();
      })
      .subscribe();

    return () => {
      ordersChannel.unsubscribe();
      shiftsChannel.unsubscribe();
      shiftEntriesChannel.unsubscribe();
    };
  }, [activeShift?.id]);

  // Listen to active shift changes
  useEffect(() => {
    if (!activeShift?.id) return;

    const fetchShift = async () => {
      const { data, error } = await supabase
        .from('shifts')
        .select('*')
        .eq('id', activeShift.id)
        .single();
      
      if (data && !error) {
        // Also fetch entries
        const { data: entries } = await supabase
          .from('shift_entries')
          .select('*')
          .eq('shift_id', activeShift.id);

        const deposits = (entries || [])
          .filter((e: any) => e.entry_type === 'deposit')
          .map((e: any) => ({ id: e.id, amount: Number(e.amount), reason: e.reason, time: e.occurred_at }));

        const payouts = (entries || [])
          .filter((e: any) => e.entry_type === 'payout')
          .map((e: any) => ({ id: e.id, amount: Number(e.amount), reason: e.reason, time: e.occurred_at }));

        setActiveShift({
          ...data,
          tenantId: data.tenant_id,
          staffId: data.staff_id,
          staffName: data.staff_name,
          openingBalance: data.opening_balance,
          closingBalance: data.closing_balance,
          actualCash: data.actual_cash,
          expectedCash: data.expected_cash,
          discrepancy: data.discrepancy,
          discrepancyReason: data.discrepancy_reason,
          startTime: data.start_time,
          endTime: data.end_time,
          deposits,
          payouts
        } as Shift);
      }
    };

    fetchShift();

    const channel = supabase
      .channel(`shift-${activeShift.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'shifts', filter: `id=eq.${activeShift.id}` }, () => {
        fetchShift();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeShift?.id]);

  const handleTopTabChange = (tab: 'pos' | 'returns' | 'shifts') => {
    setActiveTopTab(tab);
    if (tab === 'pos') setActiveSubTab('pos_main');
    if (tab === 'returns') setActiveSubTab('returns_main');
    if (tab === 'shifts') setActiveSubTab('shifts_main');
  };

  const handleCloseShift = () => {
    setIsClosingModalOpen(true);
  };

  const handleShiftClosed = () => {
    setIsClosingModalOpen(false);
    setActiveShift(null);
  };

  return (
    <div className="flex flex-col h-full font-sans bg-background" dir={isRtl ? 'rtl' : 'ltr'} style={{ fontFamily: 'IBM Plex Sans, sans-serif' }}>
      {/* Header & Top Tabs */}
      <div className="bg-surface border-b border-border shrink-0">
        <div className="px-6 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <h1 className="text-2xl font-bold text-content">{t('sales.title', 'المبيعات')}</h1>
          {activeShift && (
            <div className="flex flex-wrap items-center gap-4 bg-surface-muted/30 px-4 py-2.5 rounded-2xl border border-border/60">
              {/* Active Shift Details */}
              <div className="text-sm text-content-muted flex items-center gap-2">
                <Clock className="text-brand shrink-0" size={16} />
                <span>
                  {t('sales.active_shift', 'وردية نشطة')}: <span className="font-extrabold text-content">{activeShift.staffName}</span> | {t('sales.shift_start', 'البداية')}: <span className="font-semibold text-content" dir="ltr">{new Date(activeShift.startTime).toLocaleTimeString(i18n.language === 'ar' ? 'ar-SA' : (i18n.language === 'ur' ? 'ur-PK' : 'en-US'), { hour: '2-digit', minute: '2-digit' })}</span>
                </span>
              </div>
              
              {/* Divider */}
              <span className="hidden md:inline h-4 w-px bg-border" />

              {/* Dynamic Cash Drawer Balance Badge */}
              <button
                onClick={() => setIsCashDrawerDetailsOpen(true)}
                className="flex items-center gap-2 bg-emerald-500/10 text-emerald-600 px-3.5 py-1.5 rounded-xl border border-emerald-500/20 shadow-sm hover:bg-emerald-500/20 transition-all cursor-pointer active:scale-95"
                title={t('sales.cash_drawer_tooltip', 'انقر لعرض تفصيل وتدفق نقدية الصندوق')}
              >
                <Wallet size={16} className="text-emerald-500 shrink-0" />
                <span className="text-xs font-bold text-emerald-700">{t('sales.cash_drawer', 'صندوق الكاش')}:</span>
                <span className="text-sm font-black text-emerald-600">
                  <PriceDisplay amount={cashDrawerBalance} />
                </span>
              </button>

              {/* Action operations buttons */}
              {canManageShifts && (
                <>
                  <span className="hidden md:inline h-4 w-px bg-border" />
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setIsCashOperationsModalOpen(true)}
                      className="text-brand bg-brand/5 hover:bg-brand/10 border border-brand/20 px-3.5 py-1.5 rounded-xl text-xs font-extrabold transition-all duration-250 flex items-center gap-1.5 active:scale-95"
                    >
                      <DollarSign size={15} />
                      {t('sales.cash_operations', 'حركة الدرج النقدية')}
                    </button>
                    <button 
                      onClick={handleCloseShift}
                      className="bg-brand text-white hover:bg-brand/90 px-3.5 py-1.5 rounded-xl text-xs font-extrabold transition-all duration-250 active:scale-95"
                    >
                      {t('sales.close_shift', 'إغلاق الوردية')}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        
        {/* Primary Top Tabs */}
        <div className="flex px-6 gap-8 border-b border-border/50">
          <button
            onClick={() => handleTopTabChange('pos')}
            className={cn(
              "pb-4 text-sm font-bold flex items-center gap-2 border-b-2 transition-colors",
              activeTopTab === 'pos' ? "border-brand text-brand" : "border-transparent text-content-muted hover:text-content"
            )}
          >
            <Monitor size={18} />
            {t('sales.pos', 'نقطة البيع (POS)')}
          </button>
          <button
            onClick={() => handleTopTabChange('returns')}
            className={cn(
              "pb-4 text-sm font-bold flex items-center gap-2 border-b-2 transition-colors",
              activeTopTab === 'returns' ? "border-brand text-brand" : "border-transparent text-content-muted hover:text-content"
            )}
          >
            <RotateCcw size={18} />
            {t('sales.returns', 'المرتجعات')}
          </button>
          {canManageShifts && (
            <button
              onClick={() => handleTopTabChange('shifts')}
              className={cn(
                "pb-4 text-sm font-bold flex items-center gap-2 border-b-2 transition-colors",
                activeTopTab === 'shifts' ? "border-brand text-brand" : "border-transparent text-content-muted hover:text-content"
              )}
            >
              <Clock size={18} />
              {t('sales.shifts', 'الورديات')}
            </button>
          )}
        </div>

        {/* Sub Tabs */}
        <div className="flex px-6 gap-4 py-3 bg-surface-muted/50 overflow-x-auto scrollbar-hide scroll-smooth">
          {activeTopTab === 'pos' && (
            <>
              <button
                onClick={() => setActiveSubTab('pos_main')}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-bold transition-colors",
                  activeSubTab === 'pos_main' ? "bg-brand text-white" : "bg-surface text-content-muted border border-border hover:border-brand hover:text-brand"
                )}
              >
                {t('sales.pos', 'نقطة البيع')}
              </button>
              <button
                onClick={() => setActiveSubTab('sales_record')}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-bold transition-colors",
                  activeSubTab === 'sales_record' ? "bg-brand text-white" : "bg-surface text-content-muted border border-border hover:border-brand hover:text-brand"
                )}
              >
                {t('sales.sales_record', 'سجل المبيعات')}
              </button>
              <button
                onClick={() => setActiveSubTab('tax_invoices')}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-bold transition-colors",
                  activeSubTab === 'tax_invoices' ? "bg-brand text-white" : "bg-surface text-content-muted border border-border hover:border-brand hover:text-brand"
                )}
              >
                {t('sales.tax_invoices', 'الفواتير الضريبية')}
              </button>
              <button
                onClick={() => setActiveSubTab('credit_notes')}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-bold transition-colors",
                  activeSubTab === 'credit_notes' ? "bg-brand text-white" : "bg-surface text-content-muted border border-border hover:border-brand hover:text-brand"
                )}
              >
                {t('sales.credit_notes', 'الإشعارات الدائنة')}
              </button>
            </>
          )}
          {activeTopTab === 'returns' && (
            <>
              <button
                onClick={() => setActiveSubTab('returns_main')}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-bold transition-colors",
                  activeSubTab === 'returns_main' ? "bg-brand text-white" : "bg-surface text-content-muted border border-border hover:border-brand hover:text-brand"
                )}
              >
                {t('sales.returns', 'المرتجعات')}
              </button>
              <button
                onClick={() => setActiveSubTab('returns_record')}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-bold transition-colors",
                  activeSubTab === 'returns_record' ? "bg-brand text-white" : "bg-surface text-content-muted border border-border hover:border-brand hover:text-brand"
                )}
              >
                {t('sales.returns_record', 'سجل المرتجعات')}
              </button>
            </>
          )}
          {activeTopTab === 'shifts' && canManageShifts && (
            <>
              <button
                onClick={() => setActiveSubTab('shifts_main')}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-bold transition-colors",
                  activeSubTab === 'shifts_main' ? "bg-brand text-white" : "bg-surface text-content-muted border border-border hover:border-brand hover:text-brand"
                )}
              >
                {t('sales.shifts', 'الورديات')}
              </button>
              <button
                onClick={() => setActiveSubTab('shifts_record')}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-bold transition-colors",
                  activeSubTab === 'shifts_record' ? "bg-brand text-white" : "bg-surface text-content-muted border border-border hover:border-brand hover:text-brand"
                )}
              >
                {t('sales.shifts_record', 'سجل الورديات')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto relative">
        {/* POS Tab Content */}
        {activeTopTab === 'pos' && activeSubTab === 'pos_main' && (
          !activeShift ? (
            <ShiftManager tenantId={tenantId} onShiftOpen={setActiveShift} />
          ) : (
            <POS tenantId={tenantId} shiftId={activeShift.id} />
          )
        )}
        {activeTopTab === 'pos' && activeSubTab === 'sales_record' && (
          <SalesRecord tenantId={tenantId} />
        )}
        {activeTopTab === 'pos' && activeSubTab === 'tax_invoices' && (
          <TaxInvoices tenantId={tenantId} />
        )}
        {activeTopTab === 'pos' && activeSubTab === 'credit_notes' && (
          <CreditNotes tenantId={tenantId} />
        )}

        {/* Returns Tab Content */}
        {activeTopTab === 'returns' && activeSubTab === 'returns_main' && (
          <SalesReturns tenantId={tenantId} />
        )}
        {activeTopTab === 'returns' && activeSubTab === 'returns_record' && (
          <SalesRecord tenantId={tenantId} filterStatus="cancelled" />
        )}

        {/* Shifts Tab Content */}
        {activeTopTab === 'shifts' && activeSubTab === 'shifts_main' && canManageShifts && (
          <div className="p-6">
            {!activeShift ? (
              <div className="bg-surface p-8 rounded-2xl border border-border text-center max-w-md mx-auto">
                <Clock size={48} className="mx-auto text-content-muted mb-4" />
                <h2 className="text-2xl font-bold text-content mb-2">{t('sales.no_active_shift', 'لا توجد وردية نشطة')}</h2>
                <p className="text-content-muted mb-6">{t('sales.must_open_shift', 'يجب فتح وردية للبدء في عمليات البيع')}</p>
                <button 
                  onClick={() => {
                    setActiveTopTab('pos');
                    setActiveSubTab('pos_main');
                  }}
                  className="bg-brand text-white px-6 py-3 rounded-xl font-bold hover:bg-brand/90 transition-colors w-full"
                >
                  {t('sales.go_to_open_shift', 'الذهاب لفتح وردية')}
                </button>
              </div>
            ) : (
              <div className="bg-surface p-8 rounded-2xl border border-border max-w-md mx-auto">
                <h2 className="text-2xl font-bold text-content mb-6">{t('sales.current_shift', 'الوردية الحالية')}</h2>
                <div className="space-y-4 mb-8">
                  <div className="flex justify-between items-center py-3 border-b border-border/50">
                    <span className="text-content-muted font-medium">{t('sales.employee', 'الموظف')}</span>
                    <span className="font-bold text-content">{activeShift.staffName}</span>
                  </div>
                  <div className="flex justify-between items-center py-3 border-b border-border/50">
                    <span className="text-content-muted font-medium">{t('sales.start_time', 'وقت البداية')}</span>
                    <span className="font-bold text-content" dir="ltr">{new Date(activeShift.startTime).toLocaleString(i18n.language === 'ar' ? 'ar-SA' : (i18n.language === 'ur' ? 'ur-PK' : 'en-US'))}</span>
                  </div>
                  <div className="flex justify-between items-center py-3 border-b border-border/50">
                    <span className="text-content-muted font-medium">{t('sales.opening_balance', 'الرصيد الافتتاحي')}</span>
                    <span className="font-bold text-brand"><PriceDisplay amount={activeShift.openingBalance} /></span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-4">
                  <button 
                    onClick={() => setIsCashOperationsModalOpen(true)}
                    className="flex-1 bg-surface-muted text-content py-3 rounded-xl font-bold hover:bg-surface transition-colors flex items-center justify-center gap-2"
                  >
                    <DollarSign size={18} />
                    {t('sales.cash_operations', 'حركة الدرج النقدية')}
                  </button>
                  <button 
                    onClick={handleCloseShift}
                    className="flex-1 bg-brand text-white py-3 rounded-xl font-bold hover:bg-brand/90 transition-colors"
                  >
                    {t('sales.close_shift', 'إغلاق الوردية')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {activeTopTab === 'shifts' && activeSubTab === 'shifts_record' && canManageShifts && (
          <ShiftHistory 
            tenantId={tenantId} 
            staffId={currentStaff?.id || ''} 
            isManager={currentStaff?.role === 'owner' || currentStaff?.role === 'admin' || currentStaff?.role === 'super_admin' || currentStaff?.role === 'manager'} 
          />
        )}
      </div>

      {/* Modals */}
      {isClosingModalOpen && activeShift && (
        <ShiftClosingModal 
          shift={activeShift} 
          tenantId={tenantId} 
          onClose={() => setIsClosingModalOpen(false)} 
          onClosed={handleShiftClosed} 
        />
      )}

      {isCashOperationsModalOpen && activeShift && (
        <CashOperationsModal 
          shift={activeShift} 
          tenantId={tenantId}
          onClose={() => {
            setIsCashOperationsModalOpen(false);
            fetchCashDrawerBalance();
          }} 
        />
      )}

      {/* Cash Drawer Details Modal */}
      <AnimatePresence>
        {isCashDrawerDetailsOpen && activeShift && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md overflow-y-auto font-sans">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="relative w-full max-w-md rounded-[2.5rem] bg-surface shadow-2xl flex flex-col my-auto border border-border overflow-hidden text-right"
              dir={isRtl ? 'rtl' : 'ltr'}
            >
              {/* Header */}
              <div className="sticky top-0 z-10 flex items-center justify-between p-6 border-b border-border bg-surface shrink-0 bg-brand/5">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-brand/10 text-brand rounded-2xl shrink-0 shadow-sm">
                    <Wallet size={24} />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-content">{t('sales.cash_drawer_details', 'تدفق نقدية الصندوق')}</h2>
                    <p className="text-xs font-bold text-content-muted mt-0.5">{t('sales.shift_cash_details', 'تفاصيل وحالة نقدية الوردية الحالية')}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsCashDrawerDetailsOpen(false)} 
                  className="p-2 hover:bg-surface-muted rounded-full transition-colors text-content-muted"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Body */}
              <div className="p-6 space-y-6">
                {/* Employee / Shift info */}
                <div className="flex justify-between items-center text-xs font-bold text-content-muted bg-surface-muted/35 px-4 py-2.5 rounded-xl border border-border">
                  <span>{t('sales.employee', 'الموظف')}: <span className="text-content font-extrabold">{activeShift.staffName || t('sales.unknown', 'غير معروف')}</span></span>
                  <span>{t('sales.shift_no', 'رقم الوردية')}: <span className="font-mono text-content font-extrabold">#{activeShift.id?.slice(-6).toUpperCase()}</span></span>
                </div>

                {/* Main Cash Drawer Indicator */}
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-3xl p-5 text-center space-y-2">
                  <span className="text-xs font-black text-emerald-600 block uppercase tracking-widest">
                    {t('sales.expected_cash', 'صافي النقدية المتوقعة بالصندوق (كاش)')}
                  </span>
                  <div className="text-3xl font-black text-emerald-500 tracking-tight">
                    <PriceDisplay amount={cashDrawerBalance} />
                  </div>
                  <p className="text-[10px] text-content-muted">
                    {t('sales.expected_cash_desc', '* هذا المبلغ يمثل الرصيد المسجل بالإضافة للمبيعات والإيداعات مخصوماً منه المصروفات والمرتجعات.')}
                  </p>
                </div>

                {/* Operations Breakdown Grid */}
                <div className="space-y-3.5">
                  <h3 className="text-xs font-black text-content-muted uppercase tracking-widest">{t('sales.flow_details', 'تفاصيل التدفق المالي')}</h3>
                  
                  <div className="grid grid-cols-1 gap-3">
                    {/* Opening Balance */}
                    <div className="flex items-center justify-between p-3.5 bg-surface-muted/30 border border-border rounded-2xl">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 bg-blue-500/10 text-blue-500 rounded-xl">
                          <Coins size={18} />
                        </div>
                        <span className="text-xs font-bold text-content">{t('sales.opening_balance', 'الرصيد الافتتاحي')}</span>
                      </div>
                      <span className="text-sm font-black text-content">
                        <PriceDisplay amount={cashDrawerBreakdown.opening} />
                      </span>
                    </div>

                    {/* Cash Sales */}
                    <div className="flex items-center justify-between p-3.5 bg-surface-muted/30 border border-border rounded-2xl">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-xl">
                          <TrendingUp size={18} />
                        </div>
                        <span className="text-xs font-bold text-content">{t('sales.cash_sales', 'مبيعات كاش')}</span>
                      </div>
                      <span className="text-sm font-black text-emerald-500">
                        + <PriceDisplay amount={cashDrawerBreakdown.sales} />
                      </span>
                    </div>

                    {/* Cash Deposits */}
                    {cashDrawerBreakdown.deposits > 0 && (
                      <div className="flex items-center justify-between p-3.5 bg-surface-muted/30 border border-border rounded-2xl">
                        <div className="flex items-center gap-2.5">
                          <div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-xl">
                            <Plus size={18} />
                          </div>
                          <span className="text-xs font-bold text-content">{t('sales.cash_deposits', 'عمليات الإيداع كاش')}</span>
                        </div>
                        <span className="text-sm font-black text-emerald-500">
                          + <PriceDisplay amount={cashDrawerBreakdown.deposits} />
                        </span>
                      </div>
                    )}

                    {/* Cash Returns (Subtracted) */}
                    {cashDrawerBreakdown.returns > 0 && (
                      <div className="flex items-center justify-between p-3.5 bg-surface-muted/30 border border-border rounded-2xl">
                        <div className="flex items-center gap-2.5">
                          <div className="p-2 bg-red-500/10 text-red-500 rounded-xl">
                            <TrendingDown size={18} />
                          </div>
                          <span className="text-xs font-bold text-content">{t('sales.cash_returns', 'مرتجعات مبيعات (كاش)')}</span>
                        </div>
                        <span className="text-sm font-black text-red-500">
                          - <PriceDisplay amount={cashDrawerBreakdown.returns} />
                        </span>
                      </div>
                    )}

                    {/* Cash Withdrawals / Expenditures */}
                    {cashDrawerBreakdown.withdrawals > 0 && (
                      <div className="flex items-center justify-between p-3.5 bg-surface-muted/30 border border-border rounded-2xl">
                        <div className="flex items-center gap-2.5">
                          <div className="p-2 bg-red-500/10 text-red-500 rounded-xl">
                            <X size={18} />
                          </div>
                          <span className="text-xs font-bold text-content">{t('sales.expenses_withdrawals', 'المصروفات والمسحوبات')}</span>
                        </div>
                        <span className="text-sm font-black text-red-500">
                          - <PriceDisplay amount={cashDrawerBreakdown.withdrawals} />
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => {
                      fetchCashDrawerBalance();
                    }}
                    className="flex-1 py-3 bg-surface border border-border text-content hover:bg-surface-muted rounded-xl transition-all font-bold text-xs sm:text-sm text-center flex items-center justify-center gap-2 active:scale-95 cursor-pointer text-right"
                  >
                    <Coins size={16} />
                    <span>{t('sales.refresh_data', 'تحديث البيانات')}</span>
                  </button>
                  <button
                    onClick={() => setIsCashDrawerDetailsOpen(false)}
                    className="flex-1 py-3 bg-brand text-white hover:bg-brand/90 rounded-xl transition-all font-bold text-xs sm:text-sm text-center active:scale-95 cursor-pointer"
                  >
                    {t('sales.close', 'إغلاق')}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer Branding */}
    </div>
  );
}
