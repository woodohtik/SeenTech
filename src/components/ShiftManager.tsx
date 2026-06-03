import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase/client';
import { handleError, OperationType } from '../lib/firebase';
import { Shift } from '../types';
import { useStaff } from '../contexts/StaffContext';
import { logEmployeeAction } from '../services/employeeAuditService';
import { Clock, DollarSign, User, Coins } from 'lucide-react';
import { cn, getCurrencySymbol, formatCurrency } from '../lib/utils';
import { motion } from 'motion/react';

interface ShiftManagerProps {
  tenantId: string;
  onShiftOpen: (shift: Shift) => void;
}

export default function ShiftManager({ tenantId, onShiftOpen }: ShiftManagerProps) {
  const { currentStaff } = useStaff();
  const [loading, setLoading] = useState(true);
  const [openingBalance, setOpeningBalance] = useState<number | ''>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const checkActiveShift = async () => {
      if (!currentStaff) return;
      try {
        const { data, error } = await supabase
          .from('shifts')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('staff_id', currentStaff.id)
          .eq('status', 'open')
          .maybeSingle();

        if (error) throw error;
        if (data) {
          onShiftOpen({
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
            endTime: data.end_time
          } as Shift);
        }
      } catch (error) {
        handleError(error as any, OperationType.LIST, 'shifts');
      } finally {
        setLoading(false);
      }
    };
    checkActiveShift();
  }, [tenantId, currentStaff, onShiftOpen]);

  const handleOpenShift = async () => {
    if (!currentStaff) return;
    setIsSubmitting(true);
    const balanceValue = Number(openingBalance) || 0;
    try {
      const shiftData = {
        tenant_id: tenantId,
        staff_id: currentStaff.id,
        staff_name: currentStaff.name,
        opening_balance: balanceValue,
        start_time: new Date().toISOString(),
        status: 'open' as const,
        created_at: new Date().toISOString()
      };
      
      const { data: newShift, error } = await supabase
        .from('shifts')
        .insert(shiftData)
        .select()
        .single();
      
      if (error) throw error;

      // Audit Log
      await logEmployeeAction(
        tenantId,
        currentStaff.id,
        currentStaff.name,
        'open_shift',
        `تم فتح وردية جديدة برصيد افتتاحي ${formatCurrency(balanceValue)} ${getCurrencySymbol()}`
      );

      onShiftOpen({
        ...newShift,
        tenantId: newShift.tenant_id,
        staffId: newShift.staff_id,
        staffName: newShift.staff_name,
        openingBalance: newShift.opening_balance,
        closingBalance: newShift.closing_balance,
        actualCash: newShift.actual_cash,
        expectedCash: newShift.expected_cash,
        discrepancy: newShift.discrepancy,
        discrepancyReason: newShift.discrepancy_reason,
        startTime: newShift.start_time,
        endTime: newShift.end_time
      } as Shift);
    } catch (error) {
      handleError(error as any, OperationType.WRITE, 'shifts');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand"></div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[150] p-4 overflow-y-auto" dir="rtl">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 350 }}
        className="bg-surface rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-border flex flex-col text-right my-auto"
      >
        {/* Header */}
        <div className="p-6 border-b border-border bg-surface-muted/40 text-center relative">
          <div className="mx-auto w-12 h-12 bg-brand/10 text-brand rounded-2xl flex items-center justify-center mb-3">
            <Coins size={24} />
          </div>
          <h2 className="text-xl font-black text-content">فتح وردية جديدة</h2>
          <p className="text-xs font-bold text-content-muted mt-1">يجب تسجيل الرصيد الافتتاحي للبدء في عمليات المبيعات</p>
        </div>
        
        {/* Body Content */}
        <div className="p-6 space-y-6">
          {/* Staff Info Details Card */}
          <div className="bg-surface-muted/30 p-4 rounded-2xl space-y-3.5 border border-border">
            <div className="flex items-center gap-3 text-content-muted">
              <User size={18} className="text-brand shrink-0" />
              <span className="text-xs font-bold">الموظف الحالي:</span>
              <span className="text-sm font-extrabold text-content">{currentStaff?.name || '—'}</span>
            </div>
            <div className="flex items-center gap-3 text-content-muted">
              <Clock size={18} className="text-brand shrink-0" />
              <span className="text-xs font-bold font-sans">وقت البدء:</span>
              <span className="text-sm font-extrabold text-content" dir="ltr">
                {new Date().toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' })}
              </span>
            </div>
          </div>

          {/* Opening balance field */}
          <div className="space-y-2">
            <label className="block text-xs font-black text-content-muted uppercase tracking-widest">
              رصيد الصندوق الافتتاحي (كاش)
            </label>
            <div className="relative">
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-content-muted font-bold self-center">
                <DollarSign size={20} />
              </span>
              <input 
                type="number" 
                value={openingBalance}
                onChange={(e) => {
                  const val = e.target.value;
                  setOpeningBalance(val === '' ? '' : Number(val));
                }}
                className="w-full pr-12 pl-16 py-3.5 bg-surface-muted/50 border border-border rounded-xl focus:ring-2 focus:ring-brand focus:border-brand outline-none text-xl font-black text-content text-left"
                placeholder="0"
                min="0"
                step="any"
              />
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xs font-extrabold text-content-muted bg-surface/80 px-2 py-1 rounded-md border border-border">
                {getCurrencySymbol()}
              </span>
            </div>
            <p className="text-[10px] text-content-muted leading-relaxed">
              * يمكنك إبقاء القيمة <span className="font-bold text-brand">0</span> إذا كان الدرج فارغاً تماماً في بداية الوردية.
            </p>
          </div>

          {/* Action button */}
          <button 
            onClick={handleOpenShift}
            disabled={isSubmitting || (openingBalance !== '' && openingBalance < 0)}
            className="w-full bg-brand text-white py-4 rounded-xl font-black text-base hover:bg-brand/90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none shadow-lg shadow-brand/10 flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>جاري فتح الوردية...</span>
              </>
            ) : (
              <span>تأكيد وفتح الوردية</span>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
