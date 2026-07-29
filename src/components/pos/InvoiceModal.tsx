import React from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { Printer, Download, Share2, FileText, CheckCircle2, X } from 'lucide-react';
import { Fragment } from 'react';
import { motion } from 'motion/react';
import { formatCurrency } from '../../lib/utils';
import { Customer, TaxInvoice } from '../../types/supabase';
import { PriceDisplay } from '../PriceDisplay';

interface InvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: TaxInvoice | null;
  tenantName: string;
  tenantVatNumber: string;
  items: { name: string; quantity: number; price: number }[];
}

export function InvoiceModal({ isOpen, onClose, invoice, tenantName, tenantVatNumber, items }: InvoiceModalProps) {
  /*
   * تُعرَّف دالة الطباعة قبل الـ useEffect عن قصد: الـ effect يسجّل مستمع
   * Ctrl+P، ولو كانت الدالة معرّفة بعد `if (!invoice) return null` لصار
   * استدعاؤها من المستمع يرمي ReferenceError.
   */
  const handlePrint = React.useCallback(async () => {
    if (!invoice) return;
    try {
      const { printElementDetailed, getConfiguredPaperSize } = await import('../../utils/printManager');
      const res = await printElementDetailed('print-area', {
        paperSize: getConfiguredPaperSize('80mm'),
        title: `فاتورة-${invoice.invoice_number}`,
      });
      if (!res.ok) {
        console.error('[InvoiceModal] فشل الطباعة:', res.message);
        alert(`تعذّرت الطباعة: ${res.message}`);
      }
    } catch (e) {
      console.error('[InvoiceModal] خطأ الطباعة:', e);
      window.print();
    }
  }, [invoice]);

  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        // نمر عبر محرك الطباعة الموحّد بدل window.print() حتى تخرج الفاتورة
        // بنفس الشكل والهوامش على كل الأجهزة.
        void handlePrint();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, handlePrint]);

  if (!invoice) return null;

  const handleDownloadPDF = async () => {
    try {
      const { downloadInvoicePDF } = await import('../../utils/pdfGenerator');
      await downloadInvoicePDF('print-area', `Invoice-${invoice.invoice_number}.pdf`);
    } catch (e) {
      console.error(e);
    }
  };

  const handleShareWhatsApp = async () => {
    const text = `فاتورة من ${tenantName}\nرقم الفاتورة: ${invoice.invoice_number}\nالإجمالي: ${invoice.total_amount}`;
    try {
      const { shareInvoiceAsPDFFile } = await import('../../utils/pdfGenerator');
      await shareInvoiceAsPDFFile('print-area', `Invoice-${invoice.invoice_number}.pdf`, text);
    } catch (e) {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    }
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-[92mm] sm:max-w-[100mm] transform overflow-hidden rounded-2xl bg-surface p-4 sm:p-5 text-right align-middle shadow-xl transition-all" dir="rtl">
                
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2 text-success">
                    <div className="w-8 h-8 rounded-full bg-success/10 flex items-center justify-center shrink-0">
                      <CheckCircle2 size={20} />
                    </div>
                    <Dialog.Title as="h3" className="text-base font-bold">
                      تم إصدار الفاتورة بنجاح
                    </Dialog.Title>
                  </div>
                  <button onClick={onClose} className="p-1.5 text-content-muted hover:text-content hover:bg-surface-muted rounded-lg transition-colors">
                    <X size={18} />
                  </button>
                </div>

                {/* Printable Area */}
                <div id="print-area" data-paper="80mm" className="bg-surface border border-border rounded-xl p-3 sm:p-4 mb-4 print:mx-auto print:my-0 print:border-none print:p-2 print:px-3 w-full box-border">
                  <div className="text-center mb-6 border-b border-dashed border-border pb-6">
                    <h2 className="text-2xl font-bold text-content mb-1">{tenantName}</h2>
                    {tenantVatNumber && (
                      <p className="text-sm text-content-muted">الرقم الضريبي: {tenantVatNumber}</p>
                    )}
                    <div className="mt-4 inline-block bg-surface-muted px-3 py-1 rounded-lg border border-border">
                      <p className="text-sm font-bold text-content">
                        فاتورة ضريبية {invoice.invoice_type === 'simplified_b2c' ? 'مبسطة' : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex justify-between items-center mb-6 text-sm flex-wrap gap-4">
                    <div>
                      <p className="text-content-muted mb-1 text-xs font-medium">رقم الفاتورة</p>
                      <p className="font-bold text-content">{invoice.invoice_number}</p>
                    </div>
                    <div className="text-left">
                      <p className="text-content-muted mb-1 text-xs font-medium">التاريخ والوقت</p>
                      <div className="font-bold text-content text-xs flex items-center gap-1.5 justify-end">
                        <span className="font-mono" dir="ltr">
                          {new Date(invoice.issued_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        </span>
                        <span className="font-mono text-content-muted text-[10px]" dir="ltr">
                          {new Date(invoice.issued_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Items — quantity is folded into the name as "2 × المنتج"
                      rather than living in its own column. */}
                  <div className="mb-6 border-t border-b border-dashed border-border py-4 space-y-2">
                    <div className="flex justify-between items-end text-[10px] font-bold text-content-muted mb-2 gap-2">
                      <span className="flex-1 min-w-0">المنتج</span>
                      <span className="w-16 shrink-0 text-center">السعر</span>
                      <span className="w-20 shrink-0 text-left">المجموع</span>
                    </div>
                    {items.map((item, idx) => (
                      <div key={idx} className="flex justify-between text-xs font-medium text-content gap-2">
                        <span className="flex-1 min-w-0 leading-snug">
                          <span className="font-mono text-content-muted" dir="ltr">{item.quantity} ×</span>{' '}
                          {item.name}
                        </span>
                        <span className="w-16 shrink-0 text-center tabular-nums text-content-muted">{formatCurrency(item.price)}</span>
                        <span className="w-20 shrink-0 text-left tabular-nums">{formatCurrency(item.quantity * item.price)}</span>
                      </div>
                    ))}
                  </div>

                  {/* Totals */}
                  <div className="space-y-2 text-sm font-medium border-b border-dashed border-border pb-4 mb-4">
                    <div className="flex justify-between text-content-muted">
                      <span>المجموع الفرعي (قبل الخصم والضريبة)</span>
                      <span className="tabular-nums font-bold text-content">{formatCurrency(Number(invoice.subtotal))}</span>
                    </div>
                    {Number(invoice.discount_amount) > 0 && (
                      <div className="flex justify-between text-brand">
                        <span>الخصم المستقطع</span>
                        <span className="tabular-nums font-bold">-{formatCurrency(Number(invoice.discount_amount))}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-content-muted">
                      <span>الإجمالي الخاضع للضريبة</span>
                      <span className="tabular-nums font-bold text-content">{formatCurrency(Number(invoice.subtotal) - Number(invoice.discount_amount))}</span>
                    </div>
                    <div className="flex justify-between text-content-muted">
                      <span>ضريبة القيمة المضافة (15%)</span>
                      <span className="tabular-nums font-bold text-content">{formatCurrency(Number(invoice.tax_amount))}</span>
                    </div>
                  </div>

                  <div className="flex justify-between items-end mb-3">
                    <p className="font-bold text-content text-lg">الإجمالي شامل الضريبة</p>
                    <PriceDisplay amount={Number(invoice.total_amount)} className="text-2xl font-black text-brand" />
                  </div>

                  <div className="flex justify-between items-center text-xs font-bold text-content-muted pt-3 border-t border-dashed border-border">
                    <span>طريقة الدفع</span>
                    <span className="text-brand font-black bg-brand/10 px-2.5 py-1 rounded-lg">
                      {(invoice as any).payment_method === 'network' || (invoice as any).paymentMethod === 'network' ? 'شبكة / بطاقة' :
                       (invoice as any).payment_method === 'bank_transfer' || (invoice as any).paymentMethod === 'bank_transfer' ? 'تحويل بنكي' :
                       (invoice as any).payment_method === 'partial' || (invoice as any).paymentMethod === 'partial' ? 'آجل / دفع جزئي' :
                       (invoice as any).payment_method === 'cash_on_delivery' || (invoice as any).paymentMethod === 'cash_on_delivery' ? 'الدفع عند الاستلام' : 'نقدي'}
                    </span>
                  </div>

                  {/* QR Code */}
                  {invoice.qr_payload && (
                    <div className="mt-8 flex flex-col items-center justify-center">
                      <div className="bg-surface-muted p-3 rounded-xl border border-border flex items-center justify-center break-all text-[8px] sm:text-xs">
                        <img 
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(invoice.qr_payload)}`} 
                          alt="ZATCA QR Code" 
                          className="w-32 h-32"
                        />
                      </div>
                      <p className="text-xs text-content-muted mt-2">متوافق مع هيئة الزكاة والضريبة والجمارك</p>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 print:hidden">
                  <button
                    onClick={handlePrint}
                    className="flex justify-center items-center gap-2 w-full px-4 py-3 bg-content text-surface rounded-xl font-bold hover:bg-content/90 transition-colors"
                  >
                    <Printer size={18} />
                    <span>طباعة</span>
                  </button>
                  <button
                    onClick={handleDownloadPDF}
                    className="flex justify-center items-center gap-2 w-full px-4 py-3 bg-surface border border-border text-content rounded-xl font-bold hover:bg-surface-muted transition-colors"
                  >
                    <Download size={18} />
                    <span>تنزيل PDF</span>
                  </button>
                  <button
                    onClick={handleShareWhatsApp}
                    className="flex justify-center items-center gap-2 w-full px-4 py-3 bg-[#25D366] text-white rounded-xl font-bold hover:bg-opacity-90 transition-colors"
                  >
                    <Share2 size={18} />
                    <span>مشاركة</span>
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
