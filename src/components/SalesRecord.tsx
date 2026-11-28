import { useVerticalConfig } from '../hooks/useVerticalConfig';
import React, { useState, useEffect } from 'react';
import { useMeasurementUnit } from '../hooks/useMeasurementUnit';
import { measurementRows } from '../constants/measurementFields';
import { measurementText, unitLabelKey } from '../utils/measurementUnits';
import { supabase } from '../lib/supabase/client';
import { handleError, OperationType, getFriendlyErrorMessage } from '../lib/appErrors';
import { Order } from '../types';
import { cn } from '../lib/utils';
import { decodeOrderB2BNotes } from '../utils/b2bHelper';
import { computePaidRemaining } from '../utils/cartTotals';
import { decodeOrderRow } from '../utils/orderHistoryHelper';
import { PriceDisplay } from './PriceDisplay';
import { FileText, Eye, X, Download, Package, Scissors, User, Calendar, CreditCard, ShoppingBag, Clock, Printer, Share2, AlertTriangle, Paperclip } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { downloadInvoicePDF, shareOrDownloadInvoicePDF } from '../utils/pdfGenerator';
import { openWhatsApp, whatsappMessage } from '../utils/whatsapp';
import SimplifiedTaxInvoice from './printing/SimplifiedTaxInvoice';
import TaxInvoice from './printing/TaxInvoice';
import DateTimeDisplay from './DateTimeDisplay';
import { generateZatcaQR } from '../services/zatcaService';
import { useToast } from '../contexts/ToastContext';
import WhatsAppPhoneModal from './ui/WhatsAppPhoneModal';
import { formatSaudiPhone } from '../utils/phoneUtils';
import { DatePicker } from './ui/DatePicker';
import { Pagination } from './ui/Pagination';
import { riyadhMidnightIso, riyadhDayAfterIso } from '../services/financialSummaryService';

import { isRtlLang } from '../lib/direction';
import { taxRateFraction } from '../shared/taxRate';

const PAGE_SIZE = 20;

export default function SalesRecord({ tenantId, shiftId, filterStatus }: { tenantId: string, shiftId?: string, filterStatus?: string }) {
  const measurementUnit = useMeasurementUnit(tenantId);
  const { t, i18n } = useTranslation();
  const { capabilities } = useVerticalConfig();
  const isRtl = isRtlLang(i18n.language);
  const { error: toastError } = useToast();

  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  useEffect(() => {
    if (!selectedOrder) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setSelectedOrder(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedOrder]);
  const [tenantInfo, setTenantInfo] = useState<{ name: string; vat_number: string; address?: string; phone?: string } | null>(null);
  const [whatsappModalOpen, setWhatsappModalOpen] = useState(false);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });

  // Bug report (sprint 2 pagination project, 2026-11-17): date filtering
  // used to run in the browser as a plain string-prefix comparison on
  // orderDate -- the same Riyadh-vs-UTC boundary bug fixed in Reports.tsx
  // earlier this sprint. Now filtered server-side in fetchOrders itself
  // (riyadhMidnightIso/riyadhDayAfterIso, reused from
  // financialSummaryService.ts), which pagination requires anyway: a
  // client-side filter over only the current page's rows would silently
  // drop matches that exist on other pages.

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
   * (p-4 / main-640:p-8) وارتفاع 100% كان يظهر فراغ واسع حول الفاتورة.
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
        toastError(res);
      }
    } catch (e) {
      console.error('[SalesRecord] خطأ الطباعة:', e);
      window.print();
    }
  };

  // The user's own customizable template (WhatsAppSettings), not a fixed
  // string -- the invoice share message must match what they configured.
  // invoiceUrl was missing here too (seen-whatsapp-instant-send-task.md
  // only called out POS.tsx by name, but this is the exact same gap: the
  // default template's {invoice_url} tag resolved to an empty string).
  // Uses /track/:token (the real, working, no-auth public tracking page)
  // -- /order/:id is not a route at all (confirmed in App.tsx: any
  // unmatched path redirects to "/"), despite being the pattern
  // Orders.tsx's own reference implementation had been using too.
  const buildWhatsAppInvoiceText = (order: Order, phone?: string) => whatsappMessage('invoice', {
    customerName: order.customerName,
    invoiceNumber: order.invoiceNumber,
    orderNumber: order.orderNumber || order.id.slice(-6).toUpperCase(),
    total: order.totalAmount,
    customerPhone: phone,
    trackingToken: order.trackingToken,
  });

  // seen-whatsapp-instant-send-task.md: used to await
  // shareOrDownloadInvoicePDF BEFORE opening WhatsApp -- by the time it
  // resolved, the click's "user activation" window had often already
  // expired, so Chrome/Edge silently blocked the window.open as an
  // unwanted popup with no visible error. Now opens WhatsApp immediately,
  // synchronously, in the same click handler. Attaching the invoice as an
  // actual PDF file is a separate, explicit, optional action now
  // (handleAttachInvoicePdf below).
  const handleShareWhatsApp = () => {
    if (!selectedOrder) return;
    const knownPhone = selectedOrder.customerPhone ? formatSaudiPhone(selectedOrder.customerPhone).replace('+', '') : '';
    if (knownPhone) {
      proceedToWhatsApp(knownPhone);
      return;
    }
    setWhatsappModalOpen(true);
  };

  // The optional "attach as PDF too" step split out of handleShareWhatsApp
  // above -- tries the OS share sheet (text + file together) and falls
  // back to downloading the PDF so it's ready to attach manually. Never
  // blocks or precedes opening WhatsApp itself.
  const handleAttachInvoicePdf = async () => {
    if (!selectedOrder) return;
    const filename = `Invoice-${selectedOrder.orderNumber || selectedOrder.id.slice(-6).toUpperCase()}.pdf`;
    const knownPhone = selectedOrder.customerPhone ? formatSaudiPhone(selectedOrder.customerPhone).replace('+', '') : '';
    const text = buildWhatsAppInvoiceText(selectedOrder, knownPhone || undefined);
    await shareOrDownloadInvoicePDF('sales-record-print-area', filename, text);
  };

  const proceedToWhatsApp = (phone: string) => {
    if (!selectedOrder) return;
    const text = buildWhatsAppInvoiceText(selectedOrder, phone);
    openWhatsApp({ phone, message: text, kind: 'customer' });
    setWhatsappModalOpen(false);
  };

  const fetchOrders = async () => {
    setLoading(true);
    setError(null);
    try {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const [{ data: staffData }, { data: ordersData, count: ordersCount, error: fetchError }, { data: tenantData }] = await Promise.all([
        supabase.from('staff').select('id, name'),
        (() => {
          let query = supabase.from('orders').select('*', { count: 'exact' }).eq('tenant_id', tenantId);
          if (shiftId) query = query.eq('shift_id', shiftId);
          if (filterStatus) query = query.eq('status', filterStatus);
          // Bug report (sprint 2 pagination project, 2026-11-17): date
          // filtering used to happen client-side as a string-prefix
          // compare on orderDate (same Riyadh/UTC boundary bug fixed in
          // Reports.tsx this sprint) -- moved server-side here, which
          // pagination requires anyway.
          if (dateRange.start) query = query.gte('order_date', riyadhMidnightIso(dateRange.start));
          if (dateRange.end) query = query.lt('order_date', riyadhDayAfterIso(dateRange.end));
          return query.order('created_at', { ascending: false }).range(from, to);
        })(),
        supabase.from('tenants').select('name, vat_number, address, phone').eq('id', tenantId).maybeSingle(),
      ]);

      if (fetchError) throw fetchError;
      setOrdersTotal(ordersCount || 0);

      const pageOrderIds = (ordersData || []).map(o => o.id);
      const pageCustomerIds = Array.from(new Set((ordersData || []).map((o: any) => o.customer_id).filter(Boolean)));

      const [{ data: invoicesData }, { data: customersData }] = await Promise.all([
        // Real ZATCA-sequential invoice numbers, keyed by order_id --
        // distinct from orderNumber (a friendly reference, not the legal
        // invoice number). Restricted to this page's orders now instead
        // of the whole tenant's invoice history.
        pageOrderIds.length > 0
          ? supabase.from('tax_invoices').select('order_id, invoice_number').eq('tenant_id', tenantId).in('order_id', pageOrderIds)
          : Promise.resolve({ data: [] as any[] }),
        // orders.customer_phone is never actually written at checkout --
        // the real phone lives on the customer record. Restricted to this
        // page's customers instead of the whole tenant's customer list.
        pageCustomerIds.length > 0
          ? supabase.from('customers').select('id, phone').eq('tenant_id', tenantId).in('id', pageCustomerIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      // seen-cto-sprint1-financial-engine-task.md (POS-02/C6): orders.notes
      // only ever carries the legacy __ORDER_METADATA_V2__ embed --
      // create_pos_sale has written real line items to order_items for a
      // long time now, and this screen never read that table at all, so
      // every reprint/PDF/WhatsApp invoice from here showed the full total
      // with zero line items. Loaded in one extra batched query instead of
      // decodeOrderRow's always-empty `items`.
      const itemsByOrderId: Record<string, any[]> = {};
      if (pageOrderIds.length > 0) {
        const { data: itemsData, error: itemsError } = await supabase
          .from('order_items')
          .select('*')
          .in('order_id', pageOrderIds);
        if (itemsError) {
          console.error('[SalesRecord] Error fetching order_items:', itemsError);
        } else {
          for (const row of itemsData || []) {
            (itemsByOrderId[row.order_id] ??= []).push({
              id: row.id,
              type: row.type,
              itemId: row.item_id,
              variantId: row.variant_id,
              name: row.name,
              garmentType: row.garment_type,
              quantity: Number(row.quantity),
              price: Number(row.price),
            });
          }
        }
      }

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

      const customerPhoneMap: Record<string, string> = {};
      if (customersData) {
        customersData.forEach(c => {
          if (c.id && c.phone) customerPhoneMap[c.id] = c.phone;
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
          customerPhone: (decoded.customer_id && customerPhoneMap[decoded.customer_id]) || decoded.customer_phone || decoded.customerPhone,
          // seen-whatsapp-instant-send-task.md follow-up: needed for the
          // WhatsApp invoice link (/track/:token), same mapping Orders.tsx
          // already does.
          trackingToken: decoded.tracking_token ?? decoded.trackingToken,
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
          items: itemsByOrderId[d.id] || [],
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

  useEffect(() => { setPage(0); }, [tenantId, shiftId, filterStatus, dateRange.start, dateRange.end]);
  useEffect(() => {
    fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, shiftId, filterStatus, dateRange.start, dateRange.end, page]);

  const getStatusBadge = (status?: string) => {
    if (status === 'delivered') return { label: t('pos.delivered'), className: 'bg-[var(--seen-success-bg)] text-success' };
    // A returned order is set to 'cancelled' -- falling through to the
    // generic "pending" bucket below made every returned invoice in the
    // Returns Record list misleadingly show as still awaiting processing.
    if (status === 'cancelled') return { label: t('common.status_cancelled'), className: 'bg-[var(--seen-danger-bg)] text-danger' };
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
        <div className="w-12 h-12 bg-[var(--seen-danger-bg)] text-danger rounded-full flex items-center justify-center mb-4"><AlertTriangle size={22} /></div>
        <h3 className="text-sm font-black text-content mb-2">{t('sales_record.failed_to_load', 'فشل تحميل سجل المبيعات')}</h3>
        <p className="text-sm text-content-muted mb-4 font-bold max-w-[280px] leading-relaxed">{error}</p>
        <button
          onClick={fetchOrders}
          className="px-5 py-2 bg-brand text-white text-sm font-black rounded-xl hover:bg-brand/90 transition-colors shadow-md shadow-brand/10 cursor-pointer"
        >
          {t('common.retry', 'إعادة المحاولة')}
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 main-640:p-6 font-sans">
      <div className="flex flex-col main-640:flex-row items-stretch main-640:items-center gap-3 mb-4">
        <div className="flex-1 main-640:flex-none main-640:min-w-[150px]">
          <DatePicker
            value={dateRange.start}
            onChange={(val) => setDateRange(prev => ({ ...prev, start: val }))}
            placeholder={t('common.from', 'من')}
          />
        </div>
        <div className="flex-1 main-640:flex-none main-640:min-w-[150px]">
          <DatePicker
            value={dateRange.end}
            onChange={(val) => setDateRange(prev => ({ ...prev, end: val }))}
            placeholder={t('common.to', 'إلى')}
          />
        </div>
      </div>

      <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden">
        {/* Desktop View Table */}
        <div className="hidden main-720:block overflow-x-auto whitespace-nowrap scrollbar-hide">
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
                      "px-2 py-1 rounded-lg text-sm font-black whitespace-nowrap",
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
                      "px-2 py-1 rounded-md text-sm font-bold",
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
        <div className="main-720:hidden divide-y divide-border">
          {orders.map(order => (
            <div key={order.id} className="p-4 active:bg-surface-muted/50" onClick={() => setSelectedOrder(order)}>
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="text-sm font-bold text-content mb-1">#{order.orderNumber || order.id.slice(-6).toUpperCase()}</p>
                  <p className="font-bold text-content leading-tight">{order.customerName}</p>
                </div>
                <div className="text-left font-black text-brand">
                  <PriceDisplay amount={order.totalAmount} />
                </div>
              </div>
              <div className="flex justify-between items-center mt-3">
                <div className="flex gap-2">
                  <span className={cn(
                    "px-2 py-0.5 rounded text-sm font-bold",
                    getStatusBadge(order.status).className
                  )}>
                    {getStatusBadge(order.status).label}
                  </span>
                  <span className={cn(
                    "px-2 py-0.5 rounded text-sm font-black whitespace-nowrap",
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
        <div className="px-4 main-640:px-6">
          <Pagination page={page} pageSize={PAGE_SIZE} total={ordersTotal} onPageChange={setPage} />
        </div>
      </div>

      {/* Order Details Modal */}
      {selectedOrder && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-2 main-640:p-4"
          onClick={() => setSelectedOrder(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('pos.order_details')}
            onClick={(e) => e.stopPropagation()}
            className={cn(
            "bg-surface rounded-3xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden transition-all duration-200",
            selectedOrder.isB2B ? "w-full max-w-3xl" : "w-full max-w-[92mm] main-640:max-w-[100mm]"
          )}>
            <div className="p-4 main-640:p-6 border-b border-border flex justify-between items-center shrink-0">
              <div className="flex items-center gap-3 main-640:gap-4">
                <div className="p-2.5 main-640:p-3 bg-brand/10 text-brand rounded-xl main-640:rounded-2xl">
                  <FileText className="w-5 h-5 main-640:w-6 main-640:h-6" />
                </div>
                <div>
                  <h2 className="text-base main-640:text-xl font-black text-content">{t('pos.order_details')} #{selectedOrder.orderNumber || selectedOrder.id.slice(-6).toUpperCase()}</h2>
                  <div className="mt-0.5">
                    <DateTimeDisplay date={selectedOrder.orderDate} showTime={true} size="xs" />
                  </div>
                </div>
              </div>
              <button onClick={() => setSelectedOrder(null)} aria-label={t('common.close')} className="p-2 hover:bg-surface-muted rounded-full transition-colors">
                <X className="w-5 h-5 main-640:w-6 main-640:h-6 text-content-muted" />
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

              // The one reader of a stored rate (src/shared/taxRate.ts, P1.2).
              // A 0 with no stored tax is an order sold without tax; a 0 next to a
              // stored tax amount is an old row (before the rate was stored): 15%.
              const storedRate = taxRateFraction((selectedOrder as any).taxRate);
              const soldWithoutTax = storedRate === 0 && !(Number((selectedOrder as any).taxAmount) > 0);
              const vatRateFraction = soldWithoutTax ? 0 : storedRate && storedRate > 0 ? storedRate : 0.15;

              const formattedItems = (selectedOrder.items || []).map((item: any) => ({
                name: item.type === 'custom' ? item.garmentType || t('orders.custom_thobe', 'تفصيل ثوب') : item.name || t('orders.ready_made', 'صنف جاهز'),
                quantity: Number(item.quantity || 0),
                unitPrice: Number(item.price || item.unitPrice || 0),
                taxType: item.taxType,
                // The line's measurements as on the first print (the order line's
                // snapshot); shown when the shop's layout prints measurements.
                measurements: item.type === 'custom' && item.measurements
                  ? measurementRows(item.measurements, false, capabilities.body_measurements === 'womens' ? 'womens' : 'thobe').filter((row) => row.value > 0).map((row) => ({
                      label: t(row.labelKey),
                      value: measurementText(row.value, measurementUnit, t(unitLabelKey(measurementUnit))),
                    }))
                  : undefined,
                vatAmount: Number((item.price || item.unitPrice || 0) * item.quantity - ((item.price || item.unitPrice || 0) * item.quantity) / (1 + vatRateFraction)),
                total: Number((item.price || item.unitPrice || 0) * item.quantity)
              }));

              const subtotalExcVat = selectedOrder.totalAmount / (1 + vatRateFraction);
              const vatAmt = selectedOrder.totalAmount - subtotalExcVat;

              // Was `selectedOrder.totalAmount - selectedOrder.paidAmount`
              // with no floor -- an overpayment or stored-value drift could
              // print a negative "remaining" on a real invoice.
              const { paidAmount, remainingAmount } = computePaidRemaining(selectedOrder.totalAmount, selectedOrder.paidAmount);

              const totals = {
                subtotal: subtotalExcVat,
                discount: selectedOrder.discountAmount || 0,
                taxableAmount: subtotalExcVat,
                vatAmount: vatAmt,
                grandTotal: selectedOrder.totalAmount,
                paidAmount,
                remainingAmount
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
                <div className="flex-1 overflow-auto p-4 main-640:p-8 flex justify-center bg-surface-muted print:bg-white print:p-2 print:px-3 print:overflow-visible print:max-h-none" id="sales-record-print-area">
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
                      vatRate={vatRateFraction}
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
                      vatRate={vatRateFraction}
                    />
                  )}
                </div>
              );
            })()}

            <div className="p-4 bg-surface-muted border-t border-border flex flex-wrap gap-2.5 shrink-0 mt-auto print:hidden">
              <button 
                onClick={handleDownloadPDF}
                className="flex-1 min-w-[110px] bg-brand text-white py-2.5 px-3 rounded-xl font-bold text-sm shadow-md hover:bg-brand/90 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Download size={16} />
                {t('sales_record.download_pdf', 'تحميل PDF')}
              </button>
              <button
                onClick={handleShareWhatsApp}
                className="flex-1 min-w-[110px] bg-[#25D366] text-white py-2.5 px-3 rounded-xl font-bold text-sm shadow-md hover:bg-[#20ba56] transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Share2 size={16} />
                {t('sales_record.whatsapp', 'واتساب')}
              </button>
              <button
                onClick={() => void handleAttachInvoicePdf()}
                className="flex-1 min-w-[110px] bg-surface border border-border text-content-muted hover:text-content py-2.5 px-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Paperclip size={16} />
                {t('sales_record.attach_invoice_pdf', 'إرفاق PDF أيضاً')}
              </button>
              <button
                onClick={handlePrint}
                className="flex-1 min-w-[90px] bg-content text-surface py-2.5 px-3 rounded-xl font-bold text-sm shadow-md hover:bg-content/90 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Printer size={16} />
                {t('tax_invoices.print', 'طباعة')}
              </button>
              <button 
                onClick={() => setSelectedOrder(null)}
                className="px-4 bg-surface text-content-muted border border-border py-2.5 rounded-xl font-bold hover:bg-surface-muted transition-all text-sm cursor-pointer"
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
