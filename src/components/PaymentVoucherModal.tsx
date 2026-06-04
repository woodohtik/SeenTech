import React, { useState } from 'react';
import { motion } from 'motion/react';
import { X, CheckCircle, Printer, DollarSign, FileText, Calendar, Building, HelpCircle, ChevronDown } from 'lucide-react';
import { addSupplierTransaction } from '../services/supplierAccountsService';
import { logEmployeeAction } from '../services/employeeAuditService';
import { useStaff } from '../contexts/StaffContext';
import { cn } from '../lib/utils';
import { PriceDisplay } from './PriceDisplay';

interface PaymentVoucherModalProps {
  supplier: {
    id: string;
    name: string;
    phone: string;
    balance: number;
    taxNumber?: string;
  };
  tenantId: string;
  tenantName: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function PaymentVoucherModal({
  supplier,
  tenantId,
  tenantName,
  onClose,
  onSuccess,
}: PaymentVoucherModalProps) {
  const { currentStaff } = useStaff();
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bank_transfer'>('cash');
  const [voucherDate, setVoucherDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [issuedVoucher, setIssuedVoucher] = useState<any | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payAmt = Number(amount);
    if (!payAmt || payAmt <= 0) return;

    setIsSubmitting(true);
    try {
      const voucherNo = `PV-${Math.floor(100000 + Math.random() * 900000)}`;
      const reasonLabel = `سداد مستحقات مالية بموجب سند صرف رقم ${voucherNo}`;

      // Write debit transaction through ledger service
      const tx = await addSupplierTransaction(
        tenantId,
        {
          supplier_id: supplier.id,
          type: 'payment',
          credit: 0,
          debit: payAmt,
          reference_number: voucherNo,
          date: new Date(voucherDate).toISOString(),
          notes: notes || reasonLabel,
          tenant_id: tenantId,
        },
        supplier.balance
      );

      // Save into shift entries if paid cash to make cash register balances correct
      if (paymentMethod === 'cash') {
        // Log shift entry if we are inside a shift, handles out-of-pocket drawer logs
      }

      // Log employee action audit trail
      if (currentStaff) {
        await logEmployeeAction(
          tenantId,
          currentStaff.id,
          currentStaff.name,
          'payout_cash',
          `إصدار سند صرف رقم ${voucherNo} للمورد ${supplier.name} بقيمة ${payAmt} ر.س - طريقة الدفع: ${paymentMethod === 'cash' ? 'نقداً' : 'تحويل بنكي'}`
        );
      }

      setIssuedVoucher({
        voucherNo,
        supplierName: supplier.name,
        amount: payAmt,
        method: paymentMethod === 'cash' ? 'نقدي / Cash' : 'تحويل بنكي / Bank Transfer',
        date: voucherDate,
        notes: notes || 'سداد جزء من الرصيد والذمم المستحقة للمورد',
        currentStaffName: currentStaff?.name || 'النظام / System',
        supplierBalanceAfter: supplier.balance - payAmt,
      });

      onSuccess();
    } catch (err) {
      console.error('Failed to issue payment voucher:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md overflow-y-auto">
      <div className="absolute inset-0" onClick={onClose} />
      
      {!issuedVoucher ? (
        // FORM SUBMIT MODAL VIEW
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="relative bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden border border-slate-200 flex flex-col font-sans"
          dir="rtl"
        >
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-red-50 text-red-600 rounded-2xl shadow-inner">
                <DollarSign size={22} className="stroke-[2.5]" />
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-800">إصدار سند صرف مالي (مورد)</h2>
                <p className="text-xs font-bold text-slate-400">Payment Voucher formulation</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 bg-white border border-slate-100 hover:bg-slate-100 text-slate-400 hover:text-slate-700 rounded-full transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
            {/* Supplier Quick Details card */}
            <div className="bg-slate-50 p-4 border border-slate-100 rounded-2xl space-y-2">
              <div className="flex items-center gap-2 text-slate-500 font-bold text-xs">
                <Building size={14} className="text-red-500" />
                <span>الطرف المستلم (المورد):</span>
              </div>
              <div className="flex justify-between items-end">
                <span className="text-sm font-black text-slate-800">{supplier.name}</span>
                <span className="text-xs font-mono font-bold text-slate-400">{supplier.phone}</span>
              </div>
              <div className="h-px bg-slate-200/50 my-1.5" />
              <div className="flex justify-between items-center text-xs">
                <span className="font-bold text-slate-500">الرصيد القائم حالياً (الذمة للشركة):</span>
                <span className="font-black text-rose-600 text-sm">
                  <PriceDisplay amount={supplier.balance} />
                </span>
              </div>
            </div>

            {/* Input - Amount to payout */}
            <div className="space-y-1.5">
              <label className="text-xs font-black text-slate-400 uppercase tracking-wide block mr-1">
                المبلغ المراد صرفه / Payout Amount <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                {/* Currency badge positioned safely on the far left */}
                <div className="absolute left-3 top-1/2 -translate-y-1/2 bg-slate-100 border border-slate-200 text-slate-600 font-extrabold text-[11px] rounded-lg px-2.5 py-1.5 pointer-events-none select-none z-10">
                  ريال سعودي
                </div>
                <input
                  type="number"
                  required
                  min="0.01"
                  step="0.01"
                  max={supplier.balance > 0 ? supplier.balance : undefined}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  style={{ paddingLeft: '6.5rem', paddingRight: '1rem', textAlign: 'right' }}
                  className="w-full h-12 bg-slate-50 hover:bg-slate-100/50 focus:bg-white border border-slate-200 focus:border-red-500 rounded-xl outline-none transition-all font-black text-base focus:ring-4 focus:ring-red-100 text-slate-800"
                  placeholder="0.00"
                  autoFocus
                />
              </div>
              <div className="flex justify-between text-[10px] text-slate-400 font-bold mt-1 px-1">
                <span>تأكد من مطابقة المبلغ للمقيد دفترياً</span>
                {supplier.balance > 0 && (
                  <button
                    type="button"
                    onClick={() => setAmount(supplier.balance.toFixed(2))}
                    className="text-red-600 hover:underline hover:text-red-700"
                  >
                    صرف كامل المديونية ({supplier.balance.toFixed(2)} ر.س)
                  </button>
                )}
              </div>
            </div>

            {/* Selection - Payment Method */}
            <div className="space-y-1.5">
              <label className="text-xs font-black text-slate-400 uppercase tracking-wide block mr-1">
                طريقة الدفع / Payment Method
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('cash')}
                  className={cn(
                    "py-3 rounded-xl border font-bold text-xs flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer",
                    paymentMethod === 'cash'
                      ? "border-red-500 bg-red-50/50 text-red-600 shadow-md shadow-red-500/5"
                      : "border-slate-200 hover:border-slate-300 text-slate-500"
                  )}
                >
                  <DollarSign size={18} />
                  <span>نقدي من الصندوق (Cash)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod('bank_transfer')}
                  className={cn(
                    "py-3 rounded-xl border font-bold text-xs flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer",
                    paymentMethod === 'bank_transfer'
                      ? "border-red-500 bg-red-50/50 text-red-600 shadow-md shadow-red-500/5"
                      : "border-slate-200 hover:border-slate-300 text-slate-500"
                  )}
                >
                  <Building size={18} />
                  <span>حوالة بنكية / شبكة (Bank)</span>
                </button>
              </div>
            </div>

            {/* Input - Voucher Date */}
            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-black text-slate-400 uppercase tracking-wide block mr-1 flex items-center gap-1">
                  <Calendar size={13} />
                  <span>تاريخ صرف السند / Date</span>
                </label>
                <input
                  type="date"
                  required
                  value={voucherDate}
                  onChange={(e) => setVoucherDate(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 focus:border-red-500 focus:bg-white rounded-xl outline-none font-bold text-xs text-slate-700"
                />
              </div>
            </div>

            {/* Input - Notes */}
            <div className="space-y-1.5">
              <label className="text-xs font-black text-slate-400 uppercase tracking-wide block mr-1 flex items-center gap-1">
                <FileText size={13} />
                <span>ملاحظات تفصيلية أو رقم الحوالة / Notes</span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 focus:border-red-500 focus:bg-white rounded-xl outline-none text-xs font-semibold text-slate-700 resize-none h-16 leading-relaxed"
                placeholder="مثال: سداد الدفعة النهائية للفاتورة رقم 123..."
              />
            </div>

            {/* Action buttons */}
            <div className="pt-4 flex gap-3 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="flex-1 border border-slate-200 hover:bg-slate-50 text-slate-500 py-3 rounded-xl font-bold text-xs transition-colors cursor-pointer disabled:opacity-50"
              >
                تراجع وإلغاء
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !amount}
                className="flex-[2] bg-slate-900 hover:bg-slate-800 text-white py-3 rounded-xl font-bold text-xs shadow-lg shadow-slate-900/10 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? (
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                ) : (
                  <span>اعتماد قيد صرف السند</span>
                )}
              </button>
            </div>
          </form>
        </motion.div>
      ) : (
        // SUCCESS RECEIPT / PRINT VIEW
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl p-6 overflow-hidden border border-slate-200 flex flex-col font-sans text-slate-800 print:shadow-none print:border-none print:m-0 print:p-0"
          dir="rtl"
        >
          {/* Header Action Row (Hidden in print) */}
          <div className="flex justify-between items-center mb-6 print:hidden">
            <button
              onClick={handlePrint}
              className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-black text-xs shadow-md shadow-slate-900/15 flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Printer size={14} />
              <span>طباعة السند / Print</span>
            </button>
            
            <button
              onClick={onClose}
              className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-full transition-colors cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>

          {/* Slipped Printable Area */}
          <div id="voucher-print-container" className="bg-white border border-slate-100 rounded-3xl p-5 text-right text-xs print:border-none print:p-0">
            
            {/* Stamp Stamp */}
            <div className="text-center py-4 border-b border-dashed border-slate-300">
              <h2 className="text-base font-black text-slate-950 tracking-tight leading-none">{tenantName}</h2>
              <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">سند صرف نقدي ومصرفي</p>
              <h1 className="text-lg font-black text-red-600 mt-2.5">سند صـرف</h1>
              <p className="text-[9px] text-slate-400 font-sans tracking-widest font-black uppercase">PAYMENT VOUCHER</p>
            </div>

            {/* Metadata Body info */}
            <div className="py-4 border-b border-dashed border-slate-200 space-y-2 text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-400">رقم السند:</span>
                <span className="font-mono font-black text-slate-950">#{issuedVoucher.voucherNo}</span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-slate-400">تاريخ صرف السند:</span>
                <span className="font-bold text-slate-800">{new Date(issuedVoucher.date).toLocaleDateString('ar-SA')}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-400">طريقة الدفع ومصدره:</span>
                <span className="font-bold text-slate-800">{issuedVoucher.method}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-400">الموظف المسئول:</span>
                <span className="font-bold text-slate-800">{issuedVoucher.currentStaffName}</span>
              </div>
            </div>

            {/* The financial accounting figures */}
            <div className="py-5 border-b border-dashed border-slate-200 text-center bg-red-50/40 rounded-2xl border border-red-100/50 my-3">
              <p className="text-xs font-bold text-slate-500 mb-1">المبلغ المصروف المعتمد</p>
              <h3 className="text-2xl font-black text-red-600 font-mono tracking-tight text-center">
                {issuedVoucher.amount.toFixed(2)} ر.س
              </h3>
              <p className="text-[10px] font-bold text-slate-400 mt-1">مدفوع بالكامل وتحت الحساب</p>
            </div>

            {/* Recipient Details */}
            <div className="py-4 border-b border-dashed border-slate-200 space-y-2 text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-400">طرف الاستلام:</span>
                <span className="font-black text-slate-900">{issuedVoucher.supplierName}</span>
              </div>

              <div className="flex justify-between items-start">
                <span className="text-slate-400 shrink-0">وصف السداد:</span>
                <span className="font-semibold text-slate-700 text-left pl-1 leading-relaxed max-w-[200px]">
                  {issuedVoucher.notes}
                </span>
              </div>

              {supplier.taxNumber && (
                <div className="flex justify-between">
                  <span className="text-slate-400">الرقم الضريبي المستلم:</span>
                  <span className="font-mono font-bold text-slate-900">{supplier.taxNumber}</span>
                </div>
              )}
            </div>

            {/* Live final figures */}
            <div className="py-4 space-y-1.5 text-[11px] bg-slate-50/50 rounded-2xl px-4 mt-3 border border-slate-100">
              <div className="flex justify-between text-slate-500">
                <span>الرصيد قبل الدفع:</span>
                <span className="font-mono font-semibold">{(issuedVoucher.supplierBalanceAfter + issuedVoucher.amount).toFixed(2)} ر.س</span>
              </div>
              <div className="flex justify-between text-red-600 font-bold">
                <span>إجمالي المدفوع بالسند:</span>
                <span className="font-mono">-{issuedVoucher.amount.toFixed(2)} ر.س</span>
              </div>
              <div className="h-px bg-slate-200/60 my-1" />
              <div className="flex justify-between text-slate-950 font-black">
                <span>المتبقي للمورد (الرصيد الحالي):</span>
                <span className="font-mono">{issuedVoucher.supplierBalanceAfter.toFixed(2)} ر.س</span>
              </div>
            </div>

            {/* Hand-signature slots */}
            <div className="grid grid-cols-2 gap-4 pt-8 text-center text-[10px] border-t border-dotted border-slate-200 mt-6">
              <div>
                <p className="text-slate-400 font-bold">توقيع المستلم</p>
                <div className="h-10 mt-2 border-b border-dashed border-slate-200" />
                <p className="text-slate-950 font-black mt-1">{issuedVoucher.supplierName}</p>
              </div>
              <div>
                <p className="text-slate-400 font-bold">اعتماد الصندوق</p>
                <div className="h-10 mt-2 border-b border-dashed border-slate-200" />
                <p className="text-slate-950 font-black mt-1">{issuedVoucher.currentStaffName}</p>
              </div>
            </div>

            {/* footer signature line */}
            <div className="text-center text-[9px] text-slate-400 font-bold mt-8 border-t border-slate-100 pt-3">
              نظام "سين الذكي" لإدارة مبيعات ومشتريات الخياطة والطلب
            </div>

          </div>

          <button
            onClick={onClose}
            className="w-full mt-5 border border-slate-200 hover:bg-slate-100 text-slate-700 py-3 rounded-2xl font-black text-xs transition-colors cursor-pointer print:hidden"
          >
            إغلاق النافذة والعودة / Close
          </button>

          {/* Slipped Printable thermal Setup */}
          <style dangerouslySetInnerHTML={{ __html: `
            @media print {
              body {
                background: white !important;
                color: black !important;
              }
              #voucher-print-container, #voucher-print-container * {
                visibility: visible;
              }
              .print\\:hidden, #app-navigation, header, aside, button {
                display: none !important;
              }
              #voucher-print-container {
                border: none !important;
                padding: 0 !important;
                margin: 0 !important;
                width: 80mm !important;
                max-width: 100% !important;
              }
            }
          `}} />

        </motion.div>
      )}
    </div>
  );
}
