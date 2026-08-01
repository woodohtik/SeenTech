import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase/client';
import { handleError, OperationType, getFriendlyErrorMessage } from '../lib/firebase';
import { Order } from '../types';
import { cn, getCurrencySymbol } from '../lib/utils';
import { decodeOrderB2BNotes } from '../utils/b2bHelper';
import { PriceDisplay } from './PriceDisplay';
import { FileText, Eye, X, Download, Package, Scissors, User, Calendar, CreditCard, ShoppingBag, Clock, Printer, Share2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { downloadInvoicePDF, shareInvoiceAsPDFFile } from '../utils/pdfGenerator';
import SimplifiedTaxInvoice from './printing/SimplifiedTaxInvoice';
import TaxInvoice from './printing/TaxInvoice';
import DateTimeDisplay from './DateTimeDisplay';
import { generateZatcaQR } from '../services/zatcaService';
import { useToast } from '../contexts/ToastContext';

export default function SalesRecord({ tenantId, shiftId, filterStatus }: { tenantId: string, shiftId?: string, filterStatus?: string }) {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar' || i18n.language === 'ur';
  const { error: toastError } = useToast();

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const handleDownloadPDF = async () => {
    if (!selectedOrder) return;
    try {
      await downloadInvoicePDF('sales-record-print-area', `Invoice-${selectedOrder.orderNumber || selectedOrder.id.slice(-6).toUpperCase()}.pdf`);
    } catch (e) {
      console.error(e);
    }
  };

  /**
   * الطباعة من سجل المبيعات.
   *
   * كانت تستخدم `window.print()` مباشرة، فيطبع المتصفح الصفحة كاملة
   * بهوامشه الافتراضية الكبيرة أعلى وأسفل الورقة، ومع حشو النافذة
   * (p-4 / sm:p-8) وارتفاع 100% كان يظهر فراغ واسع حول الفاتورة.
   *
   * الآن تمر عبر محرك الطباعة الموحّد: نسخة معزولة من الفاتورة بهوامش
   * @page مضبوطة — نفس ناتج الطباعة من صفحة البيع تماماً.
   */
  const handlePrint = async () => {
    if (!selectedOrder) return;
    try {
      const { printElementDetailed, getConfiguredPaperSize } = await import('../utils/printManager');
      const res = await printElementDetailed('sales-record-print-area', {
        paperSize: getConfiguredPaperSize('80mm'),
        title: `فاتورة-${selectedOrder.orderNumber || selectedOrder.id.slice(-6).toUpperCase()}`,
      });
      if (!res.ok) {
        // مع الطباعة الصامتة قد لا تُفتح نافذة طباعة، فلا بد من إشعار مرئي
        console.error('[SalesRecord] فشل الطباعة:', res.message);
        toastError('تعذّرت الطباعة', res.message);
      }
    } catch (e) {
      console.error('[SalesRecord] خطأ الطباعة:', e);
      window.print();
    }
  };

  const handleShareWhatsApp = async () => {
    if (!selectedOrder) return;
    const paymentMethodText = selectedOrder.paymentMethod === 'cash' ? t('pos.cash') :
                          selectedOrder.paymentMethod === 'network' ? t('pos.card') : 
                          selectedOrder.paymentMethod === 'partial' ? t('pos.partial') : 
                          selectedOrder.paymentMethod === 'bank_transfer' ? t('pos.bank_transfer') : t('pos.other');
    const statusText = selectedOrder.status === 'delivered' ? t('pos.delivered') : t('pos.pending');
    
    const text = isRtl
      ? `السلام عليكم ورحمة الله وبركاته،\nتفاصيل الفاتورة من المتجر:\nرقم الفاتورة: #${selectedOrder.orderNumber || selectedOrder.id.slice(-6).toUpperCase()}\nالإجمالي: ${selectedOrder.totalAmount} ${getCurrencySymbol()}\nطريقة الدفع: ${paymentMethodText}\nحالة الطلب: ${statusText}\nشكراً لتواصلك معنا!`
      : `Hello,\nInvoice details from store:\nInvoice No: #${selectedOrder.orderNumber || selectedOrder.id.slice(-6).toUpperCase()}\nTotal: ${selectedOrder.totalAmount} ${getCurrencySymbol()}\nPayment Method: ${paymentMethodText}\nOrder Status: ${statusText}\nThank you for choosing us!`;
    
    try {
      await shareInvoiceAsPDFFile('sales-record-print-area', `Invoice-${selectedOrder.orderNumber || selectedOrder.id.slice(-6).toUpperCase()}.pdf`, text);
    } catch (e) {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    }
  };

  const fetchOrders = async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: staffData }, { data: ordersData, error: fetchError }] = await Promise.all([
        supabase.from('staff').select('id, name'),
        (() => {
          let query = supabase.from('orders').select('*').eq('tenant_id', tenantId);
          if (shiftId) query = query.eq('shift_id', shiftId);
          if (filterStatus) query = query.eq('status', filterStatus);
          return query.order('created_at', { ascending: false });
        })()
      ]);

      if (fetchError) throw fetchError;

      const staffMap: Record<string, string> = {};
      if (staffData) {
        staffData.forEach(s => {
          if (s.id && s.name) staffMap[s.id] = s.name;
        });
      }

      const mappedOrders = ordersData ? ordersData.map(d => {
        const b2bMeta = decodeOrderB2BNotes(d.notes);
        const resolvedCreator = (d as any).seller_name ||
          (d as any).sellerName ||
          (d as any).staff_name ||
          (d as any).cashier_name ||
          (d.created_by && staffMap[d.created_by] ? staffMap[d.created_by] : d.created_by) ||
          'النظام';

        return {
          ...d,
          orderNumber: d.order_number,
          customerId: d.customer_id,
          customerName: d.customer_name,
          tenantId: d.tenant_id,
          shiftId: d.shift_id,
          subtotalAmount: d.subtotal_amount,
          totalAmount: d.total_amount,
          paidAmount: d.paid_amount,
          discountAmount: d.discount_amount,
          remainingAmount: d.remaining_amount,
          paymentMethod: d.payment_method,
          orderDate: d.order_date,
          deliveryDate: d.delivery_date,
          createdBy: resolvedCreator,
          taxAmount: d.tax_amount,
          taxRate: d.tax_rate,
          isB2B: b2bMeta.isB2B,
          b2bCompanyName: b2bMeta.b2bCompanyName,
          b2bTRN: b2bMeta.b2bTRN,
          notes: b2bMeta.originalNotes || d.notes,
          qrCode: d.qr_code,
          createdAt: d.created_at,
          updatedAt: d.updated_at
        } as Order;
      }) : [];

      setOrders(mappedOrders);
    } catch (err: any) {
      console.error('[SalesRecord] Error fetching orders:', err);
      setError(getFriendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [tenantId, shiftId, filterStatus]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 font-sans flex flex-col items-center justify-center h-64 text-center bg-surface border border-border rounded-2xl max-w-md mx-auto my-12 shadow-sm animate-fade-in" dir={isRtl ? 'rtl' : 'ltr'}>
        <div className="w-12 h-12 bg-red-50 text-red-500 rounded-full flex items-center justify-center mb-4 font-black text-xl">⚠️</div>
        <h3 className="text-sm font-black text-content mb-2">{t('sales_record.failed_to_load', 'فشل تحميل سجل المبيعات')}</h3>
        <p className="text-xs text-content-muted mb-4 font-bold max-w-[280px] leading-relaxed">{error}</p>
        <button
          onClick={fetchOrders}
          className="px-5 py-2 bg-brand text-white text-xs font-black rounded-xl hover:bg-brand/90 transition-colors shadow-md shadow-brand/10 cursor-pointer"
        >
          {t('common.retry', 'إعادة المحاولة')}
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 font-sans">
      <div className="bg-surface rounded-2xl md:rounded-[2rem] border border-border shadow-sm overflow-hidden">
        {/* Desktop View Table */}
        <div className="hidden md:block overflow-x-auto whitespace-nowrap scrollbar-hide">
          <table className="w-full text-right min-w-max">
            <thead className="bg-surface-muted border-b border-border text-content-muted">
              <tr>
                <th className="p-4 font-medium">{t('pos.invoice_no')}</th>
                <th className="p-4 font-medium">{t('common.customer')}</th>
                <th className="p-4 font-medium">{t('common.date')}</th>
                <th className="p-4 font-medium">{t('pos.total')}</th>
                <th className="p-4 font-medium">{t('common.status')}</th>
                <th className="p-4 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {orders.map(order => (
                <tr key={order.id} className="hover:bg-surface-muted/50 transition-colors">
                  <td className="p-4 font-medium text-content">#{order.orderNumber || order.id.slice(-6).toUpperCase()}</td>
                  <td className="p-4 text-content-muted">
                    <div className="flex items-center gap-2">
                      {order.customerName}
                      {order.isB2B && (
                         <span className="bg-brand/10 text-brand px-2 py-0.5 rounded-lg text-[10px] font-black uppercase">B2B</span>
                      )}
                    </div>
                  </td>
                  <td className="p-4 text-content-muted">
                    <DateTimeDisplay date={order.orderDate} showTime={true} />
                  </td>
                  <td className="p-4 font-bold text-brand"><PriceDisplay amount={order.totalAmount} /></td>
                  <td className="p-4">
                    <span className={cn(
                      "px-2 py-1 rounded-md text-xs font-bold",
                      order.status === 'delivered' ? "bg-success/10 text-success" : "bg-brand/10 text-brand"
                    )}>
                      {order.status === 'delivered' ? t('pos.delivered') : t('pos.pending')}
                    </span>
                  </td>
                  <td className="p-4 text-left">
                    <button 
                      onClick={() => setSelectedOrder(order)}
                      className="p-2 text-content-muted hover:text-brand hover:bg-brand/5 rounded-lg transition-colors"
                    >
                      <Eye size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile View Cards */}
        <div className="md:hidden divide-y divide-border">
          {orders.map(order => (
            <div key={order.id} className="p-4 active:bg-surface-muted/50" onClick={() => setSelectedOrder(order)}>
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="text-xs font-bold text-content mb-1">#{order.orderNumber || order.id.slice(-6).toUpperCase()}</p>
                  <p className="font-bold text-content leading-tight">{order.customerName}</p>
                </div>
                <div className="text-left font-black text-brand">
                  <PriceDisplay amount={order.totalAmount} />
                </div>
              </div>
              <div className="flex justify-between items-center mt-3">
                <div className="flex gap-2">
                  <span className={cn(
                    "px-2 py-0.5 rounded text-[10px] font-bold",
                    order.status === 'delivered' ? "bg-success/10 text-success" : "bg-brand/10 text-brand"
                  )}>
                    {order.status === 'delivered' ? t('pos.delivered') : t('pos.pending')}
                  </span>
                  {order.isB2B && (
                    <span className="bg-brand/10 text-brand px-2 py-0.5 rounded text-[10px] font-black uppercase">B2B</span>
                  )}
                </div>
                <DateTimeDisplay date={order.orderDate} showTime={true} size="xs" />
              </div>
            </div>
          ))}
          {orders.length === 0 && (
            <div className="p-12 text-center text-content-muted">
              <FileText className="mx-auto mb-4 opacity-20" size={48} />
              <p>{t('pos.no_orders')}</p>
            </div>
          )}
        </div>
      </div>

      {/* Order Details Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-2 sm:p-4">
          <div className={cn(
            "bg-surface rounded-2xl md:rounded-[2rem] shadow-2xl flex flex-col max-h-[92vh] overflow-hidden transition-all duration-200",
            selectedOrder.isB2B ? "w-full max-w-3xl" : "w-full max-w-[92mm] sm:max-w-[100mm]"
          )}>
            <div className="p-4 sm:p-6 border-b border-border flex justify-between items-center shrink-0">
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="p-2.5 sm:p-3 bg-brand/10 text-brand rounded-xl sm:rounded-2xl">
                  <FileText className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div>
                  <h2 className="text-base sm:text-xl font-black text-content">{t('pos.order_details')} #{selectedOrder.orderNumber || selectedOrder.id.slice(-6).toUpperCase()}</h2>
                  <div className="mt-0.5">
                    <DateTimeDisplay date={selectedOrder.orderDate} showTime={true} size="xs" />
                  </div>
                </div>
              </div>
              <button onClick={() => setSelectedOrder(null)} className="p-2 hover:bg-surface-muted rounded-full transition-colors">
                <X className="w-5 h-5 sm:w-6 sm:h-6 text-content-muted" />
              </button>
            </div>

            {(() => {
              const sellerInfo = {
                name: (selectedOrder as any).sellerName || 'المنشأة',
                vatNumber: (selectedOrder as any).sellerTRN || '000000000000000',
                address: 'المملكة العربية السعودية',
                phone: '',
                logoUrl: '',
              };

              const formattedItems = (selectedOrder.items || []).map((item: any) => ({
                name: item.type === 'custom' ? item.garmentType || t('orders.custom_thobe', 'تفصيل ثوب') : item.name || t('orders.ready_made', 'صنف جاهز'),
                quantity: Number(item.quantity || 0),
                unitPrice: Number(item.price || item.unitPrice || 0),
                vatAmount: Number((item.price || item.unitPrice || 0) * item.quantity - ((item.price || item.unitPrice || 0) * item.quantity) / 1.15),
                total: Number((item.price || item.unitPrice || 0) * item.quantity)
              }));

              const subtotalExcVat = selectedOrder.totalAmount / 1.15;
              const vatAmt = selectedOrder.totalAmount - subtotalExcVat;

              const totals = {
                subtotal: subtotalExcVat,
                discount: selectedOrder.discountAmount || 0,
                taxableAmount: subtotalExcVat,
                vatAmount: vatAmt,
                grandTotal: selectedOrder.totalAmount,
                paidAmount: selectedOrder.paidAmount,
                remainingAmount: selectedOrder.totalAmount - selectedOrder.paidAmount
              };

              const qrCodeBase64 = selectedOrder.qrCode || generateZatcaQR(
                sellerInfo.name,
                sellerInfo.vatNumber,
                new Date(selectedOrder.orderDate).toISOString(),
                selectedOrder.totalAmount.toFixed(2),
                vatAmt.toFixed(2)
              );

              const invNumber = String(selectedOrder.orderNumber || selectedOrder.id.slice(0, 8));

              return (
                <div className="flex-1 overflow-auto p-4 sm:p-8 flex justify-center bg-gray-50 print:bg-white print:p-2 print:px-3 print:overflow-visible print:max-h-none" id="sales-record-print-area">
                  {selectedOrder.isB2B ? (
                    <TaxInvoice
                      invoiceNumber={invNumber}
                      issueDate={selectedOrder.orderDate}
                      supplyDate={selectedOrder.orderDate}
                      paymentMethod={
                        (selectedOrder.paymentMethod as any) === 'network' || (selectedOrder.paymentMethod as any) === 'card' ? 'شبكة / بطاقة' :
                        selectedOrder.paymentMethod === 'bank_transfer' ? 'تحويل بنكي' :
                        selectedOrder.paymentMethod === 'partial' ? 'آجل / دفع جزئي' :
                        selectedOrder.paymentMethod === 'cash_on_delivery' ? 'الدفع عند الاستلام' : 'نقدي'
                      }
                      seller={sellerInfo}
                      buyer={{
                        name: selectedOrder.b2bCompanyName || selectedOrder.customerName,
                        vatNumber: selectedOrder.b2bTRN
                      }}
                      items={formattedItems}
                      totals={totals}
                      qrCodeBase64={qrCodeBase64}
                      hidePrintButton={true}
                    />
                  ) : (
                    <SimplifiedTaxInvoice
                      invoiceNumber={invNumber}
                      issueDate={selectedOrder.orderDate}
                      paymentMethod={
                        (selectedOrder.paymentMethod as any) === 'network' || (selectedOrder.paymentMethod as any) === 'card' ? 'شبكة / بطاقة' :
                        selectedOrder.paymentMethod === 'bank_transfer' ? 'تحويل بنكي' :
                        selectedOrder.paymentMethod === 'partial' ? 'آجل / دفع جزئي' :
                        selectedOrder.paymentMethod === 'cash_on_delivery' ? 'الدفع عند الاستلام' : 'نقدي'
                      }
                      seller={sellerInfo}
                      customerName={selectedOrder.customerName || t('tax_invoices.walk_in_customer', 'عميل نقدي / Guest Customer')}
                      items={formattedItems}
                      totals={totals}
                      qrCodeBase64={qrCodeBase64}
                      hidePrintButton={true}
                      sellerName={selectedOrder.createdBy || 'النظام'}
                    />
                  )}
                </div>
              );
            })()}

            <div className="p-4 bg-surface-muted border-t border-border flex flex-wrap gap-2.5 shrink-0 mt-auto print:hidden">
              <button 
                onClick={handleDownloadPDF}
                className="flex-1 min-w-[110px] bg-brand text-white py-2.5 px-3 rounded-xl font-bold text-xs shadow-md hover:bg-brand/90 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Download size={16} />
                {t('sales_record.download_pdf', 'تحميل PDF')}
              </button>
              <button 
                onClick={handleShareWhatsApp}
                className="flex-1 min-w-[110px] bg-[#25D366] text-white py-2.5 px-3 rounded-xl font-bold text-xs shadow-md hover:bg-[#20ba56] transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Share2 size={16} />
                {t('sales_record.whatsapp', 'واتساب')}
              </button>
              <button 
                onClick={handlePrint}
                className="flex-1 min-w-[90px] bg-slate-600 text-white py-2.5 px-3 rounded-xl font-bold text-xs shadow-md hover:bg-slate-700 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Printer size={16} />
                {t('tax_invoices.print', 'طباعة')}
              </button>
              <button 
                onClick={() => setSelectedOrder(null)}
                className="px-4 bg-surface text-content-muted border border-border py-2.5 rounded-xl font-bold hover:bg-surface-muted transition-all text-xs cursor-pointer"
              >
                {t('common.close', 'إغلاق')}
              </button>
            </div>

            {/*
              قواعد احتياطية فقط (تُستخدم إن فشل محرك الطباعة الموحّد).
              أُزيل منها `height: 100%` — كان يُجبر الفاتورة على ملء ارتفاع
              الورقة فيظهر فراغ كبير أسفلها، وأُضيف هامش @page صريح بدل
              هوامش المتصفح الافتراضية الكبيرة.
            */}
            <style dangerouslySetInnerHTML={{ __html: `
              @media print {
                @page {
                  size: A4;
                  margin: 8mm;
                }
                body * {
                  visibility: hidden;
                }
                #sales-record-print-area, #sales-record-print-area * {
                  visibility: visible;
                }
                #sales-record-print-area {
                  position: absolute;
                  left: 0;
                  top: 0;
                  width: 100%;
                  max-width: 100%;
                  height: auto !important;
                  min-height: 0 !important;
                  max-height: none !important;
                  overflow: visible !important;
                  padding: 0 !important;
                  margin: 0 !important;
                  background-color: white !important;
                }
                .print\\:hidden {
                  display: none !important;
                }
              }
            `}} />
          </div>
        </div>
      )}
    </div>
  );
}
