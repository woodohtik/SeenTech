import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  ArrowLeft, 
  Calendar, 
  Search, 
  Filter, 
  Printer, 
  Download, 
  Plus, 
  RefreshCw, 
  TrendingUp, 
  TrendingDown, 
  BookOpen, 
  CheckCircle2, 
  AlertCircle,
  Clock,
  ChevronDown,
  Share2,
  MessageCircle
} from 'lucide-react';
import { getSupplierTransactions } from '../services/supplierAccountsService';
import { SupplierTransaction } from '../types/supplierLedger';
import { supabase } from '../lib/supabase/client';
import PaymentVoucherModal from './PaymentVoucherModal';
import { PriceDisplay } from './PriceDisplay';
import { cn } from '../lib/utils';
import { jsPDF } from 'jspdf';
import { toPng } from 'html-to-image';

interface SupplierLedgerProps {
  supplier: {
    id: string;
    name: string;
    phone: string;
    balance: number;
    taxNumber?: string;
    contactPerson?: string;
    address?: string;
  };
  tenantId: string;
  tenantName: string;
  onBack: () => void;
  onReloadSupplier: () => void;
}

export default function SupplierLedger({
  supplier,
  tenantId,
  tenantName,
  onBack,
  onReloadSupplier,
}: SupplierLedgerProps) {
  const [transactions, setTransactions] = useState<SupplierTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'purchase' | 'payment' | 'adjustment'>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isVoucherOpen, setIsVoucherOpen] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [whatsappModalOpen, setWhatsappModalOpen] = useState(false);

  // Load Transactions
  const fetchLedger = async () => {
    setLoading(true);
    try {
      const data = await getSupplierTransactions(
        supplier.id,
        tenantId,
        supplier.name,
        supplier.balance
      );
      setTransactions(data);
    } catch (err) {
      console.error('Failed to load supplier ledger transactions:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLedger();

    if (!tenantId) return;

    // Real-time subscription to update ledger dynamically when transactions or suppliers change
    const channelName = `supplier-ledger-${supplier.id}`;
    const ledgerChannel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'supplier_transactions', filter: `tenant_id=eq.${tenantId}` },
        (payload: any) => {
          // If transaction belongs to this supplier or is modified, reload ledger
          if (payload.new && payload.new.supplier_id === supplier.id) {
            fetchLedger();
          } else {
            // Fallback: update on general events for completeness
            fetchLedger();
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'suppliers', filter: `id=eq.${supplier.id}` },
        () => {
          fetchLedger();
          onReloadSupplier();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ledgerChannel);
    };
  }, [supplier.id, tenantId]);

  const handleVoucherSuccess = () => {
    fetchLedger();
    onReloadSupplier();
  };

  // Sort the full set of transactions chronologically to compute standard ledger running balances
  const sortedAllTransactions = [...transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  let runningBalanceAccumulator = 0;
  const transactionsWithCorrectBalances = sortedAllTransactions.map((tx) => {
    runningBalanceAccumulator = runningBalanceAccumulator + Number(tx.credit || 0) - Number(tx.debit || 0);
    return {
      ...tx,
      running_balance: Number(runningBalanceAccumulator.toFixed(2))
    };
  });

  // Accounting aggregates calculation
  const totalCredit = transactionsWithCorrectBalances.reduce((sum, tx) => sum + Number(tx.credit || 0), 0);
  const totalDebit = transactionsWithCorrectBalances.reduce((sum, tx) => sum + Number(tx.debit || 0), 0);
  const balanceCheck = totalCredit - totalDebit;

  // Filter transactions
  const filteredTransactions = transactionsWithCorrectBalances.filter((tx) => {
    // 1. Search notes or references
    const text = (tx.notes || '').toLowerCase() + (tx.reference_number || '').toLowerCase();
    const matchesSearch = text.includes(searchTerm.toLowerCase());

    // 2. Filter Type
    const matchesType = typeFilter === 'all' || tx.type === typeFilter;

    // 3. Date check
    const txDate = new Date(tx.date).getTime();
    const matchesStart = !startDate || txDate >= new Date(startDate).getTime();
    // Inclusive end date
    const matchesEnd = !endDate || txDate <= new Date(endDate + 'T23:59:59').getTime();

    return matchesSearch && matchesType && matchesStart && matchesEnd;
  });

  const handlePrintA4 = () => {
    window.print();
  };

  const handleWhatsAppShare = async () => {
    setExportingPdf(true);
    try {
      const element = document.getElementById('supplier-ledger-pdf-capture');
      if (!element) {
        throw new Error('Capture area not found');
      }

      const dataUrl = await toPng(element, {
        backgroundColor: '#ffffff',
        quality: 1.0,
        pixelRatio: 2
      });

      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgWidth = 210;
      const pageHeight = 295;
      
      const imgProps = pdf.getImageProperties(dataUrl);
      const imgHeight = (imgProps.height * imgWidth) / imgProps.width;
      
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(dataUrl, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft >= 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(dataUrl, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      const fileName = `كشف_حساب_${supplier.name.replace(/\s+/g, '_')}.pdf`;
      pdf.save(fileName);

      setWhatsappModalOpen(true);
    } catch (err) {
      console.error('Failed to export ledger to PDF:', err);
    } finally {
      setExportingPdf(false);
    }
  };

  const proceedToWhatsApp = () => {
    let phone = supplier.phone || '';
    phone = phone.replace(/\D/g, '');
    if (phone.startsWith('05')) {
      phone = '966' + phone.substring(1);
    } else if (phone.startsWith('5')) {
      phone = '966' + phone;
    }

    const today = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
    
    let message = `*كشف حساب المورد لدى ${tenantName}*\n`;
    message += `*المورد:* ${supplier.name}\n`;
    message += `*التاريخ:* ${today}\n\n`;
    message += `يرجى الاطلاع على ملف كشف الحساب المرفق بصيغة PDF.\n\n`;
    message += `وشكراً جزيلاً لكم.`;

    const encodedText = encodeURIComponent(message);
    const whatsappUrl = `https://api.whatsapp.com/send?phone=${phone}&text=${encodedText}`;
    window.open(whatsappUrl, '_blank');
    setWhatsappModalOpen(false);
  };

  return (
    <div className="space-y-6 font-sans text-right" dir="rtl" style={{ fontFamily: 'IBM Plex Sans, sans-serif' }}>
      
      {/* Top action header for Ledger view */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 print:hidden">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-3 hover:bg-slate-100 text-slate-500 hover:text-slate-900 rounded-2xl border border-slate-200 transition-all cursor-pointer"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black text-slate-900">كشف حساب المورد والمستندات المتبادلة</h1>
              <span className="bg-slate-100 border border-slate-200 text-slate-600 px-2.5 py-1 rounded-full text-[10px] font-black">دفتر الأستاذ المساعد</span>
            </div>
            <p className="text-xs font-bold text-slate-500 mt-0.5">مراجعة كاملة لجميع الديون والمشتريات وتواريخ الدفع في {supplier.name}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap w-full md:w-auto">
          <button
            onClick={handleWhatsAppShare}
            disabled={exportingPdf}
            className="h-10 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white rounded-xl text-xs font-black shadow-md shadow-emerald-600/10 flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            {exportingPdf ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <MessageCircle size={16} />
            )}
            <span>{exportingPdf ? 'جاري إنشاء ملف PDF...' : 'إرسال كشف حساب PDF واتساب'}</span>
          </button>

          <button
            onClick={() => setIsVoucherOpen(true)}
            className="h-10 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black shadow-md shadow-rose-600/10 flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <Plus size={16} />
            <span>إصدار سند صرف (سداد)</span>
          </button>

          <button
            onClick={handlePrintA4}
            className="h-10 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black shadow-md shadow-blue-600/10 flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <Printer size={16} />
            <span>طباعة كشف A4</span>
          </button>
        </div>
      </div>

      {/* Official A4 Printed Header Block (Visible ONLY during print) */}
      <div className="hidden print:block text-slate-900 border-b-2 border-slate-950 pb-6 mb-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-black">{tenantName}</h1>
            <p className="text-xs font-bold text-slate-500 mt-1">كشف حركـات الحساب التفصيلي للشركاء والموردين</p>
          </div>
          <div className="text-left font-mono text-[9px] text-slate-400">
            <p>Printed on: {new Date().toLocaleString()}</p>
            <p>System Ref: Seen-POS-Ledger</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 mt-6 pt-6 border-t border-slate-200 text-xs leading-relaxed">
          <div>
            <p className="font-extrabold text-slate-400 uppercase tracking-wider mb-1">تفاصيل المورد المستعلم عنه:</p>
            <p className="text-sm font-black text-slate-950">{supplier.name}</p>
            {supplier.phone && <p className="font-semibold text-slate-600">هاتف: <span className="font-mono">{supplier.phone}</span></p>}
            {supplier.taxNumber && <p className="font-semibold text-slate-600">الرقم الضريبي للمورد: <span className="font-mono">{supplier.taxNumber}</span></p>}
            {supplier.address && <p className="font-semibold text-slate-500">العنوان: {supplier.address}</p>}
          </div>
          <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl flex flex-col justify-between items-end text-left h-full">
            <span className="font-black text-slate-400 text-[10px] uppercase">إجمالي الرصيد المستحق في الذمة:</span>
            <span className="text-2xl font-black text-red-600 font-mono mt-1">
              {supplier.balance.toFixed(2)} ر.س
            </span>
          </div>
        </div>
      </div>

      {/* Account Highlights Metrics Board */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 print:grid-cols-4 print:gap-3">
        
        {/* Metric Column 1 */}
        <div className="bg-white border border-slate-200 p-5 rounded-3xl shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] font-black text-slate-400 block uppercase mb-1">إجمالي المشتريات (دائن)</span>
            <span className="text-xl font-black text-slate-900 font-mono">
              <PriceDisplay amount={totalCredit} />
            </span>
          </div>
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl">
            <TrendingUp size={20} />
          </div>
        </div>

        {/* Metric Column 2 */}
        <div className="bg-white border border-slate-200 p-5 rounded-3xl shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] font-black text-slate-400 block uppercase mb-1">إجمالي المدفوعات (مدين)</span>
            <span className="text-xl font-black text-red-600 font-mono">
              <PriceDisplay amount={totalDebit} />
            </span>
          </div>
          <div className="p-3 bg-rose-50 text-rose-600 rounded-2xl">
            <TrendingDown size={20} />
          </div>
        </div>

        {/* Metric Column 3 */}
        <div className="bg-white border border-slate-200 p-5 rounded-3xl shadow-sm flex items-center justify-between col-span-1 md:col-span-2">
          <div>
            <span className="text-[10px] font-black text-slate-400 block uppercase mb-1">الرصيد النهائي المستحق للمورد</span>
            <span className="text-2xl font-black text-slate-900 font-mono">
              <PriceDisplay amount={supplier.balance} />
            </span>
          </div>
          <div className="p-3.5 bg-indigo-50 text-indigo-600 rounded-2xl">
            <BookOpen size={22} className="stroke-[2.5]" />
          </div>
        </div>
      </div>

      {/* Filter and Date Selector Controls (Hidden during print) */}
      <div className="bg-white border border-slate-200 p-5 rounded-3xl shadow-sm space-y-4 print:hidden">
        <div className="flex flex-col md:flex-row gap-3">
          
          {/* Text search bar */}
          <div className="group flex-1 flex items-center bg-slate-50 hover:bg-slate-100/30 border border-slate-200 focus-within:border-slate-900 focus-within:bg-white rounded-xl transition-all overflow-hidden h-10">
            <div className="flex items-center justify-center px-3.5 border-e border-slate-200/60 text-slate-400 group-focus-within:text-slate-900 h-full shrink-0">
              <Search size={14} />
            </div>
            <input
              type="text"
              placeholder="بحث برقم السند، الفاتورة أو الملاحظات..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1 min-w-0 bg-transparent border-none py-2 px-3 text-xs text-slate-800 outline-none ring-0 placeholder:text-slate-400 font-semibold"
            />
          </div>

          {/* Type drop down */}
          <div className="group w-full md:w-56 flex items-center bg-slate-50 hover:bg-slate-100/30 border border-slate-200 focus-within:border-slate-900 focus-within:bg-white rounded-xl transition-all overflow-hidden h-10">
            <div className="flex items-center justify-center px-3.5 border-e border-slate-200/60 text-slate-400 group-focus-within:text-slate-900 h-full shrink-0 font-bold">
              <Filter size={12} />
            </div>
            <select
              value={typeFilter}
              onChange={(e: any) => setTypeFilter(e.target.value)}
              className="flex-1 min-w-0 bg-transparent border-none py-2 px-3 text-xs text-slate-700 outline-none ring-0 font-semibold appearance-none cursor-pointer focus:outline-none"
            >
              <option value="all">كل الحركات المالية (دائن وملف)</option>
              <option value="purchase">عمليات المشتريات (متأخرات في فواتير)</option>
              <option value="payment">سندات الصرف والمدفوعات</option>
              <option value="adjustment">تسويات الأرصدة والافتتاحي</option>
            </select>
            <div className="flex items-center justify-center px-2.5 text-slate-400 pointer-events-none">
              <ChevronDown size={14} />
            </div>
          </div>
        </div>

        {/* Date Filters row */}
        <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-100 text-xs font-bold text-slate-500">
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-slate-400">تصفية التاريخ:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none font-semibold text-xs text-slate-700 focus:border-slate-900"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="shrink-0 text-slate-400">إلى تاريخ:</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none font-semibold text-xs text-slate-700 focus:border-slate-900"
            />
          </div>

          {(startDate || endDate || searchTerm || typeFilter !== 'all') && (
            <button
              onClick={() => {
                setStartDate('');
                setEndDate('');
                setSearchTerm('');
                setTypeFilter('all');
              }}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors cursor-pointer mr-auto"
            >
              إعادة تهيئة الفلاتر
            </button>
          )}
        </div>
      </div>

      {/* Main ledger chronological listing */}
      {loading ? (
        <div className="bg-white border border-slate-200 p-12 text-center text-slate-400 rounded-3xl shadow-sm flex flex-col items-center justify-center gap-3">
          <div className="w-8 h-8 border-3 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
          <p className="text-xs font-bold">جاري تحميل حركات كشف الحساب والمستندات...</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden print:border-none print:shadow-none">
          <div className="p-5 border-b border-slate-100 flex justify-between items-center print:hidden bg-slate-50/50">
            <h3 className="font-black text-slate-900 text-sm">بيانات حركة كشف الحساب المتوافقة</h3>
            <span className="text-xs font-mono font-bold text-slate-500">مجموع القيود: {filteredTransactions.length} قيد مالي</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse whitespace-nowrap text-xs md:text-sm">
              <thead>
                <tr className="bg-slate-100/60 text-[11px] font-black text-slate-400 uppercase tracking-wider border-b border-slate-200/50 print:bg-slate-100">
                  <th className="p-4 text-right">التاريخ / الوقت</th>
                  <th className="p-4 text-right">المرجع / السند</th>
                  <th className="p-4 text-right">أطراف ووصف العمليات المستندية</th>
                  <th className="p-4 text-center">المدفوعات (مدين)</th>
                  <th className="p-4 text-center">المطلوبات (دائن)</th>
                  <th className="p-4 bg-slate-50/80 text-slate-900 border-r border-slate-200/50 font-black text-center print:bg-slate-50">الرصيد المستحق (الذمة)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTransactions.map((tx, idx) => {
                  const txDate = new Date(tx.date);
                  const isDebitPayment = tx.debit > 0;
                  
                  return (
                    <tr key={tx.id} className="hover:bg-slate-50/40 transition-colors">
                      <td className="p-4 text-slate-600 font-medium">
                        <div>{txDate.toLocaleDateString('ar-SA')}</div>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">{txDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
                      </td>
                      <td className="p-4 font-mono font-black text-slate-900 uppercase">
                        <span className={cn(
                          "px-2 py-1 rounded-md text-[10px]",
                          tx.type === 'payment' ? "bg-rose-50 text-rose-600 border border-rose-150" :
                          tx.type === 'purchase' ? "bg-slate-50 text-slate-600 border border-slate-200" :
                          "bg-amber-50 text-amber-600 border border-amber-200"
                        )}>
                          {tx.reference_number}
                        </span>
                      </td>
                      <td className="p-4 font-semibold text-slate-700 max-w-sm truncate whitespace-normal leading-relaxed">
                        {tx.notes}
                      </td>
                      
                      {/* Debit Column (Madin) */}
                      <td className="p-4 text-center font-mono font-black text-red-600">
                        {tx.debit > 0 ? (
                          <span className="flex items-center justify-center gap-1">
                            <span>-</span>
                            <span>{tx.debit.toFixed(2)}</span>
                          </span>
                        ) : '—'}
                      </td>

                      {/* Credit Column (Dain) */}
                      <td className="p-4 text-center font-mono font-black text-slate-800">
                        {tx.credit > 0 ? (
                          <span className="flex items-center justify-center gap-1">
                            <span>+</span>
                            <span>{tx.credit.toFixed(2)}</span>
                          </span>
                        ) : '—'}
                      </td>

                      {/* Running Balance Column */}
                      <td className="p-4 bg-slate-50/50 font-mono font-black text-center text-slate-950 border-r border-slate-200/50 text-sm print:bg-slate-50">
                        <div className="flex items-center justify-center gap-1">
                          <span>{tx.running_balance.toFixed(2)}</span>
                          <span className="text-[10px] text-slate-400 font-bold">ر.س</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {filteredTransactions.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-12 text-center text-slate-400 font-bold bg-white">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <AlertCircle className="opacity-25" size={40} />
                        <p className="text-xs text-slate-400">لا توجد حركات مالية مطابقة للقيد المستعلم عنه حالياً</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Payment Voucher trigger */}
      {isVoucherOpen && (
        <PaymentVoucherModal
          supplier={supplier}
          tenantId={tenantId}
          tenantName={tenantName}
          onClose={() => setIsVoucherOpen(false)}
          onSuccess={handleVoucherSuccess}
        />
      )}

      {/* WhatsApp Modal Dialog with instructions */}
      {whatsappModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 print:hidden animate-fade-in" dir="rtl">
          <div className="bg-white border border-slate-100 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-6">
            <div className="text-center space-y-2">
              <div className="mx-auto w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center">
                <MessageCircle size={24} />
              </div>
              <h3 className="text-lg font-black text-slate-900">تم تنزيل كشف الحساب بصيغة PDF!</h3>
              <p className="text-xs font-bold text-slate-500 leading-relaxed">
                تم حفظ ملف الـ PDF بنجاح في جهازك باسم: <br />
                <span className="font-mono text-slate-900 bg-slate-100 px-2 py-1 rounded inline-block mt-1 font-bold">
                  كشف_حساب_{supplier.name.replace(/\s+/g, '_')}.pdf
                </span>
                <br /><br />
                سنقوم الآن بفتح محادثة الواتساب مع المورد. يرجى إرسال الرسالة ثم إرفاق ملف الـ PDF المُنزّل من جهازك لإرساله مباشرة.
              </p>
            </div>
            <div className="flex gap-2 font-black">
              <button
                onClick={proceedToWhatsApp}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black shadow-md shadow-emerald-600/15 flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <span>فتح واتساب الآن</span>
                <ArrowLeft size={14} className="rotate-180" />
              </button>
              <button
                onClick={() => setWhatsappModalOpen(false)}
                className="px-4 py-3 bg-slate-150 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black transition-colors cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden container specifically styled for PDF captures */}
      <div 
        className="absolute left-[-9999px] top-[-9999px] w-[800px] bg-white p-8 space-y-6 text-right" 
        dir="rtl" 
        id="supplier-ledger-pdf-capture" 
        style={{ fontFamily: 'IBM Plex Sans, sans-serif' }}
      >
        {/* Headings */}
        <div className="border-b-2 border-slate-950 pb-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-black text-slate-950">{tenantName}</h1>
              <p className="text-xs font-bold text-slate-500 mt-1">كشف حركـات الحساب التفصيلي للشركاء والموردين</p>
            </div>
            <div className="text-left font-mono text-[9px] text-slate-400">
              <p>تاريخ الاستخراج: {new Date().toLocaleString('ar-SA')}</p>
              <p>النظام: Seen-POS</p>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4 mt-6 pt-4 border-t border-slate-100 text-xs">
            <div>
              <p className="font-extrabold text-slate-400 uppercase tracking-wider mb-1">بيانات المورد:</p>
              <p className="text-sm font-black text-slate-950">{supplier.name}</p>
              {supplier.phone && <p className="font-semibold text-slate-600">هاتف: <span className="font-mono">{supplier.phone}</span></p>}
              {supplier.taxNumber && <p className="font-semibold text-slate-600">الرقم الضريبي للمورد: <span className="font-mono">{supplier.taxNumber}</span></p>}
              {supplier.address && <p className="font-semibold text-slate-500">العنوان: {supplier.address}</p>}
            </div>
            <div className="bg-slate-50 p-4 rounded-2xl flex flex-col justify-between items-end text-left h-full border border-slate-200">
              <span className="font-black text-slate-400 text-[10px] uppercase">إجمالي الرصيد المستحق في الذمة:</span>
              <span className="text-2xl font-black text-red-600 font-mono mt-1">
                {supplier.balance.toFixed(2)} ر.س
              </span>
            </div>
          </div>
        </div>

        {/* Accounting aggregates */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
            <span className="text-[9px] font-black text-slate-400 block mb-1">إجمالي المشتريات (دائن)</span>
            <span className="text-sm font-black text-slate-900 font-mono">
              {totalCredit.toFixed(2)} ر.س
            </span>
          </div>
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
            <span className="text-[9px] font-black text-slate-400 block mb-1">إجمالي المدفوعات (مدين)</span>
            <span className="text-sm font-black text-red-600 font-mono">
              {totalDebit.toFixed(2)} ر.س
            </span>
          </div>
          <div className="bg-indigo-50 p-3 rounded-xl border border-indigo-100">
            <span className="text-[9px] font-black text-indigo-500 block mb-1">الرصيد النهائي المستحق للمورد</span>
            <span className="text-sm font-black text-slate-950 font-mono">
              {supplier.balance.toFixed(2)} ر.س
            </span>
          </div>
        </div>

        {/* Transactions */}
        <div className="border border-slate-200 rounded-2xl overflow-hidden mt-4">
          <table className="w-full text-right border-collapse text-xs whitespace-nowrap">
            <thead>
              <tr className="bg-slate-100/80 text-[10px] font-black text-slate-500 uppercase tracking-wider border-b border-slate-200">
                <th className="p-3 text-right">التاريخ</th>
                <th className="p-3 text-right">المرجع</th>
                <th className="p-3 text-right">الوصف والبيان</th>
                <th className="p-3 text-center">المدفوعات (مدين)</th>
                <th className="p-3 text-center">المطلوبات (دائن)</th>
                <th className="p-3 text-center bg-slate-50 border-r border-slate-200 text-slate-950 font-black">الرصيد المستحق</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTransactions.map((tx) => {
                const txDate = new Date(tx.date);
                return (
                  <tr key={tx.id} className="bg-white">
                    <td className="p-3 text-slate-600 font-medium">
                      {txDate.toLocaleDateString('ar-SA')}
                    </td>
                    <td className="p-3 font-mono font-black text-slate-950">
                      {tx.reference_number}
                    </td>
                    <td className="p-3 font-semibold text-slate-700 whitespace-normal leading-relaxed max-w-xs text-[11px]">
                      {tx.notes}
                    </td>
                    <td className="p-3 text-center font-mono font-bold text-red-600">
                      {tx.debit > 0 ? `-${tx.debit.toFixed(2)}` : '—'}
                    </td>
                    <td className="p-3 text-center font-mono font-bold text-slate-800">
                      {tx.credit > 0 ? `+${tx.credit.toFixed(2)}` : '—'}
                    </td>
                    <td className="p-3 bg-slate-50/50 font-mono font-black text-center text-slate-950 border-r border-slate-200">
                      {tx.running_balance.toFixed(2)} ر.س
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        
        <div className="text-[10px] text-slate-400 font-bold text-center mt-6 pt-4 border-t border-slate-100">
          نشكركم لتعاملكم معنا. تم استخراج هذا المستند آلياً ويدوياً عبر مكتب المحاسبة والمستندات الرسمية.
        </div>
      </div>
    </div>
  );
}
