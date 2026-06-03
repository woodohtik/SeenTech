import React, { useState, useEffect, useCallback } from 'react';
import { 
  Search, 
  Plus, 
  ShoppingCart, 
  Trash2, 
  CreditCard, 
  User, 
  Scissors,
  Package,
  Barcode,
  X,
  CheckCircle2,
  Ruler,
  Zap,
  Image as ImageIcon,
  Camera,
  UserPlus,
  Banknote,
  Landmark,
  Wallet,
  Coins,
  TrendingUp,
  TrendingDown,
  LayoutGrid,
  List
} from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { auth, handleError, OperationType, getFriendlyErrorMessage } from '../lib/firebase';
import { Combobox, Transition, Dialog } from '@headlessui/react';
import { Customer, InventoryItem, OrderItem, Order, PaymentMethod, OrderStatus } from '../types';
import { cn, generateOrderNumber } from '../lib/utils';
import { SmartSelect } from './ui/SmartSelect';
import { motion, AnimatePresence } from 'motion/react';
import { PriceDisplay } from './PriceDisplay';
import { decodeInventoryDescription, calculateItemTax } from '../utils/b2bHelper';
import { QRCodeSVG } from 'qrcode.react';
import { useStaff } from '../contexts/StaffContext';
import { useToast } from '../contexts/ToastContext';
import { logEmployeeAction } from '../services/employeeAuditService';
import { generateZatcaQR } from '../lib/zatca';
import VisualMeasurements from './VisualMeasurements';
import ThobeMeasurementSelector from './ThobeMeasurementSelector';
import Branding from './Branding';
import { downloadInvoicePDF, shareInvoiceAsPDFFile } from '../utils/pdfGenerator';
import { useBranding } from '../contexts/BrandingContext';
import { useRealtimeSync } from '../hooks/useRealtimeSync';
import { useRouter, useRefreshCounter } from '../hooks/useRouter';
import { encodeOrderB2BNotes, encodeInvoiceExtendedNotes } from '../utils/b2bHelper';
import { useTranslation } from 'react-i18next';

export default function POS({ tenantId, shiftId }: { tenantId: string, shiftId?: string }) {
  const router = useRouter();
  const refreshCounter = useRefreshCounter();
  const { error: toastError, success: toastSuccess, handleError } = useToast();
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar' || i18n.language === 'ur';
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [cart, setCart] = useState<OrderItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [isCustomOrderModalOpen, setIsCustomOrderModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [isB2B, setIsB2B] = useState(false);
  const [b2bData, setB2bData] = useState({ companyName: '', trn: '' });
  const [isB2bModalOpen, setIsB2bModalOpen] = useState(false);
  const [completedOrder, setCompletedOrder] = useState<any>(null);
  const [showCartOnMobile, setShowCartOnMobile] = useState(false);
  const { currentStaff } = useStaff();

  const [taxSettings, setTaxSettings] = useState<any>(null);

  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>('fixed');
  const { settings: brandingSettings } = useBranding();
  const [discountValue, setDiscountValue] = useState<number>(0);

  // Customer Combobox State
  const [customerQuery, setCustomerQuery] = useState('');
  
  // Quick Add Customer State
  const [isAddCustomerModalOpen, setIsAddCustomerModalOpen] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [newCustomerVat, setNewCustomerVat] = useState('');
  const [isSavingCustomer, setIsSavingCustomer] = useState(false);

  // Cash Drawer State
  const [cashDrawerBalance, setCashDrawerBalance] = useState<number>(0);
  const [showCashDrawerDetails, setShowCashDrawerDetails] = useState<boolean>(false);
  const [activeShiftData, setActiveShiftData] = useState<any | null>(null);
  const [cashDrawerBreakdown, setCashDrawerBreakdown] = useState({
    opening: 0,
    sales: 0,
    deposits: 0,
    withdrawals: 0,
    returns: 0,
    total: 0
  });

  const fetchCashDrawerBalance = useCallback(async () => {
    if (!shiftId) return;
    try {
      // 1. Fetch current shift
      const { data: shift, error: shiftErr } = await supabase
        .from('shifts')
        .select('*')
        .eq('id', shiftId)
        .maybeSingle();

      if (shiftErr) throw shiftErr;
      if (!shift) return;

      // Fetch shift entries
      const { data: entries, error: entriesErr } = await supabase
        .from('shift_entries')
        .select('*')
        .eq('shift_id', shiftId);

      if (!entriesErr && entries) {
        shift.deposits = entries
          .filter((e: any) => e.entry_type === 'deposit')
          .map((e: any) => ({ id: e.id, amount: Number(e.amount), reason: e.reason, time: e.occurred_at }));

        shift.payouts = entries
          .filter((e: any) => e.entry_type === 'payout')
          .map((e: any) => ({ id: e.id, amount: Number(e.amount), reason: e.reason, time: e.occurred_at }));
      }

      setActiveShiftData(shift);

      // 2. Fetch all orders for this shift
      const { data: orders, error: ordersErr } = await supabase
        .from('orders')
        .select('*')
        .eq('shift_id', shiftId);

      if (ordersErr) throw ordersErr;

      let cashSales = 0;
      let cashReturns = 0;

      (orders || []).forEach(order => {
        if (order.status === 'cancelled') {
          if (order.payment_method === 'cash') {
            cashReturns += (order.paid_amount || 0);
          }
        } else {
          if (order.payment_method === 'cash') {
            cashSales += (order.paid_amount || 0);
          }
        }
      });

      // Calculate totals
      const opening = Number(shift.opening_balance || 0);
      
      // Calculate deposits from shift.deposits
      let customDeposits = 0;
      if (Array.isArray(shift.deposits)) {
        customDeposits = shift.deposits.reduce((sum: number, d: any) => sum + Number(d.amount || 0), 0);
      } else if (typeof shift.deposits === 'string') {
        try {
          const parsed = JSON.parse(shift.deposits);
          if (Array.isArray(parsed)) {
            customDeposits = parsed.reduce((sum: number, d: any) => sum + Number(d.amount || 0), 0);
          }
        } catch (_) {}
      }

      // Calculate payouts/expenses from shift.payouts
      let customPayouts = 0;
      if (Array.isArray(shift.payouts)) {
        customPayouts = shift.payouts.reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
      } else if (typeof shift.payouts === 'string') {
        try {
          const parsed = JSON.parse(shift.payouts);
          if (Array.isArray(parsed)) {
            customPayouts = parsed.reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
          }
        } catch (_) {}
      }

      const totalInDrawer = opening + cashSales + customDeposits - cashReturns - customPayouts;

      setCashDrawerBalance(totalInDrawer);
      setCashDrawerBreakdown({
        opening,
        sales: cashSales,
        deposits: customDeposits,
        withdrawals: customPayouts,
        returns: cashReturns,
        total: totalInDrawer
      });
    } catch (err) {
      console.error('Error calculating cash drawer balance:', err);
    }
  }, [shiftId]);

  useEffect(() => {
    fetchCashDrawerBalance();
  }, [shiftId, fetchCashDrawerBalance, refreshCounter]);

  useEffect(() => {
    if (!shiftId) return;

    const ordersChannel = supabase
      .channel('pos-drawer-orders')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'orders',
        filter: `shift_id=eq.${shiftId}`
      }, () => {
        fetchCashDrawerBalance();
      })
      .subscribe();

    const shiftsChannel = supabase
      .channel('pos-drawer-shifts')
      .on('postgres_changes', { 
        event: 'UPDATE', 
        schema: 'public', 
        table: 'shifts',
        filter: `id=eq.${shiftId}`
      }, () => {
        fetchCashDrawerBalance();
      })
      .subscribe();

    const shiftEntriesChannel = supabase
      .channel('pos-drawer-entries')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'shift_entries',
        filter: `shift_id=eq.${shiftId}`
      }, () => {
        fetchCashDrawerBalance();
      })
      .subscribe();

    return () => {
      ordersChannel.unsubscribe();
      shiftsChannel.unsubscribe();
      shiftEntriesChannel.unsubscribe();
    };
  }, [shiftId, fetchCashDrawerBalance]);

  const mapCustomer = useCallback((d: any): Customer => ({
    ...d,
    tenantId: d.tenant_id,
    companyName: d.company_name,
    isB2B: d.is_b2b,
    loyaltyPoints: d.loyalty_points,
    createdAt: d.created_at,
    updatedAt: d.updated_at
  }), []);

  const mapInventoryItem = useCallback((d: any): InventoryItem => {
    const meta = decodeInventoryDescription(d.description);
    return {
      ...d,
      tenantId: d.tenant_id,
      nameEn: d.name_en,
      baseUnit: d.base_unit,
      conversionRate: d.conversion_rate,
      minThreshold: d.min_threshold,
      pricePerUnit: d.price_per_unit,
      costPrice: meta.costPrice,
      productDescription: meta.originalDescription,
      taxType: meta.taxType,
      supplierId: d.supplier_id,
      mainImage: (Array.isArray(d.images) && d.images.length > 0) ? (d.images[0]?.url || d.images[0]) : undefined,
      isTest: d.is_test,
      showInPos: d.show_in_pos !== false,
      updatedAt: d.updated_at
    };
  }, []);

  useRealtimeSync('customers', tenantId, (payload) => {
    if (payload.eventType === 'INSERT') {
      const newItem = mapCustomer(payload.new);
      setCustomers(prev => [newItem, ...prev]);
    } else if (payload.eventType === 'UPDATE') {
      const updatedItem = mapCustomer(payload.new);
      setCustomers(prev => {
        const index = prev.findIndex(c => c.id === updatedItem.id);
        if (index >= 0) {
          const arr = [...prev];
          arr[index] = updatedItem;
          return arr;
        }
        return [updatedItem, ...prev];
      });
    } else if (payload.eventType === 'DELETE') {
      setCustomers(prev => prev.filter(c => c.id !== payload.old.id));
    }
  });

  useRealtimeSync('inventory_items', tenantId, (payload) => {
    if (payload.eventType === 'INSERT') {
      const newItem = mapInventoryItem(payload.new);
      setInventory(prev => [newItem, ...prev]);
    } else if (payload.eventType === 'UPDATE') {
      const updatedItem = mapInventoryItem(payload.new);
      setInventory(prev => {
        const index = prev.findIndex(i => i.id === updatedItem.id);
        if (index >= 0) {
          const arr = [...prev];
          arr[index] = updatedItem;
          return arr;
        }
        return [updatedItem, ...prev];
      });
    } else if (payload.eventType === 'DELETE') {
      setInventory(prev => prev.filter(i => i.id !== payload.old.id));
    }
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: custData } = await supabase
          .from('customers')
          .select('*')
          .eq('tenant_id', tenantId);
        setCustomers((custData || []).map(mapCustomer));

        const { data: invData } = await supabase
          .from('inventory_items')
          .select('*')
          .eq('tenant_id', tenantId);
        setInventory((invData || []).map(mapInventoryItem));

        const { data: tenantData } = await supabase
          .from('tenants')
          .select('*')
          .eq('id', tenantId)
          .maybeSingle();
        
        if (tenantData) {
          setTaxSettings(tenantData.tax_settings || null);
        }
      } catch (error) {
        console.error('Error fetching POS data:', error);
      }
    };
    fetchData();
  }, [tenantId, mapCustomer, mapInventoryItem, refreshCounter]);

  const [selectedCategory, setSelectedCategory] = useState('all');

  const uniqueCategories = React.useMemo(() => {
    const list = new Set<string>();
    inventory.forEach(item => {
      if (item.category && item.showInPos !== false) {
        list.add(item.category);
      }
    });
    const result = Array.from(list);
    // Ensure we have some default categories shown even if empty
    if (!result.includes('fabric')) result.push('fabric');
    if (!result.includes('ready_made')) result.push('ready_made');
    return ['all', ...result];
  }, [inventory]);

  const getCategoryLabel = (cat: string) => {
    switch (cat) {
      case 'all': return t('pos.categories.all', 'الكل');
      case 'fabric': return t('pos.categories.fabric', 'الأقمشة');
      case 'ready_made': return t('pos.categories.ready_made', 'جاهز');
      case 'clothing': return t('pos.categories.clothing', 'ملابس');
      case 'accessory': return t('pos.categories.accessory', 'مستلزمات');
      default: return cat.charAt(0).toUpperCase() + cat.slice(1);
    }
  };

  const filteredInventory = inventory.filter(item => 
    item.showInPos !== false &&
    (selectedCategory === 'all' || item.category === selectedCategory) &&
    (item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
     item.barcode?.includes(searchQuery) || 
     item.sku?.includes(searchQuery))
  );

  const addToCart = (item: InventoryItem) => {
    setCart(prev => {
      const existing = prev.find(i => i.type === 'ready_made' && i.itemId === item.id);
      if (existing) {
        return prev.map(i => i === existing ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, {
        id: Math.random().toString(36).substr(2, 9),
        type: 'ready_made',
        itemId: item.id,
        name: item.name,
        nameEn: item.nameEn,
        price: item.pricePerUnit,
        taxType: item.taxType || 'exclusive',
        image: item.mainImage || item.images?.[0] || '',
        quantity: 1
      } as OrderItem];
    });
    // On mobile, maybe show the cart after adding?
    // setShowCartOnMobile(true);
  };

  const handleItemImageUpload = (itemId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setCart(prev => prev.map(item => 
          item.id === itemId ? { ...item, image: base64 } : item
        ));
      };
      reader.readAsDataURL(file);
    }
  };

  const [customItemForm, setCustomItemForm] = useState<Partial<OrderItem>>({
    garmentType: 'ثوب سعودي',
    price: 0,
    quantity: 1,
    fabric: '',
    fabricId: ''
  });
  
  const [customMeasurements, setCustomMeasurements] = useState<any>({});

  const handleAddCustomItem = () => {
    if (!customItemForm.garmentType || !customItemForm.price || customItemForm.price <= 0) {
      toastError('خطأ في البيانات', 'الرجاء إدخال نوع الثوب والسعر');
      return;
    }

    setCart(prev => [...prev, {
      id: Math.random().toString(36).substr(2, 9),
      ...customItemForm,
      ...customMeasurements,
      type: 'custom',
      status: 'measurements_taken'
    } as OrderItem]);
    setIsCustomOrderModalOpen(false);
    
    // Reset form
    setCustomItemForm({
      garmentType: 'ثوب سعودي',
      price: 0,
      quantity: 1,
      fabric: '',
      fabricId: ''
    });
    setCustomMeasurements({});
  };

  const removeFromCart = (id: string) => {
    setCart(prev => prev.filter(i => i.id !== id));
  };

  const handleSaveCustomer = async () => {
    if (!newCustomerName || !newCustomerPhone) {
      toastError('خطأ', 'الرجاء إدخال اسم العميل ورقم الجوال');
      return;
    }
    
    setIsSavingCustomer(true);
    try {
      const { data: newCustData, error } = await supabase
        .from('customers')
        .insert({
          tenant_id: tenantId,
          name: newCustomerName,
          phone: newCustomerPhone,
          trn: newCustomerVat || null,
          company_name: newCustomerVat ? newCustomerName : null,
          is_b2b: !!newCustomerVat,
          created_at: new Date().toISOString()
        })
        .select()
        .single();
      
      if (error) throw error;
      
      const newCustomer = newCustData as Customer;
      
      setCustomers(prev => [...prev, newCustomer]);
      setSelectedCustomer(newCustomer);
      setIsB2B(!!newCustomerVat);
      setB2bData({
        companyName: newCustomerVat ? newCustomerName : '',
        trn: newCustomerVat
      });
      
      setIsAddCustomerModalOpen(false);
      setNewCustomerName('');
      setNewCustomerPhone('');
      setNewCustomerVat('');
      router.refresh();
      toastSuccess('تم إضافة العميل بنجاح');
    } catch (error) {
      console.error('Error adding customer:', error);
      toastError('خطأ', 'فشل في إضافة العميل');
    } finally {
      setIsSavingCustomer(false);
    }
  };

  const updateQuantity = (id: string, delta: number) => {
    setCart(prev => prev.map(i => {
      if (i.id === id) {
        const newQuantity = Math.max(1, i.quantity + delta);
        return { ...i, quantity: newQuantity };
      }
      return i;
    }));
  };

  const subTotalAmount = cart.reduce((sum, item) => {
    const calc = calculateItemTax(item.price, (item.taxType as any) || 'exclusive', 0.15, item.quantity);
    return sum + calc.basePrice;
  }, 0);

  const taxAmountPerItem = cart.reduce((sum, item) => {
    const calc = calculateItemTax(item.price, (item.taxType as any) || 'exclusive', 0.15, item.quantity);
    return sum + calc.taxAmount;
  }, 0);
  
  // Calculate discount
  let calculatedDiscountAmount = 0;
  if (discountValue > 0) {
    if (discountType === 'percent') {
      calculatedDiscountAmount = subTotalAmount * (discountValue / 100);
    } else {
      calculatedDiscountAmount = discountValue;
    }
  }
  calculatedDiscountAmount = Math.min(calculatedDiscountAmount, subTotalAmount);
  
  const discountedSubtotal = subTotalAmount - calculatedDiscountAmount;

  const discountRatio = subTotalAmount > 0 ? (subTotalAmount - calculatedDiscountAmount) / subTotalAmount : 1;
  const taxAmount = taxAmountPerItem * discountRatio;
  const vatRate = 15;
  const isTaxEnabled = taxAmount > 0 || (taxSettings?.enabled ?? true);
  const totalAmount = discountedSubtotal + taxAmount;

  const handleCheckout = async () => {
    if (cart.length === 0) {
      toastError('السلة فارغة', 'يرجى إضافة منتجات لإتمام الطلب');
      return;
    }

    setLoading(true);
    try {
      const hasCustom = cart.some(i => i.type === 'custom');
      const hasReadyMade = cart.some(i => i.type === 'ready_made');
      
      let orderStatus: OrderStatus | 'partial_delivered' = 'delivered';
      if (hasCustom && hasReadyMade) {
        orderStatus = 'partial_delivered';
      } else if (hasCustom) {
        orderStatus = 'measurements_taken';
      }

      const orderNumber = generateOrderNumber();
      let qrCodeBase64 = "";
      
      let invoiceType = 'simplified_b2c';
      let b2bCompanyName = isB2B ? b2bData.companyName : '';
      let b2bTRN = isB2B ? b2bData.trn : '';
      
      if (isB2B) {
         if (!b2bCompanyName || !b2bTRN) {
             toastError('بيانات ناقصة', 'يرجى إدخال اسم الشركة والرقم الضريبي لفاتورة الأعمال B2B');
             setLoading(false);
             return;
         }
         invoiceType = 'standard_b2b';
      }

      const timestamp = new Date().toISOString();
      const sellerName = taxSettings?.legalName || 'مؤسسة وضوح الشاملة';
      const trn = taxSettings?.trn || '300000000000003';
      
      qrCodeBase64 = generateZatcaQR(sellerName, trn, timestamp, totalAmount.toFixed(2), taxAmount.toFixed(2));

      const isUuid = (val: string | undefined | null) => 
        val ? /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val) : false;

      const orderData = {
        order_number: orderNumber,
        customer_id: (selectedCustomer?.id && isUuid(selectedCustomer.id)) ? selectedCustomer.id : null,
        customer_name: selectedCustomer?.name || 'عميل نقدي',
        tenant_id: tenantId,
        shift_id: shiftId || null,
        items: cart,
        subtotal_amount: subTotalAmount,
        total_amount: totalAmount,
        paid_amount: paidAmount,
        discount_amount: calculatedDiscountAmount,
        remaining_amount: totalAmount - paidAmount,
        payment_method: paymentMethod,
        status: orderStatus,
        order_date: timestamp,
        delivery_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        created_by: (currentStaff?.id && isUuid(currentStaff.id)) ? currentStaff.id : null,
        tax_amount: taxAmount,
        tax_rate: vatRate,
        notes: encodeOrderB2BNotes(isB2B ? b2bCompanyName : '', isB2B ? b2bTRN : ''),
        qr_code: qrCodeBase64,
        history: [{
          status: orderStatus as OrderStatus,
          updatedAt: timestamp,
          updatedBy: currentStaff?.name || 'System',
          updatedByUid: currentStaff?.id
        }],
        created_at: timestamp
      };

      const { data: newOrder, error: orderError } = await supabase
        .from('orders')
        .insert(orderData)
        .select()
        .single();

      if (orderError) throw orderError;

      // Generate Invoice entry
      const { error: invoiceError } = await supabase
        .from('tax_invoices')
        .insert({
          invoice_number: `INV-${orderNumber}`,
          order_id: newOrder.id,
          tenant_id: tenantId,
          customer_id: orderData.customer_id,
          customer_name: orderData.customer_name,
          subtotal: subTotalAmount,
          tax_rate: vatRate,
          tax_amount: taxAmount,
          discount_amount: calculatedDiscountAmount,
          paid_amount: paidAmount,
          total_amount: totalAmount,
          vat_number: b2bTRN || null,
          qr_payload: qrCodeBase64,
          issued_at: timestamp,
          created_at: timestamp,
          status: 'issued',
          notes: encodeInvoiceExtendedNotes({
            invoiceType: invoiceType,
            isB2B: invoiceType === 'standard_b2b',
            b2bCompanyName: isB2B ? b2bCompanyName : undefined,
            items: cart.map(item => ({ 
              name: item.name || item.garmentType || 'منتج مخصص', 
              quantity: item.quantity, 
              price: item.price,
              type: item.type
            })),
            createdBy: currentStaff?.name || 'System'
          })
        });

      if (invoiceError) throw invoiceError;

      // Audit Log
      await logEmployeeAction(
        tenantId,
        currentStaff?.id || 'system',
        currentStaff?.name || 'System',
        'create_invoice',
        `تم إنشاء فاتورة جديدة بقيمة ${totalAmount} للعميل ${orderData.customer_name}`
      );

      // Deduct inventory for ready-made items and reserved fabric
      for (const item of cart) {
        if (item.type === 'ready_made' && item.itemId && isUuid(item.itemId)) {
          // Update branch_inventory
          const branchId = currentStaff?.branchId || '';
          if (branchId) {
            const { error: stockError } = await supabase.rpc('adjust_stock', {
              p_branch_id: branchId,
              p_item_id: item.itemId,
              p_quantity: -item.quantity,
              p_reason: `بيع في نقطة البيع - فاتورة ${orderNumber}`,
              p_type: 'out',
              p_staff_id: (currentStaff?.id && isUuid(currentStaff.id)) ? currentStaff.id : null
            });
            if (stockError) console.error('Stock adjustment error:', stockError);
          }
        } else if (item.type === 'custom' && item.fabricId && item.fabricId !== 'custom' && isUuid(item.fabricId) && item.consumedMeters) {
          const branchId = currentStaff?.branchId || '';
          if (branchId) {
            const { error: stockError } = await supabase.rpc('adjust_stock', {
              p_branch_id: branchId,
              p_item_id: item.fabricId,
              p_quantity: -item.consumedMeters,
              p_reason: `استهلاك قماش تفصيل - فاتورة ${orderNumber}`,
              p_type: 'out',
              p_staff_id: (currentStaff?.id && isUuid(currentStaff.id)) ? currentStaff.id : null
            });
            if (stockError) console.error('Fabric adjustment error:', stockError);
          }
        }
      }

      setCart([]);
      setSelectedCustomer(null);
      setIsB2B(false);
      setB2bData({ companyName: '', trn: '' });
      setPaidAmount(0);
      setCompletedOrder({
         id: newOrder.id,
         invoiceNumber: `INV-${orderNumber}`,
         invoiceType,
         total: totalAmount,
         subTotal: subTotalAmount,
         taxAmount: taxAmount,
         discountAmount: calculatedDiscountAmount,
         customerName: orderData.customer_name,
         customerVat: b2bTRN,
         items: cart.map(item => ({ name: item.name || item.garmentType || 'منتج مخصص', quantity: item.quantity, price: item.price })),
         qrCode: qrCodeBase64,
         issuedAt: timestamp
      });
      try {
        await fetchCashDrawerBalance();
      } catch (err) {
        console.error('Failed to trigger fetchCashDrawerBalance after order:', err);
      }
      router.refresh();
      toastSuccess('تم إصدار الفاتورة الضريبية بنجاح');
    } catch (error) {
      console.error('Checkout error:', error);
      handleError(error as any, 'فشل إتمام العملية');
    } finally {
      setLoading(false);
    }
  };

  const renderCartPanel = (isMobilePanel: boolean = false) => {
    return (
      <div className="flex flex-col h-full bg-[#FFFFFF] dark:bg-[#1D1D1D]">
        {/* Cart Header */}
        <div className="p-4 lg:p-6 border-b border-border flex items-center justify-between shrink-0 relative">
          <div className="flex items-center gap-2">
            {isMobilePanel && <div className="lg:hidden w-10 h-1 bg-border rounded-full absolute top-2 left-1/2 -translate-x-1/2" />}
            <ShoppingCart size={24} className="text-[#1C8FFF]" />
            <h2 className="text-lg lg:text-xl font-bold text-content" style={{ fontFamily: 'IBM Plex Sans, sans-serif' }}>
              {t('pos.cart_title', 'سلة المشتريات')}
            </h2>
            <span className="bg-[#1C8FFF]/10 text-[#1C8FFF] text-xs px-2.5 py-0.5 rounded-full font-black">{cart.length}</span>
          </div>
          {isMobilePanel && (
            <button 
              onClick={() => setShowCartOnMobile(false)}
              className="p-2 text-[#6B7280] hover:bg-surface-muted rounded-full transition-all cursor-pointer"
            >
              <X size={24} />
            </button>
          )}
        </div>

        {/* Customer Selector */}
        <div className="p-4 border-b border-border space-y-3 z-30 shrink-0">
          <div className="flex gap-2 relative">
            <Combobox value={selectedCustomer} onChange={(customer: Customer | null) => {
              setSelectedCustomer(customer);
              if (customer) {
                 setIsB2B(customer.isB2B || !!customer.companyName || !!customer.trn);
                 setB2bData({
                    companyName: customer.companyName || '',
                    trn: customer.trn || ''
                 });
              } else {
                 setIsB2B(false);
                 setB2bData({ companyName: '', trn: '' });
              }
            }}>
              <div className="relative flex-1">
                <Combobox.Input
                  className="w-full p-3 bg-[#FFFFFF] dark:bg-[#1D1D1D] text-content border border-border rounded-xl focus:ring-2 focus:ring-[#1C8FFF] focus:border-[#1C8FFF] shadow-sm font-medium rtl:pr-10 ltr:pl-10"
                  placeholder={t('pos.search_customer', 'ابحث عن عميل...')}
                  displayValue={(person: Customer) => person?.name || ''}
                  onChange={(event) => setCustomerQuery(event.target.value)}
                />
                <Combobox.Button className="absolute inset-y-0 ltr:right-0 rtl:left-0 flex items-center px-3">
                  <User className="w-5 h-5 text-[#6B7280]" aria-hidden="true" />
                </Combobox.Button>
                <Transition
                  as={React.Fragment}
                  leave="transition ease-in duration-100"
                  leaveFrom="opacity-100"
                  leaveTo="opacity-0"
                  afterLeave={() => setCustomerQuery('')}
                >
                  <Combobox.Options className="absolute mt-1 max-h-60 w-full overflow-auto rounded-xl bg-[#FFFFFF] dark:bg-[#1D1D1D] border border-border text-content py-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-50">
                    <Combobox.Option
                      className={({ active }) =>
                        `relative cursor-pointer select-none py-2 px-4 ${
                          active ? 'bg-[#1C8FFF] text-white' : 'text-content'
                        }`
                      }
                      value={null}
                    >
                      <span className="block truncate">{t('pos.walk_in_customer', 'عميل نقدي (بدون اسم)')}</span>
                    </Combobox.Option>
                    {customers
                      .filter((person) =>
                        person.name.toLowerCase().includes(customerQuery.toLowerCase()) ||
                        person.phone.includes(customerQuery)
                      )
                      .map((person) => (
                      <Combobox.Option
                        key={person.id}
                        className={({ active }) =>
                          `relative cursor-pointer select-none py-2 px-4 ${
                            active ? 'bg-[#1C8FFF] text-white' : 'text-content'
                          }`
                        }
                        value={person}
                      >
                        <span className="block truncate font-medium">{person.name}</span>
                        <span className="block text-xs opacity-75">{person.phone}</span>
                      </Combobox.Option>
                    ))}
                  </Combobox.Options>
                </Transition>
              </div>
            </Combobox>
            <button 
              onClick={() => setIsAddCustomerModalOpen(true)}
              className="px-3 bg-surface-muted border border-border rounded-xl text-[#6B7280] hover:text-[#1C8FFF] hover:border-[#1C8FFF] transition-all flex items-center justify-center shrink-0 cursor-pointer"
              title={t('pos.add_new_customer', 'إضافة عميل جديد')}
            >
              <UserPlus size={20} />
            </button>
          </div>
        </div>

        {/* Cart Items List */}
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {focusedItemId && (
            <div 
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 transition-opacity"
              onClick={() => setFocusedItemId(null)}
            />
          )}
          {cart.map(item => (
              <div 
                key={item.id} 
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('input')) return;
                  setFocusedItemId(focusedItemId === item.id ? null : item.id!);
                }}
                className={cn(
                  "p-3 rounded-xl border transition-all cursor-pointer bg-surface",
                  focusedItemId === item.id 
                    ? "border-[#1C8FFF] ring-2 ring-[#1C8FFF] shadow-2xl z-50 relative bg-white dark:bg-[#1D1D1D] scale-[1.02]" 
                    : "bg-[#FFFFFF] dark:bg-[#1D1D1D] border-border hover:border-[#1C8FFF]/50",
                  focusedItemId && focusedItemId !== item.id ? "opacity-30" : ""
                )}
              >
                <div className="flex items-center gap-3">
                  {/* Item Image */}
                  <div className="relative group w-12 h-12 shrink-0">
                    {item.image ? (
                      <img 
                        src={item.image} 
                        alt={item.name} 
                        className="w-full h-full object-cover rounded-lg border border-border"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-full h-full bg-[#F5F7FA] dark:bg-[#121212] border border-border rounded-lg flex items-center justify-center text-[#6B7280]">
                        <ImageIcon size={18} />
                      </div>
                    )}
                    {item.type === 'ready_made' && (
                      <label className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 rounded-lg cursor-pointer transition-opacity">
                        <Camera size={18} className="text-white" />
                        <input 
                          type="file" 
                          accept="image/*" 
                          className="hidden" 
                          onChange={(e) => handleItemImageUpload(item.id!, e)} 
                        />
                      </label>
                    )}
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {item.type === 'custom' ? (
                        <span className="px-2 py-0.5 bg-[#1C8FFF]/10 text-[#1C8FFF] text-xs font-bold rounded-md flex items-center gap-1">
                          <Scissors size={12} />
                          {t('pos.type_custom', 'تفصيل')}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-[#6B7280]/10 text-[#6B7280] text-xs font-bold rounded-md flex items-center gap-1">
                          <Package size={12} />
                          {t('pos.type_ready_made', 'جاهز')}
                        </span>
                      )}
                      <span className="font-medium text-content line-clamp-1" style={{ fontFamily: 'IBM Plex Sans, sans-serif' }}>
                        {item.type === 'custom' ? item.garmentType : (i18n.language === 'en' && item.nameEn ? item.nameEn : item.name)}
                      </span>
                    </div>
                    <div className="text-[#1C8FFF] font-bold"><PriceDisplay amount={item.price} /></div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 bg-[#F5F7FA] dark:bg-[#121212] border border-border rounded-lg p-1">
                      <button onClick={() => updateQuantity(item.id!, -1)} className="w-6 h-6 flex items-center justify-center hover:bg-surface-muted rounded transition-colors">-</button>
                      <span className="w-6 text-center font-bold text-content">{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.id!, 1)} className="w-6 h-6 flex items-center justify-center hover:bg-surface-muted rounded transition-colors">+</button>
                    </div>
                    <button onClick={() => removeFromCart(item.id!)} className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer">
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>

                {/* Expanded Details when focused */}
                {focusedItemId === item.id && item.type === 'ready_made' && (
                  <div className="mt-3 pt-3 border-t border-border flex flex-wrap gap-2 animate-in fade-in slide-in-from-top-1">
                    <button 
                      className="text-[10px] font-black text-[#1C8FFF] bg-[#1C8FFF]/5 px-2 py-1 rounded-md uppercase tracking-wider cursor-pointer"
                      onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = 'image/*';
                        input.onchange = (e: any) => handleItemImageUpload(item.id!, e);
                        input.click();
                      }}
                    >
                      {t('pos.change_image', 'تغيير الصورة')}
                    </button>
                  </div>
                )}
              </div>
          ))}
          {cart.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-[#6B7280] space-y-2 py-12">
              <ShoppingCart size={48} className="opacity-20" />
              <p>{t('pos.empty_cart', 'السلة فارغة')}</p>
            </div>
          )}
        </div>

        {/* Order Summary Block */}
        <div className="p-4 md:p-6 border-t border-border bg-[#FFFFFF] dark:bg-[#1D1D1D] shadow-lg shrink-0">
          <div className="space-y-2 mb-4">
            <div className="flex justify-between items-center text-sm">
              <span className="text-[#6B7280] font-medium">{t('pos.subtotal', 'المجموع الفرعي')}</span>
              <span className="text-content font-bold"><PriceDisplay amount={subTotalAmount} /></span>
            </div>
            
            {calculatedDiscountAmount > 0 && (
              <div className="flex justify-between items-center text-sm text-[#1C8FFF] font-medium">
                <span>{t('pos.discount_applied', 'الخصم المستقطع')}</span>
                <span className="font-bold relative flex items-center">
                  -<PriceDisplay amount={calculatedDiscountAmount} className="inline-flex mr-1" />
                </span>
              </div>
            )}

            {isTaxEnabled && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-[#6B7280] font-medium">{t('pos.vat', 'الضريبة')} ({vatRate}%)</span>
                <span className="text-content font-bold"><PriceDisplay amount={taxAmount} /></span>
              </div>
            )}
          </div>
          
          <div className="flex justify-between items-center mb-4 pt-3 border-t border-border">
            <span className="text-[#6B7280] font-black uppercase tracking-widest text-xs md:text-sm">
              {t('pos.grand_total', 'الإجمالي')} {isTaxEnabled && t('pos.inclusive_vat', '(شامل الضريبة)')}
            </span>
            <span className="text-xl md:text-2xl font-black text-[#1C8FFF]"><PriceDisplay amount={totalAmount} /></span>
          </div>

          <button
            onClick={() => {
               setIsPaymentModalOpen(true);
               setPaidAmount(totalAmount);
            }}
            disabled={cart.length === 0}
            className="w-full py-4 bg-[#22C55E] hover:bg-[#22C55E]/90 text-white rounded-2xl font-black text-lg transition-all shadow-lg shadow-[#22C55E]/10 active:scale-[0.98] disabled:opacity-50 disabled:grayscale disabled:scale-100 flex items-center justify-center gap-3 cursor-pointer"
          >
            <CreditCard size={24} />
            <span>{t('pos.checkout_and_pay', 'الدفع وإتمام الطلب')}</span>
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col lg:flex-row font-sans bg-[#F5F7FA] dark:bg-[#121212] overflow-hidden w-full" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Main Pane (70% width on Desktop) */}
      <div className="w-full lg:w-[70%] flex flex-col gap-4 lg:gap-6 overflow-x-hidden transition-all duration-300 p-4 lg:p-6 overflow-y-auto h-[calc(100vh-4rem)] lg:h-full shrink-0">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute ltr:left-3 rtl:right-3 top-1/2 -translate-y-1/2 text-[#6B7280]" size={20} />
            <input
              type="text"
              placeholder={t('pos.search_placeholder', 'ابحث عن منتج أو باركود...')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full ltr:pl-10 ltr:pr-4 rtl:pr-10 rtl:pl-4 py-3 bg-[#FFFFFF] dark:bg-[#1D1D1D] text-content border border-border rounded-xl focus:ring-2 focus:ring-[#1C8FFF] focus:border-[#1C8FFF] transition-all shadow-sm"
            />
            <button className="absolute ltr:right-3 rtl:left-3 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#1C8FFF] transition-colors">
              <Barcode size={20} />
            </button>
          </div>

          <button
            onClick={() => setIsCustomOrderModalOpen(true)}
            className="flex items-center justify-center gap-2 px-6 py-3 bg-[#1C8FFF] text-white rounded-xl hover:bg-[#1C8FFF]/90 transition-colors font-bold shadow-md active:scale-95 cursor-pointer"
          >
            <Scissors size={20} />
            <span className="whitespace-nowrap">{t('pos.custom_tailor', 'تفصيل جديد')}</span>
          </button>
        </div>

        {/* Category Filters scroll row & View Toggle */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 overflow-x-auto py-1 scrollbar-none w-full sm:w-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
            {uniqueCategories.map(cat => {
              const isActive = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={cn(
                    "px-5 py-2.5 rounded-full text-xs font-bold transition-all duration-200 cursor-pointer border shrink-0 active:scale-95",
                    isActive
                      ? "bg-[#1C8FFF] text-white border-[#1C8FFF] shadow-md shadow-[#1C8FFF]/20"
                      : "bg-[#FFFFFF] dark:bg-[#1D1D1D] text-[#6B7280] border-border hover:bg-surface-muted/50"
                  )}
                >
                  {getCategoryLabel(cat)}
                </button>
              );
            })}
          </div>

          <div className="flex items-center self-end sm:self-center bg-[#FFFFFF] dark:bg-[#1D1D1D] border border-border rounded-xl p-1 shadow-sm shrink-0">
            <button
              onClick={() => setViewMode('grid')}
              className={cn(
                "p-2 rounded-lg transition-all duration-200 cursor-pointer flex items-center justify-center",
                viewMode === 'grid'
                  ? "bg-[#1C8FFF] text-white shadow"
                  : "text-[#6B7280] hover:bg-slate-100 dark:hover:bg-slate-800"
              )}
              title={t('pos.grid_view', 'عرض شبكي')}
            >
              <LayoutGrid size={16} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={cn(
                "p-2 rounded-lg transition-all duration-200 cursor-pointer flex items-center justify-center",
                viewMode === 'list'
                  ? "bg-[#1C8FFF] text-white shadow"
                  : "text-[#6B7280] hover:bg-slate-100 dark:hover:bg-slate-800"
              )}
              title={t('pos.list_view', 'عرض قائمة')}
            >
              <List size={16} />
            </button>
          </div>
        </div>

        {/* Products Grid / List View */}
        <div className="flex-1 bg-[#FFFFFF] dark:bg-[#1D1D1D] border border-border rounded-2xl p-4 md:p-6 overflow-auto shadow-sm">
          {filteredInventory.length > 0 ? (
            viewMode === 'grid' ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4 w-full">
                {filteredInventory.map(item => (
                  <button
                    key={item.id}
                    onClick={() => addToCart(item)}
                    className="flex flex-col items-center p-3 md:p-4 bg-[#FFFFFF] dark:bg-[#1D1D1D] border border-gray-200/50 dark:border-gray-700/50 rounded-2xl shadow-sm hover:shadow-md hover:border-[#1C8FFF]/50 hover:-translate-y-1 transition-all duration-300 ease-in-out group active:scale-95 cursor-pointer text-center w-full"
                  >
                    <div className="w-full aspect-square bg-[#F5F7FA] dark:bg-[#121212] rounded-t-xl rounded-b-lg flex items-center justify-center mb-2 md:mb-3 group-hover:scale-105 transition-transform overflow-hidden border border-border/50">
                      {item.mainImage ? (
                        <img 
                          src={item.mainImage} 
                          alt={item.name} 
                          className="w-full h-full object-cover rounded-t-xl"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="p-4 bg-[#F5F7FA] dark:bg-[#121212] rounded-full">
                          <Package size={28} className="text-[#6B7280] group-hover:text-[#1C8FFF]" />
                        </div>
                      )}
                    </div>
                    <span className="text-sm md:text-base font-bold text-content text-center line-clamp-2 min-h-[2.5rem] mb-1 w-full">
                      {i18n.language === 'en' && item.nameEn ? item.nameEn : item.name}
                    </span>
                    <span className="text-[#1C8FFF] font-black text-sm md:text-base"><PriceDisplay amount={item.pricePerUnit} /></span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-3 w-full">
                {filteredInventory.map(item => (
                  <button
                    key={item.id}
                    onClick={() => addToCart(item)}
                    className="flex items-center p-3 md:p-4 bg-[#FFFFFF] dark:bg-[#1D1D1D] border border-gray-200/50 dark:border-gray-700/50 rounded-2xl shadow-sm hover:shadow-md hover:border-[#1C8FFF]/50 hover:-translate-y-1 transition-all duration-300 ease-in-out group active:scale-[0.99] cursor-pointer w-full text-right"
                  >
                    {/* Item Image */}
                    <div className="w-16 h-16 sm:w-20 sm:h-20 bg-[#F5F7FA] dark:bg-[#121212] rounded-xl flex items-center justify-center shrink-0 overflow-hidden border border-border/50 ms-0 me-4">
                      {item.mainImage ? (
                        <img 
                          src={item.mainImage} 
                          alt={item.name} 
                          className="w-full h-full object-cover rounded-xl"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <Package size={24} className="text-[#6B7280] group-hover:text-[#1C8FFF]" />
                      )}
                    </div>

                    {/* Details in the Middle */}
                    <div className="flex-1 min-w-0 flex flex-col items-start text-start justify-center gap-1">
                      <span className="text-sm sm:text-base font-bold text-content line-clamp-1 w-full text-start">
                        {i18n.language === 'en' && item.nameEn ? item.nameEn : item.name}
                      </span>
                      {item.category && (
                        <span className="text-[10px] sm:text-xs text-[#6B7280] bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 rounded-full font-bold">
                          {getCategoryLabel(item.category)}
                        </span>
                      )}
                    </div>

                    {/* Price and Action button on the End/Right */}
                    <div className="flex flex-col items-end justify-center shrink-0 gap-1.5 ms-4 me-0">
                      <span className="text-[#1C8FFF] font-black text-sm sm:text-lg">
                        <PriceDisplay amount={item.pricePerUnit} />
                      </span>
                      <div className="px-2.5 py-1 bg-[#1C8FFF]/10 text-[#1C8FFF] group-hover:bg-[#1C8FFF] group-hover:text-white rounded-lg transition-colors text-xs font-bold flex items-center gap-1">
                        <Plus size={12} />
                        <span>{t('pos.add_to_cart', 'إضافة')}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-[#6B7280] space-y-2 py-12">
              <Package size={48} className="opacity-20" />
              <p className="text-sm font-bold">{t('pos.no_products_found', 'لم يتم العثور على منتجات')}</p>
            </div>
          )}
        </div>
      </div>

      {/* Desktop sidebar cart layout (30% width) - Hidden on mobile */}
      <div className="hidden lg:flex lg:w-[30%] lg:min-w-[360px] lg:max-w-[450px] ltr:border-l rtl:border-r border-border flex-col h-full overflow-hidden shrink-0 shadow-sm">
        {renderCartPanel(false)}
      </div>

      {/* Mobile Drawer/Bottom Sheet Cart - Triggered via FAB */}
      <AnimatePresence>
        {showCartOnMobile && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCartOnMobile(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[50] lg:hidden"
            />
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 220 }}
              className="fixed inset-x-0 bottom-0 h-[85vh] rounded-t-[2.5rem] bg-[#FFFFFF] dark:bg-[#1D1D1D] flex flex-col shadow-2xl z-[60] lg:hidden overflow-hidden pb-10"
              dir={isRtl ? 'rtl' : 'ltr'}
            >
              {renderCartPanel(true)}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Mobile Floating Action Button (FAB) */}
      {!showCartOnMobile && cart.length > 0 && (
        <motion.button
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowCartOnMobile(true)}
          className="lg:hidden fixed bottom-6 left-6 z-[40] bg-brand text-white p-5 rounded-[2rem] shadow-2xl flex items-center gap-3 transition-all"
        >
          <div className="relative">
            <ShoppingCart size={28} />
            <span className="absolute -top-3 -right-3 bg-red-500 text-white text-[10px] font-black w-7 h-7 rounded-full flex items-center justify-center ring-4 ring-white shadow-lg">
              {cart.length}
            </span>
          </div>
          <div className="flex flex-col items-start pr-1">
             <span className="text-[10px] font-bold uppercase opacity-80 leading-none mb-1">الإجمالي</span>
             <PriceDisplay amount={totalAmount} className="text-sm font-black leading-none" />
          </div>
        </motion.button>
      )}

      {/* Payment Side Drawer Refactored to Bottom Sheet for mobile */}
      <AnimatePresence>
        {isPaymentModalOpen && (
          <div className="fixed inset-0 z-[60] flex items-end lg:items-center justify-center overflow-hidden">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => !completedOrder && setIsPaymentModalOpen(false)}
            />
            <motion.div 
              initial={{ y: window.innerWidth < 1024 ? '100%' : 0, x: window.innerWidth >= 1024 ? '100%' : 0 }}
              animate={{ y: 0, x: 0 }}
              exit={{ y: window.innerWidth < 1024 ? '100%' : 0, x: window.innerWidth >= 1024 ? '100%' : 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="bg-surface w-full lg:w-[450px] md:h-auto lg:h-full h-[90vh] shadow-2xl relative z-10 flex flex-col lg:rounded-none rounded-t-[2.5rem] border-t lg:border-t-0 lg:border-r border-border overflow-hidden lg:mr-auto md:max-w-md md:rounded-[2.5rem] md:mb-10 lg:max-w-none lg:mb-0 lg:ml-0"
              dir="rtl"
            >
              <div className="flex-1 overflow-y-auto p-4 lg:p-6 pb-24 lg:pb-6">
              {completedOrder ? (
                <div className="flex flex-col items-center text-center space-y-6 mt-12">
                  <motion.div 
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="w-20 h-20 bg-success/10 rounded-full flex items-center justify-center mb-2"
                  >
                    <CheckCircle2 size={40} className="text-success" />
                  </motion.div>
                  <div>
                    <h2 className="text-2xl font-black text-content mb-1">تم إصدار الفاتورة</h2>
                    <p className="text-content-muted">{completedOrder.invoiceNumber}</p>
                  </div>
                  
                  <div className="bg-surface-muted p-4 rounded-2xl w-full border border-border">
                    <p className="text-sm text-content-muted mb-1">الإجمالي الشامل</p>
                    <p className="text-3xl font-bold text-brand"><PriceDisplay amount={completedOrder.total} /></p>
                    {completedOrder.invoiceType === 'standard_b2b' && (
                       <span className="inline-block mt-2 px-3 py-1 bg-brand/10 text-brand text-xs font-bold rounded-full">
                         فاتورة ضريبية (أعمال B2B)
                       </span>
                    )}
                  </div>

                  {completedOrder.qrCode && (
                    <div className="flex justify-center p-4 bg-white rounded-xl border border-border">
                      <QRCodeSVG value={completedOrder.qrCode} size={100} level="M" />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3 w-full pt-4 print:hidden">
                    <button 
                      onClick={() => {
                        window.print();
                      }}
                      className="flex flex-col items-center justify-center p-4 rounded-2xl border border-border hover:border-brand hover:bg-brand/5 transition-all text-content group"
                    >
                      <span className="text-2xl mb-2 group-hover:scale-110 transition-transform">🖨️</span>
                      <span className="text-sm font-bold">إيصال / طباعة</span>
                    </button>
                    <button 
                      onClick={async () => {
                        try {
                          await downloadInvoicePDF('pos-invoice-print-area', `Invoice-${completedOrder.invoiceNumber}.pdf`);
                        } catch (e) {
                          console.error(e);
                          toastError('فشل تنزيل الفاتورة');
                        }
                      }}
                      className="flex flex-col items-center justify-center p-4 rounded-2xl border border-border hover:border-brand hover:bg-brand/5 transition-all text-content group"
                    >
                      <span className="text-2xl mb-2 group-hover:scale-110 transition-transform">📥</span>
                      <span className="text-sm font-bold">تحميل PDF</span>
                    </button>
                    <button 
                       className="col-span-2 flex flex-col items-center justify-center p-4 rounded-2xl border border-success/20 hover:border-success hover:bg-success/5 transition-all text-success group"
                       onClick={async () => {
                         const text = `فاتورة من ${brandingSettings?.storeName || 'المتجر'}\nرقم الفاتورة: ${completedOrder.invoiceNumber}\nالإجمالي: ${completedOrder.total} ريال.`;
                         try {
                           await shareInvoiceAsPDFFile('pos-invoice-print-area', `Invoice-${completedOrder.invoiceNumber}.pdf`, text);
                         } catch (e) {
                           console.error(e);
                         }
                       }}
                    >
                      <span className="text-2xl mb-2 group-hover:scale-110 transition-transform">📱</span>
                      <span className="text-sm font-bold">مشاركة واتساب (نص + PDF)</span>
                    </button>
                  </div>
                  
                  <button
                    onClick={() => {
                       setCompletedOrder(null);
                       setIsPaymentModalOpen(false);
                    }}
                    className="w-full mt-4 py-3 bg-surface-muted text-content font-bold rounded-xl hover:bg-border transition-colors"
                  >
                    إغلاق وبدء طلب جديد
                  </button>
                </div>
              ) : (
                // Payment form
                <div className="flex flex-col min-h-full">
                  <div className="flex justify-between items-center mb-6 border-b border-border pb-4">
                    <h2 className="text-2xl font-black text-content">إتمام الطلب</h2>
                    <button onClick={() => setIsPaymentModalOpen(false)} className="p-2 hover:bg-surface-muted rounded-full">
                      <X size={24} />
                    </button>
                  </div>
                  
                  <div className="space-y-6 flex-1">

                    {/* Invoice Type */}
                    <div className="bg-surface p-4 rounded-2xl border border-border">
                      <label className="block text-sm font-bold text-content mb-3">نوع الفاتورة</label>
                      <div className="flex bg-surface-muted p-1 rounded-xl">
                        <button
                          className={cn("flex-1 py-2 text-sm font-bold rounded-lg transition-colors", !isB2B ? "bg-white shadow-sm text-brand" : "text-content-muted hover:text-content")}
                          onClick={() => {
                            setIsB2B(false);
                            setB2bData({ companyName: '', trn: '' });
                          }}
                        >
                          عادي (ضريبية مبسطة)
                        </button>
                        <button
                          className={cn("flex-1 py-2 text-sm font-bold rounded-lg transition-colors", isB2B ? "bg-white shadow-sm text-brand" : "text-content-muted hover:text-content")}
                          onClick={() => {
                            setIsB2B(true);
                            setIsB2bModalOpen(true);
                          }}
                        >
                          ضريبية (أعمال B2B)
                        </button>
                      </div>
                      {isB2B && b2bData.companyName && (
                        <div className="mt-3 p-3 bg-brand/5 border border-brand/20 rounded-xl text-sm">
                           <div className="flex justify-between items-center mb-1">
                             <span className="font-bold text-brand">{b2bData.companyName}</span>
                             <button onClick={() => setIsB2bModalOpen(true)} className="text-brand text-xs font-bold hover:underline">تعديل</button>
                           </div>
                           <div className="text-content-muted">الرقم الضريبي: {b2bData.trn}</div>
                        </div>
                      )}
                    </div>

                    {/* Discount */}
                    <div className="bg-surface p-4 rounded-2xl border border-border">
                      <div className="flex justify-between items-center mb-3">
                        <label className="text-sm font-bold text-content">الخصم</label>
                        <div className="flex bg-surface-muted rounded-lg p-0.5">
                          <button
                            type="button"
                            className={cn(
                              "px-3 py-1 text-xs font-bold rounded-md transition-all",
                              discountType === 'percent' ? "bg-brand text-white shadow-sm" : "text-content-muted hover:text-content"
                            )}
                            onClick={() => {
                              setDiscountType('percent');
                              if (discountValue > 100) setDiscountValue(100);
                            }}
                          >
                            نسبة (%)
                          </button>
                          <button
                            type="button"
                            className={cn(
                              "px-3 py-1 text-xs font-bold rounded-md transition-all",
                              discountType === 'fixed' ? "bg-brand text-white shadow-sm" : "text-content-muted hover:text-content"
                            )}
                            onClick={() => setDiscountType('fixed')}
                          >
                            مبلغ ثابت
                          </button>
                        </div>
                      </div>
                      <div className="relative">
                        <input
                          type="number"
                          min="0"
                          max={discountType === 'percent' ? "100" : undefined}
                          value={discountValue || ''}
                          onChange={(e) => {
                             let val = Number(e.target.value);
                             if (discountType === 'percent' && val > 100) val = 100;
                             setDiscountValue(val);
                             // Also update paidAmount if they are paying in full
                             if (paidAmount >= (totalAmount - calculatedDiscountAmount)) {
                               // It's tricky to auto update here accurately, but we can do our best.
                               // Just let the effect handle it or let user adjust.
                             }
                          }}
                          placeholder="0"
                          className="w-full bg-surface-muted border-none rounded-xl py-3 px-4 focus:ring-2 focus:ring-brand text-left tabular-nums font-bold text-lg"
                          dir="ltr"
                        />
                      </div>
                    </div>

                    {/* Payment Method */}
                    <div className="bg-surface p-4 rounded-2xl border border-border">
                      <label className="block text-sm font-bold text-content mb-3">طريقة الدفع</label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {[
                          { id: 'cash', label: 'كاش', icon: Banknote },
                          { id: 'card', label: 'شبكة', icon: CreditCard },
                          { id: 'bank_transfer', label: 'تحويل', icon: Landmark },
                          { id: 'credit', label: 'آجل / عربون', icon: Wallet }
                        ].map(method => (
                          <button
                            key={method.id}
                            onClick={() => {
                              setPaymentMethod(method.id as PaymentMethod);
                              if (method.id === 'credit') {
                                setPaidAmount(0);
                              } else {
                                setPaidAmount(totalAmount);
                              }
                            }}
                            className={cn(
                              "flex flex-col items-center justify-center gap-2 p-3 rounded-xl border transition-all",
                              paymentMethod === method.id
                                ? "border-brand bg-brand/5 text-brand font-bold shadow-sm"
                                : "border-border hover:border-brand/50 text-content-muted hover:bg-surface-muted"
                            )}
                          >
                            <method.icon size={20} />
                            <span className="text-xs">{method.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="bg-surface p-4 rounded-2xl border border-border">
                      <label className="block text-sm font-bold text-content mb-3">المبلغ المدفوع الآن</label>
                      <input
                        type="number"
                        value={paidAmount}
                        onChange={(e) => setPaidAmount(Number(e.target.value))}
                        className="w-full p-4 bg-surface-muted border-none rounded-xl focus:ring-2 focus:ring-brand font-black text-2xl text-center tabular-nums"
                        dir="ltr"
                        min="0"
                        max={totalAmount}
                      />
                    </div>

                  </div>

                  <div className="absolute bottom-0 right-0 left-0 p-4 md:p-6 bg-surface border-t border-border md:static md:mt-8 md:mb-4 md:border-none md:p-0">
                    <div className="hidden md:block">
                      <div className="flex justify-between items-center mb-2 px-1 text-content-muted">
                        <span>الإجمالي المطلوب:</span>
                        <span className="font-bold text-content line-through opacity-70"><PriceDisplay amount={totalAmount + calculatedDiscountAmount} /></span>
                      </div>
                      {calculatedDiscountAmount > 0 && (
                        <div className="flex justify-between items-center mb-2 px-1 text-red-500 font-bold">
                          <span>الخصم:</span>
                          <span>-<PriceDisplay amount={calculatedDiscountAmount} /></span>
                        </div>
                      )}
                      <div className="flex justify-between items-center bg-surface-muted p-4 rounded-2xl border border-border mb-4">
                        <span className="font-bold text-content">الصافي:</span>
                        <span className="font-black text-2xl text-brand"><PriceDisplay amount={totalAmount} /></span>
                      </div>
                    </div>
                    
                    <div className="md:hidden flex justify-between items-center mb-4">
                        <div className="flex flex-col">
                            <span className="text-[10px] text-content-muted font-bold uppercase">الصافي للدفع</span>
                            <span className="text-xl font-black text-brand"><PriceDisplay amount={totalAmount} /></span>
                        </div>
                        {totalAmount - paidAmount > 0 && (
                            <div className="flex flex-col items-end">
                                <span className="text-[10px] text-red-500 font-bold uppercase">المتبقي</span>
                                <span className="text-lg font-bold text-red-600"><PriceDisplay amount={totalAmount - paidAmount} /></span>
                            </div>
                        )}
                    </div>

                    <button
                      onClick={handleCheckout}
                      disabled={loading}
                      className="w-full py-4 bg-brand text-white rounded-xl md:rounded-2xl font-black text-lg hover:bg-brand/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg active:scale-95"
                    >
                      {loading ? 'جاري التنفيذ...' : (
                        <>
                          <CheckCircle2 size={24} />
                          إصدار الفاتورة
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>

      {/* Cash Drawer Details Modal */}
      <AnimatePresence>
        {showCashDrawerDetails && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md overflow-y-auto font-sans">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="relative w-full max-w-md rounded-[2.5rem] bg-surface shadow-2xl flex flex-col my-auto border border-border overflow-hidden text-right"
              dir="rtl"
            >
              {/* Header */}
              <div className="sticky top-0 z-10 flex items-center justify-between p-6 border-b border-border bg-surface shrink-0 bg-brand/5">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-brand/10 text-brand rounded-2xl shrink-0 shadow-sm">
                    <Wallet size={24} />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-content">تدفق نقدية الصندوق</h2>
                    <p className="text-xs font-bold text-content-muted mt-0.5">تفاصيل وحالة نقدية الوردية الحالية</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowCashDrawerDetails(false)} 
                  className="p-2 hover:bg-surface-muted rounded-full transition-colors text-content-muted"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Body */}
              <div className="p-6 space-y-6">
                {/* Employee / Shift info */}
                <div className="flex justify-between items-center text-xs font-bold text-content-muted bg-surface-muted/35 px-4 py-2.5 rounded-xl border border-border">
                  <span>الموظف: <span className="text-content font-extrabold">{currentStaff?.name || 'غير معروف'}</span></span>
                  <span>رقم الوردية: <span className="font-mono text-content font-extrabold">#{shiftId?.slice(-6).toUpperCase()}</span></span>
                </div>

                {/* Main Cash Drawer Indicator */}
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-3xl p-5 text-center space-y-2">
                  <span className="text-xs font-black text-emerald-600 block uppercase tracking-widest">
                    صافي النقدية المتوقعة بالصندوق (كاش)
                  </span>
                  <div className="text-3xl font-black text-emerald-500 tracking-tight">
                    <PriceDisplay amount={cashDrawerBalance} />
                  </div>
                  <p className="text-[10px] text-content-muted">
                    * هذا المبلغ يمثل الرصيد المسجل بالإضافة للمبيعات والإيداعات مخصوماً منه المصروفات والمرتجعات.
                  </p>
                </div>

                {/* Operations Breakdown Grid */}
                <div className="space-y-3.5">
                  <h3 className="text-xs font-black text-content-muted uppercase tracking-widest">تفاصيل التدفق المالي</h3>
                  
                  <div className="grid grid-cols-1 gap-3">
                    {/* Opening Balance */}
                    <div className="flex items-center justify-between p-3.5 bg-surface-muted/30 border border-border rounded-2xl">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 bg-blue-500/10 text-blue-500 rounded-xl">
                          <Coins size={18} />
                        </div>
                        <span className="text-xs font-bold text-content">الرصيد الافتتاحي</span>
                      </div>
                      <span className="text-sm font-black text-content">
                        <PriceDisplay amount={cashDrawerBreakdown.opening} />
                      </span>
                    </div>

                    {/* Cash Sales */}
                    <div className="flex items-center justify-between p-3.5 bg-surface-muted/30 border border-border rounded-2xl">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-xl">
                          <TrendingUp size={18} />
                        </div>
                        <span className="text-xs font-bold text-content">مبيعات كاش</span>
                      </div>
                      <span className="text-sm font-black text-emerald-500">
                        + <PriceDisplay amount={cashDrawerBreakdown.sales} />
                      </span>
                    </div>

                    {/* Cash Deposits */}
                    {cashDrawerBreakdown.deposits > 0 && (
                      <div className="flex items-center justify-between p-3.5 bg-surface-muted/30 border border-border rounded-2xl">
                        <div className="flex items-center gap-2.5">
                          <div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-xl">
                            <Plus size={18} />
                          </div>
                          <span className="text-xs font-bold text-content">عمليات الإيداع كاش</span>
                        </div>
                        <span className="text-sm font-black text-emerald-500">
                          + <PriceDisplay amount={cashDrawerBreakdown.deposits} />
                        </span>
                      </div>
                    )}

                    {/* Cash Returns (Subtracted) */}
                    {cashDrawerBreakdown.returns > 0 && (
                      <div className="flex items-center justify-between p-3.5 bg-surface-muted/30 border border-border rounded-2xl">
                        <div className="flex items-center gap-2.5">
                          <div className="p-2 bg-red-500/10 text-red-500 rounded-xl">
                            <TrendingDown size={18} />
                          </div>
                          <span className="text-xs font-bold text-content">مرتجعات مبيعات (كاش)</span>
                        </div>
                        <span className="text-sm font-black text-red-500">
                          - <PriceDisplay amount={cashDrawerBreakdown.returns} />
                        </span>
                      </div>
                    )}

                    {/* Cash Withdrawals / Expenditures */}
                    {cashDrawerBreakdown.withdrawals > 0 && (
                      <div className="flex items-center justify-between p-3.5 bg-surface-muted/30 border border-border rounded-2xl">
                        <div className="flex items-center gap-2.5">
                          <div className="p-2 bg-red-500/10 text-red-500 rounded-xl">
                            <X size={18} />
                          </div>
                          <span className="text-xs font-bold text-content">المصروفات والمسحوبات</span>
                        </div>
                        <span className="text-sm font-black text-red-500">
                          - <PriceDisplay amount={cashDrawerBreakdown.withdrawals} />
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      fetchCashDrawerBalance();
                      toastSuccess('تم تحديث نقدية الصندوق فورا');
                    }}
                    className="flex-1 py-3 bg-surface border border-border text-content hover:bg-surface-muted rounded-xl transition-all font-bold text-xs sm:text-sm text-center flex items-center justify-center gap-2 active:scale-95"
                  >
                    <Coins size={16} />
                    <span>تحديث البيانات</span>
                  </button>
                  <button
                    onClick={() => setShowCashDrawerDetails(false)}
                    className="flex-1 py-3 bg-brand text-white hover:bg-brand/90 rounded-xl transition-all font-bold text-xs sm:text-sm text-center active:scale-95"
                  >
                    إغلاق النافذة
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Custom Order Modal Refactored to Bottom Sheet */}
      <AnimatePresence>
        {isCustomOrderModalOpen && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto font-sans">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="relative w-full max-w-[clamp(320px,94vw,1100px)] max-h-[90vh] rounded-[var(--radius-card)] bg-[var(--surface)] shadow-2xl flex flex-col my-auto border border-border z-10 overflow-hidden" 
              dir="rtl"
            >
              {/* Header (Fixed) */}
              <div className="sticky top-0 z-10 flex items-center justify-between p-4 sm:p-6 border-b border-[var(--border)] bg-[var(--surface)] shrink-0 bg-brand/5">
                <h2 className="text-base sm:text-lg lg:text-xl font-black text-content flex items-center gap-3">
                  <div className="p-2.5 bg-brand text-white rounded-2xl shrink-0 shadow-sm">
                    <Scissors size={20} />
                  </div>
                  تفصيل جديد
                </h2>
                <button onClick={() => setIsCustomOrderModalOpen(false)} className="p-2 hover:bg-surface-muted rounded-full transition-colors shadow-sm text-content-muted">
                  <X size={20} />
                </button>
              </div>
              
              {/* Body (Scrollable) */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                  <div>
                    <label className="block text-xs sm:text-sm font-black text-content-muted uppercase tracking-widest mb-2">نوع الثوب</label>
                    <input 
                      type="text" 
                      value={customItemForm.garmentType}
                      onChange={(e) => setCustomItemForm({...customItemForm, garmentType: e.target.value})}
                      className="w-full p-2.5 sm:p-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-brand focus:border-brand text-sm sm:text-base text-content" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs sm:text-sm font-black text-content-muted uppercase tracking-widest mb-2">السعر</label>
                    <input 
                      type="number" 
                      value={customItemForm.price}
                      onChange={(e) => setCustomItemForm({...customItemForm, price: Number(e.target.value)})}
                      className="w-full p-2.5 sm:p-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-brand focus:border-brand text-sm sm:text-base text-content" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs sm:text-sm font-black text-content-muted uppercase tracking-widest mb-2">القماش</label>
                    <SmartSelect 
                      value={customItemForm.fabricId}
                      onChange={(val) => {
                        const fabric = inventory.find(i => i.id === val);
                        setCustomItemForm({
                          ...customItemForm, 
                          fabricId: val,
                          fabric: fabric?.name || ''
                        });
                      }}
                      className="w-full"
                      options={[
                        { value: '', label: 'اختر قماش...' },
                        ...inventory.filter(i => i.category === 'fabric').map(item => ({ value: item.id, label: `${item.name} (${item.quantity} ${item.unit})` })),
                        { value: 'custom', label: 'قماش خارجي' }
                      ]}
                    />
                  </div>
                  <div>
                    <label className="block text-xs sm:text-sm font-black text-content-muted uppercase tracking-widest mb-2">الكمية</label>
                    <input 
                      type="number" 
                      value={customItemForm.quantity}
                      onChange={(e) => setCustomItemForm({...customItemForm, quantity: Number(e.target.value)})}
                      className="w-full p-2.5 sm:p-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-brand focus:border-brand text-sm sm:text-base text-content" 
                      min="1"
                    />
                  </div>
                </div>

                {selectedCustomer && (
                  <div className="bg-brand/5 p-4 rounded-xl border border-brand/10 space-y-4">
                    <div className="flex items-center gap-2 text-brand mb-2">
                      <Ruler size={18} />
                      <h4 className="font-bold text-sm">مقاسات العميل المحددة</h4>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { label: 'الطول', value: selectedCustomer.measurements?.length },
                        { label: 'الكتف', value: selectedCustomer.measurements?.shoulder },
                        { label: 'الصدر', value: selectedCustomer.measurements?.chest },
                        { label: 'الكم', value: selectedCustomer.measurements?.sleeve },
                      ].map((m) => (
                        <div key={m.label} className="bg-surface p-2 rounded-lg border border-brand/10 text-center">
                          <p className="text-[10px] text-content-muted">{m.label}</p>
                          <p className="text-sm font-bold text-brand">{m.value || '-'}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-content-muted mt-2 flex items-center gap-1">
                      <Zap size={12} />
                      سيتم إرفاق المقاسات الحالية للعميل مع هذا الطلب تلقائياً.
                    </p>
                  </div>
                )}

                <div className="space-y-4 border-t border-border pt-6">
                  <h4 className="text-xs sm:text-sm font-black text-content-muted uppercase tracking-widest flex items-center gap-2">
                    <Zap size={16} />
                    التفاصيل البصرية والمقاسات التفاعلية
                  </h4>
                  <VisualMeasurements 
                    values={customMeasurements} 
                    onChange={(field, val) => setCustomMeasurements({...customMeasurements, [field]: val})} 
                  />
                  
                  <div className="mt-8 pt-8 border-t border-border">
                    <h3 className="text-sm font-black text-content flex items-center gap-2 mb-4">
                      <div className="w-1.5 h-4 bg-brand rounded-full" />
                      مُحدد المقاسات البصري التفاعلي
                    </h3>
                    <ThobeMeasurementSelector 
                      values={customMeasurements.thobeMeasurements || {
                        collar: 0,
                        chest: 0,
                        shoulders: 0,
                        sleeves: 0,
                        length: 0,
                        bottomWidth: 0
                      }}
                      onChange={(newMeasurements) => setCustomMeasurements({...customMeasurements, thobeMeasurements: newMeasurements})}
                    />
                  </div>
                </div>
              </div>

              {/* Footer (Fixed) */}
              <div className="sticky bottom-0 z-10 p-4 sm:p-6 border-t border-[var(--border)] bg-[var(--surface)] shrink-0">
                <button
                  onClick={handleAddCustomItem}
                  className="w-full py-3 sm:py-3.5 bg-brand text-white rounded-xl font-bold hover:bg-brand/90 transition-all shadow-lg shadow-brand/20 flex items-center justify-center gap-2 text-sm sm:text-base cursor-pointer"
                >
                  <Plus size={18} />
                  إضافة للسلة
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Customer Modal Refactored to Bottom Sheet */}
      <Transition appear show={isAddCustomerModalOpen} as={React.Fragment}>
        <Dialog as="div" className="relative z-50 flex items-end sm:items-center justify-center" onClose={() => setIsAddCustomerModalOpen(false)}>
          <Transition.Child
            as={React.Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto pt-20 md:pt-0">
            <div className="flex min-h-full items-end sm:items-center justify-center sm:p-4 text-center">
              <Transition.Child
                as={React.Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 translate-y-full sm:translate-y-0 sm:scale-95"
                enterTo="opacity-100 translate-y-0 sm:scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 translate-y-0 sm:scale-100"
                leaveTo="opacity-0 translate-y-full sm:translate-y-0 sm:scale-95"
              >
                <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-t-3xl sm:rounded-3xl bg-white p-6 text-right align-middle shadow-2xl transition-all border border-border">
                  <Dialog.Title
                    as="h3"
                    className="text-lg font-bold leading-6 text-gray-900 mb-4 flex items-center justify-between"
                  >
                    إضافة عميل جديد
                    <button title="Close" onClick={() => setIsAddCustomerModalOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                      <X size={20} />
                    </button>
                  </Dialog.Title>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">اسم العميل <span className="text-red-500">*</span></label>
                      <input 
                        type="text" 
                        value={newCustomerName}
                        onChange={(e) => setNewCustomerName(e.target.value)}
                        className="w-full p-2.5 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-brand focus:border-brand" 
                        placeholder="محمد عبدالله"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">رقم الجوال <span className="text-red-500">*</span></label>
                      <input 
                        type="tel" 
                        value={newCustomerPhone}
                        onChange={(e) => setNewCustomerPhone(e.target.value)}
                        className="w-full p-2.5 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-brand focus:border-brand text-right" 
                        placeholder="05XXXXXXXX"
                        dir="ltr"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">الرقم الضريبي <span className="text-gray-400 text-xs font-normal">(للأعمال B2B)</span></label>
                      <input 
                        type="text" 
                        value={newCustomerVat}
                        onChange={(e) => setNewCustomerVat(e.target.value)}
                        className="w-full p-2.5 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-brand focus:border-brand" 
                        placeholder="اختياري (سيعتبر العميل شركة)"
                      />
                    </div>
                  </div>

                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      type="button"
                      className="px-4 py-2 font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
                      onClick={() => setIsAddCustomerModalOpen(false)}
                    >
                      إلغاء
                    </button>
                    <button
                      type="button"
                      disabled={isSavingCustomer || !newCustomerName || !newCustomerPhone}
                      className="px-4 py-2 font-medium text-white bg-brand hover:bg-brand/90 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm"
                      onClick={handleSaveCustomer}
                    >
                      {isSavingCustomer ? 'جاري الحفظ...' : 'حفظ العميل'}
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>

      {/* Hidden Invoice to Print */}
      {completedOrder && (
        <div id="pos-invoice-print-area" className="fixed top-[100%] left-[100%] w-[800px] -z-50 pointer-events-none bg-white font-sans text-black print:static print:w-full print:block print:max-w-none print:m-0 print:p-0" dir="rtl">
          
          {/* B2C Simplified Invoice */}
          {completedOrder.invoiceType === 'simplified_b2c' && (
            <div className="p-8 print:p-0">
              <div className="text-center mb-6 pb-4 border-b-2 border-black">
                <h2 className="text-2xl font-bold print:text-xl mb-1">فاتورة ضريبية مبسطة</h2>
                <h3 className="text-xl font-bold print:text-lg mb-3">Simplified Tax Invoice</h3>
                
                <div className="text-sm print:text-sm space-y-1">
                  <p className="font-bold text-lg print:text-base">{brandingSettings?.storeName || 'المتجر'}</p>
                  <p>الرقم الضريبي | VAT No: {taxSettings?.trn || '300000000000003'}</p>
                </div>
              </div>

              <div className="flex justify-between items-center mb-4 text-sm print:text-sm border-b-2 border-black pb-4">
                <div>
                  <p className="font-bold mb-1">رقم الفاتورة | Invoice No</p>
                  <p>{completedOrder.invoiceNumber}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold mb-1">تاريخ الإصدار | Issue Date</p>
                  <p dir="ltr">{new Date(completedOrder.issuedAt).toLocaleString('en-GB')}</p>
                </div>
              </div>

              <div className="overflow-x-auto whitespace-nowrap scrollbar-hide print:overflow-visible print:whitespace-normal mb-4">
                <table className="w-full text-sm print:text-xs min-w-max border-b-2 border-black pb-4">
                <thead>
                  <tr className="border-b-[1.5px] border-black">
                    <th className="py-2 text-right">المنتج<br/>Item</th>
                    <th className="py-2 text-center">السعر<br/>Price</th>
                    <th className="py-2 text-center">الكمية<br/>Qty</th>
                    <th className="py-2 text-left">الإجمالي<br/>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {completedOrder.items?.map((item: any, idx: number) => {
                    const lineTotal = item.quantity * item.price;
                    return (
                      <tr key={idx} className="border-b border-gray-200">
                        <td className="py-2 font-bold">{item.name}</td>
                        <td className="py-2 text-center tabular-nums">{item.price.toFixed(2)}</td>
                        <td className="py-2 text-center tabular-nums">{item.quantity}</td>
                        <td className="py-2 text-left tabular-nums">{lineTotal.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>

              {/* Unified Totals Section */}
              <div className="space-y-2 text-sm print:text-sm border-b-2 border-black pb-4 mb-4">
                <div className="flex justify-between items-center">
                  <div>
                    <span className="block font-bold">الإجمالي (غير شامل الضريبة)</span>
                    <span className="block text-gray-800 text-[10px] text-left" dir="ltr">Total (Excluding VAT)</span>
                  </div>
                  <span className="tabular-nums font-bold">{Number(completedOrder.subTotal).toFixed(2)}</span>
                </div>
                
                <div className="flex justify-between items-center">
                  <div>
                    <span className="block font-bold">الخصم</span>
                    <span className="block text-gray-800 text-[10px] text-left" dir="ltr">Discount</span>
                  </div>
                  <span className="tabular-nums font-bold">{Number(completedOrder.discountAmount).toFixed(2)}</span>
                </div>

                <div className="flex justify-between items-center">
                  <div>
                    <span className="block font-bold">الإجمالي الخاضع للضريبة</span>
                    <span className="block text-gray-800 text-[10px] text-left" dir="ltr">Total Taxable Amount</span>
                  </div>
                  <span className="tabular-nums font-bold">{(Number(completedOrder.subTotal) - Number(completedOrder.discountAmount)).toFixed(2)}</span>
                </div>

                <div className="flex justify-between items-center">
                  <div>
                    <span className="block font-bold">مجموع ضريبة القيمة المضافة (15%)</span>
                    <span className="block text-gray-800 text-[10px] text-left" dir="ltr">Total VAT (15%)</span>
                  </div>
                  <span className="tabular-nums font-bold">{Number(completedOrder.taxAmount).toFixed(2)}</span>
                </div>

                <div className="flex justify-between items-center mt-3 pt-3 border-t-[1.5px] border-black text-base print:text-base">
                  <div>
                    <span className="block font-black">الإجمالي (شامل الضريبة)</span>
                    <span className="block text-black text-xs font-bold text-left" dir="ltr">Grand Total (Inc VAT)</span>
                  </div>
                  <span className="tabular-nums font-black">{Number(completedOrder.total).toFixed(2)}</span>
                </div>
              </div>

              {completedOrder.qrCode && (
                <div className="flex justify-center mb-6">
                  <QRCodeSVG 
                    value={completedOrder.qrCode} 
                    size={140} 
                    level="M"
                    includeMargin={true}
                  />
                </div>
              )}
            </div>
          )}

          {/* B2B Standard Invoice */}
          {completedOrder.invoiceType === 'standard_b2b' && (
            <div className="p-8 print:p-8">
               <div className="text-center mb-8 pb-6 border-b-2 border-black">
                <h2 className="text-3xl font-bold mb-1">فاتورة ضريبية</h2>
                <h3 className="text-2xl font-bold text-gray-800">Tax Invoice</h3>
              </div>

              <div className="grid grid-cols-2 gap-8 mb-8">
                {/* Seller */}
                <div className="space-y-3">
                  <div className="bg-gray-100 p-2 text-center font-bold print:bg-gray-200">المورد | Seller</div>
                  <div className="space-y-1 text-sm print:text-base">
                    <div><span className="font-bold">الاسم | Name:</span> {brandingSettings?.storeName || 'المتجر'}</div>
                    <div><span className="font-bold">الرقم الضريبي | VAT No:</span> {taxSettings?.trn || '300000000000003'}</div>
                  </div>
                </div>
                
                {/* Buyer */}
                <div className="space-y-3">
                  <div className="bg-gray-100 p-2 text-center font-bold print:bg-gray-200">العميل | Buyer</div>
                  <div className="space-y-1 text-sm print:text-base">
                    <div><span className="font-bold">الاسم | Name:</span> {completedOrder.b2bCompanyName || completedOrder.customerName}</div>
                    <div><span className="font-bold">الرقم الضريبي | VAT No:</span> {completedOrder.b2bTRN || completedOrder.customerVat || b2bData.trn}</div>
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center mb-8 text-sm print:text-base border-y-2 border-black py-4">
                <div>
                  <p className="font-bold mb-1">رقم الفاتورة | Invoice No</p>
                  <p>{completedOrder.invoiceNumber}</p>
                </div>
                <div>
                  <p className="font-bold mb-1">تاريخ الإصدار | Issue Date</p>
                  <p dir="ltr">{new Date(completedOrder.issuedAt).toLocaleString('en-GB')}</p>
                </div>
                <div className="text-left">
                  <p className="font-bold mb-1">تاريخ التوريد | Date of Supply</p>
                  <p dir="ltr">{new Date(completedOrder.issuedAt).toLocaleString('en-GB')}</p>
                </div>
              </div>

              <div className="overflow-x-auto whitespace-nowrap scrollbar-hide print:overflow-visible print:whitespace-normal mb-8">
                <table className="w-full text-sm print:text-base min-w-max border-b-2 border-black pb-4">
                <thead>
                  <tr className="border-b-2 border-black bg-gray-50 print:bg-gray-100">
                    <th className="py-3 px-2 text-right">المنتج<br/>Item</th>
                    <th className="py-3 px-2 text-center">سعر الوحدة<br/>Unit Price</th>
                    <th className="py-3 px-2 text-center">الكمية<br/>Qty</th>
                    <th className="py-3 px-2 text-center">المبلغ الخاضع للضريبة<br/>Taxable Amt</th>
                    <th className="py-3 px-2 text-center">نسبة الضريبة<br/>VAT Rate</th>
                    <th className="py-3 px-2 text-center">مبلغ الضريبة<br/>VAT Amt</th>
                    <th className="py-3 px-2 text-left">المجموع (شامل الضريبة)<br/>Total (Inc. VAT)</th>
                  </tr>
                </thead>
                <tbody>
                  {completedOrder.items?.map((item: any, idx: number) => {
                    const vatRate = completedOrder.taxRate || 15;
                    const priceExcludingVat = item.price / (1 + (vatRate / 100));
                    const taxableAmount = priceExcludingVat * item.quantity;
                    const vatAmount = taxableAmount * (vatRate / 100);
                    const lineTotal = item.quantity * item.price;

                    return (
                      <tr key={idx} className="border-b border-gray-200">
                        <td className="py-3 px-2 font-bold">{item.name}</td>
                        <td className="py-3 px-2 text-center tabular-nums">{priceExcludingVat.toFixed(2)}</td>
                        <td className="py-3 px-2 text-center tabular-nums">{item.quantity}</td>
                        <td className="py-3 px-2 text-center tabular-nums">{taxableAmount.toFixed(2)}</td>
                        <td className="py-3 px-2 text-center tabular-nums">{vatRate}%</td>
                        <td className="py-3 px-2 text-center tabular-nums">{vatAmount.toFixed(2)}</td>
                        <td className="py-3 px-2 text-left tabular-nums">{lineTotal.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>

              <div className="grid grid-cols-2 gap-8 mb-8">
                <div>
                   {completedOrder.qrCode && (
                     <div className="flex justify-center mt-4">
                       <QRCodeSVG 
                         value={completedOrder.qrCode} 
                         size={200} 
                         level="M"
                         includeMargin={true}
                       />
                     </div>
                   )}
                </div>
                
                {/* Unified Totals Section */}
                <div className="space-y-3 text-sm print:text-base h-fit border-2 border-black p-4 bg-gray-50 print:bg-transparent">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="block font-bold">الإجمالي (غير شامل الضريبة)</span>
                      <span className="block text-gray-600 text-xs text-left" dir="ltr">Total (Excluding VAT)</span>
                    </div>
                    <span className="tabular-nums font-bold">{Number(completedOrder.subTotal).toFixed(2)}</span>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="block font-bold">الخصم</span>
                      <span className="block text-gray-600 text-xs text-left" dir="ltr">Discount</span>
                    </div>
                    <span className="tabular-nums font-bold">{Number(completedOrder.discountAmount).toFixed(2)}</span>
                  </div>

                  <div className="flex justify-between items-center">
                    <div>
                      <span className="block font-bold">الإجمالي الخاضع للضريبة</span>
                      <span className="block text-gray-600 text-xs text-left" dir="ltr">Total Taxable Amount</span>
                    </div>
                    <span className="tabular-nums font-bold">{(Number(completedOrder.subTotal) - Number(completedOrder.discountAmount)).toFixed(2)}</span>
                  </div>

                  <div className="flex justify-between items-center">
                    <div>
                      <span className="block font-bold">مجموع ضريبة القيمة المضافة (15%)</span>
                      <span className="block text-gray-600 text-xs text-left" dir="ltr">Total VAT (15%)</span>
                    </div>
                    <span className="tabular-nums font-bold">{Number(completedOrder.taxAmount).toFixed(2)}</span>
                  </div>

                  <div className="flex justify-between items-center mt-4 pt-4 border-t-2 border-black text-lg print:text-xl bg-gray-200 print:bg-gray-100 -mx-4 -mb-4 p-4">
                    <div>
                      <span className="block font-black">الإجمالي (شامل الضريبة)</span>
                      <span className="block text-gray-800 text-sm font-bold text-left" dir="ltr">Grand Total (Including VAT)</span>
                    </div>
                    <span className="tabular-nums font-black">{Number(completedOrder.total).toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* B2B Data Modal */}
      <Dialog open={isB2bModalOpen} onClose={() => setIsB2bModalOpen(false)} className="relative z-[100]" dir="rtl">
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="w-full max-w-md bg-surface p-6 rounded-2xl shadow-xl border border-border">
            <div className="flex justify-between items-center mb-6">
              <Dialog.Title className="text-xl font-bold text-content">بيانات الفاتورة الضريبية (B2B)</Dialog.Title>
              <button onClick={() => setIsB2bModalOpen(false)} className="p-2 hover:bg-surface-muted rounded-full">
                <X size={20} />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-content mb-2">اسم الشركة <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  placeholder="مثال: شركة وضوح الشاملة"
                  value={b2bData.companyName}
                  onChange={e => setB2bData({...b2bData, companyName: e.target.value})}
                  className="w-full p-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-brand"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-content mb-2">الرقم الضريبي <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  placeholder="300000000000003"
                  value={b2bData.trn}
                  onChange={e => setB2bData({...b2bData, trn: e.target.value})}
                  className="w-full p-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-brand"
                />
              </div>
            </div>

            <div className="mt-8 flex gap-3">
              <button
                onClick={() => setIsB2bModalOpen(false)}
                className="flex-1 py-3 bg-brand text-white font-bold rounded-xl hover:bg-brand/90 transition-colors"
                disabled={!b2bData.companyName || !b2bData.trn}
              >
                تحديث ومتابعة
              </button>
              <button
                onClick={() => {
                  if (!b2bData.companyName || !b2bData.trn) {
                    setIsB2B(false);
                    setB2bData({ companyName: '', trn: '' });
                  }
                  setIsB2bModalOpen(false);
                }}
                className="py-3 px-6 bg-surface-muted text-content font-bold rounded-xl hover:bg-border transition-colors"
              >
                إلغاء
              </button>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>

    </div>
  );
}
