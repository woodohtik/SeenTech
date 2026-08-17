import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase/client';
import { handleError, OperationType, getFriendlyErrorMessage } from '../lib/firebase';
import { Order } from '../types';
import { cn, getCurrencySymbol } from '../lib/utils';
import { decodeOrderB2BNotes } from '../utils/b2bHelper';
import { decodeOrderRow } from '../utils/orderHistoryHelper';
import { PriceDisplay } from './PriceDisplay';
import { FileText, Eye, X, Download, Package, Scissors, User, Calendar, CreditCard, ShoppingBag, Clock, Printer, Share2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { downloadInvoicePDF } from '../utils/pdfGenerator';
import SimplifiedTaxInvoice from './printing/SimplifiedTaxInvoice';
import TaxInvoice from './printing/TaxInvoice';
import DateTimeDisplay from './DateTimeDisplay';
import { generateZatcaQR } from '../services/zatcaService';
import { useToast } from '../contexts/ToastContext';
import WhatsAppPhoneModal from './ui/WhatsAppPhoneModal';
import { formatSaudiPhone } from '../utils/phoneUtils';

import { isRtlLang } from '../lib/direction';

export default function SalesRecord({ tenantId, shiftId, filterStatus }: { tenantId: string, shiftId?: string, filterStatus?: string }) {
  const { t, i18n } = useTranslation();
  const isRtl = isRtlLang(i18n.language);
  const { error: toastError } = useToast();

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [tenantInfo, setTenantInfo] = useState<{ name: string; vat_number: string; address?: string; phone?: string } | null>(null);
  const [whatsappModalOpen, setWhatsappModalOpen] = useState(false);

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
        title: t('printing.invoice_document_title', { number: selectedOrder.orderNumber || selectedOrder.id.slice(-6).toUpperCase() }),
      });
      if (!res.ok) {
        // مع الطباعة الصامتة قد لا تُفتح نافذة طباعة، فلا بد من إشعار مرئي
        console.error('[SalesRecord] فشل الطباعة:', res.message);
        toastError(t('printing.print_failed'), res.message);
      }
    } catch (e) {
      console.error('[SalesRecord] خطأ الطباعة:', e);
      window.print();
    }
  };

  const buildWhatsAppInvoiceText = (order: Order) => {
    const paymentMethodText = order.paymentMethod === 'cash' ? t('pos.cash') :
                          order.paymentMethod === 'network' ? t('pos.card') :
                          order.paymentMethod === 'partial' ? t('pos.partial') :
                          order.paymentMethod === 'bank_transfer' ? t('pos.bank_transfer') : t('pos.other');
    const statusText = getStatusBadge(order.status).label;

    return t('sales_record.whatsapp_invoice_message', {
      invoiceNumber: order.invoiceNumber || order.orderNumber || order.id.slice(-6).toUpperCase(),
      total: order.totalAmount,
      currency: getCurrencySymbol(),
      method: paymentMethodText,
      status: statusText
    });
  };

  const handleShareWhatsApp = () => {
    if (!selectedOrder) return;
    // Known customer phone -> send straight to WhatsApp, no extra step.
    // Only prompt for a number when the order has none on file.
    const knownPhone = selectedOrder.customerPhone ? formatSaudiPhone(selectedOrder.customerPhone).replace('+', '') : '';
    if (knownPhone) {
      proceedToWhatsApp(knownPhone);
      return;
    }
    setWhatsappModalOpen(true);
  };

  const proceedToWhatsApp = (phone: string) => {
    if (!selectedOrder) return;
    const text = buildWhatsAppInvoiceText(selectedOrder);
    window.open(`https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(text)}`, '_blank');
    setWhatsappModalOpen(false);
  };

  const fetchOrders = async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: staffData }, { data: ordersData, error: fetchError }, { data: tenantData }, { data: invoicesData }] = await Promise.all([
        supabase.from('staff').select('id, name'),
        (() => {
          let query = supabase.from('orders').select('*').eq('tenant_id', tenantId);
          if (shiftId) query = query.eq('shift_id', shiftId);
          if (filterStatus) query = query.eq('status', filterStatus);
          return query.order('created_at', { ascending: false });
        })(),
        supabase.from('tenants').select('name, vat_number, address, phone').eq('id', tenantId).maybeSingle(),
        // Real ZATCA-sequential invoice numbers, keyed by order_id -- distinct
        // from orderNumber (a friendly reference, not the legal invoice number).
        supabase.from('tax_invoices').select('order_id, invoice_number').eq('tenant_id', tenantId)
      ]);

      if (fetchError) throw fetchError;

      const staffMap: Record<string, string> = {};
      if (staffData) {
        staffData.forEach(s => {
          if (s.id && s.name) staffMap[s.id] = s.name;
        });
      }

      const invoiceNumberMap: Record<string, string> = {};
      if (invoicesData) {
        invoicesData.forEach(inv => {
          if (inv.order_id && inv.invoice_number) invoiceNumberMap[inv.order_id] = inv.invoice_number;
        });
      }

      if (tenantData) {
        setTenantInfo(tenantData);
      }

      const mappedOrders = ordersData ? ordersData.map(d => {
        const decoded = decodeOrderRow(d);
        const b2bMeta = decodeOrderB2BNotes(decoded.notes);
        const resolvedCreator = decoded.seller_name ||
          decoded.sellerName ||
          decoded.staff_name ||
          decoded.cashier_name ||
          (decoded.created_by && staffMap[decoded.created_by] ? staffMap[decoded.created_by] : decoded.created_by) ||
          t('common.system');

        return {
          ...decoded,
          orderNumber: decoded.order_number || decoded.orderNumber,
          invoiceNumber: invoiceNumberMap[decoded.id],
          customerId: decoded.customer_id || decoded.customerId,
          customerName: decoded.customer_name || decoded.customerName,
          customerPhone: decoded.customer_phone || decoded.customerPhone,
          tenantId: decoded.tenant_id || decoded.tenantId,
          shiftId: decoded.shift_id || decoded.shiftId,
          subtotalAmount: decoded.subtotal_amount || decoded.subtotalAmount,
          totalAmount: decoded.total_amount || decoded.totalAmount,
          paidAmount: decoded.paid_amount || decoded.paidAmount,
          discountAmount: decoded.discount_amount || decoded.discountAmount,
          remainingAmount: decoded.remaining_amount || decoded.remainingAmount,
          paymentMethod: decoded.payment_method || decoded.paymentMethod,
          orderDate: decoded.order_date || decoded.orderDate,
          deliveryDate: decoded.delivery_date || decoded.deliveryDate,
          createdBy: resolvedCreator,
          taxAmount: decoded.tax_amount || decoded.taxAmount,
          taxRate: decoded.tax_rate || decoded.taxRate,
          isB2B: b2bMeta.isB2B,
          b2bCompanyName: b2bMeta.b2bCompanyName,
          b2bTRN: b2bMeta.b2bTRN,
          notes: b2bMeta.originalNotes || decoded.notes,
          qrCode: decoded.qr_code || decoded.qrCode,
          items: decoded.items || [],
          history: decoded.history || [],
          createdAt: decoded.created_at || decoded.createdAt,
          updatedAt: decoded.updated_at || decoded.updatedAt
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

  const getStatusBadge = (status?: string) => {
    if (status === 'delivered') return { label: t('pos.delivered'), className: 'bg-success/10 text-success' };
    // A returned order is set to 'cancelled' -- falling through to the
    // generic "pending" bucket below made every returned invoice in the
    // Returns Record list misleadingly show as still awaiting processing.
    if (status === 'cancelled') return { label: t('common.status_cancelled'), className: 'bg-danger/10 text-danger' };
    return { label: t('pos.pending'), className: 'bg-brand/10 text-brand' };
  };

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
                <th className="p-4 font-medium">{t('tax_invoices.invoice_type')}</th>
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
                  <td className="p-4 text-content-muted">{order.customerName}</td>
                  <td className="p-4">
                    <span className={cn(
                      "px-2 py-1 rounded-lg text-[10px] font-black whitespace-nowrap",
                      order.isB2B ? "bg-brand/10 text-brand" : "bg-surface-muted text-content-muted"
                    )}>
                      {order.isB2B ? t('tax_invoices.b2b_label') : t('tax_invoices.b2c_label')}
                    </span>
                  </td>
                  <td className="p-4 text-content-muted">
                    <DateTimeDisplay date={order.orderDate} showTime={true} />
                  </td>
                  <td className="p-4 font-bold text-brand"><PriceDisplay amount={order.totalAmount} /></td>
                  <td className="p-4">
                    <span className={cn(
                      "px-2 py-1 rounded-md text-xs font-bold",
                      getStatusBadge(order.status).className
                    )}>
                      {getStatusBadge(order.status).label}
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
                    getStatusBadge(order.status).className
                  )}>
                    {getStatusBadge(order.status).label}
                  </span>
                  <span className={cn(
                    "px-2 py-0.5 rounded text-[10px] font-black whitespace-nowrap",
                    order.isB2B ? "bg-brand/10 text-brand" : "bg-surface-muted text-content-muted"
                  )}>
                    {order.isB2B ? t('tax_invoices.b2b_label') : t('tax_invoices.b2c_label')}
                  </span>
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
                name: (selectedOrder as any).sellerName || tenantInfo?.name || 'المنشأة',
                vatNumber: (selectedOrder as any).sellerTRN || tenantInfo?.vat_number || '000000000000000',
                address: tenantInfo?.address || 'المملكة العربية السعودية',
                phone: tenantInfo?.phone || '',
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

              const invNumber = selectedOrder.invoiceNumber || String(selectedOrder.orderNumber || selectedOrder.id.slice(0, 8));

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
                      sellerName={selectedOrder.createdBy || t('common.system')}
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

      {whatsappModalOpen && selectedOrder && (
        <WhatsAppPhoneModal
          onClose={() => setWhatsappModalOpen(false)}
          onConfirm={proceedToWhatsApp}
          defaultPhone={selectedOrder.customerPhone}
          title={t('sales_record.whatsapp_modal_title', 'إرسال الفاتورة عبر واتساب')}
          description={t('sales_record.whatsapp_modal_desc', 'أدخل رقم جوال العميل لفتح واتساب مع تفاصيل الفاتورة جاهزة للإرسال.')}
        />
      )}
    </div>
  );
}
