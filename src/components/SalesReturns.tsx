import { invoiceNumberCandidates, matchesReturnSearch } from '../utils/returnSearch';
import React, { useState, useEffect } from 'react';
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
import { IconInput } from './ui/IconInput';
import { useTranslation } from 'react-i18next';
import DateTimeDisplay from './DateTimeDisplay';
import { motion, AnimatePresence } from 'motion/react';
import { decodeOrderRow } from '../utils/orderHistoryHelper';

import { isRtlLang } from '../lib/direction';

export default function SalesReturns({ tenantId, shiftId }: { tenantId: string, shiftId?: string }) {
  const { t, i18n } = useTranslation();
  const { success: toastSuccess, error: toastError, handleError: globalHandleError } = useToast();
  const isRtl = isRtlLang(i18n.language);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Order[]>([]);
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [refundMethod, setRefundMethod] = useState<'cash' | 'network' | 'bank_transfer'>('cash');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  // seen-cto-sprint1-financial-engine-task.md (POS-02/C6): orders.notes only
  // ever carries the legacy __ORDER_METADATA_V2__ embed -- create_pos_sale
  // has written real line items to order_items for a long time now, and
  // this screen never read that table at all, so `order.items` was always
  // [] for any sale made since then. Returns silently refunded 0, restocked
  // nothing, and (because readyMadeItems was []) the order still got
  // cancelled outright, including any custom items still in progress.
  // Loaded fresh per selected order instead of trusting decodeOrderRow's
  // notes-only items.
  const [orderItems, setOrderItems] = useState<any[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  useEffect(() => {
    if (!order?.id) {
      setOrderItems([]);
      return;
    }
    let cancelled = false;
    setLoadingItems(true);
    (async () => {
      const { data, error } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', order.id);
      if (cancelled) return;
      if (error) {
        globalHandleError(error, 'orders');
        setOrderItems([]);
      } else {
        setOrderItems((data || []).map((row: any) => ({
          id: row.id,
          type: row.type,
          itemId: row.item_id,
          variantId: row.variant_id,
          name: row.name,
          garmentType: row.garment_type,
          quantity: Number(row.quantity),
          price: Number(row.price),
        })));
      }
      setLoadingItems(false);
    })();
    return () => { cancelled = true; };
  }, [order?.id]);

  useEffect(() => {
    if (!showConfirmModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowConfirmModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showConfirmModal]);

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

      // The invoice number on the receipt (INV-21, or 21) -- the box asks for it.
      const { data: invoiceRows } = await supabase
        .from('tax_invoices')
        .select('order_id')
        .eq('tenant_id', tenantId)
        .in('invoice_number', invoiceNumberCandidates(trimmedQuery));
      const invoiceOrderIds = (invoiceRows || []).map((r: { order_id: string | null }) => r.order_id).filter(Boolean) as string[];

      // 2. Query orders for the tenant
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('order_date', { ascending: false });
      
      if (error) throw error;

      // 3. Filter orders matching invoice identifier OR matching customer IDs
      const matchedOrders = (data || []).filter(d => matchesReturnSearch(d, trimmedQuery, { invoiceOrderIds, customerIds })).map(foundDoc => {
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
        toastError(t('sales_returns.invoice_not_found'));
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
    if (!shiftId) {
      // process_sales_return now requires the caller's own open shift
      // (seen-cto-sprint1-financial-engine-task.md) -- a cash refund must
      // affect a real, currently-open drawer.
      toastError(t('sales_returns.no_open_shift', 'لا توجد وردية مفتوحة -- افتح وردية قبل معالجة مرتجع.'));
      return;
    }

    setIsSubmitting(true);
    try {
      // seen-pos-sale-testing-task.md / seen-cto-sprint1-financial-engine
      // -task.md: process_sales_return now only takes order_item_id +
      // quantity per line -- it reads the real sold price, tax/discount
      // share, variant_id and remaining returnable quantity itself from
      // order_items/orders, instead of trusting whatever the client sends.
      // This screen still only offers "return everything ready-made in
      // this order" as a single action (no partial-quantity picker UI yet
      // -- that's a separate, smaller follow-up), but the server-side
      // quantity/refund correctness no longer depends on the client at all.
      const operationId = globalThis.crypto.randomUUID();

      const { data: returnResult, error: returnError } = await supabase.rpc('process_sales_return', {
        p_operation_id: operationId,
        p_order_id: order.id,
        p_shift_id: shiftId,
        p_items: readyMadeItems
          .filter((item: any) => item.id)
          .map((item: any) => ({
            order_item_id: item.id,
            quantity: Number(item.quantity || 0),
          })),
        p_reason: returnReason || null,
        p_refund_method: refundMethod,
      });

      if (returnError) throw returnError;

      // P6 (MONEY-13): cash back is capped by what was paid; the rest of the
      // credit note comes off what the customer owes -- say both.
      const res = (returnResult || {}) as { refunded_amount?: number; credited_amount?: number };
      const refunded = Number(res.refunded_amount || 0);
      const credited = Number(res.credited_amount || 0);
      toastSuccess(credited > 0
        ? t('sales_returns.return_success_with_credit', { refunded: refunded.toFixed(2), credited: credited.toFixed(2) })
        : t('sales_returns.return_success_msg'));
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

  // Process items eligibility -- from the real order_items rows (see the
  // orderItems effect above), not the near-always-empty order.items.
  const items = orderItems;
  const readyMadeItems = items.filter((item: any) => item.type === 'ready_made');
  const customItems = items.filter((item: any) => item.type === 'custom');
  const hasReadyMade = readyMadeItems.length > 0;
  const hasCustom = customItems.length > 0;
  const isFullyCustom = items.length > 0 && readyMadeItems.length === 0;

  // Total refunded amount for eligible items only -- an ESTIMATE shown to
  // the cashier before confirming (face value, no discount/tax share
  // applied yet); process_sales_return computes and returns the real,
  // discount/tax-aware refund amount once the return actually runs.
  const refundTotalAmount = readyMadeItems.reduce((sum: number, item: any) => sum + (Number(item.quantity || 0) * Number(item.price || 0)), 0);

  return (
    <div className="p-4 main-640:p-6 max-w-4xl mx-auto font-sans" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="bg-surface p-4 main-640:p-6 rounded-2xl border border-border shadow-sm space-y-6">
        <div>
          <h2 className="text-lg main-640:text-xl font-bold text-content mb-4">
            {t('sales_returns.title')}
          </h2>
          <div className="flex flex-col main-640:flex-row gap-3">
            <IconInput
              type="text"
              startIcon={Search}
              placeholder={t('sales_returns.search_placeholder_phone')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              containerClassName="flex-1"
            />
            <button 
              onClick={handleSearch}
              disabled={loading || !searchQuery.trim()}
              className="bg-brand text-white px-6 py-3 rounded-xl font-bold hover:bg-brand/90 transition-all active:scale-95 disabled:opacity-50 cursor-pointer h-12 shrink-0"
            >
              {loading ? t('sales_returns.searching') : t('sales_returns.search_btn')}
            </button>
          </div>
        </div>

        {/* Multiple results found list */}
        {searchResults.length > 0 && !order && (
          <div className="border-t border-border pt-6 space-y-4">
            <div className="flex items-center gap-2 text-warning">
              <AlertTriangle size={18} />
              <h3 className="font-bold text-sm main-640:text-base">
                {t('sales_returns.multiple_found')}
              </h3>
            </div>
            <div className="grid gap-3 main-640:grid-cols-2">
              {searchResults.map((srvOrder) => (
                <button
                  key={srvOrder.id}
                  onClick={() => setOrder(srvOrder)}
                  className={`flex flex-col ${isRtl ? 'text-right' : 'text-left'} p-4 rounded-xl border border-border bg-surface-muted/50 hover:bg-surface-muted transition-all w-full focus:ring-2 focus:ring-brand outline-none`}
                >
                  <div className="flex items-center justify-between w-full mb-2 border-b border-border pb-2">
                    <span className="font-extrabold text-brand">#{srvOrder.orderNumber || srvOrder.id.slice(-6).toUpperCase()}</span>
                    <span className="text-sm text-content-muted font-medium">
                      <DateTimeDisplay date={srvOrder.orderDate} showTime={false} />
                    </span>
                  </div>
                  <div className="flex justify-between items-center w-full text-sm text-content-muted">
                    <div className="flex items-center gap-1.5">
                      <User size={12} />
                      <span className="font-bold text-content-muted">{srvOrder.customerName}</span>
                    </div>
                    <div className="font-black text-content">
                      <PriceDisplay amount={srvOrder.totalAmount} />
                    </div>
                  </div>
                  {srvOrder.status === 'cancelled' && (
                    <span className="mt-2 text-sm self-start bg-[var(--seen-danger-bg)] text-danger px-2 py-0.5 rounded-full font-bold">
                      {t('procurement.return')}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Single Selected Order */}
        {order && (
          <div className="border-t border-border pt-6 space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-content flex items-center gap-2">
                <ShoppingBag size={18} className="text-brand" />
                {t('sales_returns.order_details')}
              </h3>
              {searchResults.length > 0 && (
                <button
                  onClick={() => setOrder(null)}
                  className="text-sm text-content-muted hover:text-brand flex items-center gap-1 transition-all"
                >
                  <ChevronRight size={14} className={isRtl ? 'rotate-180' : ''} />
                  {t('sales_returns.back_to_results')}
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 main-720:grid-cols-4 gap-4">
              <div className="bg-surface-muted p-4 rounded-xl border border-border">
                <p className="text-sm text-content-muted mb-1">{t('sales_returns.invoice_no')}</p>
                <p className="font-bold text-content">#{order.orderNumber || order.id.slice(-6).toUpperCase()}</p>
              </div>
              <div className="bg-surface-muted p-4 rounded-xl border border-border">
                <p className="text-sm text-content-muted mb-1">{t('sales_returns.customer')}</p>
                <p className="font-bold text-content">{order.customerName}</p>
              </div>
              <div className="bg-surface-muted p-4 rounded-xl border border-border">
                <p className="text-sm text-content-muted mb-1">{t('sales_returns.date')}</p>
                <DateTimeDisplay date={order.orderDate} showTime={true} size="xs" />
              </div>
              <div className="bg-surface-muted p-4 rounded-xl border border-border">
                <p className="text-sm text-content-muted mb-1">{t('sales_returns.total')}</p>
                <p className="font-bold text-brand"><PriceDisplay amount={order.totalAmount} /></p>
              </div>
            </div>

            {/* List items and demonstrate eligibility */}
            <div className="space-y-3">
              <h4 className="font-bold text-sm text-content-muted">
                {t('sales_returns.items_list')}
              </h4>
              <div className="border border-border rounded-xl overflow-hidden divide-y divide-border">
                {items.map((item: any, idx: number) => {
                  const isCustom = item.type === 'custom';
                  return (
                    <div key={idx} className="p-4 flex flex-col main-640:flex-row main-640:items-center main-640:justify-between gap-3 bg-surface">
                      <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-lg shrink-0 ${isCustom ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'}`}>
                          {isCustom ? <Scissors size={18} /> : <Package size={18} />}
                        </div>
                        <div>
                          <p className="font-bold text-content text-sm">
                            {isCustom ? item.garmentType || t('orders.custom_thobe') : item.name || t('orders.ready_made')}
                          </p>
                          <p className="text-sm text-content-muted">
                            {t('common.quantity')}: {item.quantity} × <PriceDisplay amount={item.price} />
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-3 self-end main-640:self-center">
                        {isCustom ? (
                          <span className="text-sm font-bold px-3 py-1 bg-[var(--seen-warning-bg)] text-warning rounded-full flex items-center gap-1">
                            <AlertTriangle size={12} />
                            {t('sales_returns.non_returnable')}
                          </span>
                        ) : (
                          <span className="text-sm font-bold px-3 py-1 bg-[var(--seen-success-bg)] text-success rounded-full flex items-center gap-1">
                            <CheckCircle2 size={12} />
                            {t('sales_returns.returnable_restock')}
                          </span>
                        )}
                        <span className="font-black text-content text-sm">
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
              <div className="p-4 bg-danger/10 rounded-xl border border-danger/20 flex items-start gap-3">
                <AlertTriangle className="text-danger shrink-0 mt-0.5" size={18} />
                <div>
                  <h4 className="font-bold text-danger text-sm">
                    {t('sales_returns.cannot_return_title')}
                  </h4>
                  <p className="text-sm text-danger/80 mt-1 leading-relaxed">
                    {t('sales_returns.cannot_return_msg')}
                  </p>
                </div>
              </div>
            ) : hasCustom ? (
              <div className="p-4 bg-warning/10 rounded-xl border border-warning/20 flex items-start gap-3">
                <AlertTriangle className="text-warning shrink-0 mt-0.5" size={18} />
                <div>
                  <h4 className="font-bold text-warning text-sm">
                    {t('sales_returns.partial_return_warning_title')}
                  </h4>
                  <p className="text-sm text-warning/80 mt-1 leading-relaxed">
                    {t('sales_returns.partial_return_warning_msg')} <PriceDisplay amount={refundTotalAmount} />.
                  </p>
                </div>
              </div>
            ) : null}

            {/* Only allow input and submit if has returnable products and not returned */}
            {!isFullyCustom && order.status !== 'cancelled' && (
              <>
                {/* 1. Refund Payment Method Selection */}
                <div className="space-y-3">
                  <label className="block text-sm font-bold text-content-muted">
                    {t('sales_returns.refund_method_label')}
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    <button
                      type="button"
                      onClick={() => setRefundMethod('cash')}
                      className={`flex flex-col items-center justify-center p-3 rounded-xl border font-bold text-sm transition-all gap-2 ${
                        refundMethod === 'cash'
                          ? 'bg-brand/10 border-brand text-brand'
                          : 'border-border bg-surface-muted/50 hover:bg-surface-muted text-content-muted'
                      }`}
                    >
                      <Coins size={18} />
                      {t('sales_returns.method_cash')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRefundMethod('network')}
                      className={`flex flex-col items-center justify-center p-3 rounded-xl border font-bold text-sm transition-all gap-2 ${
                        refundMethod === 'network'
                          ? 'bg-brand/10 border-brand text-brand'
                          : 'border-border bg-surface-muted/50 hover:bg-surface-muted text-content-muted'
                      }`}
                    >
                      <CreditCard size={18} />
                      {t('common.payment_methods.network')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRefundMethod('bank_transfer')}
                      className={`flex flex-col items-center justify-center p-3 rounded-xl border font-bold text-sm transition-all gap-2 ${
                        refundMethod === 'bank_transfer'
                          ? 'bg-brand/10 border-brand text-brand'
                          : 'border-border bg-surface-muted/50 hover:bg-surface-muted text-content-muted'
                      }`}
                    >
                      <Landmark size={18} />
                      {t('pos.bank_transfer')}
                    </button>
                  </div>
                </div>

                {/* 2. Reason Textarea */}
                <div>
                  <label className="block text-sm font-bold text-content-muted mb-2">
                    {t('sales_returns.return_reason')}
                  </label>
                  <textarea 
                    value={returnReason}
                    onChange={(e) => setReturnReason(e.target.value)}
                    className="w-full p-4 bg-surface-muted border border-border rounded-xl focus:ring-2 focus:ring-brand outline-none h-24 resize-none text-content font-semibold"
                    placeholder={t('sales_returns.reason_placeholder')}
                  />
                </div>
              </>
            )}

            {/* Refund Buttons */}
            <button 
              onClick={() => setShowConfirmModal(true)}
              disabled={isSubmitting || loadingItems || order.status === 'cancelled' || isFullyCustom}
              className="w-full bg-danger text-white py-4 rounded-xl font-bold text-lg hover:bg-danger/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
            >
              <RotateCcw size={20} />
              {order.status === 'cancelled' 
                ? t('sales_returns.already_returned') 
                : isFullyCustom 
                ? t('sales_returns.no_returnable_items')
                : t('sales_returns.confirm_return')}
            </button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showConfirmModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowConfirmModal(false)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={t('sales_returns.confirm_title')}
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-surface rounded-3xl border border-border p-6 max-w-md w-full shadow-2xl space-y-6 text-center"
            >
              <div className="w-16 h-16 bg-[var(--seen-danger-bg)] rounded-full flex items-center justify-center mx-auto text-danger">
                <RotateCcw size={32} />
              </div>
              
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-content">
                  {t('sales_returns.confirm_title')}
                </h3>
                <p className="text-sm text-content-muted leading-relaxed">
                  {t('sales_returns.confirm_return_msg_custom')}
                </p>
              </div>

              {/* Total Summary */}
              <div className={`bg-surface-muted p-4 rounded-2xl border border-border ${isRtl ? 'text-right' : 'text-left'} space-y-2.5`}>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-content-muted font-bold">{t('sales_returns.refund_amount')}:</span>
                  <span className="font-extrabold text-lg text-brand">
                    <PriceDisplay amount={refundTotalAmount} />
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-content-muted font-bold">{t('sales_returns.refund_method_confirm')}:</span>
                  <span className="text-sm font-bold text-content">
                    {refundMethod === 'cash' ? t('sales_returns.method_cash') : refundMethod === 'network' ? t('sales_returns.method_network_mada') : t('pos.bank_transfer')}
                  </span>
                </div>
                {returnReason && (
                  <div className="border-t border-border pt-2 mt-1">
                    <p className="text-sm text-content-muted mb-0.5">{t('sales_returns.return_reason')}:</p>
                    <p className="text-sm font-bold text-content-muted">{returnReason}</p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowConfirmModal(false)}
                  className="w-full bg-surface-muted hover:bg-border/40 text-content py-3 rounded-xl font-bold text-sm transition-all cursor-pointer"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleReturn}
                  disabled={isSubmitting}
                  className="w-full bg-danger hover:bg-danger/90 text-white py-3 rounded-xl font-bold text-sm transition-all shadow-md shadow-danger/10 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isSubmitting ? (
                    <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  ) : (
                    <RotateCcw size={16} />
                  )}
                  {t('sales_returns.confirm_return')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
