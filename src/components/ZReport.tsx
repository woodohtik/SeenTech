import React, { useState } from 'react';
import { FileText, Download, Printer, ShoppingBag, DollarSign, RotateCcw, CreditCard, Calculator, ArrowRightLeft, MessageCircle, ArrowLeft } from 'lucide-react';
import { cn } from '../lib/utils';
import { PriceDisplay } from './PriceDisplay';
import { Shift, ShiftTotals } from '../types';
import Branding from './Branding';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import { toPng } from 'html-to-image';

interface ZReportProps {
  data: Shift | {
    id: string;
    tenantId: string;
    staffName: string;
    startTime: string;
    endTime: string;
    openingBalance: number;
    actualCash: number;
    expectedCash: number;
    discrepancy: number;
    totals: ShiftTotals;
    type: 'shift' | 'daily';
  };
  onClose?: () => void;
}

export default function ZReport({ data, onClose }: ZReportProps) {
  const isDaily = 'type' in data && data.type === 'daily';
  
  const [exportingPdf, setExportingPdf] = useState(false);
  const [whatsappModalOpen, setWhatsappModalOpen] = useState(false);
  const [recipientPhone, setRecipientPhone] = useState(localStorage.getItem('last_zreport_whatsapp_phone') || '');

  const totals = data.totals || {
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
  };

  const handleWhatsAppExport = async () => {
    setExportingPdf(true);
    try {
      const element = document.getElementById('zreport-pdf-capture');
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

      const fileName = `تقرير_إغلاق_${isDaily ? 'اليومي' : 'الوردية'}_#${data.id.slice(0, 8).toUpperCase()}.pdf`;
      pdf.save(fileName);

      setWhatsappModalOpen(true);
    } catch (err) {
      console.error('Failed to export Z-Report to PDF:', err);
    } finally {
      setExportingPdf(false);
    }
  };

  const proceedToWhatsApp = () => {
    let phone = recipientPhone.replace(/\D/g, '');
    if (phone.startsWith('05')) {
      phone = '966' + phone.substring(1);
    } else if (phone.startsWith('5')) {
      phone = '966' + phone;
    }

    if (phone) {
      localStorage.setItem('last_zreport_whatsapp_phone', recipientPhone);
    }

    const today = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
    let message = `*تقرير إغلاق ${isDaily ? 'المبيعات اليومي (Z-Report)' : 'الوردية'}*\n`;
    message += `*الرقم المرجعي:* #${data.id.slice(0, 8).toUpperCase()}\n`;
    message += `*المسئول:* ${data.staffName}\n`;
    message += `*التاريخ:* ${today}\n\n`;
    message += `يرجى الاطلاع على ملف التقرير المرفق بصيغة PDF.\n\n`;
    message += `وشكراً جزيلاً لكم.`;

    const encodedText = encodeURIComponent(message);
    const whatsappUrl = `https://api.whatsapp.com/send?phone=${phone}&text=${encodedText}`;
    window.open(whatsappUrl, '_blank');
    setWhatsappModalOpen(false);
  };

  const handlePrint = () => {
    window.print();
  };

  const exportToExcel = () => {
    const reportData = [
      ['تقرير إغلاق ' + (isDaily ? 'اليوم' : 'الوردية')],
      ['المصدر:', 'نظام وضوح ووضوح تيك'],
      ['التاريخ:', new Date().toLocaleDateString('ar-SA')],
      [],
      ['المعلومات الأساسية'],
      ['الرقم المرجعي', data.id],
      ['الموظف', data.staffName],
      ['وقت البداية', new Date(data.startTime).toLocaleString('ar-SA')],
      ['وقت النهاية', new Date(data.endTime || '').toLocaleString('ar-SA')],
      [],
      ['ملخص المبيعات'],
      ['إجمالي المبيعات (Gross)', totals.grossSales || totals.totalSales],
      ['الخصومات', totals.discounts || 0],
      ['صافي المبيعات (Net)', totals.totalSales],
      ['إجمالي الضريبة (VAT)', totals.taxes],
      [],
      ['توزيع طرق الدفع'],
      ['نقد (Cash)', totals.cash],
      ['بطاقة (Card)', totals.card],
      ['تحويل بنكي', totals.bank_transfer],
      ['آجل / أخرى', totals.credit],
      [],
      ['تسوية النقدية'],
      ['الرصيد الافتتاحي', data.openingBalance],
      ['المبيعات النقدية', totals.cash],
      ['إيداعات نقدية', totals.totalDeposits || 0],
      ['مرتجعات نقدية', totals.cashReturns],
      ['المصروفات / المسحوبات', totals.expenses || 0],
      ['النقد المتوقع', data.expectedCash],
      ['النقد الفعلي', data.actualCash],
      ['العجز / الزيادة', data.discrepancy],
      [],
      ['المرتجعات'],
      ['عدد العمليات', totals.returnCount || 0],
      ['إجمالي المبالغ المرتجعة', totals.totalReturns]
    ];

    const ws = XLSX.utils.aoa_to_sheet(reportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Z-Report");
    XLSX.writeFile(wb, `Z-Report-${data.id}.xlsx`);
  };

  const netProfit = totals.totalSales - totals.taxes;

  return (
    <div className="bg-surface min-h-screen py-4 sm:py-8 px-2 sm:px-6 lg:px-8 font-sans print:p-0" dir="rtl">
      {/* Header Utilities (Hide on print) */}
      <div className="max-w-3xl mx-auto mb-6 sm:mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 print:hidden">
        <h1 className="text-xl sm:text-2xl font-black text-content flex items-center gap-2.5 sm:gap-3">
          <FileText className="text-brand shrink-0 sm:w-7 sm:h-7" size={24} />
          <span>{isDaily ? 'تقرير المبيعات اليومي (Z-Report)' : 'تقرير إغلاق الوردية'}</span>
        </h1>
        <div className="flex flex-wrap gap-2 w-full md:w-auto">
          <button 
            onClick={handleWhatsAppExport}
            disabled={exportingPdf}
            className="flex-1 md:flex-none flex items-center justify-center gap-1.5 px-3 py-2 sm:px-4 sm:py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white rounded-xl transition-colors font-bold text-xs sm:text-sm shadow-lg shadow-emerald-500/20 cursor-pointer"
          >
            {exportingPdf ? (
              <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <MessageCircle size={16} />
            )}
            <span>{exportingPdf ? 'جاري التحضير...' : 'واتساب'}</span>
          </button>
          <button 
            onClick={exportToExcel}
            className="flex-1 md:flex-none flex items-center justify-center gap-1.5 px-3 py-2 sm:px-4 sm:py-2 bg-success/10 text-success rounded-xl hover:bg-success/20 transition-colors font-bold text-xs sm:text-sm"
          >
            <Download size={16} />
            <span>Excel</span>
          </button>
          <button 
            onClick={handlePrint}
            className="flex-1 md:flex-none flex items-center justify-center gap-1.5 px-3 py-2 sm:px-4 sm:py-2 bg-brand text-white rounded-xl hover:bg-brand/90 transition-colors font-bold text-xs sm:text-sm shadow-lg shadow-brand/20"
          >
            <Printer size={16} />
            <span>طباعة</span>
          </button>
          {onClose && (
            <button 
              onClick={onClose}
              className="flex-1 md:flex-none flex items-center justify-center px-3 py-2 sm:px-4 sm:py-2 bg-surface-muted text-content-muted rounded-xl hover:bg-surface-muted/80 transition-colors font-bold text-xs sm:text-sm"
            >
              إغلاق
            </button>
          )}
        </div>
      </div>

      {/* Report Container */}
      <div id="zreport-pdf-capture" className="max-w-2xl mx-auto bg-surface border border-border shadow-sm rounded-2xl sm:rounded-3xl overflow-hidden print:border-none print:shadow-none p-4 sm:p-8 print:p-0">
        {/* Branch Info */}
        <div className="text-center mb-6 sm:mb-10 border-b border-border pb-6 sm:pb-8">
          <div className="bg-brand/10 w-12 h-12 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl flex items-center justify-center text-brand mx-auto mb-3 sm:mb-4">
            <Calculator size={24} className="sm:w-8 sm:h-8" />
          </div>
          <h2 className="text-lg sm:text-2xl font-black text-content">تقرير المبيعات والتحصيل</h2>
          <p className="text-content-muted font-bold mt-1 text-[10px] sm:text-sm tracking-widest uppercase">Z-REPORT | END OF {isDaily ? 'DAY' : 'SHIFT'}</p>
        </div>

        {/* Master Info Grid */}
        <div className="grid grid-cols-2 gap-4 sm:gap-y-6 mb-8 sm:mb-10 text-xs sm:text-sm">
          <div>
            <p className="text-content-muted font-bold mb-1">الموظف المسئول</p>
            <p className="text-content font-black text-sm sm:text-lg truncate">{data.staffName}</p>
          </div>
          <div className="text-left">
            <p className="text-content-muted font-bold mb-1">الرقم المرجعي</p>
            <p className="text-content font-mono font-bold truncate">#{data.id.slice(0, 8).toUpperCase()}</p>
          </div>
          <div>
            <p className="text-content-muted font-bold mb-1">وقت البداية</p>
            <p className="text-content font-bold text-[10px] sm:text-xs" dir="ltr">{new Date(data.startTime).toLocaleString('ar-SA')}</p>
          </div>
          <div className="text-left">
            <p className="text-content-muted font-bold mb-1">وقت الإغلاق</p>
            <p className="text-content font-bold text-[10px] sm:text-xs" dir="ltr">{new Date(data.endTime || '').toLocaleString('ar-SA')}</p>
          </div>
        </div>

        {/* Sales Summary */}
        <div className="space-y-3 sm:space-y-4 mb-8 sm:mb-10">
          <h3 className="flex items-center gap-2 text-brand font-black text-xs sm:text-sm uppercase tracking-wider mb-2 sm:mb-4">
            <ShoppingBag size={16} className="sm:w-[18px] sm:h-[18px]" />
            <span>ملخص المبيعات</span>
          </h3>
          <div className="bg-surface-muted rounded-xl sm:rounded-2xl p-4 sm:p-6 space-y-2.5 sm:space-y-3">
            <div className="flex justify-between items-center text-xs sm:text-sm text-content font-bold">
              <span>إجمالي المبيعات (Gross)</span>
              <span><PriceDisplay amount={totals.grossSales || totals.totalSales} /></span>
            </div>
            <div className="flex justify-between items-center text-xs sm:text-sm text-content font-bold">
              <span>إجمالي الخصومات</span>
              <span className="text-danger">-<PriceDisplay amount={totals.discounts || 0} /></span>
            </div>
            <div className="pt-2.5 sm:pt-3 border-t border-border flex justify-between items-center text-content font-black text-sm sm:text-lg">
              <span>صافي المبيعات (Net)</span>
              <span className="text-brand"><PriceDisplay amount={totals.totalSales} /></span>
            </div>
            <div className="flex justify-between items-center text-[10px] sm:text-xs font-bold text-content-muted">
              <span>ضريبة القيمة المضافة (15% VAT)</span>
              <span><PriceDisplay amount={totals.taxes} /></span>
            </div>
          </div>
        </div>

        {/* Payment Methods */}
        <div className="space-y-3 sm:space-y-4 mb-8 sm:mb-10">
          <h3 className="flex items-center gap-2 text-brand font-black text-xs sm:text-sm uppercase tracking-wider mb-2 sm:mb-4">
            <CreditCard size={16} className="sm:w-[18px] sm:h-[18px]" />
            <span>توزيع طرق الدفع</span>
          </h3>
          <div className="border border-border rounded-xl sm:rounded-2xl overflow-x-auto whitespace-nowrap scrollbar-hide">
            <table className="w-full text-right text-xs sm:text-sm min-w-max">
              <thead className="bg-surface-muted text-content-muted font-black text-[10px] uppercase">
                <tr>
                  <th className="p-3 sm:p-4">طريقة الدفع</th>
                  <th className="p-3 sm:p-4 text-left">المبلغ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr>
                  <td className="p-3 sm:p-4 font-bold text-content">نقدي (Cash)</td>
                  <td className="p-3 sm:p-4 text-left font-black"><PriceDisplay amount={totals.cash} /></td>
                </tr>
                <tr>
                  <td className="p-3 sm:p-4 font-bold text-content">بطاقة (Card)</td>
                  <td className="p-3 sm:p-4 text-left font-black"><PriceDisplay amount={totals.card} /></td>
                </tr>
                <tr>
                  <td className="p-3 sm:p-4 font-bold text-content">تحويل بنكي</td>
                  <td className="p-3 sm:p-4 text-left font-black"><PriceDisplay amount={totals.bank_transfer} /></td>
                </tr>
                <tr>
                  <td className="p-3 sm:p-4 font-bold text-content">آجل / أخرى</td>
                  <td className="p-3 sm:p-4 text-left font-black"><PriceDisplay amount={totals.credit} /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Cash Reconciliation */}
        <div className="space-y-3 sm:space-y-4 mb-8 sm:mb-10">
          <h3 className="flex items-center gap-2 text-brand font-black text-xs sm:text-sm uppercase tracking-wider mb-2 sm:mb-4">
            <ArrowRightLeft size={16} className="sm:w-[18px] sm:h-[18px]" />
            <span>تسوية النقدية (Cash Reconciliation)</span>
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <div className="p-3 sm:p-4 border border-border rounded-xl sm:rounded-2xl bg-surface-muted/30">
              <p className="text-[9px] sm:text-[10px] font-black text-content-muted mb-1 uppercase">النقد المتوقع</p>
              <p className="text-sm sm:text-xl font-black text-content"><PriceDisplay amount={data.expectedCash} /></p>
            </div>
            <div className="p-3 sm:p-4 border border-border rounded-xl sm:rounded-2xl bg-surface-muted/30">
              <p className="text-[9px] sm:text-[10px] font-black text-content-muted mb-1 uppercase">النقد الفعلي</p>
              <p className="text-sm sm:text-xl font-black text-content"><PriceDisplay amount={data.actualCash} /></p>
            </div>
          </div>
          <div className={cn(
            "p-4 sm:p-6 rounded-xl sm:rounded-2xl flex flex-col sm:flex-row gap-4 sm:items-center justify-between shadow-lg",
            data.discrepancy === 0 ? "bg-success text-white" : "bg-danger text-white"
          )}>
            <div className="flex justify-between sm:block">
              <p className="text-[10px] font-bold uppercase opacity-80 mb-1">صافي العجز / الزيادة</p>
              <h4 className="text-lg sm:text-2xl font-black">
                {data.discrepancy === 0 ? 'مُطابق تماماً' : <PriceDisplay amount={data.discrepancy} />}
              </h4>
            </div>
            <div className="flex justify-between sm:block sm:text-right border-t border-white/20 sm:border-0 pt-3 sm:pt-0">
              <p className="text-[10px] font-bold uppercase opacity-80 mb-1">الربح الصافي</p>
              <h4 className="text-lg sm:text-2xl font-black text-success bg-white px-4 py-1 rounded-xl shadow-inner inline-block">
                <PriceDisplay amount={netProfit} />
              </h4>
            </div>
          </div>
        </div>

        {/* Returns & Expenses */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 mb-8 sm:mb-12">
          <div className="border border-border p-4 sm:p-6 rounded-xl sm:rounded-2xl">
            <div className="flex items-center gap-2.5 sm:gap-3 mb-3 sm:mb-4 text-content">
              <RotateCcw size={18} className="text-danger sm:w-5 sm:h-5" />
              <h4 className="font-black text-xs sm:text-sm">المرتجعات</h4>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-[10px] sm:text-xs font-bold text-content-muted">
                <span>العدد</span>
                <span>{totals.returnCount || 0} عملية</span>
              </div>
              <div className="flex justify-between text-xs sm:text-sm font-black text-danger">
                <span>الإجمالي</span>
                <span><PriceDisplay amount={totals.totalReturns} /></span>
              </div>
            </div>
          </div>

          <div className="border border-border p-4 sm:p-6 rounded-xl sm:rounded-2xl">
            <div className="flex items-center gap-2.5 sm:gap-3 mb-3 sm:mb-4 text-content">
              <DollarSign size={18} className="text-warning sm:w-5 sm:h-5" />
              <h4 className="font-black text-xs sm:text-sm">السحوبات والمصاريف</h4>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-[10px] sm:text-xs font-bold text-content-muted">
                <span>إجمالي المسحوبات</span>
                <span><PriceDisplay amount={totals.expenses || 0} /></span>
              </div>
              <div className="flex justify-between text-[10px] sm:text-xs font-bold text-content-muted">
                <span>إجمالي الإيداعات</span>
                <span className="text-success"><PriceDisplay amount={totals.totalDeposits || 0} /></span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Branding */}
        <div className="pt-6 sm:pt-8 border-t border-border text-center">
          <Branding collapsed={false} className="opacity-90 transition-all" />
        </div>
      </div>

      {/* WhatsApp Modal Dialog with instructions */}
      {whatsappModalOpen && (
        <div className="fixed inset-0 bg-slate-900/65 backdrop-blur-md flex items-center justify-center p-4 z-50 print:hidden animate-fade-in" dir="rtl">
          <div className="bg-white border border-slate-100 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-6">
            <div className="text-center space-y-2">
              <div className="mx-auto w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center animate-bounce">
                <MessageCircle size={24} />
              </div>
              <h3 className="text-lg font-black text-slate-900">تم تجهيز كشف إغلاق الوردية PDF!</h3>
              <p className="text-xs font-bold text-slate-500 leading-relaxed">
                تم حفظ التقرير بنجاح على جهازك. يرجى كتابة رقم واتساب المستلم بالأسفل (المندوب أو المدير أو المالك) ومن ثم إرساله.
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-black text-slate-700">رقم جوال المستلم (مثال: 0501234567)</label>
              <input
                type="text"
                placeholder="أدخل رقم الجوال هنا"
                value={recipientPhone}
                onChange={(e) => setRecipientPhone(e.target.value)}
                className="w-full px-4 py-3 border border-slate-200 rounded-2xl text-sm font-bold text-slate-950 focus:outline-none focus:border-emerald-500 bg-slate-50 focus:bg-white transition-all"
              />
            </div>

            <div className="flex gap-2 font-black">
              <button
                onClick={proceedToWhatsApp}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black shadow-md shadow-emerald-600/15 flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <span>متابعة إلى واتساب</span>
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

      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          body { background-color: white !important; }
          .print-hidden { display: none !important; }
          @page {
            size: auto;
            margin: 0mm;
          }
           /* Optimize for 80mm if possible via scaling or custom size */
        }
      `}} />
    </div>
  );
}
