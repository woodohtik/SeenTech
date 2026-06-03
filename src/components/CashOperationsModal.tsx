import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { X, ArrowDownRight, ArrowUpRight, User, Banknote, CheckCircle2, Clock, History, ChevronDown, ChevronUp, AlertCircle, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { Shift } from '../types';
import { cn, formatCurrency } from '../lib/utils';
import { handleError, OperationType } from '../lib/firebase';
import { logEmployeeAction } from '../services/employeeAuditService';

interface CashOperationsModalProps {
  shift: Shift;
  tenantId: string;
  onClose: () => void;
}

interface ShiftEntry {
  id: string;
  entry_type: 'deposit' | 'payout';
  amount: number;
  reason: string;
  occurred_at: string;
  created_at: string;
}

export default function CashOperationsModal({ shift, tenantId, onClose }: CashOperationsModalProps) {
  const [operationType, setOperationType] = useState<'deposit' | 'withdrawal'>('withdrawal');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recentEntries, setRecentEntries] = useState<ShiftEntry[]>([]);
  const [isLoadingEntries, setIsLoadingEntries] = useState(false);
  const [showHistoryMobile, setShowHistoryMobile] = useState(false);

  // Fetch recent entries for this shift
  const fetchRecentEntries = async () => {
    setIsLoadingEntries(true);
    try {
      const { data, error } = await supabase
        .from('shift_entries')
        .select('*')
        .eq('shift_id', shift.id)
        .order('occurred_at', { ascending: false });

      if (error) throw error;
      setRecentEntries(data || []);
    } catch (err) {
      console.error('[CashOperationsModal] Failed to fetch entries:', err);
    } finally {
      setIsLoadingEntries(false);
    }
  };

  useEffect(() => {
    fetchRecentEntries();
  }, [shift.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !reason) return;

    setIsSubmitting(true);
    try {
      const entryId = crypto.randomUUID();
      const numAmount = Number(amount);

      const { error: insertError } = await supabase
        .from('shift_entries')
        .insert({
          id: entryId,
          tenant_id: tenantId,
          shift_id: shift.id,
          entry_type: operationType === 'deposit' ? 'deposit' : 'payout',
          amount: numAmount,
          reason,
          occurred_at: new Date().toISOString(),
          created_by: shift.staffId || null,
          created_at: new Date().toISOString()
        });

      if (insertError) throw insertError;

      try {
        await logEmployeeAction(
          tenantId,
          shift.staffId || 'system',
          shift.staffName || 'System',
          operationType === 'deposit' ? 'deposit_cash' : 'payout_cash',
          `${operationType === 'deposit' ? 'إيداع نقدي' : 'سحب نقدي'} بمبلغ ${amount} ريال - السبب: ${reason}`
        );
      } catch (auditErr) {
        console.error('Audit log failed:', auditErr);
      }

      // Re-fetch transactions to show update or close
      await fetchRecentEntries();
      
      // Clear forms
      setAmount('');
      setReason('');

      // Auto close with small delay for pleasant feedback
      setTimeout(() => {
        onClose();
      }, 300);

    } catch (error) {
      handleError(error as any, OperationType.WRITE, 'shift_entries');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isDeposit = operationType === 'deposit';

  const presets = [50, 100, 200, 500];

  const handlePresetClick = (val: number) => {
    setAmount(val.toString());
  };

  const handleAddPreset = (val: number) => {
    const current = Number(amount) || 0;
    setAmount((current + val).toString());
  };

  // Helper shortcuts for quick reasons
  const reasonShortcuts = {
    deposit: [
      'تغذية صندوق الصرف اليومي / Drawer Float',
      'تسوية رصيد الصندوق مع الحساب / Settlement',
      'إيداع فئات ريالات طارئة / Small Denominations',
    ],
    withdrawal: [
      'مشتريات مستلزمات طارئة للفرع / Office Supplies',
      'مصروفات نظافة وضيافة الفرع / Cleaning & Hospitality',
      'سلفة تحت الحساب للموظف / Staff Float Advance',
      'دفع نقد لخدمات صيانة طارئة / Emergency Maintenance',
    ]
  };

  // Stats calculation
  const totalDeposits = recentEntries
    .filter(e => e.entry_type === 'deposit')
    .reduce((sum, e) => sum + Number(e.amount), 0);

  const totalPayouts = recentEntries
    .filter(e => e.entry_type === 'payout')
    .reduce((sum, e) => sum + Number(e.amount), 0);

  const currentEstimatedCashInDrawer = shift.openingBalance + totalDeposits - totalPayouts;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 20 }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        className="relative w-full max-w-5xl max-h-[90vh] overflow-hidden rounded-3xl bg-white border border-slate-200 shadow-2xl flex flex-col my-auto text-right font-sans"
        dir="rtl"
      >
        {/* Top Strip Color Indicator using Theme Color variables */}
        <div className="h-1.5 w-full bg-brand shrink-0" />

        {/* Header Panel */}
        <div className="p-6 border-b border-slate-100 shrink-0 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-300 bg-brand/10 text-brand shadow">
              {isDeposit ? <ArrowUpRight size={22} className="stroke-[2.5]" /> : <ArrowDownRight size={22} className="stroke-[2.5]" />}
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-800 tracking-tight flex items-center gap-2">
                إدارة صندوق النقدية والدرج
              </h2>
              <p className="text-xs text-slate-500 font-bold mt-1">
                تسجيل ومتابعة حركات الإيداع والسحب لوردية البائع الحالي
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 self-end sm:self-center">
            <button 
              type="button" 
              onClick={onClose} 
              className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-full transition-all cursor-pointer"
              title="إغلاق الشاشة"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Context Stats Dashboard - Styled professionally with Brand & neutrals */}
        <div className="bg-slate-50 border-b border-slate-200 text-slate-800 px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-4 divide-y-0 divide-x-0 md:divide-x md:divide-x-reverse divide-slate-200 shrink-0">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-500 block mb-1">الموظف الحالي في الوردية</span>
            <span className="text-sm font-black text-slate-800 flex items-center gap-1.5">
              <User size={13} className="text-brand" />
              {shift.staffName}
            </span>
          </div>

          <div>
            <span className="text-[10px] uppercase font-bold text-slate-500 block mb-1">رصيد فتح الصندوق</span>
            <span className="text-sm font-black text-brand font-mono">
              {formatCurrency(shift.openingBalance)} ر.س
            </span>
          </div>

          <div>
            <span className="text-[10px] uppercase font-bold text-slate-500 block mb-1">إجمالي الحركات لليوم</span>
            <span className="text-sm font-bold flex items-center gap-2">
              <span className="text-brand font-mono">+{formatCurrency(totalDeposits)}</span>
              <span className="text-slate-400">/</span>
              <span className="text-slate-700 font-mono">-{formatCurrency(totalPayouts)}</span>
            </span>
          </div>

          <div>
            <span className="text-[10px] uppercase font-bold text-slate-500 block mb-1">الرصيد التقديري بالصندوق</span>
            <span className="text-base font-black text-brand font-mono">
              {formatCurrency(currentEstimatedCashInDrawer)} ر.س
            </span>
          </div>
        </div>

        {/* Main Body: Dual Pane Layout */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12">
          
          {/* Right Pane: Transaction Entry Form (7 Columns) */}
          <div className="lg:col-span-7 overflow-y-auto p-6 lg:p-8 space-y-6 border-l border-slate-100">
            <form onSubmit={handleSubmit} className="space-y-6">
              
              {/* Toggle Panel: Withdrawal / Deposit */}
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-500 uppercase tracking-wide block mr-1">
                  نوع العملية المطلوبة / DIRECTION
                </label>
                
                <div className="p-1.5 bg-slate-100 rounded-2xl border border-slate-200/50 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setOperationType('withdrawal');
                      setAmount('');
                      setReason('');
                    }}
                    className={cn(
                      "flex-1 py-3 text-sm font-black rounded-xl transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer",
                      !isDeposit 
                        ? "bg-slate-800 text-white shadow" 
                        : "text-slate-600 hover:bg-slate-200 hover:text-slate-900"
                    )}
                  >
                    <ArrowDownRight size={16} className="stroke-[2.5]" />
                    <span>سحب مصروفات (Debit Payout)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setOperationType('deposit');
                      setAmount('');
                      setReason('');
                    }}
                    className={cn(
                      "flex-1 py-3 text-sm font-black rounded-xl transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer",
                      isDeposit 
                        ? "bg-brand text-white shadow" 
                        : "text-slate-600 hover:bg-slate-200 hover:text-slate-900"
                    )}
                  >
                    <ArrowUpRight size={16} className="stroke-[2.5]" />
                    <span>إيداع سيولة بالدرج (Deposit)</span>
                  </button>
                </div>
              </div>

              {/* Amount Input with guaranteed paddings and no icon interference */}
              <div className="space-y-2">
                <div className="flex justify-between items-center mr-1">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wide">
                    المبلغ المالي المطلوب تسجيله / AMOUNT
                  </label>
                  <span className="text-[10px] text-slate-400 font-bold bg-slate-100 px-2 py-0.5 rounded-md">عملة محلية</span>
                </div>

                <div className="relative">
                  {/* Symbol Badge pinned to physical left */}
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 bg-slate-100 rounded-xl px-3 py-1.5 border border-slate-200 text-slate-600 font-extrabold text-[11px] pointer-events-none select-none z-10">
                    ريال سعودي
                  </div>

                  {/* Input field with h-16 (to bypass default css) and precise paddings to prevent overlap */}
                  <input 
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    style={{ paddingRight: '4.5rem', paddingLeft: '8rem' }}
                    className="w-full h-16 bg-slate-50 hover:bg-slate-100/50 focus:bg-white border-2 border-slate-200 rounded-2xl text-2xl font-black font-mono transition-all outline-none text-right tracking-tight shadow-sm z-0 focus:border-brand focus:ring-4 focus:ring-brand/10 text-slate-800"
                    placeholder="0.00"
                    autoFocus
                  />

                  {/* Icon pinned to physical right */}
                  <div className="absolute right-4.5 top-1/2 -translate-y-1/2 pointer-events-none z-10">
                    <Banknote className="text-slate-400" size={22} />
                  </div>
                </div>
              </div>

              {/* Quick Preset Buttons - Brand themed (Cohesive Identity) */}
              <div className="space-y-2.5">
                <span className="text-[10px] font-black text-slate-400 block mr-1 uppercase">
                  أزرار وتعديلات سريعة للمبلغ / QUICK PRESETS
                </span>
                
                <div className="space-y-2">
                  {/* Preset Selector */}
                  <div className="grid grid-cols-4 gap-2">
                    {presets.map((preset) => (
                      <button
                        key={`set-${preset}`}
                        type="button"
                        onClick={() => handlePresetClick(preset)}
                        className={cn(
                          "py-2.5 px-3 rounded-xl font-mono font-black text-xs transition-all tracking-wide cursor-pointer text-center",
                          Number(amount) === preset
                            ? "bg-brand text-white border border-brand shadow scale-[1.02]"
                            : "bg-slate-100 hover:bg-slate-200/80 text-slate-700 border border-slate-200/40"
                        )}
                      >
                        {preset} ر.س
                      </button>
                    ))}
                  </div>

                  {/* Quick Addition buttons */}
                  <div className="grid grid-cols-4 gap-2">
                    {[10, 20, 50, 100].map((addVal) => (
                      <button
                        key={`add-${addVal}`}
                        type="button"
                        onClick={() => handleAddPreset(addVal)}
                        className="py-1.5 px-3 bg-brand/5 hover:bg-brand/10 border border-brand/10 text-brand rounded-lg text-[10px] font-black tracking-wider transition-all cursor-pointer text-center"
                      >
                        +{addVal} ر.س
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Reason Description */}
              <div className="space-y-2.5">
                <label className="text-xs font-black text-slate-500 uppercase tracking-wide block mr-1">
                  سبب الحركة وملاحظات المراجعة / PURPOSE
                </label>

                <textarea 
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  className="w-full pr-4 pl-4 py-3 bg-slate-50 hover:bg-slate-100/50 focus:bg-white border-2 border-slate-150 focus:border-brand focus:ring-4 focus:ring-brand/10 rounded-2xl font-bold h-20 transition-all outline-none text-slate-800 text-sm leading-relaxed shadow-sm"
                  placeholder={
                    isDeposit 
                      ? "مثال: إيداع الصرف والسيولة للفرع..." 
                      : "مثال: شراء فواتير مصروفات ضيافة نقدية..."
                  }
                />

                {/* Quick Shortcuts */}
                <div className="space-y-1.5">
                  <span className="text-[9px] font-bold text-slate-400 block mb-1">انقر لتحديد السبب تلقائياً:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {reasonShortcuts[operationType].map((shortcut, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setReason(shortcut)}
                        className={cn(
                          "px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all border text-right cursor-pointer",
                          reason === shortcut
                            ? "bg-slate-950 text-white border-slate-950"
                            : "bg-slate-100 hover:bg-slate-200 text-slate-600 border-slate-200/50"
                        )}
                      >
                        {shortcut}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Actions Section */}
              <div className="pt-4 flex gap-3">
                <button 
                  type="button"
                  onClick={onClose}
                  disabled={isSubmitting}
                  className="flex-1 py-3.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 rounded-2xl font-black text-xs sm:text-sm transition-all cursor-pointer"
                >
                  إلغاء وتراجع / Cancel
                </button>

                <button 
                  type="submit"
                  disabled={isSubmitting || !amount || !reason}
                  className="flex-[2] text-white py-3.5 rounded-2xl font-black text-xs sm:text-sm bg-brand hover:bg-brand/90 shadow-sm shadow-brand/10 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>جاري التسجيل للدرج الحالي...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={16} />
                      <span>{isDeposit ? 'تأكيد وحفظ الإيداع اليومي' : 'تأكيد وحفظ السحب والمصروف'}</span>
                    </>
                  )}
                </button>
              </div>

            </form>
          </div>

          {/* Left Pane: Recent Entries Timeline - Aligned with Brand & Neutrals */}
          <div className="lg:col-span-5 bg-slate-50/60 overflow-y-auto flex flex-col h-full border-t lg:border-t-0 lg:border-l border-slate-150">
            {/* Header/Title for Timeline */}
            <div className="p-4 bg-slate-100 border-b border-slate-200 flex items-center justify-between shrink-0">
              <span className="text-xs font-black text-slate-700 flex items-center gap-2">
                <History size={14} className="text-slate-500" />
                سجل حركات الوردية الحالية ({recentEntries.length})
              </span>
              
              <button 
                type="button"
                onClick={fetchRecentEntries}
                className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg bg-white border border-slate-200 hover:shadow-sm active:scale-95 transition-all text-[10px] font-bold flex items-center gap-1"
                disabled={isLoadingEntries}
              >
                <RefreshCw size={10} className={cn(isLoadingEntries && "animate-spin")} />
                تحديث
              </button>
            </div>

            {/* Mobile Expand / Collapse for Timeline */}
            <div className="lg:hidden p-3 bg-white border-b border-slate-200">
              <button
                type="button"
                onClick={() => setShowHistoryMobile(!showHistoryMobile)}
                className="w-full flex items-center justify-between text-xs font-black text-brand focus:outline-none"
              >
                <span>{showHistoryMobile ? 'إخفاء سجل الحركات للوردية' : 'عرض سجل الحركات للوردية والتفاصيل'}</span>
                {showHistoryMobile ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            </div>

            {/* Content for Timeline */}
            <div className={cn(
              "flex-1 p-4 space-y-3.5 overflow-y-auto",
              "hidden lg:block", 
              showHistoryMobile && "block! lg:block"
            )}>
              {isLoadingEntries && recentEntries.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
                  <div className="w-5 h-5 border-2 border-slate-300 border-t-brand rounded-full animate-spin" />
                  <span className="text-xs font-bold">جاري تحميل حركات الصندوق...</span>
                </div>
              ) : recentEntries.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-6 text-center text-slate-400 border border-dashed border-slate-200 rounded-2xl bg-white">
                  <AlertCircle size={28} className="text-slate-300 mb-2" />
                  <p className="text-xs font-black text-slate-600">لا توجد حركات نقدية مسجلة</p>
                  <p className="text-[10px] text-slate-400 mt-1 max-w-[200px]">
                    أي عملية سحب أو تعديل رصيد بالدرج ستظهر هنا فوراً.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentEntries.map((entry) => {
                    const isDep = entry.entry_type === 'deposit';
                    return (
                      <div 
                        key={entry.id}
                        className="p-3 bg-white border border-slate-200/60 rounded-xl hover:shadow-sm transition-all flex flex-col gap-2 relative overflow-hidden group"
                      >
                        {/* Side Border Indicator */}
                        <div className={cn(
                          "absolute top-0 right-0 bottom-0 w-1",
                          isDep ? "bg-brand" : "bg-slate-300"
                        )} />

                        {/* Top Line: Type Badge + Amount */}
                        <div className="flex items-center justify-between pl-1">
                          <span className={cn(
                            "px-2 py-0.5 rounded-md text-[10px] font-black",
                            isDep ? "bg-brand/10 text-brand" : "bg-slate-100 text-slate-700"
                          )}>
                            {isDep ? 'إيـداع سيولة' : 'سحب / مصروف'}
                          </span>

                          <span className={cn(
                            "font-mono font-black text-[13px] tracking-tight",
                            isDep ? "text-brand" : "text-slate-700"
                          )}>
                            {isDep ? '+' : '-'}{Number(entry.amount).toFixed(2)} ر.س
                          </span>
                        </div>

                        {/* Middle Line: Reason */}
                        <p className="text-xs font-bold text-slate-700 pr-1 select-text">
                          {entry.reason}
                        </p>

                        {/* Bottom Line: Timestamp */}
                        <div className="flex items-center justify-between text-[9px] text-slate-400 font-bold pr-1 border-t border-slate-50 pt-1.5 mt-0.5">
                          <span className="flex items-center gap-1">
                            <Clock size={10} />
                            {new Date(entry.occurred_at).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}
                          </span>

                          <span className="opacity-0 group-hover:opacity-100 transition-opacity font-mono text-[8px]">
                            {new Date(entry.occurred_at).toLocaleDateString('ar-SA')}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Bottom Panel Drawer Status Indicator */}
            <div className="mt-auto p-4 bg-slate-100 border-t border-slate-200 text-center text-[10px] text-slate-400 font-bold text-slate-400">
              جميع حركات الصندوق تسجل آلياً في سجل تدقيق النظام.
            </div>
          </div>

        </div>

      </motion.div>
    </div>
  );
}
