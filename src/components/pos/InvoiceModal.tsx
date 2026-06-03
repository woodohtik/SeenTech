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
  if (!invoice) return null;

  const handlePrintThermal = () => {
    // Basic implementation for thermal print
    window.print();
  };

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
              <Dialog.Panel className="w-full max-w-lg transform overflow-hidden rounded-2xl bg-surface p-6 text-right align-middle shadow-xl transition-all" dir="rtl">
                
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3 text-success">
                    <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center">
                      <CheckCircle2 size={24} />
                    </div>
                    <Dialog.Title as="h3" className="text-xl font-bold">
                      تم إصدار الفاتورة بنجاح
                    </Dialog.Title>
                  </div>
                  <button onClick={onClose} className="p-2 text-content-muted hover:text-content hover:bg-surface-muted rounded-lg transition-colors">
                    <X size={20} />
                  </button>
                </div>

                {/* Printable Area */}
                <div id="print-area" className="bg-surface border border-border rounded-xl p-6 mb-6 print:m-0 print:border-none print:p-0">
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

                  <div className="flex justify-between items-center mb-6 text-sm">
                    <div>
                      <p className="text-content-muted mb-1">رقم الفاتورة</p>
                      <p className="font-bold text-content">{invoice.invoice_number}</p>
                    </div>
                    <div className="text-left">
                      <p className="text-content-muted mb-1">التاريخ والوقت</p>
                      <p className="font-bold text-content">{new Date(invoice.issued_at).toLocaleString('ar-SA')}</p>
                    </div>
                  </div>

                  {/* Items */}
                  <div className="mb-6 border-t border-b border-dashed border-border py-4 space-y-3">
                    <div className="flex justify-between text-xs font-bold text-content-muted mb-2">
                      <span>المنتج</span>
                      <span>الكمية × السعر</span>
                      <span>المجموع</span>
                    </div>
                    {items.map((item, idx) => (
                      <div key={idx} className="flex justify-between text-sm font-medium text-content">
                        <span className="truncate flex-1">{item.name}</span>
                        <span className="w-24 text-center tabular-nums text-content-muted">{item.quantity} × {formatCurrency(item.price)}</span>
                        <span className="w-20 text-left tabular-nums">{formatCurrency(item.quantity * item.price)}</span>
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

                  <div className="flex justify-between items-end">
                    <p className="font-bold text-content text-lg">الإجمالي شامل الضريبة</p>
                    <PriceDisplay amount={Number(invoice.total_amount)} className="text-2xl font-black text-brand" />
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
                    onClick={handlePrintThermal}
                    className="flex justify-center items-center gap-2 w-full px-4 py-3 bg-content text-surface rounded-xl font-bold hover:bg-content/90 transition-colors"
                  >
                    <Printer size={18} />
                    <span>طباعة حرارية</span>
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
