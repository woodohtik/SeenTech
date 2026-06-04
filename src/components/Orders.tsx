"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useRealtimeSync } from '../hooks/useRealtimeSync';
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
  FileSpreadsheet
} from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { auth, handleFirestoreError, OperationType, getFriendlyErrorMessage } from '../lib/firebase';
import { Order, Customer, OrderStatus, OrderHistory, InventoryItem, PaymentMethod, OrderItem, Staff, Tenant, ThobeMeasurements } from '../types';
import { cn, generateOrderNumber } from '../lib/utils';
import { PriceDisplay } from './PriceDisplay';
import { logEmployeeAction } from '../services/employeeAuditService';
import Header from './Header';
import VisualMeasurements from './VisualMeasurements';
import ThobeMeasurementSelector from './ThobeMeasurementSelector';
import { motion, AnimatePresence } from 'motion/react';
import { usePermissions } from '../hooks/usePermissions';
import { useToast } from '../contexts/ToastContext';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { orderSchema, customerSchema } from '../lib/validations';
import { QRCodeSVG } from 'qrcode.react';
import * as XLSX from 'xlsx';
import Branding from './Branding';
import Select from './ui/Select';
import { SmartSelect } from './ui/SmartSelect';
import { checkStockAvailability, deductStock } from '../services/inventoryService';
import { useStaff } from '../contexts/StaffContext';
import { useBranding } from '../contexts/BrandingContext';
import { analytics, AnalyticsEvent } from '../services/analyticsService';

export const STATUS_CONFIG: Record<OrderStatus, { label: string, icon: any, color: string, bgColor: string }> = {
  'measurements_taken': { label: 'أخذ المقاسات', icon: User, color: 'text-info', bgColor: 'bg-info/10' },
  'cutting': { label: 'قص القماش', icon: Scissors, color: 'text-warning', bgColor: 'bg-warning/10' },
  'sewing': { label: 'خياطة', icon: Clock, color: 'text-info', bgColor: 'bg-info/10' },
  'embroidery': { label: 'تطريز', icon: CheckSquare, color: 'text-brand', bgColor: 'bg-brand/10' },
  'ironing_packaging': { label: 'كوي وتغليف', icon: Package, color: 'text-info', bgColor: 'bg-info/10' },
  'ready': { label: 'جاهز للاستلام', icon: CheckCircle2, color: 'text-success', bgColor: 'bg-success/10' },
  'partial_delivered': { label: 'تسليم جزئي', icon: Package, color: 'text-info', bgColor: 'bg-info/10' },
  'delivered': { label: 'تم التسليم', icon: Truck, color: 'text-content-muted', bgColor: 'bg-surface-muted' },
  'cancelled': { label: 'ملغي', icon: X, color: 'text-danger', bgColor: 'bg-danger/10' }
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
                  {config.label}
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
  { id: 'cash', label: 'كاش', icon: ShoppingBag },
  { id: 'network', label: 'شبكة', icon: CreditCard },
  { id: 'cash_on_delivery', label: 'الدفع عند الاستلام', icon: Truck },
  { id: 'partial', label: 'عربون/جزئي', icon: Clock },
];

export default function Orders({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const refreshCounter = useRefreshCounter();
  const { settings: branding } = useBranding();
  const { error: toastError, success: toastSuccess, warning: toastWarning, handleError } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isInvoiceOpen, setIsInvoiceOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [pendingStatusUpdate, setPendingStatusUpdate] = useState<{ id: string, status: OrderStatus } | null>(null);
  const [statusFilter, setStatusFilter] = useState<OrderStatus | ''>('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [activeTab, setActiveTab] = useState<'active' | 'completed'>('active');
  const [isConfirmDeliveryOpen, setIsConfirmDeliveryOpen] = useState(false);
  const [tenantStrategy, setTenantStrategy] = useState<'centralized' | 'decentralized'>('centralized');
  const [searchParams] = useSearchParams();
  const { currentStaff } = useStaff();
  const { hasPermission, checkPermission } = usePermissions(currentStaff);

  const canCreate = hasPermission('orders.create');
  const canEdit = hasPermission('orders.edit');
  const canDelete = hasPermission('orders.delete');
  const canRefund = hasPermission('action.refund');
  const canDiscount = hasPermission('action.discount');

  const { register, control, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting, isValid } } = useForm({
    resolver: zodResolver(orderSchema),
    defaultValues: {
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
        closureType: 'buttons',
        closureVisibility: 'visible',
        collarType: 'plain',
        cuffType: 'plain',
        pocketType: 'single',
        chestStyle: 'plain',
        collarPadding: 'soft',
        additions: '',
        embroidery: ''
      }],
      status: 'measurements_taken',
      paidAmount: 0,
      paymentMethod: 'cash',
      discountAmount: 0,
      notes: '',
      internalNotes: '',
      images: [],
      isTest: false
    }
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "items" as any
  });

  const watchItems = watch("items" as any);
  const watchCustomerId = watch("customerId");
  const selectedCustomer = customers.find(c => c.id === watchCustomerId);
  const totalAmount = watchItems?.reduce((acc: number, item: any) => acc + (Number(item.price) * Number(item.quantity) || 0), 0) || 0;

  const mapOrderData = useCallback((o: any): Order => {
    return {
      ...o,
      customerId: o.customer_id,
      customerName: o.customer_name,
      tenantId: o.tenant_id,
      branchId: o.branch_id,
      shiftId: o.shift_id,
      totalAmount: o.total_amount,
      paidAmount: o.paid_amount,
      remainingAmount: o.remaining_amount,
      taxAmount: o.tax_amount,
      taxRate: o.tax_rate,
      orderDate: o.order_date,
      deliveryDate: o.delivery_date,
      createdBy: o.created_by,
      subTotalAmount: o.subtotal_amount,
      discountAmount: o.discount_amount,
      orderNumber: o.order_number,
      paymentMethod: o.payment_method
    } as Order;
  }, []);

  useRealtimeSync('orders', tenantId, (payload) => {
    if (payload.eventType === 'INSERT') {
      const newOrder = mapOrderData(payload.new);
      if (newOrder.items.some((item: any) => item.type === 'custom' || !item.type)) {
        setOrders(prev => [newOrder, ...prev]);
      }
    } else if (payload.eventType === 'UPDATE') {
      const updatedOrder = mapOrderData(payload.new);
      if (updatedOrder.items.some((item: any) => item.type === 'custom' || !item.type)) {
        setOrders(prev => {
          const index = prev.findIndex(o => o.id === updatedOrder.id);
          if (index >= 0) {
            const arr = [...prev];
            arr[index] = updatedOrder;
            return arr;
          }
          return [updatedOrder, ...prev];
        });
      }
    } else if (payload.eventType === 'DELETE') {
      setOrders(prev => prev.filter(o => o.id !== payload.old.id));
    }
  });

  useEffect(() => {
    if (!tenantId) return;

    const fetchOrders = async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('order_date', { ascending: false });
      
      if (error) {
        handleFirestoreError(error, OperationType.LIST, 'orders');
      } else {
        const allOrders = (data || []).map(mapOrderData);
        // Only show orders that have at least one custom item, or legacy orders (no type field)
        const trackingOrders = allOrders.filter(order => 
          order.items.some((item: any) => item.type === 'custom' || !item.type)
        );
        setOrders(trackingOrders);
      }
    };

    fetchOrders();

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
          const mappedTenant = {
            ...tenantData,
            ownerEmail: tenantData.owner_email,
            inventoryStrategy: tenantData.inventory_strategy,
            createdAt: tenantData.created_at,
            vatNumber: tenantData.vat_number,
            customerId: tenantData.customer_id
          } as unknown as Tenant;
          setTenant(mappedTenant);
          setTenantStrategy(mappedTenant.inventoryStrategy || 'centralized');
        }
      } catch (error) {
        handleFirestoreError(error as any, OperationType.LIST, 'data');
      }
    };

    fetchData();
  }, [tenantId, mapOrderData, refreshCounter]);

  useEffect(() => {
    const customerId = searchParams.get('customerId');
    if (customerId && customers.length > 0) {
      setValue('customerId', customerId);
      setIsModalOpen(true);
    }
  }, [searchParams, customers, setValue]);

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

    const onQuickAddSubmit = async (data: any) => {
      try {
        const { data: newCust, error } = await supabase
          .from('customers')
          .insert({
            ...data,
            tenant_id: tenantId,
            created_at: new Date().toISOString()
          })
          .select()
          .single();
        
        if (error) throw error;

        const mappedCust = {
          ...newCust,
          isTest: newCust.is_test,
          isB2B: newCust.is_b2b,
          createdAt: newCust.created_at,
          tenantId: newCust.tenant_id
        } as unknown as Customer;

        setCustomers(prev => [mappedCust, ...prev]);
        setValue('customerId', mappedCust.id);
        setIsQuickAddOpen(false);
        resetCust();
      } catch (error) {
        handleFirestoreError(error as any, OperationType.WRITE, 'customers');
      }
    };

    return (
      <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto font-sans">
        <motion.div 
          initial={{ scale: 0.95, opacity: 0, y: 20 }} 
          animate={{ scale: 1, opacity: 1, y: 0 }} 
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="relative w-full max-w-[clamp(320px,94vw,1100px)] max-h-[90vh] rounded-[var(--radius-card)] bg-[var(--surface)] shadow-2xl flex flex-col my-auto border border-border overflow-hidden text-right" 
          dir="rtl"
        >
          {/* Header (Fixed) */}
          <div className="sticky top-0 z-10 flex items-center justify-between p-4 sm:p-6 border-b border-[var(--border)] bg-[var(--surface)] shrink-0 bg-brand/5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-brand text-white rounded-2xl shrink-0 shadow-sm">
                <UserPlus size={20} />
              </div>
              <h3 className="text-base sm:text-lg lg:text-xl font-black text-content">إضافة عميل جديد</h3>
            </div>
            <button type="button" onClick={() => setIsQuickAddOpen(false)} className="p-2 hover:bg-surface-muted rounded-full transition-colors shadow-sm text-content-muted">
              <X size={20} />
            </button>
          </div>
          
          <form onSubmit={handleCustSubmit(onQuickAddSubmit)} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1">
                <label className="text-xs font-bold text-content-muted">الاسم الكامل</label>
                <input {...regCust('name')} className="w-full bg-surface-muted border-none rounded-xl p-3 text-sm focus:ring-2 focus:ring-brand text-content" />
                {custErrors.name && <p className="text-[10px] text-danger font-bold">{custErrors.name.message}</p>}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-content-muted">رقم الهاتف</label>
                <input {...regCust('phone')} className="w-full bg-surface-muted border-none rounded-xl p-3 text-sm focus:ring-2 focus:ring-brand text-content" />
                {custErrors.phone && <p className="text-[10px] text-danger font-bold">{custErrors.phone.message}</p>}
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-sm font-black text-content-muted uppercase tracking-widest flex items-center gap-2">
                <Ruler size={16} />
                القياسات الأساسية
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { id: 'length', label: 'الطول' },
                  { id: 'shoulder', label: 'الكتف' },
                  { id: 'chest', label: 'الصدر' },
                  { id: 'waist', label: 'الخصر' },
                  { id: 'hips', label: 'الأرداف' },
                  { id: 'sleeve', label: 'الكم' },
                  { id: 'neck', label: 'الرقبة' },
                ].map((field) => (
                  <div key={field.id} className="space-y-1">
                    <label className="text-[10px] font-bold text-content-muted">{field.label}</label>
                    <input 
                      type="number" 
                      step="0.1"
                      {...regCust(`measurements.${field.id}` as any)} 
                      className="w-full bg-surface-muted border-none rounded-lg p-2 text-sm focus:ring-2 focus:ring-brand text-content" 
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-sm font-black text-content-muted uppercase tracking-widest flex items-center gap-2">
                <Zap size={16} />
                التفاصيل البصرية والمقاسات التفاعلية
              </h4>
              <VisualMeasurements 
                values={watchCustMeasurements || {}} 
                onChange={(field, val) => setCustValue(`measurements.${field}` as any, val)} 
              />
              
              <div className="mt-8 pt-8 border-t border-border">
                <h3 className="text-sm font-black text-content flex items-center gap-2 mb-4">
                  <div className="w-1.5 h-4 bg-brand rounded-full" />
                  مُحدد المقاسات البصري التفاعلي
                </h3>
                <ThobeMeasurementSelector 
                  values={(watchCustMeasurements?.thobeMeasurements as ThobeMeasurements) || {
                    collar: 0,
                    chest: 0,
                    shoulders: 0,
                    sleeves: 0,
                    length: 0,
                    bottomWidth: 0
                  }}
                  onChange={(newMeasurements) => setCustValue('measurements.thobeMeasurements' as any, newMeasurements)}
                />
              </div>
            </div>

            {/* Footer (Fixed) */}
            <div className="sticky bottom-0 z-10 p-4 sm:p-6 border-t border-[var(--border)] bg-[var(--surface)] shrink-0 flex justify-end gap-3">
              <button type="button" onClick={() => setIsQuickAddOpen(false)} className="px-6 py-2.5 sm:px-8 sm:py-3.5 text-content-muted font-bold hover:text-content transition-colors text-sm sm:text-base">إلغاء</button>
              <button type="submit" disabled={custSubmitting} className="bg-brand text-white px-8 py-2.5 sm:px-12 sm:py-3.5 rounded-xl font-bold hover:bg-brand/90 shadow-lg shadow-brand/20 transition-all hover:scale-102 active:scale-98 disabled:opacity-50 text-sm sm:text-base">
                {custSubmitting ? 'جاري الحفظ...' : 'تأكيد وإضافة العميل'}
              </button>
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
      toastError('خطأ: لم يتم العثور على كود المتجر');
      return;
    }

    if (tenantStrategy === 'decentralized' && !currentStaff?.branchId) {
      toastError('خطأ: يجب ربط الموظف بفرع لاستخدام استراتيجية المخزون اللامركزية');
      return;
    }

    const initialHistory: OrderHistory = {
      status: 'measurements_taken',
      updatedAt: new Date().toISOString(),
      updatedBy: currentStaff?.name || 'المالك',
      updatedByUid: currentStaff?.id || auth.currentUser?.uid,
      notes: 'تم إنشاء الطلب'
    };

    const isUuid = (val: string | undefined | null) => 
      val ? /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val) : false;

    const orderData = {
      tenant_id: tenantId,
      branch_id: (currentStaff?.branchId && isUuid(currentStaff.branchId)) ? currentStaff.branchId : null,
      customer_id: isUuid(data.customerId) ? data.customerId : null,
      customer_name: selectedCustomer?.name || 'عميل غير معروف',
      order_number: generateOrderNumber(),
      status: data.status || 'measurements_taken',
      payment_method: data.paymentMethod || 'cash',
      total_amount: totalAmount,
      paid_amount: Number(data.paidAmount || 0),
      tax_rate: Number(data.taxRate || 0),
      tax_amount: Number(data.taxAmount || 0),
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
        if (!confirm(`تحذير: الكميات التالية غير متوفرة في المخزون: ${missingItems.join(', ')}. هل تود المتابعة على أي حال؟`)) {
          toastWarning('تم إلغاء إضافة الطلب بسبب نقص المخزون');
          return;
        }
      }

      const { data: newOrder, error } = await supabase
        .from('orders')
        .insert(orderData)
        .select()
        .single();
      
      if (error) throw error;
      
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

      setIsModalOpen(false);
      reset();
      router.refresh();
      toastSuccess('تم إضافة الطلب بنجاح');
    } catch (error: any) {
      console.error('Order submission error:', error);
      handleFirestoreError(error, OperationType.WRITE, 'orders');
    }
  };

  const updateStatus = async (id: string, status: OrderStatus, notes?: string) => {
    const order = orders.find(o => o.id === id);
    if (!order) return;

    // Prevent any changes if order is already delivered (locked)
    if (order.status === 'delivered') {
      alert('لا يمكن تعديل حالة الطلب بعد تسليمه.');
      return;
    }

    // Prevent delivery if there's a remaining balance
    if (status === 'delivered') {
      if (order.remainingAmount > 0) {
        alert('لا يمكن تسليم الطلب قبل سداد كامل المبلغ المتبقي.');
        setPendingStatusUpdate({ id, status });
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
          alert('حدث خطأ أثناء خصم المخزون: ' + (err instanceof Error ? err.message : 'خطأ غير معروف'));
          return;
        }
      }

      const historyEntry: OrderHistory = {
        status,
        updatedAt: new Date().toISOString(),
        updatedBy: currentStaff?.name || 'المالك',
        updatedByUid: currentStaff?.id || auth.currentUser?.uid,
        notes: notes || `تغيير الحالة إلى ${STATUS_CONFIG[status].label}`
      };

      const updatedHistory = [...(order.history || []), historyEntry];

      const { error } = await supabase
        .from('orders')
        .update({
          status,
          history: updatedHistory
        })
        .eq('id', id);

      if (error) throw error;
      router.refresh();
      toastSuccess(`تم تحديث حالة الطلب بنجاح`);
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
        updatedBy: currentStaff?.name || 'المالك',
        updatedByUid: currentStaff?.id || auth.currentUser?.uid,
        notes: `تم تسليم الطلب وإغلاقه`
      };

      const updatedHistory = [...(order.history || []), historyEntry];

      const { error } = await supabase
        .from('orders')
        .update({
          status,
          history: updatedHistory
        })
        .eq('id', id);

      if (error) throw error;

      // Track Order Delivered
      analytics.track(AnalyticsEvent.ORDER_DELIVERED, {
        order_id: id,
        customer_id: order.customerId,
        total_amount: order.totalAmount
      });

      setIsConfirmDeliveryOpen(false);
      setPendingStatusUpdate(null);
      router.refresh();
      toastSuccess('تم تسليم الطلب بنجاح');
    } catch (error) {
      handleFirestoreError(error as any, OperationType.UPDATE, 'orders');
    }
  };

  const handleDelete = async (id: string, orderNumber: string) => {
    const allowed = await checkPermission('orders.delete', 'إدارة الطلبات');
    if (!allowed) return;

    if (window.confirm('هل أنت متأكد من حذف هذا الطلب والفاتورة الخاصة به؟')) {
      try {
        const { error } = await supabase
          .from('orders')
          .delete()
          .eq('id', id);
        
        if (error) throw error;
        
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
        toastSuccess('تم حذف الطلب بنجاح');
      } catch (error) {
        handleFirestoreError(error as any, OperationType.DELETE, 'orders');
      }
    }
  };

  const filteredOrders = orders.filter(o => {
    const matchesSearch = (o.customerName || '').toLowerCase().includes(search.toLowerCase()) || 
                         o.id.includes(search);
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
    const brandingText = `\n\nPowered By ${branding.companyName}${branding.websiteUrl ? `\n${branding.websiteUrl}` : ''}`;
    const message = `مرحباً ${order.customerName}، تم استلام طلبك رقم #${(order.orderNumber?.toString() || order.id).slice(-6).toUpperCase()}. الإجمالي: ${order.totalAmount} ر.س. المتبقي: ${order.remainingAmount} ر.س.${brandingText}`;
    const whatsappUrl = `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank');
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
          updatedBy: currentStaff?.name || 'المالك',
          updatedByUid: currentStaff?.id || auth.currentUser?.uid,
          notes: `تسديد مبلغ: ${payAmount} ر.س عبر ${PAYMENT_METHODS.find(m => m.id === payMethod)?.label}`
        };

        const updatedHistory = [...(order.history || []), historyEntry];

        await supabase
          .from('orders')
          .update({
            paid_amount: newPaidAmount,
            history: updatedHistory
          })
          .eq('id', order.id);

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
          className="bg-surface w-full lg:max-w-md h-[95vh] lg:h-full shadow-2xl relative z-10 flex flex-col text-right lg:rounded-none rounded-t-[3rem] overflow-hidden"
          dir="rtl"
        >
          <div className="p-6 border-b border-border flex justify-between items-center bg-brand/5">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-brand text-white rounded-2xl">
                <Info size={24} />
              </div>
              <div>
                <h2 className="text-xl font-black text-content">تفاصيل الطلب</h2>
                <p className="text-xs text-content-muted font-bold">#{order.id.slice(-6).toUpperCase()}</p>
              </div>
            </div>
            <button onClick={() => setIsDetailsOpen(false)} className="p-2 hover:bg-surface rounded-full transition-colors shadow-sm">
              <X size={24} className="text-content-muted" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-8">
            <OrderStepper currentStatus={order.status} />

            {/* Payment Status Card */}
            <section className={cn(
              "p-6 rounded-3xl border-2 transition-all",
              order.remainingAmount > 0 ? "bg-danger/5 border-danger/10" : "bg-success/5 border-success/10"
            )}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-black text-content">حالة الدفع</h3>
                {order.remainingAmount > 0 ? (
                  <span className="bg-danger text-white text-[10px] px-2 py-1 rounded-full font-bold">متبقي رصيد</span>
                ) : (
                  <span className="bg-success text-white text-[10px] px-2 py-1 rounded-full font-bold">مدفوع بالكامل</span>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-content-muted">الإجمالي:</span>
                  <span className="font-bold text-content"><PriceDisplay amount={order.totalAmount} /></span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-content-muted">المدفوع:</span>
                  <span className="font-bold text-success"><PriceDisplay amount={order.paidAmount} /></span>
                </div>
                <div className="flex justify-between text-lg pt-2 border-t border-border/50">
                  <span className="font-bold text-content">المتبقي:</span>
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
                  تسديد المتبقي
                </button>
              )}

              {isPaying && (
                <div className="mt-4 p-4 bg-surface rounded-2xl border border-red-500/20 space-y-4 animate-in fade-in slide-in-from-top-2">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-content-muted uppercase">المبلغ المراد تسديده</label>
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
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={handleQuickPayment}
                      disabled={isProcessing || payAmount <= 0}
                      className="flex-1 bg-brand text-white py-3 rounded-xl font-bold text-sm hover:bg-brand/90 disabled:opacity-50"
                    >
                      {isProcessing ? 'جاري...' : 'تأكيد الدفع'}
                    </button>
                    <button 
                      onClick={() => setIsPaying(false)}
                      className="px-4 py-3 text-content-muted font-bold text-sm hover:bg-surface-muted rounded-xl"
                    >
                      إلغاء
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* Status Timeline */}
            <section className="space-y-4">
              <h3 className="text-xs font-black text-content-muted uppercase tracking-widest flex items-center gap-2">
                <History size={14} />
                سجل الحالة
              </h3>
              <div className="space-y-4 relative before:absolute before:right-4 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
                {order.history?.slice().reverse().map((h, idx) => {
                  const updater = staff.find(s => s.id === h.updatedByUid);
                  const isOwner = tenant && (tenant.id === h.updatedByUid || tenant.ownerEmail === h.updatedBy);
                  
                  let updaterName = h.updatedBy;
                  let updaterRole = '';

                  if (updater) {
                    updaterName = updater.name;
                    updaterRole = updater.role === 'tailor' ? 'خياط' : 'موظف';
                  } else if (isOwner) {
                    updaterName = tenant.name;
                    updaterRole = 'المالك';
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
                              {STATUS_CONFIG[h.status].label}
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
                            <span className="text-[9px] text-content-muted font-medium flex items-center gap-1">
                              <Calendar size={10} />
                              {new Date(h.updatedAt).toLocaleDateString('ar-SA')}
                            </span>
                            <span className="text-[9px] text-content-muted font-medium flex items-center gap-1 mt-0.5">
                              <Clock size={10} />
                              {new Date(h.updatedAt).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}
                            </span>
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
            {customers.find(c => c.id === order.customerId)?.measurements?.thobeMeasurements && (
              <section className="space-y-4">
                <h3 className="text-xs font-black text-content-muted uppercase tracking-widest flex items-center gap-2">
                  <Ruler size={14} />
                  مقاسات العميل (الثوب)
                </h3>
                <div className="bg-brand/5 p-6 rounded-3xl border border-brand/10">
                  <div className="grid grid-cols-3 gap-4">
                    {[
                      { label: 'الرقبة', value: customers.find(c => c.id === order.customerId)?.measurements?.thobeMeasurements?.collar },
                      { label: 'الصدر', value: customers.find(c => c.id === order.customerId)?.measurements?.thobeMeasurements?.chest },
                      { label: 'الأكتاف', value: customers.find(c => c.id === order.customerId)?.measurements?.thobeMeasurements?.shoulders },
                      { label: 'الأكمام', value: customers.find(c => c.id === order.customerId)?.measurements?.thobeMeasurements?.sleeves },
                      { label: 'الطول', value: customers.find(c => c.id === order.customerId)?.measurements?.thobeMeasurements?.length },
                      { label: 'الوسع', value: customers.find(c => c.id === order.customerId)?.measurements?.thobeMeasurements?.bottomWidth },
                    ].map((m, i) => (
                      <div key={i} className="text-center">
                        <span className="block text-[10px] text-content-muted font-bold mb-1">{m.label}</span>
                        <span className="text-lg font-black text-brand">{m.value || 0}</span>
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
                الأصناف
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
                        <span>القماش: <span className="text-content">{item.fabric || 'غير محدد'}</span></span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-brand/30" />
                        <span>الإضافات: <span className="text-content">{item.additions || 'لا يوجد'}</span></span>
                      </div>
                      <div className="flex items-center gap-2 text-brand">
                        <Zap size={12} />
                        <span>التطريز: <span className="font-black">{item.embroidery || 'لا يوجد'}</span></span>
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
              <span>طباعة</span>
            </button>
            <button 
              onClick={() => sendToWhatsApp(order)}
              className="flex items-center justify-center gap-2 bg-success text-white py-4 rounded-2xl font-bold hover:bg-success/90 transition-all shadow-lg shadow-success/10 text-sm"
            >
              <MessageSquare size={18} />
              <span>واتساب</span>
            </button>
          </div>
        </motion.div>
      </div>
    );
  };

  const ConfirmDeliveryModal = () => (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsConfirmDeliveryOpen(false)} />
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-surface w-full max-w-sm rounded-[2rem] shadow-2xl relative z-10 p-8 text-center" dir="rtl">
        <div className="w-20 h-20 bg-success/10 text-success rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 size={40} />
        </div>
        <h3 className="text-xl font-black text-content mb-2">تأكيد تسليم الطلب</h3>
        <p className="text-content-muted text-sm mb-8 font-medium">هل تم تسليم الطلب للعميل بنجاح؟ سيتم إغلاق الطلب نهائياً ولا يمكن تعديله لاحقاً.</p>
        <div className="flex flex-col gap-3">
          <button 
            onClick={confirmDelivery}
            className="w-full bg-success text-white py-4 rounded-2xl font-bold hover:bg-success/90 shadow-lg shadow-success/10 transition-all"
          >
            تأكيد التسليم
          </button>
          <button 
            onClick={() => setIsConfirmDeliveryOpen(false)}
            className="w-full py-4 text-content-muted font-bold hover:bg-surface-muted rounded-2xl transition-all"
          >
            إلغاء
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
          updatedBy: currentStaff?.name || 'المالك',
          updatedByUid: currentStaff?.id || auth.currentUser?.uid,
          notes: `تم سداد مبلغ ${amount} ر.س بواسطة ${PAYMENT_METHODS.find(m => m.id === method)?.label}. المتبقي: ${newRemainingAmount} ر.س`
        };

        const updatedHistory = [...(order.history || []), historyEntry];

        await supabase
          .from('orders')
          .update({
            paid_amount: newPaidAmount,
            payment_method: method,
            history: updatedHistory
          })
          .eq('id', order.id);

        if (newRemainingAmount === 0 && pendingStatusUpdate) {
          const finalHistoryEntry: OrderHistory = {
            status: pendingStatusUpdate.status,
            updatedAt: new Date().toISOString(),
            updatedBy: currentStaff?.name || 'المالك',
            updatedByUid: currentStaff?.id || auth.currentUser?.uid,
            notes: 'تم سداد المتبقي وتسليم الطلب'
          };

          const finalHistory = [...(order.history || []), historyEntry, finalHistoryEntry];

          await supabase
            .from('orders')
            .update({ 
              status: pendingStatusUpdate.status,
              history: finalHistory
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
          className="bg-surface w-full lg:max-w-md rounded-3xl shadow-2xl relative z-10 overflow-y-auto max-h-[90vh] text-right border border-border" 
          dir="rtl"
        >
          <div className="p-6 border-b border-border flex justify-between items-center bg-success/5">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-success text-white rounded-2xl">
                <CreditCard size={24} />
              </div>
              <h3 className="text-xl font-black text-content">استكمال الدفع</h3>
            </div>
            <button onClick={() => setIsPaymentModalOpen(false)} className="p-2 hover:bg-surface rounded-full transition-colors shadow-sm">
              <X size={24} className="text-content-muted" />
            </button>
          </div>
          
          <div className="p-8 space-y-6">
            <div className="bg-surface-muted p-6 rounded-3xl border border-border text-center">
              <p className="text-xs font-bold text-content-muted uppercase tracking-widest mb-1">المبلغ المتبقي</p>
              <p className="text-3xl font-black text-danger"><PriceDisplay amount={order.remainingAmount} /></p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-content-muted uppercase tracking-widest">المبلغ المدفوع الآن</label>
              <input 
                type="number" 
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                max={order.remainingAmount}
                className="w-full bg-surface-muted border-2 border-transparent focus:border-success rounded-2xl p-4 font-black text-success outline-none transition-all"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-content-muted uppercase tracking-widest">طريقة الدفع</label>
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
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <button 
              onClick={handlePayment}
              disabled={isProcessing || amount <= 0}
              className="w-full bg-success text-white py-4 rounded-2xl font-black hover:bg-success/90 shadow-xl shadow-success/10 transition-all disabled:opacity-50"
            >
              {isProcessing ? 'جاري المعالجة...' : 'تأكيد الدفع والاستلام'}
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
        className="bg-surface w-full lg:max-w-lg rounded-t-[2.5rem] lg:rounded-[2.5rem] shadow-2xl relative z-10 overflow-hidden"
      >
        <div className="p-8 space-y-6 text-right" dir="rtl">
          <div className="flex justify-between items-start">
            <div className="bg-brand text-white p-4 rounded-3xl">
              <ShoppingBag size={32} />
            </div>
            <button onClick={() => setIsInvoiceOpen(false)} className="p-2 hover:bg-surface-muted rounded-full transition-colors">
              <X size={24} className="text-content-muted" />
            </button>
          </div>

          <div className="text-center space-y-1">
            <h2 className="text-2xl font-black text-content">فاتورة طلب</h2>
            <p className="text-content-muted font-medium">رقم الطلب: #{order.orderNumber || order.id.slice(-6).toUpperCase()}</p>
          </div>

          <div className="bg-surface-muted p-6 rounded-[2rem] space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-surface rounded-xl shadow-sm">
                  <User size={18} className="text-brand" />
                </div>
                <div>
                  <p className="text-[10px] text-content-muted font-bold uppercase tracking-wider">العميل</p>
                  <p className="font-bold text-content">{order.customerName}</p>
                </div>
              </div>
              <div className="text-left">
                <p className="text-[10px] text-content-muted font-bold uppercase tracking-wider">التاريخ</p>
                <p className="font-bold text-content">{new Date(order.orderDate).toLocaleDateString('ar-SA')}</p>
              </div>
            </div>

            <div className="border-t border-dashed border-border pt-4 space-y-3">
              {order.items?.map((item: any, idx: number) => (
                <div key={item.garmentType + item.fabric + idx} className="flex justify-between text-sm">
                  <span className="text-content-muted">{item.garmentType} ({item.fabric})</span>
                  <span className="font-bold text-content"><PriceDisplay amount={item.price * item.quantity} /></span>
                </div>
              ))}
            </div>

            <div className="border-t border-border pt-4 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-content-muted font-medium">الإجمالي</span>
                <span className="text-xl font-black text-brand"><PriceDisplay amount={order.totalAmount} /></span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-content-muted">المدفوع ({PAYMENT_METHODS.find(m => m.id === order.paymentMethod)?.label || order.paymentMethod})</span>
                <span className="font-bold text-success"><PriceDisplay amount={order.paidAmount} /></span>
              </div>
              <div className="flex justify-between items-center text-sm pt-2 border-t border-border">
                <span className="text-content-muted">المتبقي</span>
                <span className="font-black text-danger"><PriceDisplay amount={order.remainingAmount} /></span>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-center gap-4">
            <div className="p-4 bg-surface border-2 border-border rounded-3xl shadow-inner">
              <QRCodeSVG value={order.qrCode || order.id} size={120} />
            </div>
            <p className="text-[10px] text-content-muted font-bold text-center px-8 uppercase tracking-widest">
              امسح الكود لمتابعة حالة الطلب عبر تطبيق العملاء
            </p>

            <Branding className="opacity-40 py-0" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button className="flex items-center justify-center gap-2 bg-brand text-white py-4 rounded-2xl font-bold hover:bg-brand/90 transition-all shadow-lg shadow-brand/10">
              <Printer size={20} />
              <span>طباعة</span>
            </button>
            <button 
              onClick={() => sendToWhatsApp(order)}
              className="flex items-center justify-center gap-2 bg-success text-white py-4 rounded-2xl font-bold hover:bg-success/90 transition-all shadow-lg shadow-success/10"
            >
              <MessageSquare size={20} />
              <span>واتساب</span>
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );

  return (
    <div className="space-y-6 text-right" dir="rtl">
      <Header 
        tenantId={tenantId} 
        title="الطلبات" 
        subtitle="إدارة طلبات الخياطة والمواعيد"
      >
        <div className="flex items-center gap-3">
          <button 
            onClick={() => {
              const exportData = filteredOrders.map(o => ({
                'رقم الطلب': o.orderNumber || o.id.slice(-6).toUpperCase(),
                'العميل': o.customerName,
                'التاريخ': new Date(o.orderDate).toLocaleDateString('ar-SA'),
                'الإجمالي': o.totalAmount,
                'المدفوع': o.paidAmount,
                'المتبقي': o.remainingAmount,
                'الحالة': STATUS_CONFIG[o.status].label,
                'طريقة الدفع': PAYMENT_METHODS.find(m => m.id === o.paymentMethod)?.label || o.paymentMethod
              }));
              const worksheet = XLSX.utils.json_to_sheet(exportData);
              const workbook = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(workbook, worksheet, "Orders");
              XLSX.writeFile(workbook, `الطلبات_${new Date().toLocaleDateString('ar-SA')}.xlsx`);
            }}
            className="bg-success/5 text-success px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-success/10 transition-all border border-success/10"
          >
            <FileSpreadsheet size={20} />
            <span>تصدير Excel</span>
          </button>
          <div className="flex bg-surface p-1 rounded-2xl border border-border shadow-sm">
            <button
              onClick={() => setActiveTab('active')}
              className={cn(
                "px-6 py-2 rounded-xl font-bold text-sm transition-all",
                activeTab === 'active' ? "bg-brand text-white shadow-lg shadow-brand/10" : "text-content-muted hover:bg-surface-muted"
              )}
            >
              الطلبات النشطة
            </button>
            <button
              onClick={() => setActiveTab('completed')}
              className={cn(
                "px-6 py-2 rounded-xl font-bold text-sm transition-all",
                activeTab === 'completed' ? "bg-brand text-white shadow-lg shadow-brand/10" : "text-content-muted hover:bg-surface-muted"
              )}
            >
              الطلبات المكتملة
            </button>
          </div>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="bg-brand text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-brand/90 transition-all shadow-lg shadow-brand/10"
          >
            <Plus size={20} />
            <span>إنشاء طلب جديد</span>
          </button>
        </div>
      </Header>

      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1 bg-surface p-4 rounded-3xl border border-border shadow-sm flex items-center gap-3">
          <Search size={20} className="text-content-muted" />
          <input 
            type="text" 
            placeholder="ابحث برقم الطلب أو اسم العميل..." 
            className="flex-1 bg-transparent border-none focus:ring-0 text-content"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 bg-surface p-4 rounded-3xl border border-border shadow-sm">
          <div className="flex items-center gap-2 min-w-[180px]">
            <Select
              value={statusFilter}
              onChange={(val) => setStatusFilter(val as OrderStatus | '')}
              options={[
                { value: '', label: 'كل الحالات' },
                ...(Object.keys(STATUS_CONFIG) as OrderStatus[]).map((status) => ({
                  value: status,
                  label: STATUS_CONFIG[status].label
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
              <span className="text-content-muted text-xs">إلى</span>
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
              title="مسح الفلاتر"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {filteredOrders.map((order, index) => (
          <motion.div
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            whileHover={{ y: -2 }}
            key={order.id}
            className={cn(
              "p-6 rounded-[2.5rem] border transition-all duration-300 flex flex-col md:flex-row md:items-center justify-between gap-6 group relative overflow-hidden",
              selectedOrder?.id === order.id 
                ? "bg-brand/5 border-brand ring-4 ring-brand/5 shadow-2xl shadow-brand/10" 
                : "bg-surface border-border shadow-sm hover:shadow-xl hover:border-brand/20"
            )}
          >
            {/* Selection indicator */}
            {selectedOrder?.id === order.id && (
              <motion.div 
                layoutId="selected-indicator"
                className="absolute right-0 top-0 bottom-0 w-2 bg-brand"
              />
            )}

            <div className="flex items-center gap-5">
              <div className={cn(
                "w-16 h-16 rounded-[1.5rem] flex items-center justify-center transition-all duration-500 group-hover:scale-110 group-hover:rotate-3",
                STATUS_CONFIG[order.status].bgColor,
                STATUS_CONFIG[order.status].color
              )}>
                {React.createElement(STATUS_CONFIG[order.status].icon, { size: 32 })}
              </div>
              <div className="cursor-pointer" onClick={() => { setSelectedOrder(order); setIsDetailsOpen(true); }}>
                <div className="flex items-center gap-3">
                  <h3 className="text-xl font-black text-content">
                    {order.customerName}
                  </h3>
                  <span className="text-[10px] bg-surface-muted text-content-muted px-3 py-1 rounded-full font-black uppercase tracking-widest border border-border">
                    #{order.orderNumber || order.id.slice(-6).toUpperCase()}
                  </span>
                  {order.isTest && (
                    <span className="text-[10px] bg-danger/10 text-danger px-2 py-0.5 rounded-full font-black uppercase tracking-widest flex items-center gap-1">
                      <Zap size={10} />
                      بيانات تجريبية
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-6 mt-2 text-sm text-content-muted">
                  <span className="flex items-center gap-1.5 font-bold">
                    <Calendar size={16} className="text-brand" />
                    {new Date(order.orderDate).toLocaleDateString('ar-SA')}
                  </span>
                  <div className="w-1 h-1 bg-border rounded-full" />
                  <span className="font-black text-brand text-lg">
                    <PriceDisplay amount={order.totalAmount} />
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 bg-surface-muted/50 p-1 rounded-2xl border border-border">
                <button 
                  onClick={() => {
                    setSelectedOrder(order);
                    setIsInvoiceOpen(true);
                  }}
                  className="px-3 py-2 text-brand hover:bg-brand hover:text-white rounded-xl transition-all flex items-center gap-2 font-black text-xs"
                  title="استعراض الفاتورة"
                >
                  <Eye size={16} />
                  <span>الفاتورة</span>
                </button>

                <button 
                  onClick={() => {
                    setSelectedOrder(order);
                  }}
                  className="p-2 text-content-muted hover:text-brand hover:bg-brand/10 rounded-xl transition-all"
                  title="طباعة سريعة"
                >
                  <Printer size={18} />
                </button>

                <button 
                  onClick={() => { setSelectedOrder(order); setIsDetailsOpen(true); }}
                  className="p-2 text-content-muted hover:text-brand hover:bg-brand/10 rounded-xl transition-all"
                  title="التفاصيل"
                >
                  <Info size={18} />
                </button>
              </div>

              <div className="relative group/status">
                <motion.button 
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  disabled={order.status === 'delivered'}
                  className={cn(
                    "px-4 py-2.5 rounded-2xl text-xs font-black flex items-center gap-3 transition-all shadow-sm",
                    STATUS_CONFIG[order.status].bgColor,
                    STATUS_CONFIG[order.status].color,
                    order.status === 'delivered' ? "cursor-not-allowed opacity-80" : "hover:shadow-lg hover:shadow-brand/5 border border-brand/10"
                  )}
                >
                  <div className={cn("w-2 h-2 rounded-full animate-pulse", STATUS_CONFIG[order.status].color.replace('text', 'bg'))} />
                  <span>{STATUS_CONFIG[order.status].label}</span>
                  {order.status !== 'delivered' && <ChevronDown size={14} className="opacity-50" />}
                </motion.button>
                
                {order.status !== 'delivered' && (
                  <div className="absolute left-0 lg:right-0 top-full mt-2 w-56 bg-surface rounded-[2rem] shadow-2xl border border-border/50 py-3 z-30 hidden group-hover/status:block animate-in fade-in zoom-in duration-200 backdrop-blur-xl">
                    <div className="px-4 py-2 mb-2 border-b border-border/50">
                      <span className="text-[10px] font-black text-content-muted uppercase tracking-widest">تحديث الحالة</span>
                    </div>
                    {(Object.keys(STATUS_CONFIG) as OrderStatus[]).map((status) => {
                      const cfg = STATUS_CONFIG[status];
                      return (
                        <button
                          key={status}
                          onClick={() => updateStatus(order.id, status)}
                          className={cn(
                            "w-full text-right px-4 py-2.5 text-xs font-black hover:bg-brand/5 transition-all flex items-center justify-between group/item",
                            order.status === status ? cfg.color : "text-content-muted hover:text-brand"
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <cfg.icon size={14} className={cn("transition-transform group-hover/item:scale-110", order.status === status ? cfg.color : "text-content-muted/50")} />
                            {cfg.label}
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
                title="حذف الطلب"
              >
                <Trash2 size={18} />
              </button>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Modals */}
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

      {/* Create Order Modal Refactored to Bottom Sheet */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {isModalOpen && (
            <div className="fixed inset-0 z-[100] flex items-end lg:items-center justify-center lg:p-4 overflow-hidden">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsModalOpen(false)}
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              />
              <motion.div 
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="relative w-full lg:max-w-4xl rounded-t-[2.5rem] lg:rounded-[2.5rem] shadow-2xl z-10 overflow-hidden h-[95vh] lg:h-auto lg:max-h-[90vh] flex flex-col text-right border border-border bg-surface"
              dir="rtl"
            >
              {/* Header (Fixed) */}
              <div className="sticky top-0 z-10 flex items-center justify-between p-4 sm:p-6 border-b border-[var(--border)] bg-[var(--surface)] shrink-0 bg-brand/5">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-brand text-white rounded-2xl shrink-0 shadow-sm">
                    <Plus size={20} />
                  </div>
                  <h3 className="text-base sm:text-lg lg:text-xl font-black text-content">إنشاء طلب جديد</h3>
                </div>
                <button type="button" onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-surface-muted rounded-full transition-colors shadow-sm text-content-muted">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSubmit(onSubmit)} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
                <OrderStepper currentStatus="measurements_taken" />
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Customer Selection & Info */}
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-sm font-black text-content-muted uppercase tracking-widest">العميل</label>
                        <button 
                          type="button" 
                          onClick={() => setIsQuickAddOpen(true)}
                          className="text-brand text-xs font-bold flex items-center gap-1 hover:underline"
                        >
                          <UserPlus size={14} />
                          إضافة عميل جديد
                        </button>
                      </div>
              <Controller 
                name="customerId"
                control={control}
                render={({ field }) => (
                  <SmartSelect 
                    value={field.value}
                    onChange={field.onChange}
                    options={[
                      { value: '', label: 'اختر عميل...' },
                      ...customers.map(c => ({ value: c.id, label: c.name }))
                    ]}
                    error={!!errors.customerId}
                    className="bg-surface-muted border-none"
                  />
                )}
              />
              {errors.customerId && <p className="text-xs text-danger font-bold mt-1">{errors.customerId.message}</p>}
            </div>

                    {selectedCustomer && (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-brand/5 p-6 rounded-3xl border border-brand/10 space-y-4"
                      >
                        <div className="flex items-center gap-2 text-brand mb-2">
                          <Ruler size={18} />
                          <h4 className="font-black text-sm uppercase tracking-wider">مقاسات العميل (آلي)</h4>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          {[
                            { label: 'الطول', value: selectedCustomer.measurements?.length },
                            { label: 'الكتف', value: selectedCustomer.measurements?.shoulder },
                            { label: 'الصدر', value: selectedCustomer.measurements?.chest },
                            { label: 'الخصر', value: selectedCustomer.measurements?.waist },
                            { label: 'الأرداف', value: selectedCustomer.measurements?.hips },
                            { label: 'الكم', value: selectedCustomer.measurements?.sleeve },
                            { label: 'الرقبة', value: selectedCustomer.measurements?.neck },
                          ].map((m) => (
                            <div key={m.label} className="bg-surface p-2 rounded-xl border border-brand/10 text-center">
                              <p className="text-[10px] text-content-muted font-bold">{m.label}</p>
                              <p className="text-sm font-black text-brand">{m.value || '-'}</p>
                            </div>
                          ))}
                        </div>
                        
                        {/* Visual Details Display */}
                        <div className="pt-4 border-t border-brand/10 grid grid-cols-2 gap-2">
                          {[
                            { label: 'الياقة', value: selectedCustomer.measurements?.collarType },
                            { label: 'الكبك', value: selectedCustomer.measurements?.cuffType },
                            { label: 'الجيب', value: selectedCustomer.measurements?.pocketType },
                            { label: 'الصدر', value: selectedCustomer.measurements?.chestStyle },
                          ].filter(v => v.value).map((v) => (
                            <div key={v.label} className="flex items-center gap-2 bg-surface/50 p-2 rounded-lg border border-brand/5">
                              <Zap size={12} className="text-brand/40" />
                              <span className="text-[10px] font-bold text-content-muted">{v.label}: {v.value}</span>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </div>

                  {/* Delivery Info */}
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-sm font-black text-content-muted uppercase tracking-widest">تاريخ التسليم المتوقع</label>
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
                      {errors.deliveryDate && <p className="text-xs text-danger font-bold mt-1">{errors.deliveryDate.message}</p>}
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-black text-content-muted uppercase tracking-widest">ملاحظات عامة</label>
                      <textarea 
                        {...register('notes')} 
                        placeholder="أي تعليمات إضافية..."
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
                      الأصناف المطلوبة
                    </h4>
                    <button 
                      type="button" 
                      onClick={() => append({ garmentType: 'ثوب', quantity: 1, price: 0, fabric: '' })}
                      className="bg-brand/5 text-brand px-4 py-2 rounded-xl text-xs font-black hover:bg-brand/10 transition-all flex items-center gap-2"
                    >
                      <Plus size={14} /> إضافة صنف
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
                            <label className="text-[10px] text-content-muted font-bold uppercase tracking-wider">نوع القطعة</label>
                            <input 
                              {...register(`items.${index}.garmentType` as any)} 
                              className={cn(
                                "w-full bg-surface border-none rounded-xl p-3 text-sm font-bold shadow-sm text-content",
                                (errors.items as any)?.[index]?.garmentType && "ring-2 ring-danger"
                              )} 
                              placeholder="مثلاً: ثوب، قميص..."
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-content-muted font-bold uppercase tracking-wider">القماش</label>
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
                                    { value: '', label: 'اختر قماش...' },
                                    ...inventory.map(item => ({ value: item.name, label: `${item.name} (${item.quantity} ${item.unit})` })),
                                    { value: 'custom', label: 'قماش خارجي' }
                                  ]}
                                />
                              )}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-content-muted font-bold uppercase tracking-wider">الكمية والوحدة</label>
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
                              <Controller
                                name={`items.${index}.selectedUnit` as any}
                                control={control}
                                render={({ field }) => (
                                  <SmartSelect
                                    {...field}
                                    className="w-1/3 bg-surface rounded-xl text-[10px] font-bold shadow-sm"
                                    options={[
                                      { value: 'meter', label: 'متر' },
                                      { value: 'yard', label: 'ياردة' },
                                      { value: 'roll', label: 'رول' },
                                      { value: 'bolt', label: 'طاقة' }
                                    ]}
                                  />
                                )}
                              />
                            </div>
                            {watch(`items.${index}.consumedMeters` as any) > 0 && (
                              <p className="text-[10px] text-brand font-bold mt-1">
                                يعادل: {watch(`items.${index}.consumedMeters` as any).toFixed(2)} متر مستهلك
                              </p>
                            )}
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-content-muted font-bold uppercase tracking-wider">السعر</label>
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
                                <label className="text-[10px] text-content-muted font-bold uppercase tracking-wider">نوع الحشو (الياقة)</label>
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
                                    <span className="text-[10px] font-bold">قاسي</span>
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
                                    <span className="text-[10px] font-bold">لين</span>
                                  </button>
                                </div>
                              </div>

                              <div className="space-y-2">
                                <label className="text-[10px] text-content-muted font-bold uppercase tracking-wider">إضافات أخرى</label>
                                <input 
                                  {...register(`items.${index}.additions` as any)}
                                  placeholder="مثلاً: جيب إضافي..."
                                  className="w-full bg-surface border-none rounded-xl p-3 text-xs font-bold shadow-sm text-content"
                                />
                              </div>

                              <div className="space-y-2">
                                <label className="text-[10px] text-content-muted font-bold uppercase tracking-wider">التطريز</label>
                                <input 
                                  {...register(`items.${index}.embroidery` as any)}
                                  placeholder="نوع التطريز..."
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
                      <div className="relative z-10">
                        <div className="flex justify-between items-center">
                          <span className="text-brand-content/80 font-bold text-sm uppercase tracking-widest">الإجمالي الكلي</span>
                          <span className="text-3xl font-black text-white"><PriceDisplay amount={totalAmount} /></span>
                        </div>
                        
                        <div className="space-y-3 mt-6">
                          <label className="text-xs font-bold text-brand-content/60 uppercase tracking-widest">طريقة الدفع</label>
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
                                {method.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-3 pt-6 border-t border-white/10 mt-6">
                          <label className="text-xs font-bold text-brand-content/60 uppercase tracking-widest">المبلغ المدفوع</label>
                          <div className="relative">
                            <CreditCard className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40" size={20} />
                            <input 
                              type="number" 
                              {...register('paidAmount')} 
                              className="w-full bg-surface/10 border-2 border-surface/10 rounded-2xl p-4 pr-12 font-black text-surface placeholder:text-surface/30 focus:ring-2 focus:ring-surface outline-none" 
                            />
                          </div>
                          <div className="flex justify-between text-xs font-bold pt-2">
                            <span className="text-brand-content/80">المتبقي:</span>
                            <span className="text-white bg-danger px-2 py-0.5 rounded-lg"><PriceDisplay amount={Number(totalAmount) - Number(watch('paidAmount') || 0)} /></span>
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
                        بيانات تجريبية (Test Data)
                      </label>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h4 className="text-sm font-black text-content-muted uppercase tracking-widest flex items-center gap-2">
                      <ImageIcon size={16} />
                      صور توضيحية / تصاميم
                    </h4>
                    <div className="space-y-3">
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          id="imageUrlInput"
                          placeholder="رابط الصورة (URL)..."
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
                          إضافة
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
                    بيانات تجريبية (Test Data)
                  </label>
                </div>

                {/* Footer (Fixed) */}
                <div className="sticky bottom-0 z-10 shrink-0 p-4 sm:p-6 border-t border-[var(--border)] bg-[var(--surface)] flex flex-wrap items-center justify-between gap-4">
                  <div>
                    {Object.keys(errors).length > 0 && (
                      <p className="text-xs text-danger font-bold flex items-center gap-1">
                        <AlertCircle size={14} />
                        يرجى إكمال جميع الحقول المطلوبة بشكل صحيح
                      </p>
                    )}
                  </div>
                  <div className="flex gap-3">
                    <button 
                      type="button" 
                      onClick={() => setIsModalOpen(false)} 
                      className="px-6 py-2.5 sm:px-8 sm:py-3.5 text-content-muted font-bold hover:text-content transition-colors text-sm sm:text-base"
                    >
                      إلغاء
                    </button>
                    <button 
                      type="submit" 
                      disabled={isSubmitting}
                      className="bg-brand text-white px-8 py-2.5 sm:px-12 sm:py-3.5 rounded-xl font-bold hover:bg-brand/90 shadow-lg shadow-brand/20 transition-all hover:scale-102 active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base"
                    >
                      {isSubmitting ? 'جاري الحفظ...' : 'تأكيد وإنشاء الطلب'}
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
