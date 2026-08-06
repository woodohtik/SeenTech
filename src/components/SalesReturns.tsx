import React, { useState } from 'react';
import { 
  Search, 
  RotateCcw, 
  CheckCircle2, 
  AlertTriangle, 
  User, 
  Calendar, 
  CreditCard, 
  ShoppingBag, 
  Building, 
  ChevronRight, 
  Coins, 
  Landmark, 
  Scissors, 
  Package 
} from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { useToast } from '../contexts/ToastContext';
import { Order } from '../types';
import { PriceDisplay } from './PriceDisplay';
import { useTranslation } from 'react-i18next';
import DateTimeDisplay from './DateTimeDisplay';
import { motion, AnimatePresence } from 'motion/react';
import { useStaff } from '../contexts/StaffContext';
import { decodeOrderRow } from '../utils/orderHistoryHelper';
import { adjustStock } from '../services/inventoryService';
import { logEmployeeAction } from '../services/employeeAuditService';
import { generateOrderNumber } from '../lib/utils';

export default function SalesReturns({ tenantId, shiftId }: { tenantId: string, shiftId?: string }) {
  const { t, i18n } = useTranslation();
  const { success: toastSuccess, error: toastError, handleError: globalHandleError } = useToast();
  const { currentStaff } = useStaff();
  const isRtl = i18n.language === 'ar' || i18n.language === 'ur';

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Order[]>([]);
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [refundMethod, setRefundMethod] = useState<'cash' | 'network' | 'bank_transfer'>('cash');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    setSearchResults([]);
    setOrder(null);
    try {
      // 1. Search customers by phone number first
      let customerIds: string[] = [];
      const trimmedQuery = searchQuery.trim();
      
      const { data: customersData, error: custError } = await supabase
        .from('customers')
        .select('id')
        .eq('tenant_id', tenantId)
        .like('phone', `%${trimmedQuery}%`);
      
      if (!custError && customersData) {
        customerIds = customersData.map(c => c.id);
      }

      // 2. Query orders for the tenant
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('order_date', { ascending: false });
      
      if (error) throw error;

      // 3. Filter orders matching invoice identifier OR matching customer IDs
      const matchedOrders = (data || []).filter(d => {
        const matchesInvoice = (
          d.id.includes(trimmedQuery) || 
          d.id.slice(-6).toUpperCase() === trimmedQuery.toUpperCase() ||
          d.order_number?.toString() === trimmedQuery
        );
        const matchesCustomer = d.customer_id && customerIds.includes(d.customer_id);
        return matchesInvoice || matchesCustomer;
      }).map(foundDoc => {
        const decoded = decodeOrderRow(foundDoc);
        return {
          ...decoded,
          orderNumber: decoded.order_number ?? decoded.orderNumber,
          customerId: decoded.customer_id ?? decoded.customerId,
          customerName: decoded.customer_name ?? decoded.customerName,
          tenantId: decoded.tenant_id ?? decoded.tenantId,
          branchId: decoded.branch_id ?? decoded.branchId,
          shiftId: decoded.shift_id ?? decoded.shiftId,
          totalAmount: decoded.total_amount ?? decoded.totalAmount,
          paidAmount: decoded.paid_amount ?? decoded.paidAmount,
          remainingAmount: decoded.remaining_amount ?? decoded.remainingAmount,
          paymentMethod: decoded.payment_method ?? decoded.paymentMethod,
          orderDate: decoded.order_date ?? decoded.orderDate,
          deliveryDate: decoded.delivery_date ?? decoded.deliveryDate,
          createdBy: decoded.created_by ?? decoded.createdBy,
          createdAt: decoded.created_at ?? decoded.createdAt,
          updatedAt: decoded.updated_at ?? decoded.updatedAt,
          items: Array.isArray(decoded.items) ? decoded.items : []
        } as Order;
      });

      if (matchedOrders.length === 0) {
        toastError(t('sales_returns.invoice_not_found', 'لم يتم العثور على أي فواتير تطابق البحث'));
      } else if (matchedOrders.length === 1) {
        setOrder(matchedOrders[0]);
      } else {
        setSearchResults(matchedOrders);
      }
    } catch (error) {
      globalHandleError(error, 'orders');
    } finally {
      setLoading(false);
    }
  };

  const handleReturn = async () => {
    if (!order) return;
    
    setIsSubmitting(true);
    try {
      const historyEntry = {
        status: 'cancelled',
        updatedAt: new Date().toISOString(),
        updatedBy: currentStaff?.name || t('common.roles.owner', 'المالك'),
        notes: `تم إرجاع الفاتورة. طريقة الاسترجاع: ${
          refundMethod === 'cash' ? 'نقداً' : refundMethod === 'network' ? 'شبكة' : 'تحويل بنكي'
        }. سبب الإرجاع: ${returnReason || 'لا يوجد'}`
      };

      // 1. Find or resolve tax_invoice for this order to get invoice_id
      const { data: invoiceData } = await supabase
        .from('tax_invoices')
        .select('id, invoice_number')
        .eq('order_id', order.id)
        .maybeSingle();

      const invoiceId = invoiceData?.id || order.id;

      // 2. Insert into sales_returns
      const salesReturnId = crypto.randomUUID();
      const returnNumber = `RET-${generateOrderNumber()}`;
      const { error: returnError } = await supabase
        .from('sales_returns')
        .insert({
          id: salesReturnId,
          tenant_id: tenantId,
          invoice_id: invoiceId,
          order_id: order.id,
          return_number: returnNumber,
          status: 'completed',
          reason: returnReason || null,
          total_amount: refundTotalAmount,
          refunded_amount: refundTotalAmount,
          refund_method: refundMethod,
          processed_by: currentStaff?.id || null,
          returned_at: new Date().toISOString(),
          created_at: new Date().toISOString()
        });

      if (returnError) throw returnError;

      // 3. For each ready_made item, return quantity back to stock
      for (const item of readyMadeItems) {
        if (item.itemId) {
          const branchId = order.branchId || currentStaff?.branchId;
          if (branchId) {
            await adjustStock({
              branchId,
              itemId: item.itemId,
              quantity: Number(item.quantity || 0), // positive quantity increment
              reason: `مرتجع مبيعات - إرجاع فاتورة ${order.orderNumber || order.id}`,
              type: 'in', // restock
              staffId: currentStaff?.id || null,
              tenantId
            });

            // Log returned item
            await supabase
              .from('sales_return_items')
              .insert({
                id: crypto.randomUUID(),
                tenant_id: tenantId,
                return_id: salesReturnId,
                order_item_id: item.id || null,
                item_id: item.itemId,
                name: item.name || 'منتج جاهز',
                quantity: Number(item.quantity || 0),
                unit_price: Number(item.price || 0),
                total: Number(item.quantity || 0) * Number(item.price || 0)
              });
          }
        }
      }

      // 4. Update the order row to cancelled
      const { error: orderUpdateError } = await supabase
        .from('orders')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString(),
          items: order.items || [],
          history: [...(order.history || []), historyEntry]
        })
        .eq('id', order.id);

      if (orderUpdateError) throw orderUpdateError;

      // 5. Audit trail
      await logEmployeeAction(
        tenantId,
        currentStaff?.id || 'system',
        currentStaff?.name || 'System',
        'create_sales_return',
        `تم عمل مرتجع للفاتورة #${order.orderNumber || order.id.slice(-6).toUpperCase()} بمبلغ ${refundTotalAmount} ريال بطريقة ${refundMethod === 'cash' ? 'نقداً' : refundMethod === 'network' ? 'شبكة' : 'تحويل بنكي'}`
      );

      toastSuccess(t('sales_returns.return_success_msg', 'تم إرجاع الفاتورة بنجاح وتحديث الكميات بالمستودع'));
      setOrder(null);
      setSearchResults([]);
      setSearchQuery('');
      setReturnReason('');
      setShowConfirmModal(false);
    } catch (error) {
      globalHandleError(error, 'orders');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Process items eligibility
  const items = order?.items || [];
  const readyMadeItems = items.filter((item: any) => item.type === 'ready_made');
  const customItems = items.filter((item: any) => item.type === 'custom');
  const hasReadyMade = readyMadeItems.length > 0;
  const hasCustom = customItems.length > 0;
  const isFullyCustom = items.length > 0 && readyMadeItems.length === 0;

  // Total refunded amount for eligible items only
  const refundTotalAmount = readyMadeItems.reduce((sum: number, item: any) => sum + (Number(item.quantity || 0) * Number(item.price || 0)), 0);

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto font-sans" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="bg-white dark:bg-[#1D1D1D] p-4 sm:p-6 rounded-2xl md:rounded-[2rem] border border-gray-200 dark:border-gray-800 shadow-sm space-y-6">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-gray-800 dark:text-gray-100 mb-4">
            {t('sales_returns.title', 'إرجاع فاتورة مبيعات')}
          </h2>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="group flex-1 flex items-center bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-gray-700 rounded-xl focus-within:ring-2 focus-within:ring-[#1C8FFF] transition-all overflow-hidden h-12">
              <div className="flex items-center justify-center px-4 border-e border-gray-200/60 dark:border-gray-700 text-gray-400 group-focus-within:text-[#1C8FFF] h-full shrink-0 bg-gray-100/50 dark:bg-slate-900/50">
                <Search size={18} />
              </div>
              <input 
                type="text"
                placeholder={t('sales_returns.search_placeholder_phone', 'أدخل رقم الفاتورة أو رقم جوال العميل للبحث...')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="flex-1 min-w-0 bg-transparent border-none py-3 px-4 text-sm text-gray-800 dark:text-gray-100 outline-none ring-0 placeholder:text-gray-400 font-semibold"
              />
            </div>
            <button 
              onClick={handleSearch}
              disabled={loading || !searchQuery.trim()}
              className="bg-[#1C8FFF] text-white px-6 py-3 rounded-xl font-bold hover:bg-[#1C8FFF]/90 transition-all active:scale-95 disabled:opacity-50 cursor-pointer h-12 shrink-0"
            >
              {loading ? t('sales_returns.searching', 'جاري البحث...') : t('sales_returns.search_btn', 'بحث')}
            </button>
          </div>
        </div>

        {/* Multiple results found list */}
        {searchResults.length > 0 && !order && (
          <div className="border-t border-gray-100 dark:border-gray-800 pt-6 space-y-4">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <AlertTriangle size={18} />
              <h3 className="font-bold text-sm sm:text-base">
                {t('sales_returns.multiple_found', 'تم العثور على فواتير متعددة لرقم الجوال المدخل:')}
              </h3>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {searchResults.map((srvOrder) => (
                <button
                  key={srvOrder.id}
                  onClick={() => setOrder(srvOrder)}
                  className="flex flex-col text-right p-4 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 hover:bg-gray-50 dark:bg-slate-900/40 dark:hover:bg-slate-900/80 transition-all w-full focus:ring-2 focus:ring-[#1C8FFF] outline-none"
                >
                  <div className="flex items-center justify-between w-full mb-2 border-b border-gray-100 dark:border-gray-800/80 pb-2">
                    <span className="font-extrabold text-[#1C8FFF]">#{srvOrder.orderNumber || srvOrder.id.slice(-6).toUpperCase()}</span>
                    <span className="text-xs text-gray-400 font-medium">
                      <DateTimeDisplay date={srvOrder.orderDate} showTime={false} />
                    </span>
                  </div>
                  <div className="flex justify-between items-center w-full text-xs text-gray-500 dark:text-gray-400">
                    <div className="flex items-center gap-1.5">
                      <User size={12} />
                      <span className="font-bold text-gray-700 dark:text-gray-300">{srvOrder.customerName}</span>
                    </div>
                    <div className="font-black text-gray-800 dark:text-gray-200">
                      <PriceDisplay amount={srvOrder.totalAmount} />
                    </div>
                  </div>
                  {srvOrder.status === 'cancelled' && (
                    <span className="mt-2 text-[10px] self-start bg-red-500/10 text-red-500 px-2 py-0.5 rounded-full font-bold">
                      {t('sales_returns.status_returned', 'مرتجع')}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Single Selected Order */}
        {order && (
          <div className="border-t border-gray-100 dark:border-gray-800 pt-6 space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <ShoppingBag size={18} className="text-[#1C8FFF]" />
                {t('sales_returns.order_details', 'تفاصيل الفاتورة المحددة')}
              </h3>
              {searchResults.length > 0 && (
                <button
                  onClick={() => setOrder(null)}
                  className="text-xs text-gray-500 hover:text-[#1C8FFF] flex items-center gap-1 transition-all"
                >
                  <ChevronRight size={14} className={isRtl ? 'rotate-180' : ''} />
                  {t('sales_returns.back_to_results', 'العودة لنتائج البحث')}
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-gray-50 dark:bg-slate-900/50 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">{t('sales_returns.invoice_no', 'رقم الفاتورة')}</p>
                <p className="font-bold text-gray-800 dark:text-gray-100">#{order.orderNumber || order.id.slice(-6).toUpperCase()}</p>
              </div>
              <div className="bg-gray-50 dark:bg-slate-900/50 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">{t('sales_returns.customer', 'العميل')}</p>
                <p className="font-bold text-gray-800 dark:text-gray-100">{order.customerName}</p>
              </div>
              <div className="bg-gray-50 dark:bg-slate-900/50 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">{t('sales_returns.date', 'التاريخ')}</p>
                <DateTimeDisplay date={order.orderDate} showTime={true} size="xs" />
              </div>
              <div className="bg-gray-50 dark:bg-slate-900/50 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">{t('sales_returns.total', 'الإجمالي')}</p>
                <p className="font-bold text-[#1C8FFF]"><PriceDisplay amount={order.totalAmount} /></p>
              </div>
            </div>

            {/* List items and demonstrate eligibility */}
            <div className="space-y-3">
              <h4 className="font-bold text-sm text-gray-700 dark:text-gray-300">
                {t('sales_returns.items_list', 'محتويات الفاتورة وحالة الإرجاع')}
              </h4>
              <div className="border border-gray-100 dark:border-gray-800 rounded-xl overflow-hidden divide-y divide-gray-100 dark:divide-gray-800">
                {items.map((item: any, idx: number) => {
                  const isCustom = item.type === 'custom';
                  return (
                    <div key={idx} className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white dark:bg-[#1D1D1D]">
                      <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-lg shrink-0 ${isCustom ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                          {isCustom ? <Scissors size={18} /> : <Package size={18} />}
                        </div>
                        <div>
                          <p className="font-bold text-gray-800 dark:text-gray-100 text-sm">
                            {isCustom ? item.garmentType || t('orders.custom_thobe', 'تفصيل ثوب') : item.name || t('orders.ready_made', 'صنف جاهز')}
                          </p>
                          <p className="text-xs text-gray-400">
                            {t('sales_returns.quantity', 'الكمية')}: {item.quantity} × <PriceDisplay amount={item.price} />
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-3 self-end sm:self-center">
                        {isCustom ? (
                          <span className="text-xs font-bold px-3 py-1 bg-amber-500/10 text-amber-600 rounded-full flex items-center gap-1">
                            <AlertTriangle size={12} />
                            {t('sales_returns.non_returnable', 'تفصيل - غير قابل للإرجاع')}
                          </span>
                        ) : (
                          <span className="text-xs font-bold px-3 py-1 bg-emerald-500/10 text-emerald-600 rounded-full flex items-center gap-1">
                            <CheckCircle2 size={12} />
                            {t('sales_returns.returnable_restock', 'جاهز - يرجع للمخزون')}
                          </span>
                        )}
                        <span className="font-black text-gray-800 dark:text-gray-200 text-sm">
                          <PriceDisplay amount={item.quantity * item.price} />
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Custom rule constraints feedback */}
            {isFullyCustom ? (
              <div className="p-4 bg-red-50 dark:bg-red-950/20 rounded-xl border border-red-100 dark:border-red-900/30 flex items-start gap-3">
                <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={18} />
                <div>
                  <h4 className="font-bold text-red-800 dark:text-red-400 text-sm">
                    {t('sales_returns.cannot_return_title', 'لا يمكن عمل مرتجع')}
                  </h4>
                  <p className="text-xs text-red-600 dark:text-red-400/80 mt-1 leading-relaxed">
                    {t('sales_returns.cannot_return_msg', 'جميع المنتجات في هذه الفاتورة تفصيل (مفصلة خصيصاً). حسب سياسة النظام، لا يمكن إرجاع المنتجات التفصيل.')}
                  </p>
                </div>
              </div>
            ) : hasCustom ? (
              <div className="p-4 bg-amber-50 dark:bg-amber-950/20 rounded-xl border border-amber-100 dark:border-amber-900/30 flex items-start gap-3">
                <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={18} />
                <div>
                  <h4 className="font-bold text-amber-800 dark:text-amber-400 text-sm">
                    {t('sales_returns.partial_return_warning_title', 'إرجاع جزئي فقط')}
                  </h4>
                  <p className="text-xs text-amber-600 dark:text-amber-400/80 mt-1 leading-relaxed">
                    {t('sales_returns.partial_return_warning_msg', 'هذه الفاتورة تحتوي على منتجات تفصيل وأخرى جاهزة. سيتم إرجاع المنتجات الجاهزة فقط وإعادة كميتها للمستودع بمبلغ')} <PriceDisplay amount={refundTotalAmount} />.
                  </p>
                </div>
              </div>
            ) : null}

            {/* Only allow input and submit if has returnable products and not returned */}
            {!isFullyCustom && order.status !== 'cancelled' && (
              <>
                {/* 1. Refund Payment Method Selection */}
                <div className="space-y-3">
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300">
                    {t('sales_returns.refund_method_label', 'تحديد طريقة إرجاع المبلغ')}
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    <button
                      type="button"
                      onClick={() => setRefundMethod('cash')}
                      className={`flex flex-col items-center justify-center p-3 rounded-xl border font-bold text-sm transition-all gap-2 ${
                        refundMethod === 'cash'
                          ? 'bg-[#1C8FFF]/10 border-[#1C8FFF] text-[#1C8FFF]'
                          : 'border-gray-200 dark:border-gray-800 bg-gray-50/50 hover:bg-gray-50 text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      <Coins size={18} />
                      {t('sales_returns.method_cash', 'نقداً')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRefundMethod('network')}
                      className={`flex flex-col items-center justify-center p-3 rounded-xl border font-bold text-sm transition-all gap-2 ${
                        refundMethod === 'network'
                          ? 'bg-[#1C8FFF]/10 border-[#1C8FFF] text-[#1C8FFF]'
                          : 'border-gray-200 dark:border-gray-800 bg-gray-50/50 hover:bg-gray-50 text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      <CreditCard size={18} />
                      {t('sales_returns.method_network', 'شبكة')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRefundMethod('bank_transfer')}
                      className={`flex flex-col items-center justify-center p-3 rounded-xl border font-bold text-sm transition-all gap-2 ${
                        refundMethod === 'bank_transfer'
                          ? 'bg-[#1C8FFF]/10 border-[#1C8FFF] text-[#1C8FFF]'
                          : 'border-gray-200 dark:border-gray-800 bg-gray-50/50 hover:bg-gray-50 text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      <Landmark size={18} />
                      {t('sales_returns.method_bank', 'تحويل بنكي')}
                    </button>
                  </div>
                </div>

                {/* 2. Reason Textarea */}
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
                    {t('sales_returns.return_reason', 'سبب الإرجاع')}
                  </label>
                  <textarea 
                    value={returnReason}
                    onChange={(e) => setReturnReason(e.target.value)}
                    className="w-full p-4 bg-gray-50 dark:bg-slate-900/50 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-[#1C8FFF] outline-none h-24 resize-none text-gray-800 dark:text-gray-100 font-semibold"
                    placeholder={t('sales_returns.reason_placeholder', 'اكتب سبب الإرجاع هنا...')}
                  />
                </div>
              </>
            )}

            {/* Refund Buttons */}
            <button 
              onClick={() => setShowConfirmModal(true)}
              disabled={isSubmitting || order.status === 'cancelled' || isFullyCustom}
              className="w-full bg-red-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
            >
              <RotateCcw size={20} />
              {order.status === 'cancelled' 
                ? t('sales_returns.already_returned', 'الفاتورة مرتجعة مسبقاً') 
                : isFullyCustom 
                ? t('sales_returns.no_returnable_items', 'لا توجد منتجات جاهزة لإرجاعها')
                : t('sales_returns.confirm_return', 'تأكيد الإرجاع')}
            </button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showConfirmModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white dark:bg-[#1D1D1D] rounded-3xl border border-gray-100 dark:border-gray-800 p-6 max-w-md w-full shadow-2xl space-y-6 text-center"
            >
              <div className="w-16 h-16 bg-red-50 dark:bg-red-950/30 rounded-full flex items-center justify-center mx-auto text-red-500">
                <RotateCcw size={32} />
              </div>
              
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100">
                  {t('sales_returns.confirm_title', 'تأكيد عملية الإرجاع')}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                  {t('sales_returns.confirm_return_msg_custom', 'هل أنت متأكد من إرجاع هذه الفاتورة؟ سيتم إعادة كمية المنتجات الجاهزة إلى المخزون وتحديث سجلاتك.')}
                </p>
              </div>

              {/* Total Summary */}
              <div className="bg-gray-50 dark:bg-slate-900/50 p-4 rounded-2xl border border-gray-100 dark:border-gray-800 text-right space-y-2.5">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-400 font-bold">{t('sales_returns.refund_amount', 'مبلغ الاسترجاع')}:</span>
                  <span className="font-extrabold text-lg text-[#1C8FFF]">
                    <PriceDisplay amount={refundTotalAmount} />
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-400 font-bold">{t('sales_returns.refund_method_confirm', 'طريقة الاسترداد')}:</span>
                  <span className="text-sm font-bold text-gray-800 dark:text-gray-200">
                    {refundMethod === 'cash' ? 'نقداً' : refundMethod === 'network' ? 'شبكة / مدى' : 'تحويل بنكي'}
                  </span>
                </div>
                {returnReason && (
                  <div className="border-t border-gray-100 dark:border-gray-800 pt-2 mt-1">
                    <p className="text-xs text-gray-400 mb-0.5">{t('sales_returns.return_reason', 'سبب الإرجاع')}:</p>
                    <p className="text-xs font-bold text-gray-700 dark:text-gray-300">{returnReason}</p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowConfirmModal(false)}
                  className="w-full bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-gray-800 dark:text-gray-100 py-3 rounded-xl font-bold text-sm transition-all cursor-pointer"
                >
                  {t('common.cancel', 'إلغاء')}
                </button>
                <button
                  type="button"
                  onClick={handleReturn}
                  disabled={isSubmitting}
                  className="w-full bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl font-bold text-sm transition-all shadow-md shadow-red-500/10 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isSubmitting ? (
                    <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  ) : (
                    <RotateCcw size={16} />
                  )}
                  {t('sales_returns.confirm_btn', 'تأكيد الإرجاع')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
