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
    <div className="bg-surface min-h-screen py-8 px-4 sm:px-6 lg:px-8 font-sans print:p-0" style={{ fontFamily: 'IBM Plex Sans, sans-serif' }} dir="rtl">
      {/* Header Utilities (Hide on print) */}
      <div className="max-w-3xl mx-auto mb-8 flex justify-between items-center print:hidden">
        <h1 className="text-2xl font-black text-content flex items-center gap-3">
          <FileText className="text-brand" size={28} />
          {isDaily ? 'تقرير المبيعات اليومي (Z-Report)' : 'تقرير إغلاق الوردية'}
        </h1>
        <div className="flex gap-3">
          <button 
            onClick={handleWhatsAppExport}
            disabled={exportingPdf}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white rounded-xl transition-colors font-bold text-sm shadow-lg shadow-emerald-500/20 cursor-pointer"
          >
            {exportingPdf ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <MessageCircle size={18} />
            )}
            <span>{exportingPdf ? 'جاري التحضير...' : 'إرسال واتساب (PDF)'}</span>
          </button>
          <button 
            onClick={exportToExcel}
            className="flex items-center gap-2 px-4 py-2 bg-success/10 text-success rounded-xl hover:bg-success/20 transition-colors font-bold text-sm"
          >
            <Download size={18} />
            Excel
          </button>
          <button 
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-xl hover:bg-brand/90 transition-colors font-bold text-sm shadow-lg shadow-brand/20"
          >
            <Printer size={18} />
            طباعة
          </button>
          {onClose && (
            <button 
              onClick={onClose}
              className="px-4 py-2 bg-surface-muted text-content-muted rounded-xl hover:bg-surface-muted/80 transition-colors font-bold text-sm"
            >
              إغلاق المعاينة
            </button>
          )}
        </div>
      </div>

      {/* Report Container */}
      <div id="zreport-pdf-capture" className="max-w-2xl mx-auto bg-surface border border-border shadow-sm rounded-3xl overflow-hidden print:border-none print:shadow-none p-8 print:p-0">
        {/* Branch Info */}
        <div className="text-center mb-10 border-b border-border pb-8">
          <div className="bg-brand/10 w-16 h-16 rounded-2xl flex items-center justify-center text-brand mx-auto mb-4">
            <Calculator size={32} />
          </div>
          <h2 className="text-2xl font-black text-content">تقرير المبيعات والتحصيل</h2>
          <p className="text-content-muted font-bold mt-1 text-sm tracking-widest uppercase">Z-REPORT | END OF {isDaily ? 'DAY' : 'SHIFT'}</p>
        </div>

        {/* Master Info Grid */}
        <div className="grid grid-cols-2 gap-y-6 mb-10 text-sm">
          <div>
            <p className="text-content-muted font-bold mb-1">الموظف المسئول</p>
            <p className="text-content font-black text-lg">{data.staffName}</p>
          </div>
          <div className="text-left">
            <p className="text-content-muted font-bold mb-1">الرقم المرجعي</p>
            <p className="text-content font-mono font-bold">#{data.id.slice(0, 8).toUpperCase()}</p>
          </div>
          <div>
            <p className="text-content-muted font-bold mb-1">وقت البداية</p>
            <p className="text-content font-bold" dir="ltr">{new Date(data.startTime).toLocaleString('ar-SA')}</p>
          </div>
          <div className="text-left">
            <p className="text-content-muted font-bold mb-1">وقت الإغلاق</p>
            <p className="text-content font-bold" dir="ltr">{new Date(data.endTime || '').toLocaleString('ar-SA')}</p>
          </div>
        </div>

        {/* Sales Summary */}
        <div className="space-y-4 mb-10">
          <h3 className="flex items-center gap-2 text-brand font-black text-sm uppercase tracking-wider mb-4">
            <ShoppingBag size={18} />
            ملخص المبيعات
          </h3>
          <div className="bg-surface-muted rounded-2xl p-6 space-y-3">
            <div className="flex justify-between items-center text-content font-bold">
              <span>إجمالي المبيعات (Gross)</span>
              <span><PriceDisplay amount={totals.grossSales || totals.totalSales} /></span>
            </div>
            <div className="flex justify-between items-center text-content font-bold">
              <span>إجمالي الخصومات</span>
              <span className="text-danger">-<PriceDisplay amount={totals.discounts || 0} /></span>
            </div>
            <div className="pt-3 border-t border-border flex justify-between items-center text-content font-black text-lg">
              <span>صافي المبيعات (Net)</span>
              <span className="text-brand"><PriceDisplay amount={totals.totalSales} /></span>
            </div>
            <div className="flex justify-between items-center text-sm font-bold text-content-muted">
              <span>ضريبة القيمة المضافة (15% VAT)</span>
              <span><PriceDisplay amount={totals.taxes} /></span>
            </div>
          </div>
        </div>

        {/* Payment Methods */}
        <div className="space-y-4 mb-10">
          <h3 className="flex items-center gap-2 text-brand font-black text-sm uppercase tracking-wider mb-4">
            <CreditCard size={18} />
            توزيع طرق الدفع
          </h3>
          <div className="border border-border rounded-2xl overflow-x-auto whitespace-nowrap scrollbar-hide">
            <table className="w-full text-right text-sm min-w-max">
              <thead className="bg-surface-muted text-content-muted font-black text-[10px] uppercase">
                <tr>
                  <th className="p-4">طريقة الدفع</th>
                  <th className="p-4 text-left">المبلغ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr>
                  <td className="p-4 font-bold text-content">نقدي (Cash)</td>
                  <td className="p-4 text-left font-black"><PriceDisplay amount={totals.cash} /></td>
                </tr>
                <tr>
                  <td className="p-4 font-bold text-content">بطاقة (Card)</td>
                  <td className="p-4 text-left font-black"><PriceDisplay amount={totals.card} /></td>
                </tr>
                <tr>
                  <td className="p-4 font-bold text-content">تحويل بنكي</td>
                  <td className="p-4 text-left font-black"><PriceDisplay amount={totals.bank_transfer} /></td>
                </tr>
                <tr>
                  <td className="p-4 font-bold text-content">آجل / أخرى</td>
                  <td className="p-4 text-left font-black"><PriceDisplay amount={totals.credit} /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Cash Reconciliation */}
        <div className="space-y-4 mb-10">
          <h3 className="flex items-center gap-2 text-brand font-black text-sm uppercase tracking-wider mb-4">
            <ArrowRightLeft size={18} />
            تسوية النقدية (Cash Reconciliation)
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 border border-border rounded-2xl bg-surface-muted/30">
              <p className="text-[10px] font-black text-content-muted mb-1 uppercase">النقد المتوقع</p>
              <p className="text-xl font-black text-content"><PriceDisplay amount={data.expectedCash} /></p>
            </div>
            <div className="p-4 border border-border rounded-2xl bg-surface-muted/30">
              <p className="text-[10px] font-black text-content-muted mb-1 uppercase">النقد الفعلي</p>
              <p className="text-xl font-black text-content"><PriceDisplay amount={data.actualCash} /></p>
            </div>
          </div>
          <div className={cn(
            "p-6 rounded-2xl flex justify-between items-center shadow-lg",
            data.discrepancy === 0 ? "bg-success text-white" : "bg-danger text-white"
          )}>
            <div>
              <p className="text-[10px] font-bold uppercase opacity-80 mb-1">صافي العجز / الزيادة</p>
              <h4 className="text-2xl font-black">
                {data.discrepancy === 0 ? 'مُطابق تماماً' : <PriceDisplay amount={data.discrepancy} />}
              </h4>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase opacity-80 mb-1">الربح الصافي</p>
              <h4 className="text-2xl font-black text-success bg-surface px-4 py-1 rounded-xl shadow-inner">
                <PriceDisplay amount={netProfit} />
              </h4>
            </div>
          </div>
        </div>

        {/* Returns & Expenses */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          <div className="border border-border p-6 rounded-2xl">
            <div className="flex items-center gap-3 mb-4 text-content">
              <RotateCcw size={20} className="text-danger" />
              <h4 className="font-black text-sm">المرتجعات</h4>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-bold text-content-muted">
                <span>العدد</span>
                <span>{totals.returnCount || 0} عملية</span>
              </div>
              <div className="flex justify-between text-sm font-black text-danger">
                <span>الإجمالي</span>
                <span><PriceDisplay amount={totals.totalReturns} /></span>
              </div>
            </div>
          </div>

          <div className="border border-border p-6 rounded-2xl">
            <div className="flex items-center gap-3 mb-4 text-content">
              <DollarSign size={20} className="text-warning" />
              <h4 className="font-black text-sm">السحوبات والمصاريف</h4>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-bold text-content-muted">
                <span>إجمالي المسحوبات</span>
                <span><PriceDisplay amount={totals.expenses || 0} /></span>
              </div>
              <div className="flex justify-between text-xs font-bold text-content-muted">
                <span>إجمالي الإيداعات</span>
                <span className="text-success"><PriceDisplay amount={totals.totalDeposits || 0} /></span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Branding */}
        <div className="pt-8 border-t border-border text-center">
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
