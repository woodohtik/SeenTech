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

export default function SalesRecord({ tenantId, shiftId, filterStatus }: { tenantId: string, shiftId?: string, filterStatus?: string }) {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar' || i18n.language === 'ur';

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
      let query = supabase
        .from('orders')
        .select('*')
        .eq('tenant_id', tenantId);
      
      if (shiftId) {
        query = query.eq('shift_id', shiftId);
      }
      
      if (filterStatus) {
        query = query.eq('status', filterStatus);
      }

      const { data, error: fetchError } = await query.order('created_at', { ascending: false });
      
      if (fetchError) throw fetchError;

      const mappedOrders = data ? data.map(d => {
        const b2bMeta = decodeOrderB2BNotes(d.notes);
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
          createdBy: d.created_by,
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
    <div className="p-4 md:p-6 font-sans">
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
                  <td className="p-4 text-content-muted" dir="ltr">{new Date(order.orderDate).toLocaleString(i18n.language === 'ar' ? 'ar-SA-u-nu-latn' : (i18n.language === 'ur' ? 'ur-PK-u-nu-latn' : 'en-US'))}</td>
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
                <span className="text-[10px] text-content-muted" dir="ltr">{new Date(order.orderDate).toLocaleDateString(i18n.language === 'ar' ? 'ar-SA-u-nu-latn' : (i18n.language === 'ur' ? 'ur-PK-u-nu-latn' : 'en-US'))}</span>
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
          <div className="bg-surface w-full max-w-3xl rounded-2xl md:rounded-[2rem] shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
            <div className="p-4 sm:p-6 border-b border-border flex justify-between items-center shrink-0">
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="p-2.5 sm:p-3 bg-brand/10 text-brand rounded-xl sm:rounded-2xl">
                  <FileText className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div>
                  <h2 className="text-base sm:text-xl font-black text-content">{t('pos.order_details')} #{selectedOrder.orderNumber || selectedOrder.id.slice(-6).toUpperCase()}</h2>
                  <p className="text-[10px] sm:text-xs text-content-muted font-bold uppercase tracking-widest">{new Date(selectedOrder.orderDate).toLocaleString(i18n.language === 'ar' ? 'ar-SA-u-nu-latn' : (i18n.language === 'ur' ? 'ur-PK-u-nu-latn' : 'en-US'))}</p>
                </div>
              </div>
              <button onClick={() => setSelectedOrder(null)} className="p-2 hover:bg-surface-muted rounded-full transition-colors">
                <X className="w-5 h-5 sm:w-6 sm:h-6 text-content-muted" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4 sm:p-8 space-y-6 sm:space-y-8" id="sales-record-print-area">
              {/* Customer & Info Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
                <div className="bg-surface-muted p-4 rounded-xl sm:rounded-2xl border border-border">
                  <div className="flex items-center gap-3 mb-2 text-content-muted">
                    <User size={16} />
                    <span className="text-xs font-bold uppercase tracking-tighter">{t('common.customer')}</span>
                  </div>
                  <p className="font-bold text-content text-sm sm:text-base">
                    {selectedOrder.isB2B ? selectedOrder.b2bCompanyName : selectedOrder.customerName}
                    {selectedOrder.isB2B && (
                       <span className="bg-brand/10 text-brand px-2 py-0.5 rounded-lg text-[10px] font-black uppercase ms-2">B2B</span>
                    )}
                  </p>
                  {selectedOrder.isB2B && (
                    <p className="text-xs text-content-muted mt-1 font-mono">{selectedOrder.b2bTRN}</p>
                  )}
                </div>
                <div className="bg-surface-muted p-4 rounded-xl sm:rounded-2xl border border-border">
                  <div className="flex items-center gap-3 mb-2 text-content-muted">
                    <CreditCard size={16} />
                    <span className="text-xs font-bold uppercase tracking-tighter">{t('pos.payment_method')}</span>
                  </div>
                  <p className="font-bold text-content text-sm sm:text-base">
                    {selectedOrder.paymentMethod === 'cash' ? t('pos.cash') : 
                     selectedOrder.paymentMethod === 'network' ? t('pos.card') : 
                     selectedOrder.paymentMethod === 'partial' ? t('pos.partial') : 
                     selectedOrder.paymentMethod === 'bank_transfer' ? t('pos.bank_transfer') : t('pos.other')}
                  </p>
                </div>
                <div className="bg-surface-muted p-4 rounded-xl sm:rounded-2xl border border-border">
                  <div className="flex items-center gap-3 mb-2 text-content-muted">
                    <ShoppingBag size={16} />
                    <span className="text-xs font-bold uppercase tracking-tighter">{t('pos.order_status')}</span>
                  </div>
                  <p className="font-bold text-brand text-sm sm:text-base">
                    {selectedOrder.status === 'delivered' ? t('pos.delivered') : t('pos.pending')}
                  </p>
                </div>
              </div>

              {/* Items Table */}
              <div className="space-y-4">
                <h3 className="text-sm font-black text-content uppercase tracking-widest flex items-center gap-2">
                  <Package size={18} className="text-brand" />
                  {t('pos.products_services')}
                </h3>
                <div className="border border-border rounded-xl sm:rounded-3xl overflow-x-auto whitespace-nowrap">
                  <table className="w-full text-right min-w-max">
                    <thead className="bg-surface-muted text-content-muted text-[10px] font-black uppercase tracking-widest">
                      <tr>
                        <th className="p-3 sm:p-4">{t('pos.item')}</th>
                        <th className="p-3 sm:p-4">{t('inventory.quantity')}</th>
                        <th className="p-3 sm:p-4">{t('pos.price')}</th>
                        <th className="p-3 sm:p-4">{t('pos.total')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {selectedOrder.items.map((item, idx) => (
                        <tr key={idx}>
                          <td className="p-3 sm:p-4">
                            <div className="flex items-center gap-3">
                              {item.image ? (
                                <img 
                                  src={item.image} 
                                  alt="" 
                                  className="w-10 h-10 rounded-lg object-cover border border-border"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded-lg bg-surface-muted flex items-center justify-center text-content-muted">
                                  {item.type === 'custom' ? <Scissors size={20} /> : <Package size={20} />}
                                </div>
                              )}
                              <div>
                                <p className="font-bold text-content text-sm">{item.type === 'custom' ? item.garmentType : item.name}</p>
                                <p className="text-[10px] text-content-muted font-bold uppercase">{item.type === 'custom' ? t('pos.tailoring') : t('pos.ready_made')}</p>
                              </div>
                            </div>
                          </td>
                          <td className="p-3 sm:p-4 text-content-muted font-bold text-sm">{item.quantity}</td>
                          <td className="p-3 sm:p-4 text-content-muted text-sm"><PriceDisplay amount={item.price} /></td>
                          <td className="p-3 sm:p-4 font-bold text-content text-sm"><PriceDisplay amount={item.price * item.quantity} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Summary */}
              <div className="flex justify-end pt-4 border-t border-border">
                <div className="w-full max-w-xs space-y-3">
                  <div className="flex justify-between items-center text-content-muted font-medium text-sm">
                    <span>{t('pos.subtotal')}</span>
                    <span><PriceDisplay amount={selectedOrder.totalAmount} /></span>
                  </div>
                  <div className="flex justify-between items-center font-black text-content pt-3 border-t-2 border-brand/20 text-base sm:text-lg">
                    <span>{t('pos.total')}</span>
                    <span className="text-brand text-xl sm:text-2xl"><PriceDisplay amount={selectedOrder.totalAmount} /></span>
                  </div>
                  <div className="flex justify-between items-center text-xs sm:text-sm font-bold pt-1">
                    <span className="text-content-muted">{t('pos.paid_amount')}</span>
                    <span className="text-success"><PriceDisplay amount={selectedOrder.paidAmount} /></span>
                  </div>
                  <div className="flex justify-between items-center text-xs sm:text-sm font-bold">
                    <span className="text-content-muted">{t('pos.remaining_amount')}</span>
                    <span className="text-danger"><PriceDisplay amount={selectedOrder.totalAmount - selectedOrder.paidAmount} /></span>
                  </div>
                </div>
              </div>
            </div>

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
                onClick={() => window.print()}
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

            <style dangerouslySetInnerHTML={{ __html: `
              @media print {
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
                  height: 100%;
                  padding: 0;
                  margin: 0;
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
