"use client";
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { fuzzyIncludes } from '../utils/fuzzySearch';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useMeasurementUnit } from '../hooks/useMeasurementUnit';
import { cmToDisplayUnit, unitLabelKey } from '../utils/measurementUnits';
import { measurementRows, measurementSetFor } from '../constants/measurementFields';
import { orderItemRowToLine, cuttingFabricLines, isFabricDeductionDue, type CuttingFabricLine } from '../utils/tailoringOrder';
import CuttingFabricDialog from './CuttingFabricDialog';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useRealtimeSync } from '../hooks/useRealtimeSync';
import { decodeOrderRow, encodeOrderRow } from '../utils/orderHistoryHelper';
import { getOpenShiftId } from '../utils/shiftHelper';
import { useRouter, useRefreshCounter } from '../hooks/useRouter';
import { 
  Plus, 
  Search, 
  ShoppingBag,
  Calendar,
  CheckCircle2,
  Clock,
  AlertCircle,
  ChevronDown,
  Trash2,
  Printer,
  ClipboardList,
  Receipt,
  QrCode,
  Barcode,
  Eye,
  Share2,
  MessageSquare,
  CreditCard,
  User,
  X,
  History,
  Scissors,
  CheckSquare,
  Package,
  Truck,
  MoreHorizontal,
  Info,
  Filter,
  Zap,
  Ruler,
  ChevronLeft,
  Shield,
  FileSpreadsheet,
  FileText,
  Phone
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import { resolveTaxSettings } from '../utils/taxSettings';
import { handleFirestoreError, OperationType, dbRefusalMessage } from '../lib/appErrors';
import { refreshOrdersCache, getCachedOrders } from '../lib/offline/cacheSync';
import OrderEditDialog from './OrderEditDialog';
import { isNetworkFailure } from '../lib/offline/outbox';
import { Order, Customer, OrderStatus, OrderHistory, PaymentMethod, Staff, Tenant, TaxInvoice } from '../types';
import { TaxInvoiceDocument } from './printing/TaxInvoiceModal';
import { fetchTaxInvoiceForOrder, issueTaxInvoiceForOrder, syncTaxInvoicePaidAmount } from '../services/taxInvoiceService';
import { cn } from '../lib/utils';
import { PriceDisplay } from './PriceDisplay';
import { logEmployeeAction } from '../services/employeeAuditService';
import PageSkeleton from "./PageSkeleton";
import Header from './Header';
import TailoringOrderForm from './TailoringOrderForm';
import OrderItemAttributes from './orders/OrderItemAttributes';
import OrderWorkCard, { WORK_CARD_ELEMENT_ID } from './orders/OrderWorkCard';
import { useVerticalTerms } from '../hooks/useVerticalTerms';
import { motion, AnimatePresence } from 'motion/react';
import { usePermissions } from '../hooks/usePermissions';
import { useTranslation } from 'react-i18next';
import DateTimeDisplay from './DateTimeDisplay';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { useAuth } from '../contexts/AuthContext';
import * as XLSX from 'xlsx';
import { buildWhatsAppMessage, getWhatsAppTemplate, sendWhatsAppMessage } from '../utils/whatsapp';
import { notifyOrderStatusChange } from '../utils/orderNotify';
import WhatsAppPhoneModal from './ui/WhatsAppPhoneModal';
import ScannerModal from './ScannerModal';
import { SmartSelect } from './ui/SmartSelect';
import { Pagination } from './ui/Pagination';
import { DatePicker } from './ui/DatePicker';
import { IconInput } from './ui/IconInput';
import { VoiceMicButton } from './ui/VoiceMicButton';
import { isSpeechRecognitionSupported } from '../hooks/useSpeechRecognition';
import { useStaff } from '../contexts/StaffContext';
import { useBranding } from '../contexts/BrandingContext';
import { analytics, AnalyticsEvent } from '../services/analyticsService';
import { useVerticalConfig } from '../hooks/useVerticalConfig';
import type { WorkflowStage } from '../types/expansion';
import { legacyOrderStatusFor } from '../services/verticalService';

import { isRtlLang, localeOf } from '../lib/direction';

// Moved to ./orderStatusConfig (seen-performance-first-open-login-task.md
// Phase 4); re-exported so existing imports from './Orders' keep working.
import { STATUS_CONFIG, getOrderStatusDisplay } from './orderStatusConfig';
export { STATUS_CONFIG, getOrderStatusDisplay };
export type { StatusVisual } from './orderStatusConfig';

const ORDER_STAGES: OrderStatus[] = [
  'measurements_taken',
  'cutting',
  'sewing',
  'embroidery',
  'ironing_packaging',
  'ready',
  'delivered'
];

const OrderStepper = ({ currentStatus, stages }: { currentStatus: string; stages?: WorkflowStage[] }) => {
  const { t } = useTranslation();
  // نشاط ديناميكي (غير mens_tailoring): يعرض مراحل عمله الفعلية بدل التسلسل
  // الثابت، مستبعداً المرحلتين الختاميتين (delivered/cancelled) من الشريط
  // نفسه تماماً كما يفعل ORDER_STAGES الثابت أصلاً.
  const dynamicStages = stages && stages.length > 0
    ? stages.filter((s) => !s.is_terminal || s.stage_key === 'delivered').map((s) => s.stage_key)
    : null;
  const activeStages = dynamicStages ?? ORDER_STAGES;
  const currentIdx = activeStages.indexOf(currentStatus === 'partial_delivered' ? 'ready' : currentStatus);

  // شريط المراحل يحتاج تمريراً أفقياً لغاية 7 مراحل (min-w-[600px]) بلا أي
  // مؤشر على وجود محتوى مخفي -- قد يفوت المستخدم أن الطلب في مرحلة متقدمة
  // (seen-tablet-mobile-ux-review.md بند 11). يُمرَّر للمرحلة الحالية تلقائياً
  // عند الفتح، وتُضاف تظليلات حافة (fade) توضّح أن هناك مزيداً يُمكن تمريره.
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeStageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    activeStageRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [currentIdx]);

  return (
    <div className="relative bg-surface p-6 rounded-2xl border border-border shadow-sm mb-8">
      <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface to-transparent rounded-e-[2rem] z-20" />
      <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-surface to-transparent rounded-s-[2rem] z-20" />
      {/* overflow-x-auto also clips vertically: the padding keeps the active
          stage's ring and scale inside the scroller instead of cut off. */}
      <div ref={scrollRef} className="overflow-x-auto pt-3 pb-1">
      <div className="relative flex justify-between items-start min-w-[600px] px-4">
        {/* Progress Line */}
        <div className="absolute top-5 right-10 left-10 h-0.5 bg-surface-muted -z-0" />
        <div
          className="absolute top-5 right-10 h-0.5 bg-brand transition-all duration-700 ease-in-out -z-0"
          style={{ width: `${Math.max(0, (currentIdx / (activeStages.length - 1)) * 100)}%` }}
        />

        {activeStages.map((status, idx) => {
          const config = getOrderStatusDisplay(status, stages || []);
          const Icon = config.icon;
          const isCompleted = idx <= currentIdx;
          const isActive = idx === currentIdx;

          return (
            <div key={status} ref={isActive ? activeStageRef : undefined} className="relative flex flex-col items-center gap-3 z-10">
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center transition-all duration-500 border-4 border-surface shadow-sm",
                isCompleted ? "bg-brand text-white" : "bg-surface-muted text-content-muted",
                isActive && "ring-8 ring-brand/10 scale-110 shadow-lg"
              )}>
                <Icon size={18} />
                {isCompleted && !isActive && idx < currentIdx && (
                  <motion.div 
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -top-1 -right-1 bg-success text-white rounded-full p-0.5 border-2 border-surface"
                  >
                    <CheckCircle2 size={10} />
                  </motion.div>
                )}
              </div>
              <div className="flex flex-col items-center">
                <span className={cn(
                  "text-[10px] font-black text-center whitespace-nowrap px-2 py-1 rounded-lg transition-colors",
                  isActive ? "text-brand bg-brand/5" : isCompleted ? "text-brand" : "text-content-muted"
                )}>
                  {t(config.labelKey)}
                </span>
                {isActive && (
                  <motion.div 
                    layoutId="active-indicator"
                    className="w-1 h-1 bg-brand rounded-full mt-1"
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
};

const PAYMENT_METHODS = [
  { id: 'cash', labelKey: 'common.payment_methods.cash', icon: ShoppingBag },
  { id: 'network', labelKey: 'common.payment_methods.network', icon: CreditCard },
  { id: 'cash_on_delivery', labelKey: 'common.payment_methods.cash_on_delivery', icon: Truck },
  { id: 'partial', labelKey: 'common.payment_methods.partial', icon: Clock },
];

export default function Orders({ tenantId }: { tenantId: string }) {
  const { t, i18n } = useTranslation();
  // Unsupported browsers render VoiceMicButton as null -- without this
  // gate, the empty mic wrapper would still show as a blank bordered icon
  // box next to the scan button / notes textarea where none existed
  // before voice input.
  const voiceSupported = isSpeechRecognitionSupported();
  const router = useRouter();
  const refreshCounter = useRefreshCounter();
  const { settings: branding } = useBranding();
  const { error: toastError, success: toastSuccess, warning: toastWarning, handleError } = useToast();
  const { confirm } = useConfirm();
  const measurementUnit = useMeasurementUnit(tenantId);
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [unpaidOrders, setUnpaidOrders] = useState<Order[]>([]);
  const [dueDetailsCustomer, setDueDetailsCustomer] = useState<Customer | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [search, setSearch] = useState('');
  // مراجعة-الفريق-التقني-الكامل-2026-10-19.md (أداء): debounce قبل الفلترة --
  // الحقل نفسه يبقى مربوطاً بـsearch (استجابة فورية للكتابة)، filteredOrders
  // وحدها تستخدم القيمة المؤجَّلة.
  const debouncedSearch = useDebouncedValue(search, 250);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isInvoiceOpen, setIsInvoiceOpen] = useState(false);
  // Bug report (2026-11-16): InvoiceModal used to reconstruct a fake
  // invoice straight from the order's own fields (order.items,
  // order.totalAmount...) instead of the real tax_invoices-backed
  // document POS and the tax-invoice registry show -- same data/
  // component fetchTaxInvoiceForOrder + TaxInvoiceDocument already
  // provide elsewhere. loadRealInvoiceForOrder is the one fetch shared
  // by openInvoiceView below and handlePrintOrder's quick-print path, so
  // both show/print the same real invoice.
  const [invoiceViewData, setInvoiceViewData] = useState<{ invoice: TaxInvoice; tenant: Tenant } | null>(null);
  const [invoiceViewError, setInvoiceViewError] = useState(false);
  const loadRealInvoiceForOrder = async (order: Order) => {
    try {
      const result = await fetchTaxInvoiceForOrder(tenantId, order.id);
      setInvoiceViewData(result);
      setInvoiceViewError(!result);
      return result;
    } catch (err) {
      handleFirestoreError(err as any, OperationType.GET, 'tax_invoices');
      setInvoiceViewData(null);
      setInvoiceViewError(true);
      return null;
    }
  };
  // Bug report (2026-11-16, second report): InvoiceModal used to fetch
  // inside its own mount `useEffect`. InvoiceModal/OrderDetailsDrawer/etc.
  // are defined as plain `const Foo = () => ...` INSIDE this component's
  // render body (a pre-existing pattern throughout this file) -- every
  // render of Orders recreates them as new function references, so React
  // treats each one as a different component type at that JSX position
  // and remounts it. That's harmless for a component with no mount
  // effect of its own, but InvoiceModal's effect called setInvoiceViewData
  // -- a re-render of Orders itself -- which created a fresh InvoiceModal
  // reference, remounted it, re-ran the effect, and looped forever (the
  // reported "shows and hides repeatedly"). The fetch now runs once, from
  // the click itself, not from a mount effect -- a remount after that has
  // nothing left to trigger.
  const openInvoiceView = (order: Order) => {
    if (!canViewInvoice) {
      toastError(t('orders.no_invoice_permission', 'لا تملك صلاحية عرض الفاتورة'));
      return;
    }
    setSelectedOrder(order);
    setIsInvoiceOpen(true);
    setInvoiceViewData(null);
    setInvoiceViewError(false);
    void loadRealInvoiceForOrder(order);
  };
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [pendingStatusUpdate, setPendingStatusUpdate] = useState<{ id: string, status: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [activeTab, setActiveTab] = useState<'active' | 'completed'>('active');
  const [isConfirmDeliveryOpen, setIsConfirmDeliveryOpen] = useState(false);
  // seen-readiness-fixes-task.md P1.4 / OPERATIONS-03: cancelling is confirmed,
  // carries a reason, and gives back any money paid (cancel_order).
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);
  const [openStatusDropdownId, setOpenStatusDropdownId] = useState<string | null>(null);

  const [whatsappModalOpen, setWhatsappModalOpen] = useState(false);
  const [pendingWhatsAppOrder, setPendingWhatsAppOrder] = useState<Order | null>(null);
  // Which message the pending-phone-number modal below should send once the
  // cashier types in a number -- the invoice link (sendToWhatsApp) or the
  // public tracking link (sendTrackingLink). Same modal, same order, two
  // possible messages.
  const [whatsappModalMode, setWhatsappModalMode] = useState<'invoice' | 'tracking'>('invoice');
  const [searchParams] = useSearchParams();
  const { currentStaff } = useStaff();
  const { user: currentAuthUser } = useAuth();
  const { workflowStages, isLegacyVertical, orderItemFields, capabilities } = useVerticalConfig();
  const tv = useVerticalTerms();
  const { hasPermission, checkPermission } = usePermissions(currentStaff);

  // قائمة مفاتيح الحالة المتاحة للاختيار (شريط التحديث السريع + قوائم الحالة المنسدلة
  // + فلتر الحالة). لمستأجري mens_tailoring نفس ORDER_STAGES القديم حرفياً بلا تغيير؛
  // لأي نشاط آخر تُبنى من vertical_workflow_stages الفعلية لهذا النشاط.
  const statusOptions = useMemo(() => (
    isLegacyVertical || workflowStages.length === 0
      ? (Object.keys(STATUS_CONFIG) as OrderStatus[])
      : workflowStages.map((s) => s.stage_key)
  ), [isLegacyVertical, workflowStages]);

  const canCreate = hasPermission('orders.create');
  const canEdit = hasPermission('orders.edit');
  const canDelete = hasPermission('orders.delete');
  const canRefund = hasPermission('action.refund');
  const canDiscount = hasPermission('action.discount');
  // seen-permissions-fix-task.md Phase 4: every action on this page follows
  // the permission the settings screen shows (the server checks the same).
  // canRefund/canDiscount have no control on this page: returns live in
  // Sales > Returns and discounts in the order form/POS, each gated there.
  void canRefund; void canDiscount;
  // P4 (OPERATIONS-06): the order being changed after it was saved.
  const [editOrderId, setEditOrderId] = useState<string | null>(null);
  const canUpdateStatus = hasPermission('orders.update_status');
  const canCollect = hasPermission('payments.collect');
  const canViewDetails = hasPermission('orders.view_details');
  const canViewPrices = hasPermission('payments.view_prices');
  const canViewInvoice = hasPermission('invoices.view');
  // Amounts for whoever may see prices (by default not the tailor).
  const money = (amount: number | null | undefined) =>
    canViewPrices ? <PriceDisplay amount={amount as number} /> : <span className="text-content-muted">—</span>;
  const openDetails = (order: Order) => {
    if (!canViewDetails) return;
    setSelectedOrder(order);
    setIsDetailsOpen(true);
  };

  // The new-order form itself is the shared TailoringOrderForm; this page only
  // opens it (optionally with a customer preselected) and lists what it saves.
  const [newOrderCustomerId, setNewOrderCustomerId] = useState<string | undefined>(undefined);
  // The move to cutting waiting on its fabric quantities to be confirmed.
  const [cuttingPrompt, setCuttingPrompt] = useState<{ id: string; status: string; notes?: string; lines: CuttingFabricLine[] } | null>(null);
  const [isCuttingBusy, setIsCuttingBusy] = useState(false);

  // The measurements an order shows: the snapshot stored on its lines when it
  // has one (orders made through create_tailoring_order), so a later edit to
  // the customer does not rewrite an existing order; the customer's current
  // measurements for older orders, which never stored a copy.
  const orderMeasurements = (order: Order) => {
    const snapshot = (order.items || []).map((item: any) => item?.measurements).find(
      (m: any) => m && typeof m === 'object' && Object.keys(m).length > 0
    );
    return snapshot || customers.find(c => c.id === order.customerId)?.measurements;
  };

  const handleOpenModal = useCallback((customCustId?: string) => {
    if (!canCreate) return;
    setNewOrderCustomerId(customCustId || undefined);
    setIsModalOpen(true);
  }, [canCreate]);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  // Escape closes whichever of this page's modals/drawers is currently open,
  // topmost (most recently opened) first. The new-order form handles its own.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isModalOpen) return;
      if (isConfirmDeliveryOpen) { setIsConfirmDeliveryOpen(false); return; }
      if (isPaymentModalOpen) { setIsPaymentModalOpen(false); return; }
      if (isInvoiceOpen) { setIsInvoiceOpen(false); return; }
      if (isDetailsOpen) { setIsDetailsOpen(false); return; }
      if (dueDetailsCustomer) { setDueDetailsCustomer(null); return; }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isConfirmDeliveryOpen, isPaymentModalOpen, isInvoiceOpen, isDetailsOpen, dueDetailsCustomer, isModalOpen]);

  const mapOrderData = useCallback((o: any): Order => {
    if (!o) return o;
    const decoded = decodeOrderRow(o);
    return {
      ...decoded,
      // status_key (نص حر، يعكس المرحلة الفعلية لأي نشاط) يتقدّم على status
      // (enum order_status القديم، مقيّد بتسميات الخياطة الرجالية فقط) متى
      // كان موجوداً. الطلبات القديمة السابقة لهذه الهجرة لا تملك status_key
      // بعد (NULL) فترجع لـstatus كما كانت دائماً — صفر تغيير لها.
      status: decoded.status_key || decoded.status,
      customerId: decoded.customer_id ?? decoded.customerId,
      customerName: decoded.customer_name ?? decoded.customerName,
      tenantId: decoded.tenant_id ?? decoded.tenantId,
      branchId: decoded.branch_id ?? decoded.branchId,
      shiftId: decoded.shift_id ?? decoded.shiftId,
      totalAmount: decoded.total_amount ?? decoded.totalAmount,
      paidAmount: decoded.paid_amount ?? decoded.paidAmount,
      remainingAmount: decoded.remaining_amount ?? decoded.remainingAmount,
      taxAmount: decoded.tax_amount ?? decoded.taxAmount,
      taxRate: decoded.tax_rate ?? decoded.taxRate,
      orderDate: decoded.order_date ?? decoded.orderDate,
      deliveryDate: decoded.delivery_date ?? decoded.deliveryDate,
      createdBy: decoded.created_by ?? decoded.createdBy,
      subTotalAmount: decoded.subtotal_amount ?? decoded.subTotalAmount,
      discountAmount: decoded.discount_amount ?? decoded.discountAmount,
      orderNumber: decoded.order_number ?? decoded.orderNumber,
      paymentMethod: decoded.payment_method ?? decoded.paymentMethod,
      trackingToken: decoded.tracking_token ?? decoded.trackingToken,
      kind: decoded.kind,
      fabricDeductedAt: decoded.fabric_deducted_at ?? decoded.fabricDeductedAt,
      items: Array.isArray(decoded.items) ? decoded.items : [],
      history: Array.isArray(decoded.history) ? decoded.history : []
    } as Order;
  }, []);

  const applyOrders = useCallback((allOrders: Order[]) => {
    const trackingOrders = allOrders.filter(order =>
      !(order as any).isPosSale &&
      (!order.items || order.items.length === 0 || order.items.some((item: any) => !item.type || item.type === 'custom'))
    );
    setOrders(trackingOrders);

    const unpaid = allOrders.filter(o => o.remainingAmount > 0 && o.status !== 'cancelled');
    setUnpaidOrders(unpaid);
  }, []);

  // Phase 3 of seen-offline-coverage-and-performance-task.md. Orders.tsx
  // keeps a deliberately lighter touch than the other six tabs: `orders`/
  // `unpaidOrders` stay plain useState, patched directly by five separate
  // optimistic-update call sites after the user's own mutations (create,
  // two status-update paths, delete, payment recording) -- those are left
  // completely untouched here, since retargeting five financially/
  // operationally sensitive call sites at a shared query cache carried far
  // more regression risk than this task's benefit justifies. Only the FETCH
  // itself moves to react-query: this query owns the raw, unfiltered order
  // list, and an effect below feeds every successful fetch through the same
  // applyOrders() the old fetchOrders used, so the two derived views end up
  // identical to before.
  const ordersQueryKey = ['orders', tenantId];
  const ordersQuery = useQuery<Order[]>({
    queryKey: ordersQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('order_date', { ascending: false });
      if (error) throw error;

      // Bug report (2026-11-17): "في قسم الطلبات المكتمله تظهر سجلات ليست
      // طلبات تفصيل" -- a POS ready-made sale ends up in this tailoring
      // order-tracking list alongside real تفصيل orders. Root cause: a POS
      // checkout's own order.items (the field applyOrders filters on below)
      // always decodes empty here -- create_pos_sale writes its items into
      // order_items, a table this page's own order-tracking form never
      // touches at all, never into orders.notes's V2 metadata the way a
      // تفصيل order created directly in "الطلبات" does -- so the filter's
      // "no items on this order" branch let every POS sale through too.
      // order_items existing at all for an order IS the POS-sale signal
      // (only create_pos_sale ever inserts there), so fetch that set once
      // here and let applyOrders use it instead of guessing from items.
      // The three reads below do not depend on each other or on the orders
      // themselves, so they go out together.
      //  - order ids that have any order_items row: a ready-made POS sale.
      //  - custom-type rows in full: the tailoring lines. They live in
      //    order_items since create_tailoring_order (and always did for a
      //    tailoring line sold through the old POS cart), so "has order_items
      //    rows" alone no longer means a ready-made sale.
      //  - order_history of tailoring-kind orders, which keep their history
      //    there rather than in notes.
      const [
        { data: itemRows, error: itemsError },
        { data: customRows, error: customError },
        { data: historyRows, error: historyError },
      ] = await Promise.all([
        supabase.from('order_items').select('order_id').eq('tenant_id', tenantId),
        supabase.from('order_items').select('*').eq('tenant_id', tenantId).eq('type', 'custom'),
        supabase
          .from('order_history')
          .select('order_id, status, notes, updated_at, updated_by_name, updated_by_staff, orders!inner(kind)')
          .eq('tenant_id', tenantId)
          .eq('orders.kind', 'tailoring')
          .order('updated_at', { ascending: true }),
      ]);
      if (itemsError) throw itemsError;
      if (customError) throw customError;
      if (historyError) console.warn('[Orders] order history unavailable:', historyError);
      const ordersWithItemRows = new Set((itemRows || []).map((r) => r.order_id));

      const linesByOrder = new Map<string, any[]>();
      (customRows || []).forEach((row: any) => {
        const list = linesByOrder.get(row.order_id) || [];
        list.push(orderItemRowToLine(row));
        linesByOrder.set(row.order_id, list);
      });

      const historyByOrder = new Map<string, OrderHistory[]>();
      (historyRows || []).forEach((row: any) => {
        const list = historyByOrder.get(row.order_id) || [];
        list.push({
          status: row.status,
          updatedAt: row.updated_at,
          updatedBy: row.updated_by_name || '',
          updatedByUid: row.updated_by_staff || undefined,
          notes: row.notes || '',
        } as OrderHistory);
        historyByOrder.set(row.order_id, list);
      });

      const allOrders = (data || []).map((o) => {
        const mapped = mapOrderData(o);
        const lines = linesByOrder.get(o.id);
        const isTailoringKind = o.kind === 'tailoring';
        // Orders made before create_tailoring_order still carry their lines
        // in notes; those win when present.
        const items = lines && (isTailoringKind || mapped.items.length === 0) ? lines : mapped.items;
        return {
          ...mapped,
          items,
          history: isTailoringKind ? (historyByOrder.get(o.id) || mapped.history) : mapped.history,
          isPosSale: ordersWithItemRows.has(o.id) && !lines && !isTailoringKind,
        } as Order;
      });
      refreshOrdersCache(tenantId, allOrders).catch(() => {});
      return allOrders;
    },
    enabled: !!tenantId,
    staleTime: 30_000,
    // react-query's default refetchOnReconnect (true, never overridden in
    // App.tsx's QueryClient) would race drainOutbox() on the exact same
    // connectivity-restored event: a refetch that lands before the outbox
    // finishes syncing a just-created offline order returns the
    // server's list WITHOUT it yet, and the effect below applies that
    // fetch verbatim -- wiping a just-printed order from view until the
    // next refetch. Off here specifically because this is the one query
    // with real offline writes queued against it; the realtime
    // subscription's own invalidateQueries and the 30s staleTime both
    // still keep it fresh for every other case (another device's
    // changes while this one was offline).
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (ordersQuery.data) applyOrders(ordersQuery.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordersQuery.data]);

  useEffect(() => {
    if (!tenantId || queryClient.getQueryData(ordersQueryKey)) return;
    getCachedOrders(tenantId).then(cached => {
      if (cached.length && !queryClient.getQueryData(ordersQueryKey)) {
        queryClient.setQueryData(ordersQueryKey, cached);
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  useEffect(() => {
    if (!ordersQuery.error) return;
    console.error('Error fetching orders:', ordersQuery.error);
    // Offline (or otherwise unreachable) fallback: getCachedOrders/
    // ordersQuery.data already cover showing the last known list (either
    // via the seed effect above or react-query's own retained data) -- this
    // just decides whether that deserves a "may be stale" notice or a real
    // error.
    if (isNetworkFailure(ordersQuery.error)) {
      if (ordersQuery.data?.length) {
        toastWarning(t('offline.showing_cached_orders', 'يتم عرض الطلبات المخزَّنة من آخر اتصال، قد لا تكون محدَّثة.'));
      }
    } else {
      handleFirestoreError(ordersQuery.error, OperationType.LIST, 'orders');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordersQuery.error]);

  // fetchOrders keeps its old name/signature so the two call sites below
  // (a realtime event, and a manual "refresh everything" effect) don't need
  // to change at all -- it's now a thin wrapper around the query's own
  // refetch instead of a standalone fetch+setState implementation.
  const fetchOrders = useCallback(async () => {
    await ordersQuery.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordersQuery.refetch]);

  useRealtimeSync('orders', tenantId, () => {
    fetchOrders();
  }, () => { void fetchOrders(); }); // P3.4: after a drop, once the queue has synced

  useEffect(() => {
    if (!tenantId) return;

    const fetchData = async () => {
      try {
        // Phase 5 of seen-offline-coverage-and-performance-task.md: none
        // of these four reads depends on another's result -- they were
        // fetched sequentially before, adding three extra network round
        // trips before this screen could finish loading.
        const [{ data: custData }, { data: staffData }, { data: tenantData }] = await Promise.all([
          supabase.from('customers').select('*').eq('tenant_id', tenantId),
          // pin_hash intentionally excluded — never expose bcrypt PIN hashes
          // in a multi-row listing (see security note in Staff.tsx).
          supabase.from('staff').select('id, tenant_id, uid, name, email, phone, role, role_id, branch_id, status, must_change_pin, is_test, commission_type, commission_value, has_seen_onboarding, created_at, updated_at').eq('tenant_id', tenantId),
          supabase.from('tenants').select('*').eq('id', tenantId).maybeSingle(),
        ]);

        const mappedCusts = (custData || []).map(c => ({
          ...c,
          isTest: c.is_test,
          isB2B: c.is_b2b,
          createdAt: c.created_at,
          tenantId: c.tenant_id
        }) as unknown as Customer);
        setCustomers(mappedCusts);

        setStaff((staffData as unknown as Staff[]) || []);

        if (tenantData) {
          // One reading of the shop's tax settings (utils/taxSettings.ts).
          const resolvedTax = resolveTaxSettings(tenantData);

          const mappedTenant = {
            ...tenantData,
            ownerEmail: tenantData.owner_email,
            inventoryStrategy: tenantData.inventory_strategy,
            createdAt: tenantData.created_at,
            vatNumber: tenantData.vat_number || resolvedTax.trn,
            taxSettings: resolvedTax,
            customerId: tenantData.customer_id
          } as unknown as Tenant;
          setTenant(mappedTenant);
        }
      } catch (error) {
        handleFirestoreError(error as any, OperationType.LIST, 'data');
      }
    };

    const fetchAll = async () => {
      setIsLoading(true);
      await Promise.all([fetchOrders(), fetchData()]);
      setIsLoading(false);
    };
    fetchAll();

    const handleDataCleared = () => {
      fetchAll();
    };
    window.addEventListener('data_cleared', handleDataCleared);
    return () => {
      window.removeEventListener('data_cleared', handleDataCleared);
    };
  }, [tenantId, mapOrderData, refreshCounter]);

  useEffect(() => {
    const customerId = searchParams.get('customerId');
    if (customerId && customers.length > 0) {
      handleOpenModal(customerId);
    }
  }, [searchParams, customers, handleOpenModal]);

  useEffect(() => {
    let barcodeBuffer = '';
    let barcodeTimeout: NodeJS.Timeout;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Allow rapid scanning from anywhere
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Enter') {
          // If they pressed Enter in the search box
          if ((e.target as HTMLInputElement).dataset.ordersSearch) {
             const searchLower = search.toLowerCase();
             const localFiltered = orders.filter(o => {
               const orderNumberStr = o.orderNumber ? o.orderNumber.toString() : '';
               const invoiceNumberStr = (o as any).invoiceNumber ? String((o as any).invoiceNumber).toLowerCase() : '';
               return (o.customerName || '').toLowerCase().includes(searchLower) ||
                      o.id.toLowerCase().includes(searchLower) ||
                      searchLower.includes(o.id.toLowerCase()) ||
                      orderNumberStr.includes(searchLower) ||
                      invoiceNumberStr.includes(searchLower) ||
                      searchLower.includes(invoiceNumberStr);
             });
             if (localFiltered.length === 1) {
                 openInvoiceView(localFiltered[0]);
             }
          }
        }
        return;
      }

      if (e.key === 'Enter') {
        if (barcodeBuffer.length > 2) {
          const scanned = barcodeBuffer.toLowerCase();
          const matchedOrder = orders.find(o => 
             (o as any).invoiceNumber?.toString().toLowerCase() === scanned ||
             o.orderNumber?.toString().toLowerCase() === scanned ||
             o.id.toLowerCase() === scanned
          );
          if (matchedOrder) {
             setSearch(scanned);
             openInvoiceView(matchedOrder);
          } else {
             // Try searching just by includes to be safe
             const partialMatch = orders.find(o =>
                 (o as any).invoiceNumber?.toString().toLowerCase().includes(scanned) ||
                 o.orderNumber?.toString().toLowerCase().includes(scanned) ||
                 o.id.toLowerCase().includes(scanned)
             );
             if (partialMatch) {
                 setSearch(scanned);
                 openInvoiceView(partialMatch);
             }
          }
        }
        barcodeBuffer = '';
      } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        barcodeBuffer += e.key;
        clearTimeout(barcodeTimeout);
        barcodeTimeout = setTimeout(() => {
          barcodeBuffer = '';
        }, 50); // Scanners are very fast, usually < 30ms per character
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
      clearTimeout(barcodeTimeout);
    };
  }, [orders, search]);


  const VisualPart = ({ label, icon: Icon, value, options, onChange }: any) => (
    <div className="space-y-2">
      <label className="text-xs font-bold text-content-muted uppercase tracking-widest flex items-center gap-2">
        <Icon size={14} className="text-brand" />
        {label}
      </label>
      <div className="grid grid-cols-2 gap-2">
        {options.map((opt: any) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={cn(
              "flex flex-col items-center gap-2 p-3 rounded-2xl border-2 transition-all group",
              value === opt.id 
                ? "border-brand bg-brand/5 text-brand shadow-lg shadow-brand/10" 
                : "border-border bg-surface text-content-muted hover:border-brand/20 hover:bg-surface-muted"
            )}
          >
            <div className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110",
              value === opt.id ? "bg-brand text-white" : "bg-surface-muted text-content-muted"
            )}>
              {opt.icon}
            </div>
            <span className="text-[10px] font-black">{opt.label}</span>
          </button>
        ))}
      </div>
    </div>
  );

  // What the shared form reports after a save: show the new order in the lists
  // right away, the same optimistic update the old in-page save did.
  const handleOrderCreated = (row: Record<string, any>, { queuedOffline }: { queuedOffline: boolean }) => {
    const mappedNewOrder = mapOrderData(row);
    if (mappedNewOrder.items.some((item: any) => item.type === 'custom' || !item.type)) {
      setOrders(prev => [mappedNewOrder, ...prev.filter(o => o.id !== mappedNewOrder.id)]);
    }
    if (mappedNewOrder.remainingAmount > 0 && mappedNewOrder.status !== 'cancelled') {
      setUnpaidOrders(prev => [mappedNewOrder, ...prev.filter(o => o.id !== mappedNewOrder.id)]);
    }
    if (!queuedOffline) router.refresh();
  };

  const confirmCancel = async () => {
    if (!cancelTarget || cancelReason.trim().length < 3) return;
    setIsCancelling(true);
    try {
      const { data, error } = await supabase.rpc('cancel_order', {
        p_operation_id: globalThis.crypto.randomUUID(),
        p_order_id: cancelTarget.id,
        p_reason: cancelReason.trim(),
      });
      if (error) throw error;
      const patch = (o: Order) => (o.id === cancelTarget.id ? { ...o, status: 'cancelled' as any } : o);
      setOrders(prev => prev.map(patch));
      toastSuccess(Number(data?.refunded) > 0
        ? t('orders.cancel_done_refunded', { amount: Number(data.refunded).toFixed(2) })
        : t('orders.cancel_done'));
      setCancelTarget(null);
    } catch (error) {
      toastError(dbRefusalMessage(error) ?? t('orders.cancel_failed'));
    } finally {
      setIsCancelling(false);
    }
  };

  const updateStatus = async (id: string, status: string, notes?: string) => {
    setOpenStatusDropdownId(null);
    const order = orders.find(o => o.id === id);
    if (!order) return;
    if (!canUpdateStatus) {
      toastError(t('orders.no_status_permission', 'لا تملك صلاحية تغيير حالة الطلب'));
      return;
    }

    // Prevent any changes if order is already delivered (locked)
    if (order.status === 'delivered') {
      toastError(t('orders.cannot_edit_delivered'));
      return;
    }

    // Cancelling is never one tap: it is confirmed, with a reason, and any
    // money paid is given back from a shift (P1.4, OPERATIONS-03).
    if (legacyOrderStatusFor(status, workflowStages) === 'cancelled') {
      setCancelReason('');
      setCancelTarget(order);
      return;
    }

    // Prevent delivery if there's a remaining balance
    if (status === 'delivered') {
      const remaining = Number(order.remainingAmount || 0);
      if (remaining > 0) {
        toastError(t('orders.cannot_deliver_unpaid'));
        // Settling it first needs payments.collect.
        if (!canCollect) return;
        setPendingStatusUpdate({ id, status });
        setSelectedOrder(order);
        setIsPaymentModalOpen(true);
        return;
      } else {
        // If balance is 0, show confirmation modal
        setPendingStatusUpdate({ id, status });
        setIsConfirmDeliveryOpen(true);
        return;
      }
    }

    // The move that first takes the order to cutting (or past it) deducts its
    // fabric. Show the quantities first; the deduction runs on the server with
    // the status change once they are confirmed.
    const fabricLines = cuttingFabricLines(order.items);
    const deductionDue = isFabricDeductionDue({
      currentStatus: legacyOrderStatusFor(order.status, workflowStages),
      targetStatus: legacyOrderStatusFor(status, workflowStages),
      fabricDeductedAt: (order as any).fabricDeductedAt,
      kind: (order as any).kind,
    });
    if (deductionDue && fabricLines.length > 0) {
      setCuttingPrompt({ id, status, notes, lines: fabricLines });
      return;
    }

    await performStatusUpdate(order, status, notes);
  };

  const performStatusUpdate = async (order: Order, status: string, notes?: string, fabricLines?: CuttingFabricLine[]) => {
    const id = order.id;
    try {
      const historyEntry: OrderHistory = {
        status,
        updatedAt: new Date().toISOString(),
        updatedBy: currentStaff?.name || t('common.roles.owner'),
        updatedByUid: currentStaff?.id || currentAuthUser?.id,
        notes: notes || t('orders.status_change_note', { status: t(getOrderStatusDisplay(status, workflowStages).labelKey) })
      };

      const updatedHistory = [...(order.history || []), historyEntry];

      // update_order_status (20261124000000): 20261122000000 narrowed direct
      // orders UPDATE to owner/admin/manager, which silently no-op'd this
      // status change for cashier/tailor. The RPC bypasses RLS with its own
      // role check (owner/admin/manager/cashier/tailor, matching the
      // /orders route). history/items aren't real columns (see
      // orderHistoryHelper.ts) -- encodeOrderRow packs them into notes the
      // same way the fetch interceptor does for a direct table write, so
      // decodeOrderRow on read still finds them.
      const encodedNotes = encodeOrderRow({ notes: order.notes, history: updatedHistory, items: order.items || [] }).notes;
      const statusArgs = {
        p_order_id: id,
        // status_key: القيمة الفعلية الحرة لأي نشاط. status: enum قديم ثابت —
        // يبقى دوماً صالحاً عبر legacyOrderStatusFor (انظر تعليق verticalService.ts).
        p_status: legacyOrderStatusFor(status, workflowStages),
        p_status_key: status,
        p_notes: encodedNotes,
        p_op_id: globalThis.crypto.randomUUID(),
        p_history_note: historyEntry.notes
      };
      // With reviewed fabric lines the deduction and the status change are one
      // server transaction: short stock fails both.
      const { error } = fabricLines
        ? await supabase.rpc('update_order_status_with_fabric', {
            ...statusArgs,
            p_fabric_lines: fabricLines.map((line) => ({ line_key: line.lineKey, fabric_id: line.fabricId, meters: line.meters })),
          })
        : await supabase.rpc('update_order_status', statusArgs);

      if (error) throw error;

      // Realtime local update
      const patch = (o: Order) => o.id === id
        ? {
            ...o, status, history: updatedHistory,
            ...(fabricLines ? {
              // Mirrors the server: stamped only when something was deducted.
              ...(fabricLines.some((l) => l.meters > 0) ? { fabricDeductedAt: new Date().toISOString() } : {}),
              items: (o.items || []).map((item: any, index: number) => {
                const line = fabricLines.find((l) => l.lineKey === (item.id ? String(item.id) : `idx-${index}`));
                return line ? { ...item, consumedMeters: line.meters } : item;
              }),
            } : {}),
          } as Order
        : o;
      setOrders(prev => prev.map(patch));
      setUnpaidOrders(prev => prev.map(patch));
      setCuttingPrompt(null);

      void notifyOrderStatusChange(id);
      router.refresh();
      toastSuccess(t('orders.status_updated_success'));
    } catch (error) {
      handleFirestoreError(error as any, OperationType.UPDATE, 'orders');
    }
  };

  const confirmDelivery = async () => {
    if (!pendingStatusUpdate) return;
    
    try {
      const { id, status } = pendingStatusUpdate;
      const order = orders.find(o => o.id === id);
      if (!order) return;

      const historyEntry: OrderHistory = {
        status,
        updatedAt: new Date().toISOString(),
        updatedBy: currentStaff?.name || t('common.owner'),
        updatedByUid: currentStaff?.id || currentAuthUser?.id,
        notes: t('orders.order_delivered_closed_note')
      };

      const updatedHistory = [...(order.history || []), historyEntry];

      // update_order_status (20261124000000): same fix as updateStatus()
      // above -- this direct-UPDATE path was also silently blocked for
      // cashier/tailor by 20261122000000's role guard.
      const encodedNotes = encodeOrderRow({ notes: order.notes, history: updatedHistory, items: order.items || [] }).notes;
      const { error } = await supabase.rpc('update_order_status', {
        p_order_id: id,
        p_status: legacyOrderStatusFor(status, workflowStages),
        p_status_key: status,
        p_notes: encodedNotes,
        p_op_id: globalThis.crypto.randomUUID(),
        p_history_note: historyEntry.notes
      });

      if (error) throw error;

      // Realtime local update
      setOrders(prev => prev.map(o => o.id === id ? { ...o, status, history: updatedHistory } : o));
      setUnpaidOrders(prev => prev.filter(o => o.id !== id));

      // Track Order Delivered
      analytics.track(AnalyticsEvent.ORDER_DELIVERED, {
        order_id: id,
        customer_id: order.customerId,
        total_amount: order.totalAmount
      });

      void notifyOrderStatusChange(id);
      setIsConfirmDeliveryOpen(false);
      setPendingStatusUpdate(null);
      router.refresh();
      toastSuccess(t('orders.order_delivered_success'));
    } catch (error) {
      handleFirestoreError(error as any, OperationType.UPDATE, 'orders');
    }
  };

  const handleDelete = async (id: string, orderNumber: string) => {
    const allowed = await checkPermission('orders.delete', t('orders.manage_orders'));
    if (!allowed) return;

    if (await confirm({ description: t('orders.confirm_delete_order'), danger: true })) {
      try {
        const { error } = await supabase
          .from('orders')
          .delete()
          .eq('id', id);
        
        if (error) throw error;
        
        // Realtime local update
        setOrders(prev => prev.filter(o => o.id !== id));
        setUnpaidOrders(prev => prev.filter(o => o.id !== id));

        // Audit Log
        if (currentStaff) {
          await logEmployeeAction(
            tenantId,
            currentStaff.id,
            currentStaff.name,
            'delete_invoice',
            `قوم بحذف الفاتورة / الطلب رقم ${orderNumber}`
          );
        }

        router.refresh();
        toastSuccess(t('orders.order_deleted_success'));
      } catch (error) {
        handleFirestoreError(error as any, OperationType.DELETE, 'orders');
      }
    }
  };

  const handleScan = (decodedText: string) => {
    const scanned = decodedText.toLowerCase();
    const matchedOrder = orders.find(o => 
        (o as any).invoiceNumber?.toString().toLowerCase() === scanned || 
        o.orderNumber?.toString().toLowerCase() === scanned || 
        o.id.toLowerCase() === scanned
    );
    
    if (matchedOrder) {
        setSearch(scanned);
        openInvoiceView(matchedOrder);
        toastSuccess(t('orders.order_found_by_barcode'));
    } else {
        const partialMatch = orders.find(o => 
            (o as any).invoiceNumber?.toString().toLowerCase().includes(scanned) ||
            o.orderNumber?.toString().toLowerCase().includes(scanned) ||
            o.id.toLowerCase().includes(scanned)
        );
        if (partialMatch) {
            setSearch(scanned);
            openInvoiceView(partialMatch);
            toastSuccess(t('orders.order_found_by_barcode'));
        } else {
            toastError(t('orders.order_not_found_by_barcode'));
        }
    }
  };

  const filteredOrders = useMemo(() => {
    const matchesNonSearch = (o: Order) => {
      const matchesStatus = !statusFilter || o.status === statusFilter;

      // Date comparison
      const orderDate = (o.orderDate || '').split('T')[0];
      const matchesDate = (!startDate || orderDate >= startDate) &&
                         (!endDate || orderDate <= endDate);

      // Tab filtering
      const matchesTab = activeTab === 'active' ? o.status !== 'delivered' : o.status === 'delivered';

      return matchesStatus && matchesDate && matchesTab;
    };

    const searchLower = debouncedSearch.toLowerCase();
    const matchesSearchExact = (o: Order) => {
      const orderNumberStr = o.orderNumber ? o.orderNumber.toString() : '';
      // Handle potential invoice number inside the order object if it exists
      const invoiceNumberStr = (o as any).invoiceNumber ? String((o as any).invoiceNumber).toLowerCase() : '';

      // Support scanning the full URL QR code by checking if the search string contains the ID
      return (o.customerName || '').toLowerCase().includes(searchLower) ||
             o.id.toLowerCase().includes(searchLower) ||
             searchLower.includes(o.id.toLowerCase()) ||
             orderNumberStr.includes(searchLower) ||
             invoiceNumberStr.includes(searchLower) ||
             searchLower.includes(invoiceNumberStr);
    };

    const exact = orders.filter(o => matchesNonSearch(o) && matchesSearchExact(o));
    if (exact.length > 0 || !searchLower.trim()) return exact;

    // Exact match found nothing -- voice search may have mis-transcribed a
    // letter in the customer's name. Order/invoice numbers aren't
    // fuzzy-matched: they're scanned or typed exactly, never spoken.
    return orders.filter(o => matchesNonSearch(o) && fuzzyIncludes(o.customerName || '', debouncedSearch));
  }, [orders, debouncedSearch, statusFilter, startDate, endDate, activeTab]);

  // Sprint 2 pagination project (seen-cto-sprint2-pagination-task.md,
  // second batch): renders filteredOrders a page at a time instead of
  // every matching order at once -- render cost only, not a server
  // round-trip. Deliberately NOT a real fetch-side pagination: barcode
  // scanning (handleScan) matches against the full `orders` state
  // directly, five separate optimistic-update call sites patch that same
  // full array, and unpaidOrders/unpaidOrdersByCustomer (customer dues)
  // are derived from the full, unfiltered order list -- none of those
  // read filteredOrders/pagedOrders, so none of them are affected by
  // paging the display. Export (exportData above) still reads
  // filteredOrders directly too, so "export" continues to mean every
  // matching order, not just the visible page.
  const ORDERS_PAGE_SIZE = 20;
  const [ordersPage, setOrdersPage] = useState(0);
  useEffect(() => { setOrdersPage(0); }, [debouncedSearch, statusFilter, startDate, endDate, activeTab]);
  const pagedOrders = useMemo(
    () => filteredOrders.slice(ordersPage * ORDERS_PAGE_SIZE, (ordersPage + 1) * ORDERS_PAGE_SIZE),
    [filteredOrders, ordersPage]
  );

  // Groups unpaidOrders by customerId once (O(n)) instead of re-filtering
  // the whole unpaidOrders array for every row rendered below (was O(n*m)
  // per render -- one full unpaidOrders scan per visible order).
  const unpaidOrdersByCustomer = useMemo(() => {
    const map = new Map<string, Order[]>();
    for (const o of unpaidOrders) {
      if (!o.customerId) continue;
      const list = map.get(o.customerId);
      if (list) list.push(o); else map.set(o.customerId, [o]);
    }
    return map;
  }, [unpaidOrders]);

  const buildOrderWhatsAppMessage = (order: Order, phone: string) => {
    const orderNum = (order.orderNumber?.toString() || order.id).slice(-6).toUpperCase();
    // seen-whatsapp-instant-send-task.md follow-up: /order/:id was never a
    // real route (confirmed in App.tsx -- any unmatched path redirects to
    // "/"), so every invoice message built here sent a dead link despite
    // this being the task's own cited "working" reference implementation.
    // /track/:token is the real, no-auth public tracking page -- same one
    // buildTrackingMessage/sendTrackingLink below already use correctly.
    const invoiceUrl = order.trackingToken ? `${window.location.origin}/track/${order.trackingToken}` : undefined;

    return buildWhatsAppMessage(getWhatsAppTemplate(), {
      customerName: order.customerName,
      orderId: `#${orderNum}`,
      totalAmount: order.totalAmount,
      customerPhone: phone,
      invoiceUrl: invoiceUrl,
      storeName: branding.companyName || t('pos.store_default'),
    });
  };

  const buildTrackingMessage = (order: Order) => t('orders.tracking_link_message', {
    customerName: order.customerName,
    storeName: branding.companyName || t('pos.store_default'),
    url: `${window.location.origin}/track/${order.trackingToken}`,
  });

  const proceedToWhatsApp = (phone: string) => {
    if (!pendingWhatsAppOrder) return;
    const message = whatsappModalMode === 'tracking'
      ? buildTrackingMessage(pendingWhatsAppOrder)
      : buildOrderWhatsAppMessage(pendingWhatsAppOrder, phone);
    sendWhatsAppMessage(phone, message);
    setWhatsappModalOpen(false);
    setPendingWhatsAppOrder(null);
  };

  const sendToWhatsApp = (order: Order) => {
    const customer = customers.find(c => c.id === order.customerId);
    const phone = customer?.phone || order.customerPhone || '';
    // Known customer phone -> send straight to WhatsApp, no extra step.
    // Only prompt for a number when there's none on file.
    if (phone) {
      sendWhatsAppMessage(phone, buildOrderWhatsAppMessage(order, phone));
      return;
    }
    setWhatsappModalMode('invoice');
    setPendingWhatsAppOrder(order);
    setWhatsappModalOpen(true);
  };

  // Sends the public /track/:token link (server-issued, unguessable --
  // see PUBLIC_TRACKING_SPEC.md) over WhatsApp, reusing the exact same
  // send/prompt-for-phone pattern as sendToWhatsApp above rather than a new
  // delivery mechanism.
  const sendTrackingLink = (order: Order) => {
    if (!order.trackingToken) return;
    const customer = customers.find(c => c.id === order.customerId);
    const phone = customer?.phone || order.customerPhone || '';
    if (phone) {
      sendWhatsAppMessage(phone, buildTrackingMessage(order));
      return;
    }
    setWhatsappModalMode('tracking');
    setPendingWhatsAppOrder(order);
    setWhatsappModalOpen(true);
  };

  /**
   * طباعة فاتورة الطلب من أي مكان (زر الطباعة السريعة في القائمة، بطاقة
   * الطلب، أو مربع حوار الفاتورة). تفتح InvoiceModal إن لم تكن مفتوحة
   * وتنتظر تحميل الفاتورة الحقيقية حتى يُركَّب #order-invoice-print-area
   * فعلياً في الـDOM بمحتوى صحيح، ثم تطبع فوراً بلا أي ضغطة إضافية من
   * المستخدم.
   */
  const handlePrintOrder = async (order: Order) => {
    if (!canViewInvoice) {
      toastError(t('orders.no_invoice_permission', 'لا تملك صلاحية عرض الفاتورة'));
      return;
    }
    setSelectedOrder(order);
    setIsInvoiceOpen(true);
    const result = await loadRealInvoiceForOrder(order);
    if (!result) {
      toastError(t('orders.invoice_not_found', 'تعذر العثور على الفاتورة الأصلية لهذا الطلب'));
      return;
    }
    try {
      const { printElementDetailed, getConfiguredPaperSize } = await import('../utils/printManager');
      const res = await printElementDetailed('order-invoice-print-area', {
        paperSize: result.invoice.isB2B ? 'A4' : getConfiguredPaperSize('80mm'),
        title: t('printing.invoice_document_title', { number: order.orderNumber || order.id.slice(-6).toUpperCase() }),
      });
      if (!res.ok) {
        console.error('[Orders] فشل الطباعة:', res.message);
        toastError(t('printing.print_failed'), res.message);
      }
    } catch (e) {
      console.error('[Orders] خطأ الطباعة:', e);
      window.print();
    }
  };

  // The workshop's work card for one order (seen-verticals-readiness-task.md Phase 3).
  const printWorkCard = async (order: Order) => {
    try {
      const { printElementDetailed, getConfiguredPaperSize } = await import('../utils/printManager');
      const res = await printElementDetailed(WORK_CARD_ELEMENT_ID, {
        paperSize: getConfiguredPaperSize('80mm'),
        title: t('orders.work_card_title', 'بطاقة عمل') + ' ' + (order.orderNumber || order.id.slice(-6).toUpperCase()),
      });
      if (!res.ok) toastError(t('printing.print_failed'), res.message);
    } catch (e) {
      console.error('[Orders] work card print failed:', e);
      toastError(t('printing.print_failed'));
    }
  };

  const OrderDetailsDrawer = ({ order }: { order: Order }) => {
    const [isPaying, setIsPaying] = useState(false);
    const [payAmount, setPayAmount] = useState(order.remainingAmount || 0);
    const [payMethod, setPayMethod] = useState<PaymentMethod>('cash');
    const [isProcessing, setIsProcessing] = useState(false);
    // Same component/data the tax-invoice registry and POS's debt
    // settlement use -- the real original invoice, not a reconstruction.
    const [viewingInvoice, setViewingInvoice] = useState<{ invoice: TaxInvoice; tenant: Tenant } | null>(null);
    const [isLoadingInvoice, setIsLoadingInvoice] = useState(false);
    // Orders created directly here (never sold through POS's own
    // checkout) have no tax_invoices row at all -- shown instead of a
    // dead-end "not found" error.
    const [showOrderSummaryFallback, setShowOrderSummaryFallback] = useState(false);

    const handleViewInvoice = async () => {
      setIsLoadingInvoice(true);
      try {
        const result = await fetchTaxInvoiceForOrder(tenantId, order.id);
        if (result) setViewingInvoice(result);
        else setShowOrderSummaryFallback(true);
      } finally {
        setIsLoadingInvoice(false);
      }
    };

    // seen-status-fix-regressions-task.md item 7: explicit "إصدار فاتورة
    // ضريبية" action, shown only to owner/admin/manager/accountant on an
    // order that's fully paid or delivered -- same eligibility the RPC
    // itself enforces server-side. Replaces the old behavior of
    // auto-issuing on every plain view.
    const canIssueInvoice =
      !!currentStaff?.role && ['owner', 'admin', 'manager', 'accountant'].includes(currentStaff.role) &&
      (order.status === 'delivered' || (order.remainingAmount || 0) <= 0);
    const [isIssuingInvoice, setIsIssuingInvoice] = useState(false);
    const handleIssueInvoice = async () => {
      setIsIssuingInvoice(true);
      try {
        const result = await issueTaxInvoiceForOrder(order.id);
        if (!result.ok) {
          toastError(t('tax_invoices.issue_failed', 'تعذّر إصدار الفاتورة'), result.error);
          return;
        }
        const invoice = await fetchTaxInvoiceForOrder(tenantId, order.id);
        if (invoice) {
          setShowOrderSummaryFallback(false);
          setViewingInvoice(invoice);
        }
      } finally {
        setIsIssuingInvoice(false);
      }
    };

    const statusOrder: string[] = [
      'measurements_taken',
      'cutting',
      'sewing',
      'ready',
      'delivered'
    ];

    const currentStatusIndex = statusOrder.indexOf(order.status);

    const handleQuickPayment = async () => {
      if (payAmount <= 0) return;
      setIsProcessing(true);
      try {
        // seen-cto-code-review-2026-11-13.md C9: this used to update
        // `orders.history`/`orders.items` directly -- neither is a real
        // column; a client-only fetch interceptor silently packed them
        // into `notes` as a JSON blob instead, so this "history" was
        // never a real, queryable audit trail. record_order_payment
        // locks the order row and caps the amount at the live remaining
        // balance server-side, instead of this component computing
        // newPaidAmount from a separately-fetched snapshot with no lock
        // between the read and the write.
        const operationId = globalThis.crypto.randomUUID();
        // seen-status-fix-regressions-task.md item 5: attribute this cash to
        // the staff member's own open shift (if any) so close_shift's
        // payments-table sum actually sees it, same as POS.tsx.
        const shiftId = await getOpenShiftId(tenantId, currentStaff?.id);
        const { data: result, error } = await supabase.rpc('record_order_payment', {
          p_operation_id: operationId,
          p_order_id: order.id,
          p_amount: payAmount,
          p_method: payMethod,
          p_shift_id: shiftId,
          p_notes: t('orders.payment_note', { amount: payAmount, method: t(`common.payment_methods.${payMethod}`, payMethod) })
        });

        if (error) throw error;

        const newPaidAmount = Number(result.paid_amount);
        const newRemainingAmount = Number(result.remaining_amount);

        // Keeps the order's original tax invoice (a separate row/column,
        // no DB trigger between them) showing the real current paid/
        // remaining amount instead of staying stuck at whatever it was
        // when the invoice was first issued.
        await syncTaxInvoicePaidAmount(order.id, newPaidAmount);

        // Realtime local update -- only reached once the write above is confirmed
        setOrders(prev => prev.map(o => o.id === order.id ? { ...o, paidAmount: newPaidAmount, remainingAmount: newRemainingAmount } : o));
        setUnpaidOrders(prev => {
          if (newRemainingAmount <= 0) return prev.filter(o => o.id !== order.id);
          return prev.map(o => o.id === order.id ? { ...o, paidAmount: newPaidAmount, remainingAmount: newRemainingAmount } : o);
        });

        // Track Payment Completed
        analytics.track(AnalyticsEvent.PAYMENT_COMPLETED, {
          order_id: order.id,
          amount_paid: payAmount,
          remaining_amount: newRemainingAmount,
          payment_method: payMethod
        });

        setIsPaying(false);
      } catch (error) {
        // ORD-07: on failure, do NOT close the payment UI or touch local
        // state as if the payment succeeded -- show the error and let the
        // merchant retry. The server's own reason when it refuses on purpose (P1.3).
        const refusal = dbRefusalMessage(error);
        if (refusal) { toastError(refusal); return; }
        handleFirestoreError(error as any, OperationType.UPDATE, 'orders');
      } finally {
        setIsProcessing(false);
      }
    };

    return (
      <>
      {/* Bug report (2026-11-16): shown here as a separate centered popup,
          while POS's debt-settlement flow shows the exact same invoice
          inline in a left-side drawer -- same invoice content
          (TaxInvoiceDocument), now the same presentation too, instead of
          two different looks for the same document depending on which
          screen opened it. */}
      <AnimatePresence>
        {viewingInvoice && (
          <div className="fixed inset-0 z-[160] flex items-end lg:items-center justify-center overflow-hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setViewingInvoice(null)}
            />
            <motion.div
              initial={{ y: '100%', x: '100%' }}
              animate={{ y: 0, x: 0 }}
              exit={{ y: '100%', x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="bg-surface w-full lg:w-[450px] md:h-auto lg:h-full h-[90vh] shadow-2xl relative z-10 flex flex-col lg:rounded-none rounded-t-3xl border-t lg:border-t-0 lg:border-r border-border overflow-hidden lg:mr-auto md:max-w-md md:rounded-3xl md:mb-10 lg:max-w-none lg:mb-0 lg:ml-0"
              dir={isRtlLang(i18n.language) ? 'rtl' : 'ltr'}
            >
              <div className="flex-1 overflow-y-auto p-4 lg:p-6">
                <TaxInvoiceDocument
                  order={viewingInvoice.invoice}
                  tenant={viewingInvoice.tenant}
                  onClose={() => setViewingInvoice(null)}
                />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Fallback for an order with no tax_invoices row at all -- created
          directly here, never sold through POS's checkout, so there's no
          real invoice to fetch. Deliberately NOT styled like a tax
          invoice (no QR, no invoice number) to avoid implying one exists. */}
      <AnimatePresence>
        {showOrderSummaryFallback && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md overflow-y-auto font-sans">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative w-full max-w-sm rounded-3xl bg-surface shadow-2xl flex flex-col my-auto border border-border overflow-hidden text-right"
              dir={isRtlLang(i18n.language) ? 'rtl' : 'ltr'}
            >
              <div className="flex items-center justify-between p-6 border-b border-border bg-brand/5 shrink-0">
                <h2 className="text-lg font-black text-content">{t('orders.order_details')}</h2>
                <button
                  onClick={() => setShowOrderSummaryFallback(false)}
                  aria-label={t('common.close')}
                  className="p-2 hover:bg-surface-muted rounded-full transition-colors text-content-muted"
                >
                  <X size={20} />
                </button>
              </div>
              <div id={`order-summary-fallback-${order.id}`} className="p-6 space-y-3 text-sm">
                <p className="text-xs font-bold text-content-muted bg-surface-muted/60 p-2.5 rounded-lg">
                  {t('pos.no_invoice_fallback_notice')}
                </p>
                <div className="flex justify-between"><span className="text-content-muted">{t('pos.customer_name')}</span><span className="font-bold">{order.customerName}</span></div>
                <div className="border-t border-border pt-3 flex justify-between items-center">
                  <span className="text-content-muted">{t('orders.grand_total')}</span>
                  <span className="font-black">{money(order.totalAmount)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-content-muted">{t('pos.paid_amount')}</span>
                  <span className="font-black text-success">{money(order.paidAmount)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-content-muted">{t('orders.remaining_amount')}</span>
                  <span className="font-black text-danger">{money(order.remainingAmount)}</span>
                </div>
              </div>
              <div className="p-6 pt-0 flex flex-col gap-3">
                {canIssueInvoice && (
                  <button
                    type="button"
                    disabled={isIssuingInvoice}
                    onClick={handleIssueInvoice}
                    className="w-full py-3 bg-success text-white rounded-xl font-black text-sm hover:bg-success/90 transition-colors cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    <Receipt size={18} />
                    {isIssuingInvoice ? t('common.loading') : t('tax_invoices.issue_invoice', 'إصدار فاتورة ضريبية')}
                  </button>
                )}
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const { printElementDetailed, getConfiguredPaperSize } = await import('../utils/printManager');
                        const res = await printElementDetailed(`order-summary-fallback-${order.id}`, {
                          paperSize: getConfiguredPaperSize('80mm'),
                          title: t('orders.order_details'),
                        });
                        if (!res.ok) toastError(t('printing.print_failed'), res.message);
                      } catch (e) {
                        console.error('[Orders] خطأ الطباعة:', e);
                        window.print();
                      }
                    }}
                    className="flex-1 py-3 bg-brand text-white rounded-xl font-black text-sm hover:bg-brand/90 transition-colors cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Printer size={18} />
                    {t('tax_invoices.print')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowOrderSummaryFallback(false)}
                    className="px-5 py-3 bg-surface-muted text-content-muted rounded-xl font-bold text-sm hover:bg-border/60 transition-colors cursor-pointer"
                  >
                    {t('common.close')}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <div className="fixed inset-0 z-[60] flex items-end lg:items-center justify-center lg:justify-end overflow-hidden">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          onClick={() => setIsDetailsOpen(false)}
        />
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={t('orders.order_details')}
          initial={{ x: '100%', y: '100%' }}
          animate={{ x: 0, y: 0 }}
          exit={{ x: '100%', y: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className={cn("bg-surface w-full lg:max-w-lg h-[95vh] lg:h-full shadow-2xl relative z-10 flex flex-col lg:rounded-none rounded-t-[3rem] overflow-hidden", isRtlLang(i18n.language) ? "text-right" : "text-left")}
          dir={isRtlLang(i18n.language) ? "rtl" : "ltr"}
        >
          <div className="px-6 py-4 border-b border-border flex justify-between items-center gap-3 bg-brand/5">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-3 bg-brand text-white rounded-xl shrink-0">
                <Info size={22} />
              </div>
              <div className="min-w-0">
                {/* The order number the list shows (#5), not a slice of the internal id. */}
                <h2 className="text-lg font-black text-content truncate">
                  {t('orders.order_details')}{' '}
                  <span className="tabular-nums">#{order.orderNumber ?? order.id.slice(-6).toUpperCase()}</span>
                </h2>
                <p className="text-sm text-content-muted font-bold truncate">{order.customerName || t('orders.unknown_customer')}</p>
              </div>
            </div>
            <button onClick={() => setIsDetailsOpen(false)} aria-label={t('common.close')} className="w-11 h-11 shrink-0 flex items-center justify-center hover:bg-surface rounded-xl transition-colors">
              <X size={22} className="text-content-muted" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Who and when, before anything else. */}
            <section className="grid grid-cols-2 gap-x-4 gap-y-3 bg-surface p-4 rounded-2xl border border-border text-sm">
              <div className="min-w-0">
                <p className="text-content-muted font-bold">{t('orders.customer_label', 'العميل')}</p>
                <p className="font-black text-content truncate">{order.customerName || t('orders.unknown_customer')}</p>
              </div>
              <div className="min-w-0">
                <p className="text-content-muted font-bold">{t('orders.phone_label', 'الجوال')}</p>
                {order.customerPhone ? (
                  <a href={`tel:${order.customerPhone}`} dir="ltr" className="inline-flex items-center gap-1.5 font-black text-brand tabular-nums hover:underline">
                    <Phone size={14} aria-hidden="true" />
                    {order.customerPhone}
                  </a>
                ) : (
                  <p className="font-bold text-content-muted">—</p>
                )}
              </div>
              <div>
                <p className="text-content-muted font-bold">{t('orders.order_date_label', 'تاريخ الطلب')}</p>
                <p className="font-black text-content tabular-nums">{order.orderDate ? new Date(order.orderDate).toLocaleDateString(localeOf(i18n.language)) : '—'}</p>
              </div>
              <div>
                <p className="text-content-muted font-bold">{t('orders.expected_delivery_date')}</p>
                <p className="font-black text-content tabular-nums">{order.deliveryDate ? new Date(order.deliveryDate).toLocaleDateString(localeOf(i18n.language)) : '—'}</p>
              </div>
            </section>

            <OrderStepper currentStatus={order.status} stages={isLegacyVertical ? undefined : workflowStages} />

            {/* Quick Status Updater */}
            <section className="bg-surface p-5 rounded-3xl border border-border space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 size={16} className="text-brand" />
                <h3 className="font-black text-content text-sm">{t('orders.update_status')}</h3>
              </div>
              
              {order.status === 'delivered' || !canUpdateStatus ? (
                <div className="bg-surface-muted p-3.5 rounded-2xl border border-border text-center text-xs font-bold text-content-muted">
                  {order.status === 'delivered'
                    ? t('orders.order_delivered_locked')
                    : t(getOrderStatusDisplay(order.status, workflowStages).labelKey)}
                </div>
              ) : (
                <div className="space-y-2">
                  <SmartSelect
                    value={order.status}
                    onChange={(v) => updateStatus(order.id, v)}
                    className="rounded-2xl p-4 text-sm"
                    options={statusOptions.map((status) => ({
                      value: status,
                      label: t(getOrderStatusDisplay(status, workflowStages).labelKey),
                    }))}
                  />
                </div>
              )}
            </section>

            {/* Payment Status Card */}
            <section className={cn(
              "p-6 rounded-3xl border-2 transition-all",
              order.remainingAmount > 0 ? "bg-danger/5 border-danger/10" : "bg-success/5 border-success/10"
            )}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-black text-content">{t('orders.payment_status')}</h3>
                {order.remainingAmount > 0 ? (
                  <span className="bg-danger text-white text-[10px] px-2 py-1 rounded-full font-bold">{t('orders.partial_balance')}</span>
                ) : (
                  <span className="bg-success text-white text-[10px] px-2 py-1 rounded-full font-bold">{t('orders.fully_paid')}</span>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-content-muted">{t('common.total')}:</span>
                  <span className="font-bold text-content">{money(order.totalAmount)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-content-muted">{t('orders.amount_paid')}:</span>
                  <span className="font-bold text-success">{money(order.paidAmount)}</span>
                </div>
                <div className="flex justify-between text-lg pt-2 border-t border-border/50">
                  <span className="font-bold text-content">{t('orders.remaining_label')}:</span>
                  <span className={cn("font-black", order.remainingAmount > 0 ? "text-danger" : "text-success")}>
                    {money(order.remainingAmount)}
                  </span>
                </div>
              </div>

              {order.remainingAmount > 0 && !isPaying && canCollect && (
                <button 
                  onClick={() => setIsPaying(true)}
                  className="w-full mt-4 bg-brand text-white py-3 rounded-2xl font-bold hover:bg-brand/90 transition-all flex items-center justify-center gap-2 shadow-lg shadow-brand/10"
                >
                  <CreditCard size={18} />
                  {t('orders.pay_remaining')}
                </button>
              )}

              {isPaying && (
                <div className="mt-4 p-4 bg-surface rounded-2xl border border-danger/20 space-y-4 animate-in fade-in slide-in-from-top-2">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-content-muted uppercase">{t('orders.pay_amount_now')}</label>
                    <input
                      type="number"
                      value={payAmount}
                      onChange={(e) => setPayAmount(Number(e.target.value))}
                      className="w-full bg-surface border border-border rounded-xl p-4 text-sm font-black text-content outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {PAYMENT_METHODS.map(m => (
                      <button
                        key={m.id}
                        onClick={() => setPayMethod(m.id as PaymentMethod)}
                        className={cn(
                          "p-2 rounded-xl border text-[10px] font-bold flex flex-col items-center gap-1 transition-all",
                          payMethod === m.id ? "bg-brand border-brand text-white shadow-md" : "bg-surface border-border text-content-muted hover:bg-surface-muted"
                        )}
                      >
                        <m.icon size={16} />
                        {t(m.labelKey)}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={handleQuickPayment}
                      disabled={isProcessing || payAmount <= 0}
                      className="flex-1 bg-brand text-white py-3 rounded-xl font-bold text-sm hover:bg-brand/90 disabled:opacity-50"
                    >
                      {isProcessing ? t('orders.processing') : t('orders.confirm_payment')}
                    </button>
                    <button 
                      onClick={() => setIsPaying(false)}
                      className="px-4 py-3 text-content-muted font-bold text-sm hover:bg-surface-muted rounded-xl"
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* Status Timeline */}
            <section className="space-y-4">
              <h3 className="text-xs font-black text-content-muted uppercase tracking-widest flex items-center gap-2">
                <History size={14} />
                {t('orders.status_history')}
              </h3>
              <div className="space-y-4 relative before:absolute before:right-4 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
                {order.history?.slice().reverse().map((h, idx) => {
                  const updater = staff.find(s => s.id === h.updatedByUid);
                  const isOwner = tenant && (tenant.id === h.updatedByUid || tenant.ownerEmail === h.updatedBy);
                  
                  let updaterName = h.updatedBy;
                  let updaterRole = '';

                  if (updater) {
                    updaterName = updater.name;
                    updaterRole = updater.role === 'tailor' ? tv('common.roles.tailor') : t('orders.employee');
                  } else if (isOwner) {
                    updaterName = tenant.name;
                    updaterRole = t('common.roles.owner');
                  }

                  return (
                    <div key={h.updatedAt + h.status + idx} className="relative pr-10">
                      <div className={cn(
                        "absolute right-2 top-1 w-4 h-4 rounded-full border-4 border-surface shadow-sm z-10",
                        idx === 0 ? "bg-brand animate-pulse" : "bg-content-muted/30"
                      )} />
                      <div className="bg-surface-muted p-4 rounded-2xl border border-border">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex flex-col">
                            <span className={cn("text-xs font-bold", getOrderStatusDisplay(h.status, workflowStages).color)}>
                              {t(getOrderStatusDisplay(h.status, workflowStages).labelKey)}
                            </span>
                            <div className="flex items-center gap-1.5 mt-1">
                              <div className="w-5 h-5 rounded-full bg-surface flex items-center justify-center border border-border">
                                <User size={10} className="text-content-muted" />
                              </div>
                              <span className="text-[10px] text-content-muted font-bold">
                                {updaterName}
                                {updaterRole && <span className="text-content-muted font-medium mr-1">({updaterRole})</span>}
                              </span>
                            </div>
                          </div>
                          <div className="flex flex-col items-end">
                            <DateTimeDisplay date={h.updatedAt} showTime={true} size="xs" />
                          </div>
                        </div>
                        <p className="text-[11px] text-content-muted bg-surface/50 p-2 rounded-lg border border-border">{h.notes}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Customer Measurements -- only for an activity that takes them (Phase 4). */}
            {measurementSetFor(capabilities.body_measurements).length > 0 && orderMeasurements(order) && (
              <section className="space-y-4">
                <h3 className="text-xs font-black text-content-muted uppercase tracking-widest flex items-center gap-2">
                  <Ruler size={14} />
                  {t('orders.customer_measurements')}
                </h3>
                <div className="bg-brand/5 p-6 rounded-3xl border border-brand/10">
                  <div className="grid grid-cols-3 gap-4">
                    {measurementRows(orderMeasurements(order)).map((row) => ({ label: t(row.labelKey), value: row.value })).map((m, i) => {
                      const displayValue = typeof m.value === 'number' ? cmToDisplayUnit(m.value, measurementUnit) : m.value;
                      return (
                        <div key={i} className="text-center">
                          <span className="block text-[10px] text-content-muted font-bold mb-1">{m.label}</span>
                          <span className="text-lg font-black text-brand">{displayValue} <span className="text-[10px] text-content-muted font-bold">{t(unitLabelKey(measurementUnit))}</span></span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            )}

            {/* Items */}
            <section className="space-y-4">
              <h3 className="text-xs font-black text-content-muted uppercase tracking-widest flex items-center gap-2">
                <ShoppingBag size={14} />
                {t('orders.items')}
              </h3>
              <div className="space-y-3">
                {order.items.map((item: any, idx: number) => (
                  <motion.div 
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.1 }}
                    key={item.garmentType + item.fabric + idx} 
                    className="bg-brand/5 p-5 rounded-2xl border border-brand/10 space-y-3 relative overflow-hidden group"
                  >
                    <div className="absolute top-0 right-0 w-16 h-16 bg-brand/5 rounded-bl-[2rem] -z-0 translate-x-4 -translate-y-4 transition-transform group-hover:translate-x-0 group-hover:translate-y-0" />
                    
                    <div className="flex justify-between items-center relative z-10">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-brand text-white flex items-center justify-center font-black text-xs">
                          {idx + 1}
                        </div>
                        <p className="font-black text-content text-sm">{item.garmentType}</p>
                      </div>
                      <span className="text-xs font-black bg-white text-brand px-3 py-1 rounded-full shadow-sm border border-brand/10">x{item.quantity}</span>
                    </div>
                    {/* Fabric / additions / embroidery: the tailoring block, hidden
                        for a vertical that uses no fabric (Phase 3). */}
                    {capabilities.fabric_consumption && (
                    <div className="grid grid-cols-1 gap-2 text-xs text-content-muted font-bold relative z-10">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-brand/30" />
                        <span>{t('orders.fabric')}: <span className="text-content">{item.fabric === 'custom' ? t('orders.external_fabric') : (item.fabric || t('orders.not_specified'))}</span></span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-brand/30" />
                        <span>{t('orders.additions')}: <span className="text-content">{item.additions || t('orders.none')}</span></span>
                      </div>
                      <div className="flex items-center gap-2 text-brand">
                        <Zap size={12} />
                        <span>{t('orders.embroidery')}: <span className="font-black">{item.embroidery || t('orders.none')}</span></span>
                      </div>
                    </div>
                    )}
                    {/* The vertical's own specs of the line (wood type, dimensions,
                        logo placement...) -- saved by the order form, shown here
                        since Phase 3 of seen-verticals-readiness-task.md. */}
                    <OrderItemAttributes attributes={item.attributes} fields={orderItemFields} className="relative z-10" />
                  </motion.div>
                ))}
              </div>
            </section>
          </div>

          {/* The workshop's work card (Phase 3 of seen-verticals-readiness-task.md):
              rendered hidden, printed as a copy. Only for a vertical with its
              own line specs; men's tailoring keeps its current buttons. */}
          {!isLegacyVertical && (
            <div className="hidden" aria-hidden="true">
              <OrderWorkCard
                order={order as any}
                shopName={tenant?.name || ''}
                fields={orderItemFields}
                stages={workflowStages}
                showFabric={capabilities.fabric_consumption}
              />
            </div>
          )}

          {/* Two rows of 48px buttons at most, so the details keep the room. */}
          <div className="px-4 py-3 bg-surface-muted border-t border-border grid grid-cols-2 gap-2">
            {canEdit && (order as any).kind === 'tailoring' && !['delivered', 'cancelled'].includes(legacyOrderStatusFor(order.status, workflowStages)) && (
              <button
                onClick={() => setEditOrderId(order.id)}
                className="col-span-2 min-h-12 flex items-center justify-center gap-2 bg-surface text-content rounded-xl font-bold border border-border hover:bg-surface-muted transition-all text-sm"
              >
                <span>{t('orders.edit_order')}</span>
              </button>
            )}
            {!isLegacyVertical && (
              <button
                onClick={() => void printWorkCard(order)}
                className="col-span-2 min-h-12 flex items-center justify-center gap-2 bg-surface text-content rounded-xl font-bold border border-border hover:bg-surface-muted transition-all text-sm"
              >
                <ClipboardList size={18} />
                <span>{t('orders.print_work_card', 'طباعة بطاقة العمل')}</span>
              </button>
            )}
            <button
              onClick={() => {
                setIsDetailsOpen(false);
                void handlePrintOrder(order);
              }}
              className="min-h-12 flex items-center justify-center gap-2 bg-surface text-content rounded-xl font-bold border border-border hover:bg-surface-muted transition-all text-sm"
            >
              <Printer size={18} />
              <span>{t('orders.print')}</span>
            </button>
            <button
              onClick={() => sendToWhatsApp(order)}
              className="min-h-12 flex items-center justify-center gap-2 bg-success text-white rounded-xl font-bold hover:bg-success/90 transition-all text-sm"
            >
              <MessageSquare size={18} />
              <span>{t('orders.whatsapp')}</span>
            </button>
            <button
              onClick={handleViewInvoice}
              disabled={isLoadingInvoice}
              className={cn(
                "min-h-12 flex items-center justify-center gap-2 bg-brand/10 text-brand rounded-xl font-bold border border-brand/20 hover:bg-brand/15 transition-all text-sm disabled:opacity-50",
                !order.trackingToken && "col-span-2"
              )}
            >
              <FileText size={18} />
              <span>{isLoadingInvoice ? t('common.loading') : t('tax_invoices.view_invoice')}</span>
            </button>
            {order.trackingToken && (
              <button
                onClick={() => sendTrackingLink(order)}
                className="min-h-12 flex items-center justify-center gap-2 bg-brand/10 text-brand rounded-xl font-bold border border-brand/20 hover:bg-brand/15 transition-all text-sm"
              >
                <Truck size={18} />
                <span>{t('orders.send_tracking_link')}</span>
              </button>
            )}
          </div>
        </motion.div>
      </div>
      </>
    );
  };

  const ConfirmDeliveryModal = () => (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsConfirmDeliveryOpen(false)} />
      <motion.div role="dialog" aria-modal="true" aria-label={t('orders.confirm_delivery_title')} initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-surface w-full max-w-sm rounded-3xl shadow-2xl relative z-10 p-8 text-center" dir={isRtlLang(i18n.language) ? 'rtl' : 'ltr'}>
        <div className="w-20 h-20 bg-success/10 text-success rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 size={40} />
        </div>
        <h3 className="text-xl font-black text-content mb-2">{t('orders.confirm_delivery_title')}</h3>
        <p className="text-content-muted text-sm mb-8 font-medium">{t('orders.confirm_delivery_desc')}</p>
        <div className="flex flex-col gap-3">
          <button 
            onClick={confirmDelivery}
            className="w-full bg-success text-white py-4 rounded-2xl font-bold hover:bg-success/90 shadow-lg shadow-success/10 transition-all"
          >
            {t('orders.confirm_delivery_btn')}
          </button>
          <button 
            onClick={() => setIsConfirmDeliveryOpen(false)}
            className="w-full py-4 text-content-muted font-bold hover:bg-surface-muted rounded-2xl transition-all"
          >
            {t('common.cancel')}
          </button>
        </div>
      </motion.div>
    </div>
  );

  const PaymentModal = ({ order, onComplete }: { order: Order, onComplete: () => void }) => {
    const [amount, setAmount] = useState(order.remainingAmount || 0);
    const [method, setMethod] = useState<PaymentMethod>('cash');
    const [isProcessing, setIsProcessing] = useState(false);

    const handlePayment = async () => {
      if (amount <= 0) return;
      // لا سقف على الدفعة الجزئية سابقاً -- مبلغ أكبر من المتبقي كان يُقبَل
      // بصمت (newRemainingAmount يُقفَل عند 0 عبر Math.max) فيضيع الفرق الزائد
      // بلا أي تتبّع أو استرجاع.
      if (amount > (order.remainingAmount || 0)) {
        toastError(t('orders.payment_exceeds_remaining', 'المبلغ أكبر من المتبقي على الطلب'));
        return;
      }

      setIsProcessing(true);
      try {
        // seen-cto-code-review-2026-11-13.md C9: this used to update
        // `orders.history`/`orders.items` directly -- neither is a real
        // column; a client-only fetch interceptor (supabase/client.ts)
        // silently packed them into `notes` as a JSON blob instead, so
        // this "history" never existed as a real, queryable audit trail.
        // record_order_payment locks the order row, caps the amount at
        // the live remaining balance, writes a real payments +
        // order_history row, and -- when this payment brings the
        // balance to zero and a status transition is pending -- applies
        // that transition in the same atomic call.
        const operationId = globalThis.crypto.randomUUID();
        // seen-status-fix-regressions-task.md item 5: same attribution fix
        // as handleQuickPayment above.
        const shiftId = await getOpenShiftId(tenantId, currentStaff?.id);
        const { data: result, error } = await supabase.rpc('record_order_payment', {
          p_operation_id: operationId,
          p_order_id: order.id,
          p_amount: amount,
          p_method: method,
          p_shift_id: shiftId,
          p_notes: t('orders.payment_completed_note', { amount, method: t(`common.payment_methods.${method}`, method), remaining: Math.max(0, (order.remainingAmount || 0) - amount) }),
          p_complete_status: pendingStatusUpdate ? legacyOrderStatusFor(pendingStatusUpdate.status, workflowStages) : null,
          p_complete_status_key: pendingStatusUpdate ? pendingStatusUpdate.status : null
        });

        if (error) throw error;

        if (result.completed) {
          // Track Order Delivered
          analytics.track(AnalyticsEvent.ORDER_DELIVERED, {
            order_id: order.id,
            customer_id: order.customerId,
            total_amount: order.totalAmount
          });
        }

        setIsPaymentModalOpen(false);
        setPendingStatusUpdate(null);
        onComplete();
      } catch (error) {
        // P1.3: the server's own reason when it refuses on purpose (no open
        // shift, a cancelled order, more than what is left).
        const refusal = dbRefusalMessage(error);
        if (refusal) { toastError(refusal); return; }
        handleFirestoreError(error as any, OperationType.UPDATE, 'orders');
      } finally {
        setIsProcessing(false);
      }
    };

    return (
      <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 sm:p-6">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setIsPaymentModalOpen(false)} />
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={t('orders.complete_payment_title')}
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="bg-surface w-full lg:max-w-md rounded-3xl shadow-2xl relative z-10 overflow-y-auto max-h-[90vh] text-start border border-border"
          dir={isRtlLang(i18n.language) ? 'rtl' : 'ltr'}
        >
          <div className="p-6 border-b border-border flex justify-between items-center bg-success/5">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-success text-white rounded-2xl">
                <CreditCard size={24} />
              </div>
              <h3 className="text-xl font-black text-content">{t('orders.complete_payment_title')}</h3>
            </div>
            <button onClick={() => setIsPaymentModalOpen(false)} aria-label={t('common.close')} className="p-2 hover:bg-surface rounded-full transition-colors shadow-sm">
              <X size={24} className="text-content-muted" />
            </button>
          </div>
          
          <div className="p-8 space-y-6">
            <div className="bg-surface-muted p-6 rounded-3xl border border-border text-center">
              <p className="text-xs font-bold text-content-muted uppercase tracking-widest mb-1">{t('orders.remaining_amount')}</p>
              <p className="text-3xl font-black text-danger">{money(order.remainingAmount)}</p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-content-muted uppercase tracking-widest">{t('orders.pay_amount_now')}</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                max={order.remainingAmount}
                className="w-full bg-surface border border-border rounded-xl p-4 text-sm font-black text-content outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-content-muted uppercase tracking-widest">{t('orders.payment_method')}</label>
              <div className="grid grid-cols-2 gap-2">
                {PAYMENT_METHODS.filter(m => m.id !== 'partial').map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setMethod(m.id as PaymentMethod)}
                    className={cn(
                      "flex items-center gap-2 p-3 rounded-xl border-2 transition-all text-xs font-bold",
                      method === m.id ? "border-success bg-success/10 text-success" : "border-border bg-surface text-content-muted"
                    )}
                  >
                    <m.icon size={16} />
                    {t(m.labelKey)}
                  </button>
                ))}
              </div>
            </div>

            <button 
              onClick={handlePayment}
              disabled={isProcessing || amount <= 0}
              className="w-full bg-success text-white py-4 rounded-2xl font-black hover:bg-success/90 shadow-xl shadow-success/10 transition-all disabled:opacity-50"
            >
              {isProcessing ? t('orders.processing_payment') : t('orders.confirm_payment_and_delivery')}
            </button>
          </div>
        </motion.div>
      </div>
    );
  };

  const InvoiceModal = ({ order }: { order: Order }) => {
    return (
      <div className="fixed inset-0 z-[60] flex items-end lg:items-center justify-center overflow-hidden">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={() => setIsInvoiceOpen(false)}
        />
        <motion.div
          initial={{ y: window.innerWidth < 1024 ? '100%' : 0, x: window.innerWidth >= 1024 ? '100%' : 0 }}
          animate={{ y: 0, x: 0 }}
          exit={{ y: window.innerWidth < 1024 ? '100%' : 0, x: window.innerWidth >= 1024 ? '100%' : 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="bg-surface w-full lg:w-[450px] md:h-auto lg:h-full h-[90vh] shadow-2xl relative z-10 flex flex-col lg:rounded-none rounded-t-3xl border-t lg:border-t-0 lg:border-r border-border overflow-hidden lg:mr-auto md:max-w-md md:rounded-3xl md:mb-10 lg:max-w-none lg:mb-0 lg:ml-0"
          dir={isRtlLang(i18n.language) ? 'rtl' : 'ltr'}
        >
          <div id="order-invoice-print-area" className="flex-1 overflow-y-auto p-4 lg:p-6">
            {invoiceViewData ? (
              <TaxInvoiceDocument
                order={invoiceViewData.invoice}
                tenant={invoiceViewData.tenant}
                onClose={() => setIsInvoiceOpen(false)}
              />
            ) : invoiceViewError ? (
              <div className="flex flex-col items-center justify-center text-center h-full gap-4 py-12">
                <p className="text-content-muted font-bold">{t('orders.invoice_not_found', 'تعذر العثور على الفاتورة الأصلية لهذا الطلب')}</p>
                <button
                  onClick={() => setIsInvoiceOpen(false)}
                  className="px-6 py-3 bg-surface-muted text-content font-bold rounded-xl hover:bg-border transition-colors"
                >
                  {t('common.close')}
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full py-12">
                <div className="w-10 h-10 border-4 border-brand/20 border-t-brand rounded-full animate-spin" />
              </div>
            )}
          </div>
        </motion.div>
      </div>
    );
  };

  if (isLoading) {
    return <PageSkeleton />;
  }

  return (
    <div className={cn("space-y-6", isRtlLang(i18n.language) ? "text-right" : "text-left")} dir={isRtlLang(i18n.language) ? 'rtl' : 'ltr'}>
      {whatsappModalOpen && pendingWhatsAppOrder && (
        <WhatsAppPhoneModal
          onClose={() => { setWhatsappModalOpen(false); setPendingWhatsAppOrder(null); }}
          onConfirm={proceedToWhatsApp}
          title={whatsappModalMode === 'tracking'
            ? t('orders.tracking_whatsapp_modal_title')
            : t('printing.whatsapp_modal_title', 'إرسال الفاتورة عبر واتساب')}
          description={whatsappModalMode === 'tracking'
            ? t('orders.tracking_whatsapp_modal_desc')
            : t('printing.whatsapp_modal_desc', 'أدخل رقم جوال العميل لفتح واتساب مع تفاصيل الفاتورة جاهزة للإرسال.')}
        />
      )}
      <Header
        tenantId={tenantId} 
        title={t('common.orders')} 
        subtitle={t('orders.subtitle')}
      >
        <div className="flex flex-wrap items-center gap-3">
          <button 
            onClick={() => {
              const exportData = filteredOrders.map(o => ({
                [t('common.order')]: o.orderNumber || o.id.slice(-6).toUpperCase(),
                [t('common.customer')]: o.customerName,
                [t('common.date')]: new Date(o.orderDate).toLocaleDateString(localeOf(i18n.language)),
                ...(canViewPrices ? {
                  [t('common.total')]: o.totalAmount,
                  [t('orders.amount_paid')]: o.paidAmount,
                  [t('orders.remaining_label')]: o.remainingAmount,
                } : {}),
                [t('common.status')]: t(getOrderStatusDisplay(o.status, workflowStages).labelKey),
                [t('orders.payment_method')]: t(`common.payment_methods.${o.paymentMethod}`, o.paymentMethod)
              }));
              const worksheet = XLSX.utils.json_to_sheet(exportData);
              const workbook = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(workbook, worksheet, "Orders");
              XLSX.writeFile(workbook, `${t('common.orders')}_${new Date().toLocaleDateString(localeOf(i18n.language))}.xlsx`);
            }}
            className="bg-success/5 text-success px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-success/10 transition-all border border-success/10"
          >
            <FileSpreadsheet size={20} />
            <span>{t('orders.export_excel')}</span>
          </button>
          <div id="tour-orders-tabs" data-tour="orders-tabs" className="flex bg-surface p-1 rounded-2xl border border-border shadow-sm">
            <button
              onClick={() => setActiveTab('active')}
              className={cn(
                "px-6 py-2 rounded-xl font-bold text-sm transition-all",
                activeTab === 'active' ? "bg-brand text-white shadow-lg shadow-brand/10" : "text-content-muted hover:bg-surface-muted"
              )}
            >
              {t('orders.active_orders')}
            </button>
            <button
              onClick={() => setActiveTab('completed')}
              className={cn(
                "px-6 py-2 rounded-xl font-bold text-sm transition-all",
                activeTab === 'completed' ? "bg-brand text-white shadow-lg shadow-brand/10" : "text-content-muted hover:bg-surface-muted"
              )}
            >
              {t('orders.completed_orders')}
            </button>
          </div>
          {canCreate && (
          <button
            id="tour-orders-new-btn"
            data-tour="orders-new-btn"
            onClick={() => handleOpenModal()}
            className="bg-brand text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-brand/90 transition-all shadow-lg shadow-brand/10"
          >
            <Plus size={20} />
            <span>{t('orders.create_new_order')}</span>
          </button>
          )}
        </div>
      </Header>

      <div className="flex flex-col md:flex-row gap-4">
        <div id="tour-orders-search" data-tour="orders-search" className="flex-1">
          <IconInput
            type="text"
            startIcon={Search}
            endIcon={[
              ...(voiceSupported ? [
                <span key="mic" className="me-2 inline-flex">
                  <VoiceMicButton onResult={setSearch} />
                </span>,
              ] : []),
              <button
                key="scan"
                type="button"
                onClick={() => setIsScannerOpen(true)}
                aria-label={t('pos.scan_barcode')}
                className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded cursor-pointer"
              >
                <Barcode size={18} />
              </button>,
            ]}
            placeholder={t('orders.search_placeholder')}
            data-orders-search="true"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* No card around the filters: they sit on the same line and at the
            same 48px height as the search box (founder, 2026-11-20). The
            padded card made this block 81px tall next to a 48px field. */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 min-w-[180px]">
            <SmartSelect
              value={statusFilter}
              onChange={(val) => setStatusFilter(val)}
              options={[
                { value: '', label: t('orders.all_statuses') },
                ...statusOptions.map((status) => ({
                  value: status,
                  label: t(getOrderStatusDisplay(status, workflowStages).labelKey)
                }))
              ]}
              // Same look as the search box beside it.
              className="bg-surface rounded-xl shadow-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[140px]">
              <DatePicker value={startDate} onChange={setStartDate} placeholder={t('common.from', 'من')} triggerClassName="bg-surface hover:bg-surface border-border rounded-xl shadow-none" />
            </div>
            <span className="text-content-muted text-xs">{t('orders.to')}</span>
            <div className="min-w-[140px]">
              <DatePicker value={endDate} onChange={setEndDate} placeholder={t('common.to', 'إلى')} triggerClassName="bg-surface hover:bg-surface border-border rounded-xl shadow-none" />
            </div>
          </div>

          {(statusFilter || startDate || endDate) && (
            <button
              onClick={() => {
                setStatusFilter('');
                setStartDate('');
                setEndDate('');
              }}
              className="p-2 text-danger hover:bg-danger/10 rounded-xl transition-all"
              title={t('orders.clear_filters')}
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {filteredOrders.length === 0 ? (
          <div className="p-12 text-center bg-surface border border-border rounded-2xl shadow-sm flex flex-col items-center justify-center">
            <div className="w-16 h-16 rounded-2xl bg-surface-muted border border-border flex items-center justify-center mb-4 text-content-muted/50">
              <ShoppingBag size={32} />
            </div>
            <h3 className="text-lg font-black text-content mb-1">
              {t('orders.no_orders_currently')}
            </h3>
            <p className="text-xs text-content-muted font-bold max-w-sm">
              {t('orders.no_orders_desc')}
            </p>
          </div>
        ) : (
          pagedOrders.map((order, index) => {
            const customerUnpaid = order.customerId ? (unpaidOrdersByCustomer.get(order.customerId) || []) : [];
            const totalUnpaid = customerUnpaid.reduce((sum, o) => sum + (o.remainingAmount || 0), 0);
            const statusDisplay = getOrderStatusDisplay(order.status, workflowStages);

            return (
              <motion.div
                layout
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.03, 0.3) }}
                key={order.id}
                className={cn(
                  "p-3.5 sm:p-4 lg:p-6 rounded-2xl sm:rounded-3xl border transition-all duration-200 group relative overflow-visible z-10 hover:z-30",
                  // Selected: one brand-coloured border on the same white card,
                  // not a grey fill with a ring and a heavy shadow (founder, 2026-11-20).
                  selectedOrder?.id === order.id
                    ? "bg-surface border-brand shadow-sm"
                    : "bg-surface border-border shadow-sm hover:border-brand/30"
                )}
              >
                {/* Selection indicator: a short bar inside the card's start edge.
                    It used to run the full height at the physical right with
                    square corners, so it stuck out past the rounded card. */}
                {selectedOrder?.id === order.id && (
                  <motion.div
                    layoutId="selected-indicator"
                    aria-hidden="true"
                    className="absolute start-0 inset-y-4 w-1 rounded-e-full bg-brand"
                  />
                )}

                {/* MOBILE & TABLET LAYOUT (< lg) */}
                <div className="flex lg:hidden flex-col gap-3">
                  {/* Top Bar: Customer Name & Status / Main Actions */}
                  <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={cn(
                        "w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0 shadow-inner",
                        statusDisplay.bgColor,
                        statusDisplay.color
                      )}>
                        {React.createElement(statusDisplay.icon, { size: 20 })}
                      </div>

                      <div className="min-w-0 flex flex-col justify-center cursor-pointer" onClick={() => openDetails(order)}>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="text-sm font-black text-content truncate hover:text-brand transition-colors">
                            {order.customerName}
                          </h3>
                          <span className="text-[10px] bg-surface-muted text-content-muted px-2 py-0.5 rounded-md font-bold shrink-0 border border-border/60">
                            #{order.orderNumber || order.id.slice(-6).toUpperCase()}
                          </span>
                        </div>
                        
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          {totalUnpaid > 0 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const matchingCustomer = customers.find(c => c.id === order.customerId) || {
                                  id: order.customerId,
                                  name: order.customerName,
                                  phone: order.customerPhone || ''
                                } as Customer;
                                setDueDetailsCustomer(matchingCustomer);
                              }}
                              className="flex items-center gap-1 bg-danger/10 text-danger border border-danger/20 px-1.5 py-0.5 rounded-md text-[9px] font-black shrink-0 animate-pulse"
                            >
                              <AlertCircle size={10} />
                              {money(totalUnpaid)}
                            </button>
                          )}
                          {order.isTest && (
                            <span className="text-[9px] bg-danger/10 text-danger px-1.5 py-0.5 rounded-md font-black flex items-center gap-0.5 shrink-0">
                              <Zap size={8} />
                              {t('orders.test_data_badge')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Status badge trigger on mobile header */}
                    <div className="relative shrink-0">
                      <button 
                        type="button"
                        disabled={order.status === 'delivered'}
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenStatusDropdownId(openStatusDropdownId === order.id ? null : order.id);
                        }}
                        className={cn(
                          "px-2.5 py-1.5 rounded-xl text-[11px] font-black flex items-center gap-1.5 transition-all shadow-xs border border-border/60",
                          statusDisplay.bgColor,
                          statusDisplay.color
                        )}
                      >
                        <span className={cn("w-1.5 h-1.5 rounded-full animate-pulse", statusDisplay.color.replace('text', 'bg'))} />
                        <span>{t(statusDisplay.labelKey)}</span>
                        {order.status !== 'delivered' && canUpdateStatus && <ChevronDown size={12} className="opacity-60" />}
                      </button>

                      {order.status !== 'delivered' && canUpdateStatus && openStatusDropdownId === order.id && (
                        <div className={cn(
                          "absolute top-full mt-2 w-48 bg-surface rounded-2xl shadow-2xl border border-border py-2 z-50 backdrop-blur-xl",
                          isRtlLang(i18n.language) ? "left-0" : "right-0"
                        )}>
                          {statusOptions.map((status) => {
                            const cfg = getOrderStatusDisplay(status, workflowStages);
                            return (
                              <button
                                key={status}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateStatus(order.id, status);
                                }}
                                className={cn(
                                  "w-full px-3 py-2 text-xs font-bold hover:bg-brand/10 flex items-center justify-between",
                                  isRtlLang(i18n.language) ? "text-right" : "text-left",
                                  order.status === status ? cfg.color : "text-content-muted"
                                )}
                              >
                                <span className="flex items-center gap-2">
                                  <cfg.icon size={12} />
                                  {t(cfg.labelKey)}
                                </span>
                                {order.status === status && <CheckCircle2 size={12} />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Info Grid for Mobile & Tablet */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    {/* Box 1: Order Date */}
                    <div className="bg-surface-muted/60 p-2.5 rounded-xl border border-border/40 flex flex-col gap-1 justify-center">
                      <span className="text-[10px] font-bold text-content-muted flex items-center gap-1">
                        <Calendar size={10} className="text-brand shrink-0" />
                        {t('common.date')}
                      </span>
                      <DateTimeDisplay date={order.orderDate} showTime={true} size="xs" />
                    </div>

                    {/* Box 2: Payment Method */}
                    <div className="bg-surface-muted/60 p-2.5 rounded-xl border border-border/40 flex flex-col gap-1 justify-center">
                      <span className="text-[10px] font-bold text-content-muted flex items-center gap-1">
                        <CreditCard size={10} className="text-brand shrink-0" />
                        {t('orders.payment_method')}
                      </span>
                      <span className="font-bold text-content text-[11px] truncate">
                        {(order.paymentMethod as any) === 'network' || (order.paymentMethod as any) === 'card' ? t('orders.payment_network_card') :
                         order.paymentMethod === 'bank_transfer' ? t('pos.bank_transfer') :
                         order.paymentMethod === 'partial' ? t('orders.payment_deferred_partial_short') :
                         order.paymentMethod === 'cash_on_delivery' ? t('orders.payment_on_delivery_short') : t('common.payment_methods.cash')}
                      </span>
                    </div>

                    {/* Box 3: Total Amount */}
                    <div className="bg-surface-muted/60 p-2.5 rounded-xl border border-border/40 flex flex-col gap-1 justify-center">
                      <span className="text-[10px] font-bold text-content-muted flex items-center gap-1">
                        <ShoppingBag size={10} className="text-brand shrink-0" />
                        {t('common.total')}
                      </span>
                      <span className="font-black text-brand text-xs">
                        {money(order.totalAmount)}
                      </span>
                    </div>

                    {/* Box 4: Balance / Remaining */}
                    <div className="bg-surface-muted/60 p-2.5 rounded-xl border border-border/40 flex flex-col gap-1 justify-center">
                      <span className="text-[10px] font-bold text-content-muted">
                        {t('orders.remaining_label')}
                      </span>
                      <div>
                        {order.remainingAmount > 0 ? (
                          <span className="bg-danger/10 text-danger border border-danger/20 px-2 py-0.5 rounded-md text-[10px] font-black inline-flex items-center gap-1 truncate">
                            <span className="w-1.5 h-1.5 bg-danger rounded-full animate-pulse shrink-0" />
                            {money(order.remainingAmount)}
                          </span>
                        ) : (
                          <span className="bg-success/10 text-success border border-success/20 px-2 py-0.5 rounded-md text-[10px] font-black inline-flex items-center gap-1 truncate">
                            <span className="w-1.5 h-1.5 bg-success rounded-full shrink-0" />
                            {t('orders.fully_paid')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Footer Actions for Mobile & Tablet */}
                  <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-border/40 text-xs">
                    <div className="flex items-center gap-1.5">
                      {canViewInvoice && (<>
                      <button 
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openInvoiceView(order);
                        }}
                        className="px-2.5 py-1.5 bg-brand/10 text-brand hover:bg-brand hover:text-white rounded-xl transition-all flex items-center gap-1.5 font-bold text-xs"
                      >
                        <Eye size={14} />
                        <span>{t('orders.invoice')}</span>
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handlePrintOrder(order);
                        }}
                        className="min-w-[40px] min-h-[40px] flex items-center justify-center text-content-muted hover:text-brand hover:bg-brand/10 rounded-xl transition-all border border-border/40"
                        title={t('orders.quick_print')}
                      >
                        <Printer size={16} />
                      </button>
                      </>)}

                      {canViewDetails && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openDetails(order);
                        }}
                        className="min-w-[40px] min-h-[40px] flex items-center justify-center text-content-muted hover:text-brand hover:bg-brand/10 rounded-xl transition-all border border-border/40"
                        title={t('orders.details')}
                      >
                        <Info size={16} />
                      </button>
                      )}
                    </div>

                    {canDelete && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(order.id, order.orderNumber?.toString() || order.id);
                        }}
                        disabled={order.status === 'delivered'}
                        className={cn(
                          "min-w-[40px] min-h-[40px] flex items-center justify-center ms-2 transition-all rounded-xl border border-border/40",
                          order.status === 'delivered'
                            ? "text-content-muted/20 cursor-not-allowed"
                            : "text-content-muted hover:text-danger hover:bg-danger/10 hover:border-danger/20"
                        )}
                        title={t('orders.delete_order')}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>

                {/* DESKTOP LAYOUT (lg:flex) */}
                <div className="hidden lg:flex lg:items-center lg:justify-between lg:gap-6">
                  <div className="flex items-center gap-5">
                    <div className={cn(
                      "w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-500 group-hover:scale-105 group-hover:rotate-3 shrink-0",
                      statusDisplay.bgColor,
                      statusDisplay.color
                    )}>
                      {React.createElement(statusDisplay.icon, { size: 32 })}
                    </div>
                    <div className="cursor-pointer" onClick={() => openDetails(order)}>
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="text-xl font-black text-content">
                          {order.customerName}
                        </h3>
                        {totalUnpaid > 0 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const matchingCustomer = customers.find(c => c.id === order.customerId) || {
                                id: order.customerId,
                                name: order.customerName,
                                phone: order.customerPhone || ''
                              } as Customer;
                              setDueDetailsCustomer(matchingCustomer);
                            }}
                            className="flex items-center gap-1 bg-danger/10 hover:bg-danger/20 text-danger border border-danger/20 px-2.5 py-1 rounded-full text-xs font-black transition-all animate-pulse"
                            title={t('orders.customer_has_dues')}
                          >
                            <AlertCircle size={14} className="text-danger" />
                            <span>{money(totalUnpaid)}</span>
                          </button>
                        )}
                        <span className="text-[10px] bg-surface-muted text-content-muted px-3 py-1 rounded-full font-black uppercase tracking-widest border border-border">
                          #{order.orderNumber || order.id.slice(-6).toUpperCase()}
                        </span>
                        {order.isTest && (
                          <span className="text-[10px] bg-danger/10 text-danger px-2 py-0.5 rounded-full font-black uppercase tracking-widest flex items-center gap-1">
                            <Zap size={10} />
                            {t('orders.test_data_badge')}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 sm:gap-4 mt-2 text-sm text-content-muted">
                        <span className="flex items-center gap-1.5 font-bold">
                          <Calendar size={16} className="text-brand shrink-0" />
                          <DateTimeDisplay date={order.orderDate} showTime={true} size="xs" />
                        </span>
                        <div className="w-1 h-1 bg-border rounded-full hidden sm:block" />
                        <span className="text-xs font-bold bg-surface-muted px-2.5 py-1 rounded-lg border border-border flex items-center gap-1">
                          <CreditCard size={12} className="text-brand" />
                          {(order.paymentMethod as any) === 'network' || (order.paymentMethod as any) === 'card' ? t('orders.payment_network_card') :
                           order.paymentMethod === 'bank_transfer' ? t('pos.bank_transfer') :
                           order.paymentMethod === 'partial' ? t('orders.payment_deferred_partial') :
                           order.paymentMethod === 'cash_on_delivery' ? t('common.payment_methods.cash_on_delivery') : t('common.payment_methods.cash')}
                        </span>
                        <div className="w-1 h-1 bg-border rounded-full hidden sm:block" />
                        <span className="font-black text-brand text-lg">
                          {money(order.totalAmount)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 bg-surface-muted/50 p-1 rounded-2xl border border-border">
                      {canViewInvoice && (<>
                      <button
                        onClick={() => {
                          openInvoiceView(order);
                        }}
                        className="px-3 py-2 text-brand hover:bg-brand hover:text-white rounded-xl transition-all flex items-center gap-2 font-black text-xs"
                        title={t('orders.view_invoice')}
                      >
                        <Eye size={16} />
                        <span>{t('orders.invoice')}</span>
                      </button>

                      <button
                        onClick={() => void handlePrintOrder(order)}
                        className="p-2 text-content-muted hover:text-brand hover:bg-brand/10 rounded-xl transition-all"
                        title={t('orders.quick_print')}
                      >
                        <Printer size={18} />
                      </button>
                      </>)}

                      {canViewDetails && (
                      <button 
                        onClick={() => openDetails(order)}
                        className="p-2 text-content-muted hover:text-brand hover:bg-brand/10 rounded-xl transition-all"
                        title={t('orders.details')}
                      >
                        <Info size={18} />
                      </button>
                      )}
                    </div>

                    <div className="relative">
                      {openStatusDropdownId === order.id && (
                        <div 
                          className="fixed inset-0 z-20 bg-transparent" 
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenStatusDropdownId(null);
                          }} 
                        />
                      )}
                      <motion.button 
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        disabled={order.status === 'delivered'}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (openStatusDropdownId === order.id) {
                            setOpenStatusDropdownId(null);
                          } else {
                            setOpenStatusDropdownId(order.id);
                          }
                        }}
                        className={cn(
                          "px-4 py-2.5 rounded-2xl text-xs font-black flex items-center gap-3 transition-all shadow-sm relative z-30",
                          statusDisplay.bgColor,
                          statusDisplay.color,
                          order.status === 'delivered' ? "cursor-not-allowed opacity-80" : "hover:shadow-lg hover:shadow-brand/5 border border-brand/10 cursor-pointer"
                        )}
                      >
                        <div className={cn("w-2 h-2 rounded-full animate-pulse", statusDisplay.color.replace('text', 'bg'))} />
                        <span>{t(statusDisplay.labelKey)}</span>
                        {order.status !== 'delivered' && canUpdateStatus && <ChevronDown size={14} className="opacity-50" />}
                      </motion.button>

                      {order.status !== 'delivered' && canUpdateStatus && openStatusDropdownId === order.id && (
                        <div className={cn(
                          "absolute top-full mt-2 w-56 bg-surface rounded-3xl shadow-2xl border border-border/50 py-3 z-30 animate-in fade-in zoom-in duration-200 backdrop-blur-xl",
                          isRtlLang(i18n.language) ? "right-0" : "left-0"
                        )}>
                          <div className="px-4 py-2 mb-2 border-b border-border/50">
                            <span className="text-[10px] font-black text-content-muted uppercase tracking-widest">{t('orders.update_status')}</span>
                          </div>
                          {statusOptions.map((status) => {
                            const cfg = getOrderStatusDisplay(status, workflowStages);
                            return (
                              <button
                                key={status}
                                onClick={() => updateStatus(order.id, status)}
                                className={cn(
                                  "w-full px-4 py-2.5 text-xs font-black hover:bg-brand/5 transition-all flex items-center justify-between group/item",
                                  isRtlLang(i18n.language) ? "text-right" : "text-left",
                                  order.status === status ? cfg.color : "text-content-muted hover:text-brand"
                                )}
                              >
                                <div className="flex items-center gap-3">
                                  <cfg.icon size={14} className={cn("transition-transform group-hover/item:scale-110", order.status === status ? cfg.color : "text-content-muted/50")} />
                                  {t(cfg.labelKey)}
                                </div>
                                {order.status === status && <CheckCircle2 size={12} />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {canDelete && (
                      <button
                        onClick={() => handleDelete(order.id, order.orderNumber?.toString() || order.id)}
                        disabled={order.status === 'delivered'}
                        className={cn(
                          "p-2.5 transition-all rounded-2xl border border-transparent",
                          order.status === 'delivered'
                            ? "text-content-muted/20 cursor-not-allowed"
                            : "text-content-muted hover:text-danger hover:bg-danger/10 hover:border-danger/20"
                        )}
                        title={t('orders.delete_order')}
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </div>
      <Pagination page={ordersPage} pageSize={ORDERS_PAGE_SIZE} total={filteredOrders.length} onPageChange={setOrdersPage} />

      {/* Modals */}
      <ScannerModal isOpen={isScannerOpen} onClose={() => setIsScannerOpen(false)} onScan={handleScan} />
      {isInvoiceOpen && selectedOrder && <InvoiceModal order={selectedOrder} />}
      <AnimatePresence>
        {isDetailsOpen && selectedOrder && <OrderDetailsDrawer order={selectedOrder} />}
      </AnimatePresence>
      {isConfirmDeliveryOpen && <ConfirmDeliveryModal />}
      {cuttingPrompt && (
        <CuttingFabricDialog
          lines={cuttingPrompt.lines}
          busy={isCuttingBusy}
          onCancel={() => setCuttingPrompt(null)}
          onConfirm={async (lines) => {
            const order = orders.find(o => o.id === cuttingPrompt.id);
            if (!order) { setCuttingPrompt(null); return; }
            setIsCuttingBusy(true);
            try {
              await performStatusUpdate(order, cuttingPrompt.status, cuttingPrompt.notes, lines);
            } finally {
              setIsCuttingBusy(false);
            }
          }}
        />
      )}
      {editOrderId && tenantId && (
        <OrderEditDialog
          orderId={editOrderId}
          tenantId={tenantId}
          onClose={() => setEditOrderId(null)}
          onSaved={() => { void fetchOrders(); setIsDetailsOpen(false); }}
        />
      )}
      {cancelTarget && (
        <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="cancel-order-title">
          <div className="w-full max-w-md rounded-3xl bg-surface p-6 shadow-2xl border border-border space-y-4" dir={isRtlLang(i18n.language) ? 'rtl' : 'ltr'}>
            <h3 id="cancel-order-title" className="text-lg font-black text-content">
              {t('orders.cancel_title', { number: cancelTarget.orderNumber || cancelTarget.id.slice(-6).toUpperCase() })}
            </h3>
            {Number(cancelTarget.paidAmount) > 0 && (
              <p className="rounded-2xl bg-warning/10 border border-warning/20 p-3 text-sm font-bold text-content">
                {t('orders.cancel_refund_note', { amount: Number(cancelTarget.paidAmount).toFixed(2) })}
              </p>
            )}
            <label className="block space-y-2">
              <span className="text-sm font-bold text-content">{t('orders.cancel_reason_label')}</span>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={3}
                className="w-full rounded-2xl border border-border bg-surface-muted p-3 text-sm"
                placeholder={t('orders.cancel_reason_placeholder')}
                autoFocus
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void confirmCancel()}
                disabled={isCancelling || cancelReason.trim().length < 3}
                className="flex-1 min-h-12 rounded-2xl bg-danger text-white font-bold disabled:opacity-50"
              >
                {t('orders.cancel_confirm')}
              </button>
              <button
                type="button"
                onClick={() => setCancelTarget(null)}
                disabled={isCancelling}
                className="flex-1 min-h-12 rounded-2xl border border-border font-bold text-content"
              >
                {t('orders.cancel_back')}
              </button>
            </div>
          </div>
        </div>
      )}
      {isPaymentModalOpen && selectedOrder && (
        <PaymentModal 
          order={selectedOrder} 
          onComplete={() => {
            // Refresh orders if needed or just let onSnapshot handle it
          }} 
        />
      )}

      {/* Customer Unpaid Balance Details Modal */}
      <AnimatePresence>
        {dueDetailsCustomer && typeof document !== 'undefined' && createPortal(
          <div className="fixed inset-0 z-[100] flex items-end lg:items-center justify-center lg:p-4 overflow-hidden">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDueDetailsCustomer(null)}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={t('orders.due_details_title')}
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="relative w-full max-w-lg rounded-t-3xl lg:rounded-3xl shadow-2xl z-10 overflow-hidden bg-surface border border-border flex flex-col max-h-[85vh]"
              dir={isRtlLang(i18n.language) ? "rtl" : "ltr"}
            >
              <div className="flex items-center justify-between p-6 border-b border-border bg-brand/5 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-danger text-white rounded-2xl shrink-0 shadow-sm animate-pulse">
                    <AlertCircle size={20} />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-content">
                      {t('orders.due_details_title')}
                    </h3>
                    <p className="text-xs text-content-muted mt-0.5 font-bold">
                      {dueDetailsCustomer.name}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDueDetailsCustomer(null)}
                  aria-label={t('common.close')}
                  className="p-2 hover:bg-surface-muted rounded-full transition-colors shadow-sm text-content-muted"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div className="p-4 bg-danger/10 border border-danger/20 rounded-2xl flex justify-between items-center">
                  <span className="font-bold text-sm text-danger">{t('orders.total_customer_dues')}</span>
                  <span className="font-mono font-black text-xl text-danger">
                    {money(unpaidOrders.filter(o => o.customerId === dueDetailsCustomer.id).reduce((sum, o) => sum + (o.remainingAmount || 0), 0))}
                  </span>
                </div>

                <div className="space-y-3">
                  <h4 className="font-black text-sm text-content-muted px-1">
                    {t('orders.unpaid_orders_list')}
                  </h4>

                  <div className="space-y-2.5 max-h-[40vh] overflow-y-auto pr-1">
                    {unpaidOrders.filter(o => o.customerId === dueDetailsCustomer.id).map(o => (
                      <div 
                        key={o.id} 
                        onClick={() => {
                          setDueDetailsCustomer(null);
                          openDetails(o);
                        }}
                        className="p-4 bg-surface-muted border border-border rounded-2xl hover:border-brand/40 hover:bg-brand/5 cursor-pointer transition-all flex justify-between items-center gap-4"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-black text-sm text-content">
                              #{o.orderNumber || o.id.slice(-6).toUpperCase()}
                            </span>
                            <span className="text-[10px] bg-brand/10 text-brand px-2 py-0.5 rounded-full font-bold">
                              {t(getOrderStatusDisplay(o.status, workflowStages).labelKey)}
                            </span>
                          </div>
                          <p className="text-xs text-content-muted font-bold">
                            {new Date(o.orderDate).toLocaleDateString(localeOf(i18n.language))}
                          </p>
                        </div>

                        <div className="text-left rtl:text-right space-y-0.5">
                          <div className="text-xs text-content-muted font-bold">
                            {t('orders.remaining_label')}
                          </div>
                          <div className="font-mono font-black text-base text-danger">
                            {money(o.remainingAmount)}
                          </div>
                          <div className="text-[10px] text-content-muted font-bold">
                            {t('common.total')}: {money(o.totalAmount)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-6 border-t border-border bg-surface-muted flex justify-end">
                <button
                  type="button"
                  onClick={() => setDueDetailsCustomer(null)}
                  className="px-5 py-2.5 bg-surface border border-border text-content-muted hover:bg-surface-muted rounded-xl transition-all font-black text-sm"
                >
                  {t('sales.close')}
                </button>
              </div>
            </motion.div>
          </div>,
          document.body
        )}
      </AnimatePresence>

      <TailoringOrderForm
        open={isModalOpen}
        onClose={handleCloseModal}
        tenantId={tenantId}
        initialCustomerId={newOrderCustomerId}
        onCreated={handleOrderCreated}
        topSlot={
          <OrderStepper
            currentStatus={isLegacyVertical || workflowStages.length === 0 ? 'measurements_taken' : workflowStages[0].stage_key}
            stages={isLegacyVertical ? undefined : workflowStages}
          />
        }
      />
    </div>
  );
}
