import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { X, Calculator, AlertTriangle, CheckCircle2, FileText, Printer } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { handleError, OperationType } from '../lib/firebase';
import { Shift, Order, ShiftTotals } from '../types';
import { logEmployeeAction } from '../services/employeeAuditService';
import { cn } from '../lib/utils';
import { PriceDisplay } from './PriceDisplay';
import ZReport from './ZReport';

interface ShiftClosingModalProps {
  shift: Shift;
  tenantId: string;
  onClose: () => void;
  onClosed: () => void;
}

export default function ShiftClosingModal({ shift, tenantId, onClose, onClosed }: ShiftClosingModalProps) {
  const [actualCash, setActualCash] = useState('');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [closedShiftData, setClosedShiftData] = useState<Shift | null>(null);
  
  const [totals, setTotals] = useState<ShiftTotals>({
    cash: 0,
    card: 0,
    bank_transfer: 0,
    credit: 0,
    cashReturns: 0,
    totalReturns: 0,
    returnCount: 0,
    expenses: 0,
    totalDeposits: 0,
    taxes: 0,
    totalSales: 0,
    grossSales: 0,
    discounts: 0
  });

  useEffect(() => {
    const fetchShiftData = async () => {
      try {
        const { data: orders, error } = await supabase
          .from('orders')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('shift_id', shift.id);

        if (error) throw error;

        let cash = 0;
        let card = 0;
        let bank_transfer = 0;
        let credit = 0;
        let cashReturns = 0;
        let totalReturns = 0;
        let returnCount = 0;
        let taxes = 0;
        let totalSales = 0;
        let grossSales = 0;
        let discounts = 0;

        (orders || []).forEach(order => {
          if (order.status === 'cancelled') {
            totalReturns += (order.total_amount || 0);
            returnCount++;
            if (order.payment_method === 'cash') cashReturns += (order.paid_amount || 0);
          } else {
            totalSales += (order.total_amount || 0);
            grossSales += (order.total_amount || 0); 
            taxes += (order.tax_amount || 0);
            
            if (order.payment_method === 'cash') cash += (order.paid_amount || 0);
            else if (order.payment_method === 'network') card += (order.paid_amount || 0);
            else if (order.payment_method === 'bank_transfer') bank_transfer += (order.paid_amount || 0);
            else credit += (order.paid_amount || 0);
          }
        });

        const { data: entries, error: entriesErr } = await supabase
          .from('shift_entries')
          .select('*')
          .eq('shift_id', shift.id);

        let dynamicPayouts = [];
        let dynamicDeposits = [];

        if (!entriesErr && entries) {
          dynamicPayouts = entries
            .filter((e: any) => e.entry_type === 'payout')
            .map((e: any) => ({ amount: Number(e.amount || 0) }));

          dynamicDeposits = entries
            .filter((e: any) => e.entry_type === 'deposit')
            .map((e: any) => ({ amount: Number(e.amount || 0) }));
        } else {
          dynamicPayouts = Array.isArray(shift.payouts) ? shift.payouts : [];
          dynamicDeposits = Array.isArray(shift.deposits) ? shift.deposits : [];
        }

        const expenses = dynamicPayouts.reduce((sum, p) => sum + p.amount, 0) || 0;
        const totalDeposits = dynamicDeposits.reduce((sum, d) => sum + d.amount, 0) || 0;

        setTotals({
          cash,
          card,
          bank_transfer,
          credit,
          cashReturns,
          totalReturns,
          returnCount,
          expenses,
          totalDeposits,
          taxes,
          totalSales,
          grossSales,
          discounts
        });
      } catch (error) {
        handleError(error as any, OperationType.GET, 'orders');
      } finally {
        setLoading(false);
      }
    };

    fetchShiftData();
  }, [shift.id, tenantId]);

  const expectedCash = shift.openingBalance + totals.cash + totals.totalDeposits - totals.cashReturns - totals.expenses;
  const discrepancy = actualCash ? Number(actualCash) - expectedCash : 0;
  const hasDiscrepancy = actualCash !== '' && discrepancy !== 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actualCash) return;
    if (hasDiscrepancy && !reason) {
      alert('يرجى إدخال سبب العجز/الزيادة');
      return;
    }

    setIsSubmitting(true);
    try {
      const endTime = new Date().toISOString();
      const closedData: any = {
        status: 'closed' as const,
        end_time: endTime,
        actual_cash: Number(actualCash),
        expected_cash: expectedCash,
        discrepancy,
        discrepancy_reason: hasDiscrepancy ? reason : '',
        totals,
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('shifts')
        .update(closedData)
        .eq('id', shift.id);

      if (error) throw error;
      
      // Audit Log
      await logEmployeeAction(
        shift.tenantId,
        shift.staffId,
        shift.staffName,
        'close_shift',
        `إغلاق وردية بصافي نقدي فعلي ${actualCash} متوقع ${expectedCash}، العجز/الزيادة: ${discrepancy}`
      );

      // Keep data for the report view
      setClosedShiftData({
        ...shift,
        status: 'closed',
        endTime,
        actualCash: Number(actualCash),
        expectedCash,
        discrepancy,
        discrepancyReason: hasDiscrepancy ? reason : '',
        totals
      });
    } catch (error) {
      handleError(error as any, OperationType.UPDATE, 'shifts');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
      </div>
    );
  }

  // Show Z-Report after closing
  if (closedShiftData) {
    return (
      <div className="fixed inset-0 z-[100] overflow-y-auto bg-surface-muted">
        <ZReport 
          data={closedShiftData} 
          onClose={onClosed} 
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
      <div 
        className="relative w-full max-w-[clamp(320px,94vw,560px)] max-h-[90vh] overflow-y-auto rounded-[var(--radius-card)] bg-[var(--surface)] shadow-2xl flex flex-col my-auto text-right"
        dir="rtl"
      >
        <form onSubmit={handleSubmit} className="flex flex-col h-full">
          {/* Header (Fixed) */}
          <div className="sticky top-0 z-10 flex items-center justify-between p-4 sm:p-6 border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-brand/10 text-brand rounded-2xl">
                <Calculator size={22} />
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-black text-content">إغلاق الوردية</h2>
                <p className="text-xs text-content-muted font-bold mt-0.5">تسوية الصندوق وإصدار التقرير</p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="p-2 hover:bg-surface-muted rounded-full transition-colors shadow-sm text-content-muted">
              <X size={20} />
            </button>
          </div>

          {/* Body (Scrollable) */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
            <div className="bg-surface-muted p-4 rounded-2xl space-y-2">
              <div className="flex justify-between text-xs sm:text-sm font-bold text-content-muted">
                <span>رصيد الافتتاح:</span>
                <span><PriceDisplay amount={shift.openingBalance} /></span>
              </div>
              <div className="flex justify-between text-xs sm:text-sm font-bold text-content-muted">
                <span>مبيعات نقدية:</span>
                <span className="text-success">+<PriceDisplay amount={totals.cash} /></span>
              </div>
              <div className="flex justify-between text-xs sm:text-sm font-bold text-content-muted">
                <span>مرتجعات نقدية:</span>
                <span className="text-danger">-<PriceDisplay amount={totals.cashReturns} /></span>
              </div>
              <div className="flex justify-between text-xs sm:text-sm font-bold text-content-muted">
                <span>إيداعات نقدية:</span>
                <span className="text-success">+<PriceDisplay amount={totals.totalDeposits} /></span>
              </div>
              <div className="flex justify-between text-xs sm:text-sm font-bold text-content-muted">
                <span>مصروفات (سحب):</span>
                <span className="text-danger">-<PriceDisplay amount={totals.expenses} /></span>
              </div>
              <div className="pt-2 border-t border-border flex justify-between text-sm sm:text-base font-black text-content">
                <span>المبلغ المتوقع في الدرج:</span>
                <span><PriceDisplay amount={expectedCash} /></span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-black text-content-muted uppercase tracking-widest ml-1">المبلغ الفعلي في الدرج (Blind Close)</label>
              <input 
                type="number"
                required
                min="0"
                step="0.01"
                value={actualCash}
                onChange={(e) => setActualCash(e.target.value)}
                className="w-full px-4 py-2.5 bg-surface-muted border-none rounded-2xl focus:ring-2 focus:ring-brand font-bold text-base sm:text-lg text-center text-content"
                placeholder="0.00"
              />
            </div>

            {actualCash !== '' && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className={cn(
                  "p-4 rounded-2xl border-2 flex flex-col gap-3",
                  discrepancy === 0 ? "border-success bg-success/10" : "border-danger bg-danger/10"
                )}
              >
                <div className="flex items-center gap-2">
                  {discrepancy === 0 ? (
                    <CheckCircle2 className="text-success" size={18} />
                  ) : (
                    <AlertTriangle className="text-danger" size={18} />
                  )}
                  <span className={cn(
                    "font-black text-xs sm:text-sm",
                    discrepancy === 0 ? "text-success" : "text-danger"
                  )}>
                    {discrepancy === 0 ? 'المبلغ مطابق' : discrepancy > 0 ? <span className="flex items-center gap-1">زيادة بقيمة <PriceDisplay amount={Math.abs(discrepancy)} /></span> : <span className="flex items-center gap-1">عجز بقيمة <PriceDisplay amount={Math.abs(discrepancy)} /></span>}
                  </span>
                </div>
                
                {hasDiscrepancy && (
                  <textarea 
                    required
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="w-full p-3 bg-surface border-none rounded-xl focus:ring-2 focus:ring-danger font-bold text-xs sm:text-sm resize-none text-content"
                    placeholder="يرجى توضيح سبب العجز أو الزيادة..."
                    rows={2}
                  />
                )}
              </motion.div>
            )}
          </div>

          {/* Footer (Fixed) */}
          <div className="sticky bottom-0 z-10 p-4 sm:p-6 border-t border-[var(--border)] bg-[var(--surface)] shrink-0">
            <button 
              type="submit"
              disabled={isSubmitting || !actualCash || (hasDiscrepancy && !reason)}
              className="w-full bg-brand text-white py-3 sm:py-3.5 rounded-2xl font-black text-sm sm:text-base hover:bg-brand/90 transition-all shadow-lg shadow-brand/20 disabled:opacity-50"
            >
              {isSubmitting ? 'جاري الإغلاق...' : 'تأكيد وإغلاق الوردية'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
