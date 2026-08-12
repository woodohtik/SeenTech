"use client";
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { formatSaudiPhone } from '../utils/phoneUtils';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useRealtimeSync } from '../hooks/useRealtimeSync';
import { decodeOrderRow } from '../utils/orderHistoryHelper';
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
  QrCode,
  Barcode,
  Eye,
  Share2,
  MessageSquare,
  CreditCard,
  User,
  X,
  History,
  Image as ImageIcon,
  Scissors,
  CheckSquare,
  Package,
  Truck,
  MoreHorizontal,
  Info,
  Filter,
  Zap,
  UserPlus,
  Ruler,
  ChevronLeft,
  Shield,
  FileSpreadsheet,
  Edit2,
  Check
} from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { auth, handleFirestoreError, OperationType, getFriendlyErrorMessage } from '../lib/firebase';
import { Order, Customer, OrderStatus, OrderHistory, InventoryItem, PaymentMethod, OrderItem, Staff, Tenant, Measurements } from '../types';
import { cn, generateOrderNumber } from '../lib/utils';
import { PriceDisplay } from './PriceDisplay';
import { logEmployeeAction } from '../services/employeeAuditService';
import PageSkeleton from "./PageSkeleton";
import Header from './Header';
import VisualMeasurements from './VisualMeasurements';
import ThobeMeasurementSelector from './ThobeMeasurementSelector';
import { motion, AnimatePresence } from 'motion/react';
import { usePermissions } from '../hooks/usePermissions';
import { useTranslation } from 'react-i18next';
import DateTimeDisplay from './DateTimeDisplay';
import { useToast } from '../contexts/ToastContext';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { orderSchema, customerSchema } from '../lib/validations';
import { QRCodeSVG } from 'qrcode.react';
import * as XLSX from 'xlsx';
import Branding from './Branding';
import { buildWhatsAppMessage, getWhatsAppTemplate, sendWhatsAppMessage } from '../utils/whatsapp';
import ScannerModal from './ScannerModal';
import Select from './ui/Select';
import { SmartSelect } from './ui/SmartSelect';
import { checkStockAvailability, deductStock } from '../services/inventoryService';
import { useStaff } from '../contexts/StaffContext';
import { useBranding } from '../contexts/BrandingContext';
import { analytics, AnalyticsEvent } from '../services/analyticsService';

import { isRtlLang, localeOf } from '../lib/direction';

export const STATUS_CONFIG: Record<OrderStatus, { labelKey: string, icon: any, color: string, bgColor: string }> = {
  'measurements_taken': { labelKey: 'common.status_measurements_taken', icon: User, color: 'text-info', bgColor: 'bg-info/10' },
  'cutting': { labelKey: 'common.status_cutting', icon: Scissors, color: 'text-warning', bgColor: 'bg-warning/10' },
  'sewing': { labelKey: 'common.status_sewing', icon: Clock, color: 'text-info', bgColor: 'bg-info/10' },
  'embroidery': { labelKey: 'common.status_embroidery', icon: CheckSquare, color: 'text-brand', bgColor: 'bg-brand/10' },
  'ironing_packaging': { labelKey: 'common.status_ironing_packaging', icon: Package, color: 'text-info', bgColor: 'bg-info/10' },
  'ready': { labelKey: 'common.status_ready', icon: CheckCircle2, color: 'text-success', bgColor: 'bg-success/10' },
  'partial_delivered': { labelKey: 'common.status_partial_delivered', icon: Package, color: 'text-info', bgColor: 'bg-info/10' },
  'delivered': { labelKey: 'common.status_delivered', icon: Truck, color: 'text-content-muted', bgColor: 'bg-surface-muted' },
  'cancelled': { labelKey: 'common.status_cancelled', icon: X, color: 'text-danger', bgColor: 'bg-danger/10' }
};

const ORDER_STAGES: OrderStatus[] = [
  'measurements_taken',
  'cutting',
  'sewing',
  'embroidery',
  'ironing_packaging',
  'ready',
  'delivered'
];

const OrderStepper = ({ currentStatus }: { currentStatus: OrderStatus }) => {
  const { t } = useTranslation();
  const currentIdx = ORDER_STAGES.indexOf(currentStatus === 'partial_delivered' ? 'ready' : currentStatus);
  
  return (
    <div className="bg-surface p-6 rounded-[2rem] border border-border shadow-sm overflow-x-auto mb-8">
      <div className="relative flex justify-between items-start min-w-[600px] px-4">
        {/* Progress Line */}
        <div className="absolute top-5 right-10 left-10 h-0.5 bg-surface-muted -z-0" />
        <div 
          className="absolute top-5 right-10 h-0.5 bg-brand transition-all duration-700 ease-in-out -z-0" 
          style={{ width: `${Math.max(0, (currentIdx / (ORDER_STAGES.length - 1)) * 100)}%` }}
        />

        {ORDER_STAGES.map((status, idx) => {
          const config = STATUS_CONFIG[status];
          const Icon = config.icon;
          const isCompleted = idx <= currentIdx;
          const isActive = idx === currentIdx;

          return (
            <div key={status} className="relative flex flex-col items-center gap-3 z-10">
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
  const router = useRouter();
  const refreshCounter = useRefreshCounter();
  const { settings: branding } = useBranding();
  const { error: toastError, success: toastSuccess, warning: toastWarning, handleError } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [unpaidOrders, setUnpaidOrders] = useState<Order[]>([]);
  const [dueDetailsCustomer, setDueDetailsCustomer] = useState<Customer | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isEditingMeasurements, setIsEditingMeasurements] = useState(false);
  const [tempMeasurements, setTempMeasurements] = useState<Measurements>({});
  const [isSavingMeasurements, setIsSavingMeasurements] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isInvoiceOpen, setIsInvoiceOpen] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [pendingStatusUpdate, setPendingStatusUpdate] = useState<{ id: string, status: OrderStatus } | null>(null);
  const [statusFilter, setStatusFilter] = useState<OrderStatus | ''>('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [activeTab, setActiveTab] = useState<'active' | 'completed'>('active');
  const [isConfirmDeliveryOpen, setIsConfirmDeliveryOpen] = useState(false);
  const [openStatusDropdownId, setOpenStatusDropdownId] = useState<string | null>(null);
  const [tenantStrategy, setTenantStrategy] = useState<'centralized' | 'decentralized'>('centralized');
  const [searchParams] = useSearchParams();
  const { currentStaff } = useStaff();
  const { hasPermission, checkPermission } = usePermissions(currentStaff);

  const canCreate = hasPermission('orders.create');
  const canEdit = hasPermission('orders.edit');
  const canDelete = hasPermission('orders.delete');
  const canRefund = hasPermission('action.refund');
  const canDiscount = hasPermission('action.discount');

  const defaultOrderValues = useMemo(() => ({
    customerId: '',
    deliveryDate: '',
    items: [{ 
      garmentType: 'ثوب', 
      quantity: 1, 
      price: 0, 
      fabric: '',
      fabricId: '',
      selectedUnit: 'meter',
      consumedMeters: 0,
      closureType: 'buttons' as const,
      closureVisibility: 'visible' as const,
      collarType: 'plain' as const,
      cuffType: 'plain' as const,
      pocketType: 'single' as const,
      chestStyle: 'plain' as const,
      collarPadding: 'soft' as const,
      additions: '',
      embroidery: ''
    }],
    status: 'measurements_taken' as const,
    paidAmount: 0,
    paymentMethod: 'cash' as const,
    discountAmount: 0,
    notes: '',
    internalNotes: '',
    images: [] as string[],
    isTest: false
  }), []);

  const { register, control, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting, isValid } } = useForm({
    resolver: zodResolver(orderSchema),
    defaultValues: defaultOrderValues as any
  });

  const handleOpenModal = useCallback((customCustId?: string) => {
    reset({
      ...defaultOrderValues,
      customerId: customCustId || ''
    });
    setIsModalOpen(true);
  }, [reset, defaultOrderValues]);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setIsEditingMeasurements(false);
    reset(defaultOrderValues);
  }, [reset, defaultOrderValues]);

  const { fields, append, remove } = useFieldArray({
    control,
    name: "items" as any
  });

  const watchItems = watch("items" as any);
  const watchCustomerId = watch("customerId");
  const selectedCustomer = customers.find(c => c.id === watchCustomerId);

  useEffect(() => {
    setIsEditingMeasurements(false);
    if (selectedCustomer?.measurements) {
      setTempMeasurements(selectedCustomer.measurements);
    } else {
      setTempMeasurements({});
    }
  }, [watchCustomerId, selectedCustomer]);

  const onInvalidSubmit = useCallback((formErrors: any) => {
    const missingFields: string[] = [];

    if (formErrors.customerId) {
      missingFields.push(t('common.customer'));
    }
    if (formErrors.deliveryDate) {
      missingFields.push(t('orders.expected_delivery_date'));
    }
    if (formErrors.items) {
      if (Array.isArray(formErrors.items)) {
        formErrors.items.forEach((itemErr: any, idx: number) => {
          if (!itemErr) return;
          const itemNum = idx + 1;
          if (itemErr.garmentType) missingFields.push(t('orders.missing_item_field', { field: t('orders.item_type'), index: itemNum }));
          if (itemErr.fabric) missingFields.push(t('orders.missing_item_field', { field: t('orders.fabric'), index: itemNum }));
          if (itemErr.price) missingFields.push(t('orders.missing_item_field', { field: t('orders.price'), index: itemNum }));
          if (itemErr.quantity) missingFields.push(t('orders.missing_item_field', { field: t('common.quantity'), index: itemNum }));
        });
      } else {
        missingFields.push(t('orders.required_items'));
      }
    }

    const errorMessage = missingFields.length > 0
      ? t('orders.complete_following_fields', { fields: missingFields.join(t('common.list_separator')) })
      : t('orders.fill_required_fields');

    toastError(errorMessage);

    setTimeout(() => {
      const errorTarget = document.querySelector('.border-danger, [aria-invalid="true"]');
      if (errorTarget) {
        errorTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  }, [t, toastError]);
  const totalAmount = watchItems?.reduce((acc: number, item: any) => acc + (Number(item.price) * Number(item.quantity) || 0), 0) || 0;

  // Dynamic Tax Calculations for Custom Thobe Orders
  const isTaxEnabled = !!tenant?.taxSettings?.enabled;
  const vatRatePercentage = Number(tenant?.taxSettings?.vatRate || 15);
  const vatRate = vatRatePercentage / 100;
  const tailoringTaxType = tenant?.taxSettings?.tailoringTaxType || 'exclusive';

  let calculatedSubtotal = totalAmount;
  let calculatedVat = 0;
  let calculatedGrandTotal = totalAmount;

  if (isTaxEnabled) {
    if (tailoringTaxType === 'exclusive') {
      calculatedSubtotal = totalAmount;
      calculatedVat = totalAmount * vatRate;
      calculatedGrandTotal = totalAmount + calculatedVat;
    } else if (tailoringTaxType === 'inclusive') {
      calculatedGrandTotal = totalAmount;
      calculatedSubtotal = totalAmount / (1 + vatRate);
      calculatedVat = totalAmount - calculatedSubtotal;
    } else if (tailoringTaxType === 'exempt') {
      calculatedGrandTotal = totalAmount;
      calculatedSubtotal = totalAmount;
      calculatedVat = 0;
    }
  }

  const roundedSubtotal = Number(calculatedSubtotal.toFixed(2));
  const roundedVat = Number(calculatedVat.toFixed(2));
  const roundedGrandTotal = Number(calculatedGrandTotal.toFixed(2));

  const mapOrderData = useCallback((o: any): Order => {
    if (!o) return o;
    const decoded = decodeOrderRow(o);
    return {
      ...decoded,
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
      items: Array.isArray(decoded.items) ? decoded.items : [],
      history: Array.isArray(decoded.history) ? decoded.history : []
    } as Order;
  }, []);

  const fetchOrders = useCallback(async () => {
    if (!tenantId) return;
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('order_date', { ascending: false });
      
      if (error) {
        handleFirestoreError(error, OperationType.LIST, 'orders');
      } else {
        const allOrders = (data || []).map(mapOrderData);
        const trackingOrders = allOrders.filter(order => 
          !order.items || order.items.length === 0 || order.items.some((item: any) => !item.type || item.type === 'custom')
        );
        setOrders(trackingOrders);

        const unpaid = allOrders.filter(o => o.remainingAmount > 0 && o.status !== 'cancelled');
        setUnpaidOrders(unpaid);
      }
    } catch (err) {
      console.error('Error fetching orders:', err);
    }
  }, [tenantId, mapOrderData]);

  useRealtimeSync('orders', tenantId, (payload) => {
    if (payload.eventType === 'INSERT' && payload.new) {
      const newOrder = mapOrderData(payload.new);
      setOrders(prev => [newOrder, ...prev.filter(o => o.id !== newOrder.id)]);
      if (newOrder.remainingAmount > 0 && newOrder.status !== 'cancelled') {
        setUnpaidOrders(prev => [newOrder, ...prev.filter(o => o.id !== newOrder.id)]);
      }
    } else if (payload.eventType === 'UPDATE' && payload.new) {
      const updatedOrder = mapOrderData(payload.new);
      setOrders(prev => {
        const index = prev.findIndex(o => o.id === updatedOrder.id);
        if (index >= 0) {
          const arr = [...prev];
          arr[index] = updatedOrder;
          return arr;
        }
        return [updatedOrder, ...prev];
      });
      setUnpaidOrders(prev => {
        const filtered = prev.filter(o => o.id !== updatedOrder.id);
        if (updatedOrder.remainingAmount > 0 && updatedOrder.status !== 'cancelled') {
          return [updatedOrder, ...filtered];
        }
        return filtered;
      });
    } else if (payload.eventType === 'DELETE' && payload.old) {
      const deletedId = payload.old.id;
      if (deletedId) {
        setOrders(prev => prev.filter(o => o.id !== deletedId));
        setUnpaidOrders(prev => prev.filter(o => o.id !== deletedId));
      }
    }

    fetchOrders();
  });

  useEffect(() => {
    if (!tenantId) return;

    const fetchData = async () => {
      try {
        const { data: custData } = await supabase
          .from('customers')
          .select('*')
          .eq('tenant_id', tenantId);
        
        const mappedCusts = (custData || []).map(c => ({
          ...c,
          isTest: c.is_test,
          isB2B: c.is_b2b,
          createdAt: c.created_at,
          tenantId: c.tenant_id
        }) as unknown as Customer);
        setCustomers(mappedCusts);

        const { data: invData } = await supabase
          .from('inventory_items')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('category', 'fabric');
        setInventory(invData as InventoryItem[] || []);

        const { data: staffData } = await supabase
          .from('staff')
          .select('*')
          .eq('tenant_id', tenantId);
        setStaff(staffData as Staff[] || []);

        const { data: tenantData } = await supabase
          .from('tenants')
          .select('*')
          .eq('id', tenantId)
          .maybeSingle();
        if (tenantData) {
          const hasVat = Boolean(tenantData.vat_number && tenantData.vat_number.trim().length > 0);
          const rawTax = tenantData.tax_settings;
          const resolvedTax = rawTax ? {
            ...rawTax,
            enabled: rawTax.enabled ?? (hasVat || Boolean(rawTax.trn)),
            trn: rawTax.trn || tenantData.vat_number || '',
            legalName: rawTax.legalName || tenantData.name || '',
            vatRate: rawTax.vatRate ?? 15,
            tailoringTaxType: rawTax.tailoringTaxType || 'exclusive'
          } : {
            enabled: hasVat,
            trn: tenantData.vat_number || '',
            legalName: tenantData.name || '',
            vatRate: 15,
            tailoringTaxType: 'exclusive'
          };

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
          setTenantStrategy(mappedTenant.inventoryStrategy || 'centralized');
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
                 setSelectedOrder(localFiltered[0]);
                 setIsInvoiceOpen(true);
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
             setSelectedOrder(matchedOrder);
             setIsInvoiceOpen(true);
          } else {
             // Try searching just by includes to be safe
             const partialMatch = orders.find(o => 
                 (o as any).invoiceNumber?.toString().toLowerCase().includes(scanned) ||
                 o.orderNumber?.toString().toLowerCase().includes(scanned) ||
                 o.id.toLowerCase().includes(scanned)
             );
             if (partialMatch) {
                 setSearch(scanned);
                 setSelectedOrder(partialMatch);
                 setIsInvoiceOpen(true);
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

  const QuickAddCustomerModal = () => {
    const { register: regCust, handleSubmit: handleCustSubmit, reset: resetCust, watch: watchCust, setValue: setCustValue, formState: { errors: custErrors, isSubmitting: custSubmitting } } = useForm({
      resolver: zodResolver(customerSchema),
      defaultValues: {
        name: '',
        phone: '',
        email: '',
        companyName: '',
        trn: '',
        notes: '',
        isTest: false,
        isB2B: false,
        address: '',
        city: '',
        measurements: {
          length: 0,
          shoulder: 0,
          chest: 0,
          waist: 0,
          hips: 0,
          sleeve: 0,
          neck: 0,
          collarType: 'classic',
          cuffType: 'square',
          pocketType: 'hidden',
          chestStyle: 'plain',
          shoulderStyle: 'plain'
        },
        styles: {
          neckShape: 'round',
          sleeveStyle: 'normal',
          pocketType: 'none'
        }
      }
    });

    const watchCustMeasurements = watchCust('measurements');

    const onQuickAddInvalid = (errs: any) => {
      const missing: string[] = [];
      if (errs.name) missing.push(t('login.full_name'));
      if (errs.phone) missing.push(t('onboarding.fields.phone'));
      
      const msg = missing.length > 0 
        ? t('orders.complete_customer_fields', { fields: missing.join(t('common.list_separator')) })
        : t('orders.customer_name_phone_invalid');
      toastError(msg);
    };

    const onQuickAddSubmit = async (data: any) => {
      if (!tenantId) {
        toastError(t('orders.error_store_not_found'));
        return;
      }

      const { 
        address, 
        city, 
        latitude, 
        longitude, 
        companyName, 
        trn, 
        isB2B, 
        isTest, 
        ...restData 
      } = data;

      // Nest the geographical data inside styles so we don't need a DB migration
      const updatedStyles = {
          ...(data.styles || {}),
          address,
          city,
          latitude,
          longitude
      };

      const customerData: any = {
        name: data.name,
        phone: formatSaudiPhone(data.phone),
        email: data.email || null,
        notes: data.notes || null,
        measurements: data.measurements || {},
        styles: updatedStyles,
        company_name: companyName ? companyName : null,
        vat_number: trn ? trn : null,
        tenant_id: tenantId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_test: !!isTest
      };

      try {
        const { data: newCust, error } = await supabase
          .from('customers')
          .insert(customerData)
          .select()
          .single();
        
        if (error) throw error;

        const mappedCust = {
          ...newCust,
          companyName: newCust.company_name,
          trn: newCust.vat_number,
          isTest: newCust.is_test,
          isB2B: !!newCust.company_name,
          createdAt: newCust.created_at,
          tenantId: newCust.tenant_id
        } as unknown as Customer;

        setCustomers(prev => [mappedCust, ...prev]);
        setValue('customerId', mappedCust.id);
        toastSuccess(t('orders.customer_added_success'));
        setIsQuickAddOpen(false);
        resetCust();
      } catch (error: any) {
        console.error(error);
        toastError(error?.message || t('orders.customer_add_failed'));
      }
    };

    return (
      <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto font-sans">
        <motion.div 
          initial={{ scale: 0.95, opacity: 0, y: 20 }} 
          animate={{ scale: 1, opacity: 1, y: 0 }} 
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="relative w-full max-w-[clamp(320px,94vw,1100px)] max-h-[90vh] rounded-[var(--radius-card)] bg-[var(--surface)] shadow-2xl flex flex-col my-auto border border-border overflow-hidden text-start" 
          dir={isRtlLang(i18n.language) ? 'rtl' : 'ltr'}
        >
          {/* Header (Fixed) */}
          <div className="sticky top-0 z-10 flex items-center justify-between p-4 sm:p-6 border-b border-[var(--border)] bg-[var(--surface)] shrink-0 bg-brand/5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-brand text-white rounded-2xl shrink-0 shadow-sm">
                <UserPlus size={20} />
              </div>
              <h3 className="text-base sm:text-lg lg:text-xl font-black text-content">{t('pos.add_new_customer')}</h3>
            </div>
            <button type="button" onClick={() => setIsQuickAddOpen(false)} className="p-2 hover:bg-surface-muted rounded-full transition-colors shadow-sm text-content-muted">
              <X size={20} />
            </button>
          </div>
          
          <form onSubmit={handleCustSubmit(onQuickAddSubmit, onQuickAddInvalid)} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1">
                <label className="text-xs font-bold text-content-muted">{t('login.full_name')}</label>
                <input {...regCust('name')} className="w-full bg-surface-muted border-none rounded-xl p-3 text-sm focus:ring-2 focus:ring-brand text-content" />
                {custErrors.name && <p className="text-[10px] text-danger font-bold">{custErrors.name.message}</p>}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-content-muted">{t('onboarding.fields.phone')}</label>
                <input 
                  {...regCust('phone')} 
                  onChange={(e) => {
                    const formatted = formatSaudiPhone(e.target.value);
                    setCustValue('phone', formatted);
                  }}
                  onBlur={(e) => {
                    const formatted = formatSaudiPhone(e.target.value);
                    setCustValue('phone', formatted);
                  }}
                  className="w-full bg-surface-muted border-none rounded-xl p-3 text-sm focus:ring-2 focus:ring-brand text-content" 
                />
                {custErrors.phone && <p className="text-[10px] text-danger font-bold">{custErrors.phone.message}</p>}
              </div>
            </div>

            <h4 className="text-lg font-bold text-content mb-4 pt-4 border-t border-border flex items-center gap-2">
              <ShoppingBag size={20} className="text-brand" />
              {t('orders.b2b_data_title')}
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-4 border-b border-border">
              <div className="space-y-2">
                <label className="text-sm font-bold text-content-muted">{t('orders.company_name_label')} <span className="opacity-70 text-xs">{t('common.optional')}</span></label>
                <input 
                  type="text"
                  {...regCust('companyName')} 
                  className="w-full bg-surface-muted border-none rounded-xl p-3 text-sm focus:ring-2 focus:ring-brand text-content"
                  placeholder={t('orders.company_name_placeholder')}
                />
                {custErrors.companyName && <p className="text-xs text-danger font-bold">{custErrors.companyName.message}</p>}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-content-muted">{t('orders.company_trn_label')} <span className="opacity-70 text-xs">{t('common.optional')}</span></label>
                <input 
                  type="text"
                  {...regCust('trn')} 
                  className="w-full bg-surface-muted border-none rounded-xl p-3 text-sm focus:ring-2 focus:ring-brand text-content"
                  dir="ltr"
                  placeholder="300000000000003"
                />
                {custErrors.trn && <p className="text-xs text-danger font-bold">{custErrors.trn.message}</p>}
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-sm font-black text-content-muted uppercase tracking-widest flex items-center gap-2">
                <Zap size={16} />
                {t('orders.visual_details_title')}
              </h4>
              <VisualMeasurements 
                values={watchCustMeasurements || {}} 
                onChange={(field, val) => setCustValue(`measurements.${field}` as any, val)} 
              />
              
              <div className="mt-8 pt-8 border-t border-border">
                <h3 className="text-sm font-black text-content flex items-center gap-2 mb-4">
                  <div className="w-1.5 h-4 bg-brand rounded-full" />
                  {t('orders.visual_measurement_selector')}
                </h3>
                <ThobeMeasurementSelector 
                  values={(watchCustMeasurements as Measurements) || {}}
                  onChange={(newMeasurements) => {
                    Object.entries(newMeasurements).forEach(([key, value]) => {
                      setCustValue(`measurements.${key}` as any, value);
                    });
                  }}
                />
              </div>
            </div>

            <div className="space-y-2 pt-8 border-t border-border">
              <label className="text-sm font-bold text-content-muted">{t('orders.extra_notes')}</label>
              <textarea {...regCust('notes')} className="w-full bg-surface-muted border-none rounded-xl p-3 focus:ring-2 focus:ring-brand h-24 text-content" />
            </div>

            {/* isTest Flag */}
            <div className="flex items-center gap-3 p-4 bg-warning/5 rounded-2xl border border-warning/10">
              <input
                type="checkbox"
                id="isTest"
                {...regCust('isTest')}
                className="w-5 h-5 text-brand border-border rounded focus:ring-brand"
              />
              <label htmlFor="isTest" className="text-sm font-bold text-warning flex items-center gap-2">
                <Zap size={16} />
                {t('common.test_data')}
              </label>
            </div>

            {/* Footer (Fixed) */}
            <div className="sticky bottom-0 z-10 p-4 sm:p-6 border-t border-[var(--border)] bg-[var(--surface)] shrink-0 flex items-center justify-between gap-3 shadow-md">
              <div>
                {Object.keys(custErrors).length > 0 && (
                  <p className="text-xs text-danger font-bold flex items-center gap-1">
                    <AlertCircle size={14} />
                    <span>{t('orders.customer_name_phone_required')}</span>
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setIsQuickAddOpen(false)} className="px-6 py-2.5 sm:px-8 sm:py-3.5 text-content-muted font-bold hover:text-content transition-colors text-sm sm:text-base">{t('common.cancel')}</button>
                <button type="submit" disabled={custSubmitting} className="bg-brand text-white px-8 py-2.5 sm:px-12 sm:py-3.5 rounded-xl font-bold hover:bg-brand/90 shadow-lg shadow-brand/20 transition-all hover:scale-102 active:scale-98 disabled:opacity-50 text-sm sm:text-base">
                  {custSubmitting ? t('common.saving') : t('orders.confirm_add_customer')}
                </button>
              </div>
            </div>
          </form>
        </motion.div>
      </div>
    );
  };

  useEffect(() => {
    // Strategy already handled in main useEffect
  }, [tenantId]);

// Toast effect removed as global toast handles it

  const onSubmit = async (data: any) => {
    if (!tenantId) {
      toastError(t('orders.error_store_code_not_found'));
      return;
    }

    if (tenantStrategy === 'decentralized' && !currentStaff?.branchId) {
      toastError(t('orders.error_staff_branch_required'));
      return;
    }

    const initialHistory: OrderHistory = {
      status: 'measurements_taken',
      updatedAt: new Date().toISOString(),
      updatedBy: currentStaff?.name || t('common.owner'),
      updatedByUid: currentStaff?.id || auth.currentUser?.uid,
      notes: t('orders.order_created_note')
    };

    const isUuid = (val: string | undefined | null) => 
      val ? /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val) : false;

    const orderData = {
      tenant_id: tenantId,
      branch_id: (currentStaff?.branchId && isUuid(currentStaff.branchId)) ? currentStaff.branchId : null,
      customer_id: isUuid(data.customerId) ? data.customerId : null,
      customer_name: selectedCustomer?.name || t('orders.unknown_customer'),
      order_number: generateOrderNumber(),
      status: data.status || 'measurements_taken',
      payment_method: data.paymentMethod || 'cash',
      total_amount: roundedGrandTotal,
      paid_amount: Number(data.paidAmount || 0),
      tax_rate: isTaxEnabled ? (tailoringTaxType === 'exempt' ? 0 : vatRatePercentage) : 0,
      tax_amount: roundedVat,
      discount_amount: Number(data.discountAmount || 0),
      order_date: new Date().toISOString(),
      delivery_date: data.deliveryDate ? new Date(data.deliveryDate).toISOString() : new Date().toISOString(),
      qr_code: `tailor-order-${Date.now()}`,
      images: data.images || [],
      notes: data.notes || '',
      created_by: (currentStaff?.id && isUuid(currentStaff.id)) ? currentStaff.id : null,
      is_test: !!data.isTest,
      // Pass virtual items & history so encodeOrderRow interceptor can serialise them into notes field safely
      items: data.items,
      history: [initialHistory]
    };

    try {
      // 1. Check Stock Availability
      const { available, missingItems } = await checkStockAvailability(
        data.items,
        currentStaff?.branchId || '',
        tenantId,
        tenantStrategy
      );

      if (!available) {
        if (!confirm(t('orders.stock_shortage_confirm', { items: missingItems.join(', ') }))) {
          toastWarning(t('orders.order_cancelled_low_stock'));
          return;
        }
      }

      const { data: newOrder, error } = await supabase
        .from('orders')
        .insert(orderData)
        .select()
        .single();
      
      if (error) throw error;

      // Insert order notification
      try {
        await supabase.from('notifications').insert({
          tenant_id: tenantId,
          title: t('orders.notification_new_order_title'),
          message: t('orders.notification_new_order_message', { number: newOrder.order_number || '', customer: newOrder.customer_name || t('pos.walk_in_customer'), amount: newOrder.total_amount || 0 }),
          type: 'order',
          status: 'unread',
          created_at: new Date().toISOString(),
          metadata: { order_id: newOrder.id }
        });
      } catch (notifErr) {
        console.warn('Failed to insert order notification:', notifErr);
      }

      const mappedNewOrder = mapOrderData(newOrder);
      if (mappedNewOrder.items.some((item: any) => item.type === 'custom' || !item.type)) {
        setOrders(prev => [mappedNewOrder, ...prev.filter(o => o.id !== mappedNewOrder.id)]);
      }
      if (mappedNewOrder.remainingAmount > 0 && mappedNewOrder.status !== 'cancelled') {
        setUnpaidOrders(prev => [mappedNewOrder, ...prev.filter(o => o.id !== mappedNewOrder.id)]);
      }
      
      // Track Order Created
      analytics.track(AnalyticsEvent.ORDER_CREATED, {
        order_id: newOrder.id,
        customer_id: orderData.customer_id || (orderData as any).customerId,
        total_amount: orderData.total_amount,
        items_count: orderData.items.length,
        payment_method: orderData.payment_method
      });

      // Track Measurements Added (if customer is selected)
      if (selectedCustomer?.measurements) {
        analytics.track(AnalyticsEvent.MEASUREMENTS_ADDED, {
          order_id: newOrder.id,
          customer_id: orderData.customer_id || (orderData as any).customerId,
          measurements: selectedCustomer.measurements
        });
      }

      handleCloseModal();
      router.refresh();
      toastSuccess(t('orders.order_added_success'));
    } catch (error: any) {
      console.error('Order submission error:', error);
      handleFirestoreError(error, OperationType.WRITE, 'orders');
    }
  };

  const updateStatus = async (id: string, status: OrderStatus, notes?: string) => {
    setOpenStatusDropdownId(null);
    const order = orders.find(o => o.id === id);
    if (!order) return;

    // Prevent any changes if order is already delivered (locked)
    if (order.status === 'delivered') {
      alert(t('orders.cannot_edit_delivered'));
      return;
    }

    // Prevent delivery if there's a remaining balance
    if (status === 'delivered') {
      const remaining = Number(order.remainingAmount || 0);
      if (remaining > 0) {
        alert(t('orders.cannot_deliver_unpaid'));
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

    try {
      // Deduct stock if moving to 'cutting'
      if (status === 'cutting' && order.status !== 'cutting') {
        try {
          await deductStock(order, currentStaff!, tenantStrategy);
        } catch (err) {
          console.error('Stock deduction error:', err);
          alert(t('inventory.stock_deduction_error') + (err instanceof Error ? err.message : t('orders.unknown_error')));
          return;
        }
      }

      const historyEntry: OrderHistory = {
        status,
        updatedAt: new Date().toISOString(),
        updatedBy: currentStaff?.name || t('common.roles.owner'),
        updatedByUid: currentStaff?.id || auth.currentUser?.uid,
        notes: notes || t('orders.status_change_note', { status: t(STATUS_CONFIG[status].labelKey) })
      };

      const updatedHistory = [...(order.history || []), historyEntry];

      const { error } = await supabase
        .from('orders')
        .update({
          status,
          history: updatedHistory,
          items: order.items || []
        })
        .eq('id', id);

      if (error) throw error;

      // Realtime local update
      setOrders(prev => prev.map(o => o.id === id ? { ...o, status, history: updatedHistory } : o));
      setUnpaidOrders(prev => prev.map(o => o.id === id ? { ...o, status, history: updatedHistory } : o));

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
        updatedByUid: currentStaff?.id || auth.currentUser?.uid,
        notes: t('orders.order_delivered_closed_note')
      };

      const updatedHistory = [...(order.history || []), historyEntry];

      const { error } = await supabase
        .from('orders')
        .update({
          status,
          history: updatedHistory,
          items: order.items || []
        })
        .eq('id', id);

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

    if (window.confirm(t('orders.confirm_delete_order'))) {
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
        setSelectedOrder(matchedOrder);
        setIsInvoiceOpen(true);
        toastSuccess(t('orders.order_found_by_barcode'));
    } else {
        const partialMatch = orders.find(o => 
            (o as any).invoiceNumber?.toString().toLowerCase().includes(scanned) ||
            o.orderNumber?.toString().toLowerCase().includes(scanned) ||
            o.id.toLowerCase().includes(scanned)
        );
        if (partialMatch) {
            setSearch(scanned);
            setSelectedOrder(partialMatch);
            setIsInvoiceOpen(true);
            toastSuccess(t('orders.order_found_by_barcode'));
        } else {
            toastError(t('orders.order_not_found_by_barcode'));
        }
    }
  };

  const filteredOrders = orders.filter(o => {
    const searchLower = search.toLowerCase();
    const orderNumberStr = o.orderNumber ? o.orderNumber.toString() : '';
    // Handle potential invoice number inside the order object if it exists
    const invoiceNumberStr = (o as any).invoiceNumber ? String((o as any).invoiceNumber).toLowerCase() : '';
    
    // Support scanning the full URL QR code by checking if the search string contains the ID
    const matchesSearch = (o.customerName || '').toLowerCase().includes(searchLower) || 
                         o.id.toLowerCase().includes(searchLower) ||
                         searchLower.includes(o.id.toLowerCase()) ||
                         orderNumberStr.includes(searchLower) ||
                         invoiceNumberStr.includes(searchLower) ||
                         searchLower.includes(invoiceNumberStr);
    const matchesStatus = !statusFilter || o.status === statusFilter;
    
    // Date comparison
    const orderDate = (o.orderDate || '').split('T')[0];
    const matchesDate = (!startDate || orderDate >= startDate) && 
                       (!endDate || orderDate <= endDate);
    
    // Tab filtering
    const matchesTab = activeTab === 'active' ? o.status !== 'delivered' : o.status === 'delivered';
    
    return matchesSearch && matchesStatus && matchesDate && matchesTab;
  });

  const sendToWhatsApp = (order: Order) => {
    const customer = customers.find(c => c.id === order.customerId);
    const phone = customer?.phone || '';
    const orderNum = (order.orderNumber?.toString() || order.id).slice(-6).toUpperCase();
    const invoiceUrl = `${window.location.origin}/order/${order.id}`;

    const message = buildWhatsAppMessage(getWhatsAppTemplate(), {
      customerName: order.customerName,
      orderId: `#${orderNum}`,
      totalAmount: order.totalAmount,
      customerPhone: phone,
      invoiceUrl: invoiceUrl,
      storeName: branding.companyName || t('pos.store_default'),
    });

    sendWhatsAppMessage(phone, message);
  };

  const OrderDetailsDrawer = ({ order }: { order: Order }) => {
    const [isPaying, setIsPaying] = useState(false);
    const [payAmount, setPayAmount] = useState(order.remainingAmount || 0);
    const [payMethod, setPayMethod] = useState<PaymentMethod>('cash');
    const [isProcessing, setIsProcessing] = useState(false);

    const statusOrder: OrderStatus[] = [
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
        const newPaidAmount = (order.paidAmount || 0) + payAmount;
        const newRemainingAmount = Math.max(0, (order.totalAmount || 0) - newPaidAmount);
        
        const historyEntry: OrderHistory = {
          status: order.status,
          updatedAt: new Date().toISOString(),
          updatedBy: currentStaff?.name || t('common.roles.owner'),
          updatedByUid: currentStaff?.id || auth.currentUser?.uid,
          notes: t('orders.payment_note', { amount: payAmount, method: t(`common.payment_methods.${payMethod}`, payMethod) })
        };

        const updatedHistory = [...(order.history || []), historyEntry];

        await supabase
          .from('orders')
          .update({
            paid_amount: newPaidAmount,
            history: updatedHistory,
            items: order.items || []
          })
          .eq('id', order.id);

        // Realtime local update
        setOrders(prev => prev.map(o => o.id === order.id ? { ...o, paidAmount: newPaidAmount, remainingAmount: newRemainingAmount, history: updatedHistory } : o));
        setUnpaidOrders(prev => {
          if (newRemainingAmount <= 0) return prev.filter(o => o.id !== order.id);
          return prev.map(o => o.id === order.id ? { ...o, paidAmount: newPaidAmount, remainingAmount: newRemainingAmount, history: updatedHistory } : o);
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
        handleFirestoreError(error as any, OperationType.UPDATE, 'orders');
      } finally {
        setIsProcessing(false);
      }
    };

    return (
      <div className="fixed inset-0 z-[60] flex items-end lg:items-center justify-center lg:justify-end overflow-hidden">
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          onClick={() => setIsDetailsOpen(false)}
        />
        <motion.div 
          initial={{ x: '100%', y: '100%' }}
          animate={{ x: 0, y: 0 }}
          exit={{ x: '100%', y: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className={cn("bg-surface w-full lg:max-w-md h-[95vh] lg:h-full shadow-2xl relative z-10 flex flex-col lg:rounded-none rounded-t-[3rem] overflow-hidden", isRtlLang(i18n.language) ? "text-right" : "text-left")}
          dir={isRtlLang(i18n.language) ? "rtl" : "ltr"}
        >
          <div className="p-6 border-b border-border flex justify-between items-center bg-brand/5">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-brand text-white rounded-2xl">
                <Info size={24} />
              </div>
              <div>
                <h2 className="text-xl font-black text-content">{t('orders.order_details')}</h2>
                <p className="text-xs text-content-muted font-bold">#{order.id.slice(-6).toUpperCase()}</p>
              </div>
            </div>
            <button onClick={() => setIsDetailsOpen(false)} className="p-2 hover:bg-surface rounded-full transition-colors shadow-sm">
              <X size={24} className="text-content-muted" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-8">
            <OrderStepper currentStatus={order.status} />

            {/* Quick Status Updater */}
            <section className="bg-surface p-5 rounded-3xl border border-border space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 size={16} className="text-brand" />
                <h3 className="font-black text-content text-sm">{t('orders.update_status')}</h3>
              </div>
              
              {order.status === 'delivered' ? (
                <div className="bg-surface-muted p-3.5 rounded-2xl border border-border text-center text-xs font-bold text-content-muted">
                  {t('orders.order_delivered_locked')}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <select
                      value={order.status}
                      onChange={(e) => updateStatus(order.id, e.target.value as OrderStatus)}
                      className="w-full bg-surface-muted border-2 border-transparent focus:border-brand rounded-2xl p-4 pr-10 text-sm font-bold focus:ring-2 focus:ring-brand text-content appearance-none cursor-pointer"
                    >
                      {(Object.keys(STATUS_CONFIG) as OrderStatus[]).map((status) => (
                        <option key={status} value={status}>
                          {t(STATUS_CONFIG[status].labelKey)}
                        </option>
                      ))}
                    </select>
                    <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-content-muted">
                      <ChevronDown size={18} />
                    </div>
                  </div>
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
                  <span className="font-bold text-content"><PriceDisplay amount={order.totalAmount} /></span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-content-muted">{t('orders.amount_paid')}:</span>
                  <span className="font-bold text-success"><PriceDisplay amount={order.paidAmount} /></span>
                </div>
                <div className="flex justify-between text-lg pt-2 border-t border-border/50">
                  <span className="font-bold text-content">{t('orders.remaining_label')}:</span>
                  <span className={cn("font-black", order.remainingAmount > 0 ? "text-danger" : "text-success")}>
                    <PriceDisplay amount={order.remainingAmount} />
                  </span>
                </div>
              </div>

              {order.remainingAmount > 0 && !isPaying && (
                <button 
                  onClick={() => setIsPaying(true)}
                  className="w-full mt-4 bg-brand text-white py-3 rounded-2xl font-bold hover:bg-brand/90 transition-all flex items-center justify-center gap-2 shadow-lg shadow-brand/10"
                >
                  <CreditCard size={18} />
                  {t('orders.pay_remaining')}
                </button>
              )}

              {isPaying && (
                <div className="mt-4 p-4 bg-surface rounded-2xl border border-red-500/20 space-y-4 animate-in fade-in slide-in-from-top-2">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-content-muted uppercase">{t('orders.pay_amount_now')}</label>
                    <input 
                      type="number" 
                      value={payAmount}
                      onChange={(e) => setPayAmount(Number(e.target.value))}
                      className="w-full bg-surface-muted border-none rounded-xl p-3 text-sm font-bold focus:ring-2 focus:ring-brand text-content"
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
                    updaterRole = updater.role === 'tailor' ? t('common.roles.tailor') : t('orders.employee');
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
                            <span className={cn("text-xs font-bold", STATUS_CONFIG[h.status].color)}>
                              {t(STATUS_CONFIG[h.status].labelKey)}
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

            {/* Customer Measurements */}
            {customers.find(c => c.id === order.customerId)?.measurements && (
              <section className="space-y-4">
                <h3 className="text-xs font-black text-content-muted uppercase tracking-widest flex items-center gap-2">
                  <Ruler size={14} />
                  {t('orders.customer_measurements')}
                </h3>
                <div className="bg-brand/5 p-6 rounded-3xl border border-brand/10">
                  <div className="grid grid-cols-3 gap-4">
                    {[
                      { label: t('measurements.neck'), value: customers.find(c => c.id === order.customerId)?.measurements?.neck },
                      { label: t('measurements.chest'), value: customers.find(c => c.id === order.customerId)?.measurements?.chest },
                      { label: t('measurements.waist'), value: customers.find(c => c.id === order.customerId)?.measurements?.waist },
                      { label: t('measurements.hips'), value: customers.find(c => c.id === order.customerId)?.measurements?.hips },
                      { label: t('measurements.shoulder'), value: customers.find(c => c.id === order.customerId)?.measurements?.shoulder },
                      { label: t('measurements.sleeve'), value: customers.find(c => c.id === order.customerId)?.measurements?.sleeve },
                      { label: t('measurements.length'), value: customers.find(c => c.id === order.customerId)?.measurements?.length },
                      { label: t('measurements.bottomWidth'), value: customers.find(c => c.id === order.customerId)?.measurements?.bottomWidth },
                    ].filter(m => m.value).map((m, i) => (
                      <div key={i} className="text-center">
                        <span className="block text-[10px] text-content-muted font-bold mb-1">{m.label}</span>
                        <span className="text-lg font-black text-brand">{m.value}</span>
                      </div>
                    ))}
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
                    className="bg-brand/5 p-5 rounded-[2rem] border border-brand/10 space-y-3 relative overflow-hidden group"
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
                  </motion.div>
                ))}
              </div>
            </section>
          </div>

          <div className="p-6 bg-surface-muted border-t border-border grid grid-cols-2 gap-3">
            <button className="flex items-center justify-center gap-2 bg-surface text-content py-4 rounded-2xl font-bold border border-border hover:bg-surface-muted transition-all text-sm">
              <Printer size={18} />
              <span>{t('orders.print')}</span>
            </button>
            <button 
              onClick={() => sendToWhatsApp(order)}
              className="flex items-center justify-center gap-2 bg-success text-white py-4 rounded-2xl font-bold hover:bg-success/90 transition-all shadow-lg shadow-success/10 text-sm"
            >
              <MessageSquare size={18} />
              <span>{t('orders.whatsapp')}</span>
            </button>
          </div>
        </motion.div>
      </div>
    );
  };

  const ConfirmDeliveryModal = () => (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsConfirmDeliveryOpen(false)} />
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-surface w-full max-w-sm rounded-[2rem] shadow-2xl relative z-10 p-8 text-center" dir={isRtlLang(i18n.language) ? 'rtl' : 'ltr'}>
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
      
      setIsProcessing(true);
      try {
        const newPaidAmount = (order.paidAmount || 0) + amount;
        const newRemainingAmount = Math.max(0, (order.totalAmount || 0) - newPaidAmount);
        
        const historyEntry: OrderHistory = {
          status: order.status,
          updatedAt: new Date().toISOString(),
          updatedBy: currentStaff?.name || t('common.roles.owner'),
          updatedByUid: currentStaff?.id || auth.currentUser?.uid,
          notes: t('orders.payment_completed_note', { amount, method: t(`common.payment_methods.${method}`, method), remaining: newRemainingAmount })
        };

        const updatedHistory = [...(order.history || []), historyEntry];

        await supabase
          .from('orders')
          .update({
            paid_amount: newPaidAmount,
            payment_method: method,
            history: updatedHistory,
            items: order.items || []
          })
          .eq('id', order.id);

        if (newRemainingAmount === 0 && pendingStatusUpdate) {
          const finalHistoryEntry: OrderHistory = {
            status: pendingStatusUpdate.status,
            updatedAt: new Date().toISOString(),
            updatedBy: currentStaff?.name || t('common.owner'),
            updatedByUid: currentStaff?.id || auth.currentUser?.uid,
            notes: t('orders.remaining_paid_delivered_note')
          };

          const finalHistory = [...(order.history || []), historyEntry, finalHistoryEntry];

          await supabase
            .from('orders')
            .update({ 
              status: pendingStatusUpdate.status,
              history: finalHistory,
              items: order.items || []
            })
            .eq('id', order.id);

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
        handleFirestoreError(error as any, OperationType.UPDATE, 'orders');
      } finally {
        setIsProcessing(false);
      }
    };

    return (
      <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 sm:p-6">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setIsPaymentModalOpen(false)} />
        <motion.div 
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
            <button onClick={() => setIsPaymentModalOpen(false)} className="p-2 hover:bg-surface rounded-full transition-colors shadow-sm">
              <X size={24} className="text-content-muted" />
            </button>
          </div>
          
          <div className="p-8 space-y-6">
            <div className="bg-surface-muted p-6 rounded-3xl border border-border text-center">
              <p className="text-xs font-bold text-content-muted uppercase tracking-widest mb-1">{t('orders.remaining_amount')}</p>
              <p className="text-3xl font-black text-danger"><PriceDisplay amount={order.remainingAmount} /></p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-content-muted uppercase tracking-widest">{t('orders.pay_amount_now')}</label>
              <input 
                type="number" 
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                max={order.remainingAmount}
                className="w-full bg-surface-muted border-2 border-transparent focus:border-success rounded-2xl p-4 font-black text-success outline-none transition-all"
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

  const InvoiceModal = ({ order }: { order: Order }) => (
    <div className="fixed inset-0 z-[60] flex items-end lg:items-center justify-center lg:p-4 overflow-hidden">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        onClick={() => setIsInvoiceOpen(false)}
      />
      <motion.div 
        initial={{ y: '100%', opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: '100%', opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="bg-surface w-full max-w-[92mm] sm:max-w-[100mm] rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl relative z-10 overflow-hidden"
      >
        <div className={cn("p-8 space-y-6", isRtlLang(i18n.language) ? "text-right" : "text-left")} dir={isRtlLang(i18n.language) ? 'rtl' : 'ltr'}>
          <div className="flex justify-between items-start">
            <div className="bg-brand text-white p-4 rounded-3xl">
              <ShoppingBag size={32} />
            </div>
            <button onClick={() => setIsInvoiceOpen(false)} className="p-2 hover:bg-surface-muted rounded-full transition-colors">
              <X size={24} className="text-content-muted" />
            </button>
          </div>

          <div className="text-center space-y-1">
            <h2 className="text-2xl font-black text-content">{t('orders.invoice')}</h2>
            <p className="text-content-muted font-medium">{t('common.order')}: #{order.orderNumber || order.id.slice(-6).toUpperCase()}</p>
          </div>

          <div className="bg-surface-muted p-6 rounded-[2rem] space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-surface rounded-xl shadow-sm">
                  <User size={18} className="text-brand" />
                </div>
                <div>
                  <p className="text-[10px] text-content-muted font-bold uppercase tracking-wider">{t('common.customer')}</p>
                  <p className="font-bold text-content">{order.customerName}</p>
                </div>
              </div>
              <div className="text-left">
                <p className="text-[10px] text-content-muted font-bold uppercase tracking-wider">{t('common.date')}</p>
                <DateTimeDisplay date={order.orderDate} showTime={true} size="xs" />
              </div>
            </div>

            <div className="border-t border-dashed border-border pt-4 space-y-3">
              {order.items?.map((item: any, idx: number) => (
                <div key={item.garmentType + item.fabric + idx} className="flex justify-between text-sm">
                  <span className="text-content-muted">{item.garmentType} ({item.fabric === 'custom' ? t('orders.external_fabric') : item.fabric})</span>
                  <span className="font-bold text-content"><PriceDisplay amount={item.price * item.quantity} /></span>
                </div>
              ))}
            </div>

            <div className="border-t border-border pt-4 space-y-2">
              {order.taxAmount && Number(order.taxAmount) > 0 ? (
                <>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-content-muted">{t('orders.subtotal')}</span>
                    <span className="font-bold text-content"><PriceDisplay amount={Number(order.totalAmount) - Number(order.taxAmount)} /></span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-content-muted">{t('orders.vat_label')} ({order.taxRate}%)</span>
                    <span className="font-bold text-content"><PriceDisplay amount={Number(order.taxAmount)} /></span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-content-muted font-black">{t('orders.grand_total')}</span>
                    <span className="text-xl font-black text-brand"><PriceDisplay amount={order.totalAmount} /></span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between items-center">
                  <span className="text-content-muted font-medium">{t('common.total')}</span>
                  <span className="text-xl font-black text-brand"><PriceDisplay amount={order.totalAmount} /></span>
                </div>
              )}
              <div className="flex justify-between items-center text-sm">
                <span className="text-content-muted">{t('orders.amount_paid')} ({t(`common.payment_methods.${order.paymentMethod}`, order.paymentMethod)})</span>
                <span className="font-bold text-success"><PriceDisplay amount={order.paidAmount} /></span>
              </div>
              <div className="flex justify-between items-center text-sm pt-2 border-t border-border">
                <span className="text-content-muted">{t('orders.remaining_label')}</span>
                <span className="font-black text-danger"><PriceDisplay amount={order.remainingAmount} /></span>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-center gap-4">
            <div className="p-4 bg-surface border-2 border-border rounded-3xl shadow-inner">
              <QRCodeSVG value={order.qrCode || order.id} size={120} />
            </div>
            <p className="text-[10px] text-content-muted font-bold text-center px-8 uppercase tracking-widest">
              {t('orders.scan_qr_desc')}
            </p>

            <Branding className="opacity-40 py-0" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button className="flex items-center justify-center gap-2 bg-brand text-white py-4 rounded-2xl font-bold hover:bg-brand/90 transition-all shadow-lg shadow-brand/10">
              <Printer size={20} />
              <span>{t('orders.print')}</span>
            </button>
            <button 
              onClick={() => sendToWhatsApp(order)}
              className="flex items-center justify-center gap-2 bg-success text-white py-4 rounded-2xl font-bold hover:bg-success/90 transition-all shadow-lg shadow-success/10"
            >
              <MessageSquare size={20} />
              <span>{t('orders.whatsapp')}</span>
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );

  if (isLoading) {
    return <PageSkeleton />;
  }

  return (
    <div className={cn("space-y-6", isRtlLang(i18n.language) ? "text-right" : "text-left")} dir={isRtlLang(i18n.language) ? 'rtl' : 'ltr'}>
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
                [t('common.total')]: o.totalAmount,
                [t('orders.amount_paid')]: o.paidAmount,
                [t('orders.remaining_label')]: o.remainingAmount,
                [t('common.status')]: t(STATUS_CONFIG[o.status].labelKey),
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
          <button
            id="tour-orders-new-btn"
            data-tour="orders-new-btn"
            onClick={() => handleOpenModal()}
            className="bg-brand text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-brand/90 transition-all shadow-lg shadow-brand/10"
          >
            <Plus size={20} />
            <span>{t('orders.create_new_order')}</span>
          </button>
        </div>
      </Header>

      <div className="flex flex-col md:flex-row gap-4">
        <div id="tour-orders-search" data-tour="orders-search" className="flex-1 bg-surface p-4 rounded-3xl border border-border shadow-sm flex items-center gap-3">
          <Search size={20} className="text-content-muted" />
          <input 
            type="text" 
            placeholder={t('orders.search_placeholder')} 
            data-orders-search="true"
            className="flex-1 bg-transparent border-none focus:ring-0 text-content"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button 
            type="button"
            onClick={() => setIsScannerOpen(true)}
            className="text-content-muted hover:text-brand transition-colors cursor-pointer"
          >
            <Barcode size={20} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 bg-surface p-4 rounded-3xl border border-border shadow-sm">
          <div className="flex items-center gap-2 min-w-[180px]">
            <Select
              value={statusFilter}
              onChange={(val) => setStatusFilter(val as OrderStatus | '')}
              options={[
                { value: '', label: t('orders.all_statuses') },
                ...(Object.keys(STATUS_CONFIG) as OrderStatus[]).map((status) => ({
                  value: status,
                  label: t(STATUS_CONFIG[status].labelKey)
                }))
              ]}
              className="bg-surface-muted"
            />
          </div>

          <div className="flex items-center gap-2">
            <Calendar size={18} className="text-content-muted" />
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-surface-muted border-none rounded-xl px-3 py-2 text-[10px] font-bold text-content focus:ring-2 focus:ring-brand"
              />
              <span className="text-content-muted text-xs">{t('orders.to')}</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-surface-muted border-none rounded-xl px-3 py-2 text-[10px] font-bold text-content focus:ring-2 focus:ring-brand"
              />
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
          <div className="p-12 text-center bg-surface border border-border rounded-[2.5rem] shadow-sm flex flex-col items-center justify-center">
            <div className="w-16 h-16 rounded-[1.5rem] bg-surface-muted border border-border flex items-center justify-center mb-4 text-content-muted/50">
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
          filteredOrders.map((order, index) => {
            const customerUnpaid = unpaidOrders.filter(o => o.customerId === order.customerId);
            const totalUnpaid = customerUnpaid.reduce((sum, o) => sum + (o.remainingAmount || 0), 0);

            return (
              <motion.div
                layout
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.03, 0.3) }}
                key={order.id}
                className={cn(
                  "p-3.5 sm:p-4 lg:p-6 rounded-2xl sm:rounded-3xl border transition-all duration-200 group relative overflow-visible z-10 hover:z-30",
                  selectedOrder?.id === order.id 
                    ? "bg-brand/5 border-brand ring-2 sm:ring-4 ring-brand/20 shadow-xl shadow-brand/10" 
                    : "bg-surface border-border shadow-sm hover:shadow-md hover:border-brand/30"
                )}
              >
                {/* Selection indicator */}
                {selectedOrder?.id === order.id && (
                  <motion.div 
                    layoutId="selected-indicator"
                    className="absolute right-0 top-0 bottom-0 w-1.5 bg-brand rounded-r-2xl rtl:rounded-l-2xl rtl:rounded-r-none"
                  />
                )}

                {/* MOBILE & TABLET LAYOUT (< lg) */}
                <div className="flex lg:hidden flex-col gap-3">
                  {/* Top Bar: Customer Name & Status / Main Actions */}
                  <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={cn(
                        "w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0 shadow-inner",
                        STATUS_CONFIG[order.status].bgColor,
                        STATUS_CONFIG[order.status].color
                      )}>
                        {React.createElement(STATUS_CONFIG[order.status].icon, { size: 20 })}
                      </div>

                      <div className="min-w-0 flex flex-col justify-center cursor-pointer" onClick={() => { setSelectedOrder(order); setIsDetailsOpen(true); }}>
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
                              className="flex items-center gap-1 bg-red-500/10 text-red-600 border border-red-500/20 px-1.5 py-0.5 rounded-md text-[9px] font-black shrink-0 animate-pulse"
                            >
                              <AlertCircle size={10} />
                              <PriceDisplay amount={totalUnpaid} />
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
                          STATUS_CONFIG[order.status].bgColor,
                          STATUS_CONFIG[order.status].color
                        )}
                      >
                        <span className={cn("w-1.5 h-1.5 rounded-full animate-pulse", STATUS_CONFIG[order.status].color.replace('text', 'bg'))} />
                        <span>{t(STATUS_CONFIG[order.status].labelKey)}</span>
                        {order.status !== 'delivered' && <ChevronDown size={12} className="opacity-60" />}
                      </button>

                      {order.status !== 'delivered' && openStatusDropdownId === order.id && (
                        <div className={cn(
                          "absolute top-full mt-2 w-48 bg-surface rounded-2xl shadow-2xl border border-border py-2 z-50 backdrop-blur-xl",
                          isRtlLang(i18n.language) ? "left-0" : "right-0"
                        )}>
                          {(Object.keys(STATUS_CONFIG) as OrderStatus[]).map((status) => {
                            const cfg = STATUS_CONFIG[status];
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
                        <PriceDisplay amount={order.totalAmount} />
                      </span>
                    </div>

                    {/* Box 4: Balance / Remaining */}
                    <div className="bg-surface-muted/60 p-2.5 rounded-xl border border-border/40 flex flex-col gap-1 justify-center">
                      <span className="text-[10px] font-bold text-content-muted">
                        {t('orders.remaining_label')}
                      </span>
                      <div>
                        {order.remainingAmount > 0 ? (
                          <span className="bg-red-500/10 text-red-600 border border-red-500/20 px-2 py-0.5 rounded-md text-[10px] font-black inline-flex items-center gap-1 truncate">
                            <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse shrink-0" />
                            <PriceDisplay amount={order.remainingAmount} />
                          </span>
                        ) : (
                          <span className="bg-green-500/10 text-green-600 border border-green-500/20 px-2 py-0.5 rounded-md text-[10px] font-black inline-flex items-center gap-1 truncate">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full shrink-0" />
                            {t('orders.fully_paid')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Footer Actions for Mobile & Tablet */}
                  <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-border/40 text-xs">
                    <div className="flex items-center gap-1.5">
                      <button 
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedOrder(order);
                          setIsInvoiceOpen(true);
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
                          setSelectedOrder(order);
                        }}
                        className="p-1.5 text-content-muted hover:text-brand hover:bg-brand/10 rounded-xl transition-all border border-border/40"
                        title={t('orders.quick_print')}
                      >
                        <Printer size={16} />
                      </button>

                      <button 
                        type="button"
                        onClick={(e) => { 
                          e.stopPropagation();
                          setSelectedOrder(order); 
                          setIsDetailsOpen(true); 
                        }}
                        className="p-1.5 text-content-muted hover:text-brand hover:bg-brand/10 rounded-xl transition-all border border-border/40"
                        title={t('orders.details')}
                      >
                        <Info size={16} />
                      </button>
                    </div>

                    <button 
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(order.id, order.orderNumber?.toString() || order.id);
                      }}
                      disabled={order.status === 'delivered'}
                      className={cn(
                        "p-1.5 transition-all rounded-xl border border-border/40",
                        order.status === 'delivered' 
                          ? "text-content-muted/20 cursor-not-allowed" 
                          : "text-content-muted hover:text-danger hover:bg-danger/10 hover:border-danger/20"
                      )}
                      title={t('orders.delete_order')}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                {/* DESKTOP LAYOUT (lg:flex) */}
                <div className="hidden lg:flex lg:items-center lg:justify-between lg:gap-6">
                  <div className="flex items-center gap-5">
                    <div className={cn(
                      "w-16 h-16 rounded-[1.5rem] flex items-center justify-center transition-all duration-500 group-hover:scale-105 group-hover:rotate-3 shrink-0",
                      STATUS_CONFIG[order.status].bgColor,
                      STATUS_CONFIG[order.status].color
                    )}>
                      {React.createElement(STATUS_CONFIG[order.status].icon, { size: 32 })}
                    </div>
                    <div className="cursor-pointer" onClick={() => { setSelectedOrder(order); setIsDetailsOpen(true); }}>
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
                            className="flex items-center gap-1 bg-red-500/10 hover:bg-red-500/20 text-red-600 border border-red-500/20 px-2.5 py-1 rounded-full text-xs font-black transition-all animate-pulse"
                            title={t('orders.customer_has_dues')}
                          >
                            <AlertCircle size={14} className="text-red-600" />
                            <span><PriceDisplay amount={totalUnpaid} /></span>
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
                          <PriceDisplay amount={order.totalAmount} />
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 bg-surface-muted/50 p-1 rounded-2xl border border-border">
                      <button 
                        onClick={() => {
                          setSelectedOrder(order);
                          setIsInvoiceOpen(true);
                        }}
                        className="px-3 py-2 text-brand hover:bg-brand hover:text-white rounded-xl transition-all flex items-center gap-2 font-black text-xs"
                        title={t('orders.view_invoice')}
                      >
                        <Eye size={16} />
                        <span>{t('orders.invoice')}</span>
                      </button>

                      <button 
                        onClick={() => {
                          setSelectedOrder(order);
                        }}
                        className="p-2 text-content-muted hover:text-brand hover:bg-brand/10 rounded-xl transition-all"
                        title={t('orders.quick_print')}
                      >
                        <Printer size={18} />
                      </button>

                      <button 
                        onClick={() => { setSelectedOrder(order); setIsDetailsOpen(true); }}
                        className="p-2 text-content-muted hover:text-brand hover:bg-brand/10 rounded-xl transition-all"
                        title={t('orders.details')}
                      >
                        <Info size={18} />
                      </button>
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
                          STATUS_CONFIG[order.status].bgColor,
                          STATUS_CONFIG[order.status].color,
                          order.status === 'delivered' ? "cursor-not-allowed opacity-80" : "hover:shadow-lg hover:shadow-brand/5 border border-brand/10 cursor-pointer"
                        )}
                      >
                        <div className={cn("w-2 h-2 rounded-full animate-pulse", STATUS_CONFIG[order.status].color.replace('text', 'bg'))} />
                        <span>{t(STATUS_CONFIG[order.status].labelKey)}</span>
                        {order.status !== 'delivered' && <ChevronDown size={14} className="opacity-50" />}
                      </motion.button>
                      
                      {order.status !== 'delivered' && openStatusDropdownId === order.id && (
                        <div className={cn(
                          "absolute top-full mt-2 w-56 bg-surface rounded-[2rem] shadow-2xl border border-border/50 py-3 z-30 animate-in fade-in zoom-in duration-200 backdrop-blur-xl",
                          isRtlLang(i18n.language) ? "right-0" : "left-0"
                        )}>
                          <div className="px-4 py-2 mb-2 border-b border-border/50">
                            <span className="text-[10px] font-black text-content-muted uppercase tracking-widest">{t('orders.update_status')}</span>
                          </div>
                          {(Object.keys(STATUS_CONFIG) as OrderStatus[]).map((status) => {
                            const cfg = STATUS_CONFIG[status];
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
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      {/* Modals */}
      <ScannerModal isOpen={isScannerOpen} onClose={() => setIsScannerOpen(false)} onScan={handleScan} />
      {isInvoiceOpen && selectedOrder && <InvoiceModal order={selectedOrder} />}
      <AnimatePresence>
        {isDetailsOpen && selectedOrder && <OrderDetailsDrawer order={selectedOrder} />}
      </AnimatePresence>
      {isQuickAddOpen && <QuickAddCustomerModal />}
      {isConfirmDeliveryOpen && <ConfirmDeliveryModal />}
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
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="relative w-full max-w-lg rounded-t-[2.5rem] lg:rounded-[2.5rem] shadow-2xl z-10 overflow-hidden bg-surface border border-border flex flex-col max-h-[85vh]"
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
                  className="p-2 hover:bg-surface-muted rounded-full transition-colors shadow-sm text-content-muted"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div className="p-4 bg-danger/10 border border-danger/20 rounded-2xl flex justify-between items-center">
                  <span className="font-bold text-sm text-danger">{t('orders.total_customer_dues')}</span>
                  <span className="font-mono font-black text-xl text-red-700">
                    <PriceDisplay amount={unpaidOrders.filter(o => o.customerId === dueDetailsCustomer.id).reduce((sum, o) => sum + (o.remainingAmount || 0), 0)} />
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
                          setSelectedOrder(o);
                          setDueDetailsCustomer(null);
                          setIsDetailsOpen(true);
                        }}
                        className="p-4 bg-surface-muted border border-border rounded-2xl hover:border-brand/40 hover:bg-brand/5 cursor-pointer transition-all flex justify-between items-center gap-4"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-black text-sm text-content">
                              #{o.orderNumber || o.id.slice(-6).toUpperCase()}
                            </span>
                            <span className="text-[10px] bg-brand/10 text-brand px-2 py-0.5 rounded-full font-bold">
                              {t(STATUS_CONFIG[o.status]?.labelKey || `common.status_${o.status}`)}
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
                          <div className="font-mono font-black text-base text-red-600">
                            <PriceDisplay amount={o.remainingAmount} />
                          </div>
                          <div className="text-[10px] text-content-muted font-bold">
                            {t('common.total')}: <PriceDisplay amount={o.totalAmount} />
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

      {/* Create Order Modal Refactored to Bottom Sheet */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {isModalOpen && (
            <div className="fixed inset-0 z-[100] flex items-end lg:items-center justify-center lg:p-4 overflow-hidden">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={handleCloseModal}
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              />
              <motion.div 
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className={cn("relative w-full lg:max-w-4xl rounded-t-[2.5rem] lg:rounded-[2.5rem] shadow-2xl z-10 overflow-hidden h-[95vh] lg:h-auto lg:max-h-[90vh] flex flex-col border border-border bg-surface", isRtlLang(i18n.language) ? "text-right" : "text-left")}
              dir={isRtlLang(i18n.language) ? "rtl" : "ltr"}
            >
              {/* Header (Fixed) */}
              <div className="sticky top-0 z-10 flex items-center justify-between p-4 sm:p-6 border-b border-[var(--border)] bg-[var(--surface)] shrink-0 bg-brand/5">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-brand text-white rounded-2xl shrink-0 shadow-sm">
                    <Plus size={20} />
                  </div>
                  <h3 className="text-base sm:text-lg lg:text-xl font-black text-content">{t('orders.create_new_order')}</h3>
                </div>
                <button type="button" onClick={handleCloseModal} className="p-2 hover:bg-surface-muted rounded-full transition-colors shadow-sm text-content-muted">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSubmit(onSubmit, onInvalidSubmit)} className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
                  <OrderStepper currentStatus="measurements_taken" />
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Customer Selection & Info */}
                    <div className="space-y-6">
                      <div className="space-y-2">
                        <label className="text-sm font-black text-content-muted uppercase tracking-widest">{t('common.customer')}</label>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <Controller 
                              name="customerId"
                              control={control}
                              render={({ field }) => (
                                <SmartSelect 
                                  value={field.value}
                                  onChange={field.onChange}
                                  options={[
                                    { value: '', label: t('orders.choose_customer') },
                                    ...customers.map(c => ({ value: c.id, label: c.name }))
                                  ]}
                                  error={!!errors.customerId}
                                  className="bg-surface-muted border-none"
                                />
                              )}
                            />
                          </div>
                          <button 
                            type="button" 
                            onClick={() => setIsQuickAddOpen(true)}
                            title={t('orders.add_new_customer')}
                            className="w-12 h-12 bg-brand text-white rounded-2xl flex items-center justify-center hover:bg-brand/90 transition-all shrink-0 shadow-sm active:scale-95"
                          >
                            <UserPlus size={20} />
                          </button>
                        </div>
                        {errors.customerId && <p className="text-xs text-danger font-bold mt-1">{String(errors.customerId.message)}</p>}
                      </div>

                      {selectedCustomer && (
                        <motion.div 
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="bg-brand/5 p-5 rounded-3xl border border-brand/10 space-y-4"
                        >
                          <div className="flex items-center justify-between text-brand mb-1">
                            <div className="flex items-center gap-2">
                              <Ruler size={18} />
                              <h4 className="font-black text-sm uppercase tracking-wider">{t('orders.customer_measurements_auto')}</h4>
                            </div>
                            {!isEditingMeasurements ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setTempMeasurements(selectedCustomer.measurements || {});
                                  setIsEditingMeasurements(true);
                                }}
                                className="text-xs font-bold text-brand bg-surface border border-brand/20 hover:bg-brand hover:text-white px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 shadow-sm active:scale-95"
                              >
                                <Edit2 size={13} />
                                <span>{t('common.edit')}</span>
                              </button>
                            ) : (
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setIsEditingMeasurements(false)}
                                  className="text-xs font-bold text-content-muted bg-surface hover:bg-surface-muted px-2.5 py-1 rounded-xl transition-all"
                                >
                                  {t('common.cancel')}
                                </button>
                                <button
                                  type="button"
                                  disabled={isSavingMeasurements}
                                  onClick={async () => {
                                    if (!selectedCustomer) return;
                                    setIsSavingMeasurements(true);
                                    try {
                                      const { error } = await supabase
                                        .from('customers')
                                        .update({ measurements: tempMeasurements })
                                        .eq('id', selectedCustomer.id);
                                      if (error) throw error;

                                      setCustomers(prev => prev.map(c => c.id === selectedCustomer.id ? { ...c, measurements: tempMeasurements } : c));
                                      toastSuccess(t('orders.measurements_updated_success'));
                                      setIsEditingMeasurements(false);
                                    } catch (err) {
                                      console.error(err);
                                      toastError(t('orders.measurements_update_failed'));
                                    } finally {
                                      setIsSavingMeasurements(false);
                                    }
                                  }}
                                  className="text-xs font-bold text-white bg-brand hover:bg-brand/90 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1 shadow-sm active:scale-95 disabled:opacity-50"
                                >
                                  <Check size={13} />
                                  <span>{isSavingMeasurements ? t('common.saving') : t('orders.save_measurements')}</span>
                                </button>
                              </div>
                            )}
                          </div>

                          {!isEditingMeasurements ? (
                            <>
                              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                                {[
                                  { label: t('measurements.length'), value: selectedCustomer.measurements?.length },
                                  { label: t('measurements.shoulder'), value: selectedCustomer.measurements?.shoulder },
                                  { label: t('measurements.chest'), value: selectedCustomer.measurements?.chest },
                                  { label: t('measurements.waist'), value: selectedCustomer.measurements?.waist },
                                  { label: t('measurements.hips'), value: selectedCustomer.measurements?.hips },
                                  { label: t('measurements.sleeve'), value: selectedCustomer.measurements?.sleeve },
                                  { label: t('measurements.neck'), value: selectedCustomer.measurements?.neck },
                                ].map((m) => (
                                  <div key={m.label} className="bg-surface p-2 rounded-xl border border-brand/10 text-center">
                                    <p className="text-[10px] text-content-muted font-bold">{m.label}</p>
                                    <p className="text-sm font-black text-brand">{m.value || '-'}</p>
                                  </div>
                                ))}
                              </div>
                              
                              {/* Visual Details Display */}
                              <div className="pt-3 border-t border-brand/10 grid grid-cols-2 gap-2">
                                {[
                                  { label: t('measurements.collarType'), value: selectedCustomer.measurements?.collarType },
                                  { label: t('measurements.cuffType'), value: selectedCustomer.measurements?.cuffType },
                                  { label: t('measurements.pocketType'), value: selectedCustomer.measurements?.pocketType },
                                  { label: t('measurements.chestStyle'), value: selectedCustomer.measurements?.chestStyle },
                                ].filter(v => v.value).map((v) => (
                                  <div key={v.label} className="flex items-center gap-2 bg-surface/50 p-2 rounded-lg border border-brand/5">
                                    <Zap size={12} className="text-brand/40" />
                                    <span className="text-[10px] font-bold text-content-muted">{v.label}: {v.value}</span>
                                  </div>
                                ))}
                              </div>
                            </>
                          ) : (
                            <div className="space-y-3 pt-1">
                              <p className="text-xs font-bold text-content-muted">{t('orders.edit_main_measurements')}</p>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {[
                                  { key: 'length', label: t('measurements.length') },
                                  { key: 'shoulder', label: t('measurements.shoulder') },
                                  { key: 'chest', label: t('measurements.chest') },
                                  { key: 'waist', label: t('measurements.waist') },
                                  { key: 'hips', label: t('measurements.hips') },
                                  { key: 'sleeve', label: t('measurements.sleeve') },
                                  { key: 'neck', label: t('measurements.neck') },
                                  { key: 'bottomWidth', label: t('measurements.bottomWidth') },
                                ].map((item) => (
                                  <div key={item.key} className="bg-surface p-2 rounded-xl border border-brand/10">
                                    <label className="text-[10px] text-content-muted font-bold block mb-1">{item.label}</label>
                                    <input
                                      type="number"
                                      step="0.1"
                                      min="0"
                                      value={(tempMeasurements as any)[item.key] ?? ''}
                                      onChange={(e) => setTempMeasurements(prev => ({
                                        ...prev,
                                        [item.key]: e.target.value === '' ? '' : Number(e.target.value)
                                      }))}
                                      className="w-full bg-surface-muted text-sm font-bold text-brand text-center p-1.5 rounded-lg outline-none border border-transparent focus:border-brand"
                                    />
                                  </div>
                                ))}
                              </div>

                              <p className="text-xs font-bold text-content-muted pt-2 border-t border-brand/10">{t('orders.edit_style_details')}</p>
                              <div className="grid grid-cols-2 gap-2">
                                {[
                                  { key: 'collarType', label: t('measurements.collarType') },
                                  { key: 'cuffType', label: t('measurements.cuffType') },
                                  { key: 'pocketType', label: t('measurements.pocketType') },
                                  { key: 'chestStyle', label: t('measurements.chestStyle') },
                                ].map((styleItem) => (
                                  <div key={styleItem.key} className="bg-surface p-2 rounded-xl border border-brand/10">
                                    <label className="text-[10px] text-content-muted font-bold block mb-1">{styleItem.label}</label>
                                    <input
                                      type="text"
                                      value={(tempMeasurements as any)[styleItem.key] ?? ''}
                                      onChange={(e) => setTempMeasurements(prev => ({
                                        ...prev,
                                        [styleItem.key]: e.target.value
                                      }))}
                                      className="w-full bg-surface-muted text-xs font-bold text-content p-1.5 rounded-lg outline-none border border-transparent focus:border-brand"
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </motion.div>
                      )}
                    </div>

                  {/* Delivery Info */}
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-sm font-black text-content-muted uppercase tracking-widest">{t('orders.expected_delivery_date')}</label>
                      <div className="relative">
                        <Calendar className="absolute right-4 top-1/2 -translate-y-1/2 text-content-muted" size={20} />
                        <input 
                          type="date" 
                          {...register('deliveryDate')} 
                          className={cn(
                            "w-full bg-surface-muted border-2 border-transparent focus:border-brand rounded-2xl p-4 pr-12 font-bold transition-all outline-none text-content",
                            errors.deliveryDate && "border-danger"
                          )} 
                        />
                      </div>
                      {errors.deliveryDate && <p className="text-xs text-danger font-bold mt-1">{String(errors.deliveryDate.message)}</p>}
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-black text-content-muted uppercase tracking-widest">{t('orders.general_notes')}</label>
                      <textarea 
                        {...register('notes')} 
                        placeholder={t('orders.additional_instructions')}
                        className="w-full bg-surface-muted border-2 border-transparent focus:border-brand rounded-2xl p-4 font-bold transition-all outline-none h-32 resize-none text-content" 
                      />
                    </div>
                  </div>
                </div>

                {/* Items Section */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h4 className="text-sm font-black text-content-muted uppercase tracking-widest flex items-center gap-2">
                      <ShoppingBag size={16} />
                      {t('orders.required_items')}
                    </h4>
                    <button 
                      type="button" 
                      onClick={() => append({ garmentType: 'ثوب', quantity: 1, price: 0, fabric: '' })}
                      className="bg-brand/5 text-brand px-4 py-2 rounded-xl text-xs font-black hover:bg-brand/10 transition-all flex items-center gap-2"
                    >
                      <Plus size={14} /> {t('orders.add_item')}
                    </button>
                  </div>
                  
                    <div className="space-y-4">
                      {fields.map((field, index) => (
                        <motion.div 
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          key={field.id} 
                          className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-surface-muted p-6 rounded-[2rem] relative group border border-transparent hover:border-brand/10 transition-all"
                        >
                          <div className="space-y-1">
                            <label className="text-[10px] text-content-muted font-bold uppercase tracking-wider">{t('orders.item_type')}</label>
                            <input 
                              {...register(`items.${index}.garmentType` as any)} 
                              className={cn(
                                "w-full bg-surface border-none rounded-xl p-3 text-sm font-bold shadow-sm text-content",
                                (errors.items as any)?.[index]?.garmentType && "ring-2 ring-danger"
                              )} 
                              placeholder={t('orders.item_type_placeholder')}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-content-muted font-bold uppercase tracking-wider">{t('orders.fabric')}</label>
                            <Controller
                              name={`items.${index}.fabric` as any}
                              control={control}
                              render={({ field }) => (
                                <SmartSelect
                                  value={field.value}
                                  onChange={(val) => {
                                    field.onChange(val);
                                    const selectedFabric = inventory.find(i => i.name === val);
                                    if (selectedFabric) {
                                      setValue(`items.${index}.fabricId` as any, selectedFabric.id);
                                      setValue(`items.${index}.selectedUnit` as any, selectedFabric.unit);
                                      // Trigger calculation
                                      const qty = watch(`items.${index}.quantity` as any) || 0;
                                      setValue(`items.${index}.consumedMeters` as any, qty * (selectedFabric.conversionRate || 1));
                                    }
                                  }}
                                  className={cn(
                                    "w-full bg-surface rounded-xl shadow-sm",
                                    (errors.items as any)?.[index]?.fabric && "ring-2 ring-danger"
                                  )}
                                  options={[
                                    { value: '', label: t('orders.choose_fabric') },
                                    ...inventory.map(item => ({ value: item.name, label: `${item.name} (${item.quantity} ${item.unit})` })),
                                    { value: 'custom', label: t('orders.external_fabric') }
                                  ]}
                                />
                              )}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-content-muted font-bold uppercase tracking-wider">{t('orders.qty_and_unit')}</label>
                            <div className="flex gap-1">
                              <input 
                                type="number" 
                                step="0.01"
                                {...register(`items.${index}.quantity` as any)} 
                                onChange={(e) => {
                                  const qty = Number(e.target.value);
                                  const fabricName = watch(`items.${index}.fabric` as any);
                                  const selectedFabric = inventory.find(i => i.name === fabricName);
                                  if (selectedFabric) {
                                    setValue(`items.${index}.consumedMeters` as any, qty * (selectedFabric.conversionRate || 1));
                                  }
                                  register(`items.${index}.quantity` as any).onChange(e);
                                }}
                                className={cn(
                                  "w-2/3 bg-surface border-none rounded-xl p-3 text-sm font-bold shadow-sm text-content",
                                  (errors.items as any)?.[index]?.quantity && "ring-2 ring-danger"
                                )} 
                              />
                              <div className="w-1/3">
                                <Controller
                                  name={`items.${index}.selectedUnit` as any}
                                  control={control}
                                  render={({ field }) => (
                                    <SmartSelect
                                      {...field}
                                      className="w-full bg-surface rounded-xl text-xs font-bold shadow-sm"
                                      options={[
                                        { value: 'meter', label: t('inventory.unit_meter') },
                                        { value: 'yard', label: t('inventory.unit_yard') },
                                        { value: 'roll', label: t('orders.roll') },
                                        { value: 'bolt', label: t('orders.bolt') }
                                      ]}
                                    />
                                  )}
                                />
                              </div>
                            </div>
                            {watch(`items.${index}.consumedMeters` as any) > 0 && (
                              <p className="text-[10px] text-brand font-bold mt-1">
                                {t('orders.equivalent_meters', { meters: Number(watch(`items.${index}.consumedMeters` as any)).toFixed(2) })}
                              </p>
                            )}
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-content-muted font-bold uppercase tracking-wider">{t('orders.price')}</label>
                            <input 
                              type="number" 
                              {...register(`items.${index}.price` as any)} 
                              className={cn(
                                "w-full bg-surface border-none rounded-xl p-3 text-sm font-bold shadow-sm text-content",
                                (errors.items as any)?.[index]?.price && "ring-2 ring-danger"
                              )} 
                            />
                          </div>

                          {/* Visual Customization UI */}
                          <div className="md:col-span-4 mt-4 pt-4 border-t border-border space-y-6">
                            <VisualMeasurements 
                              values={watch(`items.${index}` as any)} 
                              onChange={(field, val) => setValue(`items.${index}.${field}` as any, val)} 
                            />
                            
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              <div className="space-y-2">
                                <label className="text-[10px] text-content-muted font-bold uppercase tracking-wider">{t('orders.padding_type')}</label>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setValue(`items.${index}.collarPadding` as any, 'hard')}
                                    className={cn(
                                      "flex-1 flex flex-col items-center gap-1 p-2 rounded-xl border-2 transition-all",
                                      watch(`items.${index}.collarPadding` as any) === 'hard' ? "border-brand bg-brand/10 text-brand" : "border-border bg-surface text-content-muted"
                                    )}
                                  >
                                    <Shield size={18} />
                                    <span className="text-[10px] font-bold">{t('orders.padding_hard')}</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setValue(`items.${index}.collarPadding` as any, 'soft')}
                                    className={cn(
                                      "flex-1 flex flex-col items-center gap-1 p-2 rounded-xl border-2 transition-all",
                                      watch(`items.${index}.collarPadding` as any) === 'soft' ? "border-brand bg-brand/10 text-brand" : "border-border bg-surface text-content-muted"
                                    )}
                                  >
                                    <Clock size={18} />
                                    <span className="text-[10px] font-bold">{t('orders.padding_soft')}</span>
                                  </button>
                                </div>
                              </div>

                              <div className="space-y-2">
                                <label className="text-[10px] text-content-muted font-bold uppercase tracking-wider">{t('orders.other_additions')}</label>
                                <input 
                                  {...register(`items.${index}.additions` as any)}
                                  placeholder={t('orders.other_additions_placeholder')}
                                  className="w-full bg-surface border-none rounded-xl p-3 text-xs font-bold shadow-sm text-content"
                                />
                              </div>

                              <div className="space-y-2">
                                <label className="text-[10px] text-content-muted font-bold uppercase tracking-wider">{t('orders.embroidery_label')}</label>
                                <input 
                                  {...register(`items.${index}.embroidery` as any)}
                                  placeholder={t('orders.embroidery_placeholder')}
                                  className="w-full bg-surface border-none rounded-xl p-3 text-xs font-bold shadow-sm text-content"
                                />
                              </div>
                            </div>
                          </div>

                          {index > 0 && (
                            <button 
                              type="button" 
                              onClick={() => remove(index)}
                              className="absolute -right-2 -top-2 bg-danger text-white p-2 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-all hover:scale-110"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </motion.div>
                      ))}
                    </div>
                </div>

                {/* Financials & Images */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="bg-brand text-white p-8 rounded-[2.5rem] shadow-2xl shadow-brand/10 space-y-6 relative overflow-hidden">
                      <div className="absolute top-0 right-0 p-8 opacity-10 -rotate-12 scale-150">
                        <ShoppingBag size={120} />
                      </div>
                      <div className="relative z-10 space-y-4">
                        {isTaxEnabled ? (
                          <>
                            <div className="flex justify-between items-center text-sm border-b border-white/10 pb-2">
                              <span className="text-brand-content/70 font-medium">{t('orders.subtotal')}</span>
                              <span className="font-bold text-white"><PriceDisplay amount={roundedSubtotal} /></span>
                            </div>
                            <div className="flex justify-between items-center text-sm border-b border-white/10 pb-2">
                              <span className="text-brand-content/70 font-medium">{t('orders.vat_label')} ({vatRatePercentage}%)</span>
                              <span className="font-bold text-white"><PriceDisplay amount={roundedVat} /></span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-brand-content/90 font-black text-sm uppercase tracking-widest">{t('orders.grand_total')}</span>
                              <span className="text-3xl font-black text-white"><PriceDisplay amount={roundedGrandTotal} /></span>
                            </div>
                          </>
                        ) : (
                          <div className="flex justify-between items-center">
                            <span className="text-brand-content/80 font-bold text-sm uppercase tracking-widest">{t('orders.grand_total')}</span>
                            <span className="text-3xl font-black text-white"><PriceDisplay amount={roundedGrandTotal} /></span>
                          </div>
                        )}
                        
                        <div className="space-y-3 mt-6">
                          <label className="text-xs font-bold text-brand-content/60 uppercase tracking-widest">{t('orders.payment_method_label')}</label>
                          <div className="grid grid-cols-2 gap-2">
                            {PAYMENT_METHODS.map((method) => (
                              <button
                                key={method.id}
                                type="button"
                                onClick={() => setValue('paymentMethod' as any, method.id)}
                                className={cn(
                                  "flex items-center gap-2 p-3 rounded-xl border-2 transition-all text-xs font-bold",
                                  watch('paymentMethod' as any) === method.id ? "border-surface bg-surface text-brand shadow-lg" : "border-surface/20 bg-surface/10 text-surface"
                                )}
                              >
                                <method.icon size={16} />
                                {t(method.labelKey)}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-3 pt-6 border-t border-white/10 mt-6">
                          <label className="text-xs font-bold text-brand-content/60 uppercase tracking-widest">{t('orders.amount_paid')}</label>
                          <div className="relative">
                            <CreditCard className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40" size={20} />
                            <input 
                              type="number" 
                              {...register('paidAmount')} 
                              className="w-full bg-surface/10 border-2 border-surface/10 rounded-2xl p-4 pr-12 font-black text-surface placeholder:text-surface/30 focus:ring-2 focus:ring-surface outline-none" 
                            />
                          </div>
                          <div className="flex justify-between text-xs font-bold pt-2">
                            <span className="text-brand-content/80">{t('orders.remaining_label')}</span>
                            <span className="text-white bg-danger px-2 py-0.5 rounded-lg"><PriceDisplay amount={Number(roundedGrandTotal) - Number(watch('paidAmount') || 0)} /></span>
                          </div>
                        </div>
                      </div>

                    {/* isTest Flag */}
                    <div className="flex items-center gap-3 p-4 bg-surface/5 rounded-2xl border border-surface/10 mt-6">
                      <input
                        type="checkbox"
                        id="isTest"
                        {...register('isTest')}
                        className="w-5 h-5 text-brand border-white/20 rounded focus:ring-brand bg-transparent"
                      />
                      <label htmlFor="isTest" className="text-sm font-bold text-content-muted/60 flex items-center gap-2">
                        <Zap size={16} className="text-warning" />
                        {t('common.test_data')}
                      </label>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h4 className="text-sm font-black text-content-muted uppercase tracking-widest flex items-center gap-2">
                      <ImageIcon size={16} />
                      {t('orders.illustration_images')}
                    </h4>
                    <div className="space-y-3">
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          id="imageUrlInput"
                          placeholder={t('orders.image_url_placeholder')}
                          className="flex-1 bg-surface-muted border-none rounded-xl p-3 text-sm font-bold text-content"
                        />
                        <button 
                          type="button"
                          onClick={() => {
                            const input = document.getElementById('imageUrlInput') as HTMLInputElement;
                            if (input.value) {
                              const currentImages = watch('images') || [];
                              setValue('images', [...currentImages, input.value]);
                              input.value = '';
                            }
                          }}
                          className="bg-brand text-white px-4 rounded-xl font-bold text-xs"
                        >
                          {t('common.add')}
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {watch('images')?.map((img, idx) => (
                          <div key={img + idx} className="relative group aspect-square">
                            <img src={img} className="w-full h-full object-cover rounded-xl border border-border" referrerPolicy="no-referrer" />
                            <button 
                              type="button"
                              onClick={() => {
                                const currentImages = watch('images') || [];
                                setValue('images', currentImages.filter((_, i) => i !== idx));
                              }}
                              className="absolute -top-1 -right-1 bg-danger text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X size={10} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* isTest Flag */}
                <div className="flex items-center gap-3 p-4 bg-amber-500/10 rounded-2xl border border-amber-500/20 mb-8">
                  <input
                    type="checkbox"
                    id="isTestOrder"
                    {...register('isTest')}
                    className="w-5 h-5 text-brand border-border rounded focus:ring-brand"
                  />
                  <label htmlFor="isTestOrder" className="text-sm font-bold text-amber-600 flex items-center gap-2">
                    <Zap size={16} />
                    {t('common.test_data')}
                  </label>
                </div>

                </div>

                {/* Footer (Fixed to Modal Bottom) */}
                <div className="shrink-0 p-4 sm:p-6 border-t border-border bg-surface flex flex-wrap items-center justify-between gap-4 z-20 shadow-md">
                  <div>
                    {Object.keys(errors).length > 0 && (
                      <p className="text-xs text-danger font-bold flex items-center gap-1">
                        <AlertCircle size={14} />
                        {t('orders.fill_required_fields')}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-3">
                    <button 
                      type="button" 
                      onClick={handleCloseModal} 
                      className="px-6 py-2.5 sm:px-8 sm:py-3.5 text-content-muted font-bold hover:text-content transition-colors text-sm sm:text-base rounded-xl hover:bg-surface-muted"
                    >
                      {t('common.cancel')}
                    </button>
                    <button 
                      type="submit" 
                      disabled={isSubmitting}
                      className="bg-brand text-white px-8 py-2.5 sm:px-12 sm:py-3.5 rounded-xl font-bold hover:bg-brand/90 shadow-lg shadow-brand/20 transition-all hover:scale-102 active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base"
                    >
                      {isSubmitting ? t('orders.saving') : t('orders.confirm_create_order')}
                    </button>
                  </div>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
