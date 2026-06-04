import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase/client';
import { handleError, OperationType, getFriendlyErrorMessage } from '../lib/firebase';
import { Order } from '../types';
import { cn } from '../lib/utils';
import { decodeOrderB2BNotes } from '../utils/b2bHelper';
import { PriceDisplay } from './PriceDisplay';
import { FileText, Eye, X, Download, Package, Scissors, User, Calendar, CreditCard, ShoppingBag, Clock, Printer, Share2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function SalesRecord({ tenantId, shiftId, filterStatus }: { tenantId: string, shiftId?: string, filterStatus?: string }) {
  const { t } = useTranslation();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const handleDownloadPDF = async () => {
    if (!selectedOrder) return;
    try {
      const { downloadInvoicePDF } = await import('../utils/pdfGenerator');
      await downloadInvoicePDF('sales-record-print-area', `Invoice-${selectedOrder.orderNumber || selectedOrder.id.slice(-6).toUpperCase()}.pdf`);
    } catch (e) {
      console.error(e);
    }
  };

  const handleShareWhatsApp = async () => {
    if (!selectedOrder) return;
    const paymentMethodText = selectedOrder.paymentMethod === 'cash' ? 'نقدي' : 
                          selectedOrder.paymentMethod === 'network' ? 'شبكة / مدى' : 
                          selectedOrder.paymentMethod === 'partial' ? 'جزئي' : 
                          selectedOrder.paymentMethod === 'bank_transfer' ? 'تحويل بنكي' : 'أخرى';
    const statusText = selectedOrder.status === 'delivered' ? 'مكتمل / تم التسليم' : 'قيد المعالجة / الانتظار';
    const text = `السلام عليكم ورحمة الله وبركاته،\nتفاصيل الفاتورة من المتجر:\nرقم الفاتورة: #${selectedOrder.orderNumber || selectedOrder.id.slice(-6).toUpperCase()}\nالإجمالي: ${selectedOrder.totalAmount} ر.س\nطريقة الدفع: ${paymentMethodText}\nحالة الطلب: ${statusText}\nشكراً لتواصلك معنا!`;
    try {
      const { shareInvoiceAsPDFFile } = await import('../utils/pdfGenerator');
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
      <div className="p-6 font-sans flex flex-col items-center justify-center h-64 text-center bg-surface border border-border rounded-2xl max-w-md mx-auto my-12 shadow-sm animate-fade-in" dir="rtl">
        <div className="w-12 h-12 bg-red-50 text-red-500 rounded-full flex items-center justify-center mb-4 font-black text-xl">⚠️</div>
        <h3 className="text-sm font-black text-content mb-2">فشل تحميل سجل المبيعات</h3>
        <p className="text-xs text-content-muted mb-4 font-bold max-w-[280px] leading-relaxed">{error}</p>
        <button
          onClick={fetchOrders}
          className="px-5 py-2 bg-brand text-white text-xs font-black rounded-xl hover:bg-brand/90 transition-colors shadow-md shadow-brand/10 cursor-pointer"
        >
          إعادة المحاولة
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 font-sans">
      <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden">
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
                  <td className="p-4 text-content-muted" dir="ltr">{new Date(order.orderDate).toLocaleString('ar-SA')}</td>
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
                <span className="text-[10px] text-content-muted" dir="ltr">{new Date(order.orderDate).toLocaleDateString('ar-SA')}</span>
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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-surface w-full max-w-3xl rounded-[2rem] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
            <div className="p-6 border-b border-border flex justify-between items-center shrink-0">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-brand/10 text-brand rounded-2xl">
                  <FileText size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-black text-content">{t('pos.order_details')} #{selectedOrder.orderNumber || selectedOrder.id.slice(-6).toUpperCase()}</h2>
                  <p className="text-xs text-content-muted font-bold uppercase tracking-widest">{new Date(selectedOrder.orderDate).toLocaleString('ar-SA')}</p>
                </div>
              </div>
              <button onClick={() => setSelectedOrder(null)} className="p-2 hover:bg-surface-muted rounded-full transition-colors">
                <X size={24} className="text-content-muted" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-8 space-y-8" id="sales-record-print-area">
              {/* Customer & Info Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-surface-muted p-4 rounded-2xl border border-border">
                  <div className="flex items-center gap-3 mb-2 text-content-muted">
                    <User size={16} />
                    <span className="text-xs font-bold uppercase tracking-tighter">{t('common.customer')}</span>
                  </div>
                  <p className="font-bold text-content">
                    {selectedOrder.isB2B ? selectedOrder.b2bCompanyName : selectedOrder.customerName}
                    {selectedOrder.isB2B && (
                       <span className="bg-brand/10 text-brand px-2 py-0.5 rounded-lg text-[10px] font-black uppercase ms-2">B2B</span>
                    )}
                  </p>
                  {selectedOrder.isB2B && (
                    <p className="text-xs text-content-muted mt-1 font-mono">{selectedOrder.b2bTRN}</p>
                  )}
                </div>
                <div className="bg-surface-muted p-4 rounded-2xl border border-border">
                  <div className="flex items-center gap-3 mb-2 text-content-muted">
                    <CreditCard size={16} />
                    <span className="text-xs font-bold uppercase tracking-tighter">{t('pos.payment_method')}</span>
                  </div>
                  <p className="font-bold text-content">
                    {selectedOrder.paymentMethod === 'cash' ? t('pos.cash') : 
                     selectedOrder.paymentMethod === 'network' ? t('pos.card') : 
                     selectedOrder.paymentMethod === 'partial' ? t('pos.partial') : 
                     selectedOrder.paymentMethod === 'bank_transfer' ? t('pos.bank_transfer') : t('pos.other')}
                  </p>
                </div>
                <div className="bg-surface-muted p-4 rounded-2xl border border-border">
                  <div className="flex items-center gap-3 mb-2 text-content-muted">
                    <ShoppingBag size={16} />
                    <span className="text-xs font-bold uppercase tracking-tighter">{t('pos.order_status')}</span>
                  </div>
                  <p className="font-bold text-brand">
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
                <div className="border border-border rounded-3xl overflow-x-auto whitespace-nowrap">
                  <table className="w-full text-right min-w-max">
                    <thead className="bg-surface-muted text-content-muted text-[10px] font-black uppercase tracking-widest">
                      <tr>
                        <th className="p-4">{t('pos.item')}</th>
                        <th className="p-4">{t('inventory.quantity')}</th>
                        <th className="p-4">{t('pos.price')}</th>
                        <th className="p-4">{t('pos.total')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {selectedOrder.items.map((item, idx) => (
                        <tr key={idx}>
                          <td className="p-4">
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
                                <p className="font-bold text-content">{item.type === 'custom' ? item.garmentType : item.name}</p>
                                <p className="text-[10px] text-content-muted font-bold uppercase">{item.type === 'custom' ? t('pos.tailoring') : t('pos.ready_made')}</p>
                              </div>
                            </div>
                          </td>
                          <td className="p-4 text-content-muted font-bold">{item.quantity}</td>
                          <td className="p-4 text-content-muted"><PriceDisplay amount={item.price} /></td>
                          <td className="p-4 font-bold text-content"><PriceDisplay amount={item.price * item.quantity} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Summary */}
              <div className="flex justify-end pt-4 border-t border-border">
                <div className="w-full max-w-xs space-y-3">
                  <div className="flex justify-between items-center text-content-muted font-medium">
                    <span>{t('pos.subtotal')}</span>
                    <span><PriceDisplay amount={selectedOrder.totalAmount} /></span>
                  </div>
                  <div className="flex justify-between items-center text-lg font-black text-content pt-3 border-t-2 border-brand/20">
                    <span>{t('pos.total')}</span>
                    <span className="text-brand text-2xl"><PriceDisplay amount={selectedOrder.totalAmount} /></span>
                  </div>
                  <div className="flex justify-between items-center text-sm font-bold pt-2">
                    <span className="text-content-muted">{t('pos.paid_amount')}</span>
                    <span className="text-success"><PriceDisplay amount={selectedOrder.paidAmount} /></span>
                  </div>
                  <div className="flex justify-between items-center text-sm font-bold">
                    <span className="text-content-muted">{t('pos.remaining_amount')}</span>
                    <span className="text-danger"><PriceDisplay amount={selectedOrder.totalAmount - selectedOrder.paidAmount} /></span>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 bg-surface-muted border-t border-border flex flex-wrap gap-4 shrink-0 mt-auto print:hidden">
              <button 
                onClick={handleDownloadPDF}
                className="flex-1 min-w-[140px] bg-brand text-white py-3 px-4 rounded-xl font-bold text-sm shadow-md hover:bg-brand/90 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Download size={18} />
                تحميل PDF
              </button>
              <button 
                onClick={handleShareWhatsApp}
                className="flex-1 min-w-[140px] bg-[#25D366] text-white py-3 px-4 rounded-xl font-bold text-sm shadow-md hover:bg-[#20ba56] transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Share2 size={18} />
                مشاركة واتساب
              </button>
              <button 
                onClick={() => window.print()}
                className="flex-1 min-w-[120px] bg-slate-600 text-white py-3 px-4 rounded-xl font-bold text-sm shadow-md hover:bg-slate-700 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Printer size={18} />
                {t('tax_invoices.print', 'طباعة')}
              </button>
              <button 
                onClick={() => setSelectedOrder(null)}
                className="px-6 bg-surface text-content-muted border border-border py-3 rounded-xl font-bold hover:bg-surface-muted transition-all text-sm cursor-pointer"
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
