import { ThermalInvoice, StandardInvoice, InvoiceData } from "./printing/InvoiceReceipt";
import React, { useState, useEffect, useCallback } from 'react';
import { formatSaudiPhone } from '../utils/phoneUtils';
import { flushSync } from 'react-dom';
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
import { adjustStock } from '../services/inventoryService';
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
import ScannerModal from './ScannerModal';

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
  const [customerUnpaidBalance, setCustomerUnpaidBalance] = useState<number>(0);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [isCustomOrderModalOpen, setIsCustomOrderModalOpen] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
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
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

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
  
  // Settings
  const [isAutoPrintEnabled, setIsAutoPrintEnabled] = useState(() => {
    return localStorage.getItem('pos_auto_print') === 'true';
  });

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
          setTaxSettings(resolvedTax);
        }
      } catch (error) {
        console.error('Error fetching POS data:', error);
      }
    };
    fetchData();
  }, [tenantId, mapCustomer, mapInventoryItem, refreshCounter]);

  useEffect(() => {
    if (!selectedCustomer) {
      setCustomerUnpaidBalance(0);
      return;
    }

    const fetchCustomerUnpaidBalance = async () => {
      try {
        const { data, error } = await supabase
          .from('orders')
          .select('remaining_amount')
          .eq('customer_id', selectedCustomer.id)
          .neq('status', 'cancelled');
        
        if (error) throw error;
        
        const total = (data || []).reduce((sum, order) => sum + (Number(order.remaining_amount) || 0), 0);
        setCustomerUnpaidBalance(total);
      } catch (err) {
        console.error('Error fetching customer unpaid balance:', err);
      }
    };

    fetchCustomerUnpaidBalance();
  }, [selectedCustomer, isPaymentModalOpen, refreshCounter]);

  // Sync state values to refs to avoid stale closure issues in global shortcut event listeners
  const cartRef = React.useRef(cart);
  const isPaymentModalOpenRef = React.useRef(isPaymentModalOpen);
  const completedOrderRef = React.useRef(completedOrder);
  const totalAmountRef = React.useRef<number>(0);
  const loadingRef = React.useRef(loading);
  const handleCheckoutRef = React.useRef<any>(null);

  cartRef.current = cart;
  isPaymentModalOpenRef.current = isPaymentModalOpen;
  completedOrderRef.current = completedOrder;
  loadingRef.current = loading;

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. Show Keyboard Shortcuts with F1 or Ctrl+/
      if (e.key === 'F1' || (e.ctrlKey && e.key === '/')) {
        e.preventDefault();
        setIsShortcutsModalOpen(prev => !prev);
        return;
      }

      // 2. Focus search input with F3 or Ctrl+F
      if (e.key === 'F3' || (e.ctrlKey && e.key.toLowerCase() === 'f')) {
        e.preventDefault();
        if (searchInputRef.current) {
          searchInputRef.current.focus();
          searchInputRef.current.select();
        }
        return;
      }

      // 3. Open Payment Modal with F8 or Ctrl+Enter
      if ((e.key === 'F8' || (e.ctrlKey && e.key === 'Enter')) && !isPaymentModalOpenRef.current && !completedOrderRef.current && cartRef.current.length > 0) {
        e.preventDefault();
        setIsPaymentModalOpen(true);
        setPaidAmount(totalAmountRef.current);
        return;
      }

      // 4. Complete Payment with F9 when payment modal is open
      if (e.key === 'F9' && isPaymentModalOpenRef.current && !completedOrderRef.current && !loadingRef.current) {
        e.preventDefault();
        if (handleCheckoutRef.current) {
          handleCheckoutRef.current();
        }
        return;
      }

      // 5. Change payment method inside payment modal: Ctrl+1 (Cash), Ctrl+2 (Card)
      if (e.ctrlKey && isPaymentModalOpenRef.current && !completedOrderRef.current) {
        if (e.key === '1') {
          e.preventDefault();
          setPaymentMethod('cash');
          return;
        }
        if (e.key === '2') {
          e.preventDefault();
          setPaymentMethod('network');
          return;
        }
      }

      // 6. Print receipt with Ctrl+P (if completedOrder is set)
      // نمر عبر محرك الطباعة الموحّد بدل window.print() حتى يخرج الاختصار
      // بنفس شكل وهوامش زر الطباعة تماماً.
      if (e.ctrlKey && e.key.toLowerCase() === 'p') {
        if (completedOrderRef.current) {
          e.preventDefault();
          void (async () => {
            try {
              const { printElementDetailed, getConfiguredPaperSize } = await import(
                '../utils/printManager'
              );
              const res = await printElementDetailed('pos-invoice-print-area', {
                paperSize:
                  (completedOrderRef.current as any)?.invoiceType === 'standard_b2b'
                    ? 'A4'
                    : getConfiguredPaperSize('80mm'),
                title: 'إيصال فاتورة',
              });
              if (!res.ok) {
                // لا نكتفي بالـ console: مع الطباعة الصامتة قد لا تُفتح نافذة
                // طباعة إطلاقاً، فيبقى الكاشير بلا ورق وبلا أي إشعار.
                console.error('[POS] فشل الطباعة السريعة:', res.message);
                toastError('تعذّرت الطباعة', res.message);
              }
            } catch (err) {
              console.error('[POS] خطأ الطباعة السريعة:', err);
              window.print();
            }
          })();
          return;
        }
      }

      // 7. Clear cart with F4
      if (e.key === 'F4' && !isPaymentModalOpenRef.current && !completedOrderRef.current) {
        e.preventDefault();
        if (cartRef.current.length > 0) {
          if (confirm('هل أنت متأكد من رغبتك في إفراغ سلة المشتريات بالكامل؟')) {
            setCart([]);
          }
        }
        return;
      }

      // 8. Add custom tailor item with F7 or Ctrl+Shift+A
      if (e.key === 'F7' || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a')) {
        e.preventDefault();
        setIsCustomOrderModalOpen(true);
        return;
      }

      // 9. Close completed screen and start new order with F2 or Esc (when completedOrder is active)
      if ((e.key === 'F2' || e.key === 'Escape') && completedOrderRef.current) {
        e.preventDefault();
        setCompletedOrder(null);
        setIsPaymentModalOpen(false);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

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

  const handleScan = (decodedText: string) => {
    const item = inventory.find(i => i.barcode === decodedText || i.sku === decodedText);
    if (item) {
      addToCart(item);
      toastSuccess(t('pos.item_added_from_scan', 'تمت إضافة المنتج من الباركود'));
    } else {
      toastError(t('pos.item_not_found', 'لم يتم العثور على المنتج'));
    }
  };

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

  const handleAddCustomItem = async () => {
    if (!selectedCustomer) {
      toastError('خطأ', 'يجب اختيار العميل أولاً لطلبات التفصيل');
      return;
    }

    if (!customItemForm.garmentType || !customItemForm.price || customItemForm.price <= 0) {
      toastError('خطأ في البيانات', 'الرجاء إدخال نوع الثوب والسعر');
      return;
    }

    // Merge measurements: if the customer has existing measurements, and the user provided new ones, combine them
    const mergedMeasurements = {
      ...(selectedCustomer.measurements || {}),
      ...customMeasurements
    };

    // If there are measurements provided in the modal that weren't in the customer record, update the customer
    if (Object.keys(customMeasurements).length > 0) {
      try {
        await supabase
          .from('customers')
          .update({ measurements: mergedMeasurements })
          .eq('id', selectedCustomer.id);
        
        // Update local state so it reflects immediately
        setSelectedCustomer({
          ...selectedCustomer,
          measurements: mergedMeasurements
        });
      } catch (error) {
        console.error('Error updating customer measurements:', error);
      }
    }

    // Separate numeric measurements and styling fields
    const measurementKeys = ['neck', 'chest', 'waist', 'hips', 'shoulder', 'sleeve', 'length', 'bottomWidth'];
    
    const numericMeasurements: any = {};
    const stylingFields: any = {};

    for (const [key, value] of Object.entries(mergedMeasurements)) {
      if (measurementKeys.includes(key)) {
        numericMeasurements[key] = value;
      } else {
        stylingFields[key] = value;
      }
    }

    setCart(prev => [...prev, {
      id: Math.random().toString(36).substr(2, 9),
      ...customItemForm,
      ...stylingFields,
      measurements: numericMeasurements,
      type: 'custom',
      status: 'measurements_taken'
    } as any]);
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
          phone: formatSaudiPhone(newCustomerPhone),
          vat_number: newCustomerVat || null,
          company_name: newCustomerVat ? newCustomerName : null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
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

  const isTaxEnabled = taxSettings?.enabled ?? Boolean(taxSettings?.trn);
  const effectiveVatRate = isTaxEnabled ? ((Number(taxSettings?.vatRate ?? 15)) / 100) : 0;

  const subTotalAmount = cart.reduce((sum, item) => {
    const calc = calculateItemTax(item.price, (item.taxType as any) || 'exclusive', effectiveVatRate, item.quantity);
    return sum + calc.basePrice;
  }, 0);

  const taxAmountPerItem = cart.reduce((sum, item) => {
    const calc = calculateItemTax(item.price, (item.taxType as any) || 'exclusive', effectiveVatRate, item.quantity);
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
  const taxAmount = isTaxEnabled ? taxAmountPerItem * discountRatio : 0;
  const vatRate = isTaxEnabled ? Number(taxSettings?.vatRate ?? 15) : 0;
  const totalAmount = discountedSubtotal + taxAmount;
  totalAmountRef.current = totalAmount;

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
        val ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val) : false;

      const orderData = {
        order_number: orderNumber,
        customer_id: (selectedCustomer?.id && isUuid(selectedCustomer.id)) ? selectedCustomer.id : null,
        customer_name: selectedCustomer?.name || 'عميل نقدي',
        tenant_id: tenantId,
        shift_id: (shiftId && isUuid(shiftId)) ? shiftId : null,
        branch_id: (currentStaff?.branchId && isUuid(currentStaff.branchId)) ? currentStaff.branchId : null,
        total_amount: Number(totalAmount) >= 0 ? Number(totalAmount) : 0,
        paid_amount: Number(paidAmount) >= 0 ? Number(paidAmount) : 0,
        discount_amount: Number(calculatedDiscountAmount) >= 0 ? Number(calculatedDiscountAmount) : 0,
        payment_method: paymentMethod,
        status: orderStatus,
        order_date: timestamp,
        delivery_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        created_by: (currentStaff?.id && isUuid(currentStaff.id)) ? currentStaff.id : null,
        tax_amount: Number(taxAmount) >= 0 ? Number(taxAmount) : 0,
        tax_rate: 0.15,
        notes: encodeOrderB2BNotes(isB2B ? b2bCompanyName : '', isB2B ? b2bTRN : ''),
        qr_code: qrCodeBase64,
        created_at: timestamp,
        // For the supabase interceptor (Orders.tsx compat)
        items: cart,
        history: [{
          status: orderStatus,
          updatedAt: timestamp,
          updatedBy: currentStaff?.name || 'System',
          updatedByUid: currentStaff?.id || auth.currentUser?.uid,
          notes: 'إنشاء الطلب عبر نقطة البيع'
        }]
      };

      const { data: newOrder, error: orderError } = await supabase
        .from('orders')
        .insert(orderData)
        .select()
        .single();

      if (orderError) throw orderError;

      // Insert into order_items
      const VALID_INVENTORY_UNITS = ['meter', 'yard', 'roll', 'bolt', 'piece', 'spool', 'box'];
      const VALID_CLOSURE_TYPES = ['zipper', 'buttons'];
      const VALID_CLOSURE_VISIBILITIES = ['hidden', 'visible'];
      const VALID_COLLAR_PADDINGS = ['hard', 'soft'];

      const orderItemsData = cart.map(item => ({
        tenant_id: tenantId,
        order_id: newOrder.id,
        type: item.type,
        status: item.type === 'custom' ? orderStatus : null,
        item_id: (item.type === 'ready_made' && item.itemId && isUuid(item.itemId)) ? item.itemId : null,
        name: item.name || item.garmentType || 'منتج مخصص',
        garment_type: item.garmentType || null,
        fabric: item.fabric || null,
        fabric_id: (item.type === 'custom' && item.fabricId && isUuid(item.fabricId)) ? item.fabricId : null,
        quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
        selected_unit: (item.selectedUnit && VALID_INVENTORY_UNITS.includes(item.selectedUnit)) ? item.selectedUnit : null,
        consumed_meters: item.consumedMeters ? Number(item.consumedMeters) : null,
        price: Number(item.price) >= 0 ? Number(item.price) : 0,
        closure_type: (item.closureType && VALID_CLOSURE_TYPES.includes(item.closureType)) ? item.closureType : null,
        closure_visibility: (item.closureVisibility && VALID_CLOSURE_VISIBILITIES.includes(item.closureVisibility)) ? item.closureVisibility : null,
        collar_type: item.collarType || null,
        cuff_type: item.cuffType || null,
        pocket_type: item.pocketType || null,
        chest_style: item.chestStyle || null,
        collar_padding: (item.collarPadding && VALID_COLLAR_PADDINGS.includes(item.collarPadding)) ? item.collarPadding : null,
        additions: item.additions || null,
        embroidery: item.embroidery || null,
        measurements: (item as any).measurements || {}
      }));

      const { error: itemsError } = await supabase
        .from('order_items')
        .insert(orderItemsData);

      if (itemsError) throw itemsError;

      // Insert into order_history
      await supabase.from('order_history').insert({
        tenant_id: tenantId,
        order_id: newOrder.id,
        status: orderStatus,
        notes: 'إنشاء الطلب عبر نقطة البيع',
        updated_by_staff: (currentStaff?.id && isUuid(currentStaff.id)) ? currentStaff.id : null,
        updated_by_name: currentStaff?.name || 'System',
        updated_at: timestamp
      });

      // Generate Invoice entry
      const { error: invoiceError } = await supabase
        .from('tax_invoices')
        .insert({
          invoice_number: `INV-${orderNumber}`,
          order_id: newOrder.id,
          tenant_id: tenantId,
          customer_id: orderData.customer_id,
          customer_name: orderData.customer_name,
          subtotal: Number(subTotalAmount) >= 0 ? Number(subTotalAmount) : 0,
          tax_rate: 0.15,
          tax_amount: Number(taxAmount) >= 0 ? Number(taxAmount) : 0,
          discount_amount: Number(calculatedDiscountAmount) >= 0 ? Number(calculatedDiscountAmount) : 0,
          paid_amount: Number(paidAmount) >= 0 ? Number(paidAmount) : 0,
          total_amount: Number(totalAmount) >= 0 ? Number(totalAmount) : 0,
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
              quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1, 
              price: Number(item.price) >= 0 ? Number(item.price) : 0,
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
            try {
              await adjustStock({
                branchId,
                itemId: item.itemId,
                quantity: -item.quantity,
                reason: `بيع في نقطة البيع - فاتورة ${orderNumber}`,
                type: 'out',
                staffId: (currentStaff?.id && isUuid(currentStaff.id)) ? currentStaff.id : null,
                tenantId
              });
            } catch (stockError) {
              console.error('Stock adjustment error:', stockError);
            }
          }
        } else if (item.type === 'custom' && item.fabricId && item.fabricId !== 'custom' && isUuid(item.fabricId) && item.consumedMeters) {
          const branchId = currentStaff?.branchId || '';
          if (branchId) {
            try {
              await adjustStock({
                branchId,
                itemId: item.fabricId,
                quantity: -item.consumedMeters,
                reason: `استهلاك قماش تفصيل - فاتورة ${orderNumber}`,
                type: 'out',
                staffId: (currentStaff?.id && isUuid(currentStaff.id)) ? currentStaff.id : null,
                tenantId
              });
            } catch (stockError) {
              console.error('Fabric adjustment error:', stockError);
            }
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
         paymentMethod: paymentMethod,
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
      
      if (isAutoPrintEnabled) {
        flushSync(() => {
          // ensure state is flushed before printing
        });
        setTimeout(async () => {
          try {
            const { printElementDetailed } = await import('../utils/printManager');
            // الفاتورة الضريبية الكاملة (B2B) تُطبع على ورق A4، أما إيصال الكاشير
            // فيتبع حجم الورق المضبوط للطابعة الافتراضية في إعدادات الطابعة.
            const storedSize = (localStorage.getItem('active_printer_size') || '80mm') as
              | '80mm'
              | '58mm'
              | 'A4';
            const paperSize =
              invoiceData?.invoiceType === 'standard_b2b' ? 'A4' : storedSize;

            const res = await printElementDetailed('pos-invoice-print-area', {
              paperSize,
              title: 'فاتورة كاشير',
            });
            if (!res.ok) {
              console.error('Print failed in POS:', res.message);
              toastError('تعذّرت الطباعة', res.message);
            }
          } catch (printErr) {
            console.error('Print error in POS:', printErr);
            window.print();
          }
        }, 250);
      }
    } catch (error) {
      console.error('Checkout error:', error);
      handleError(error as any, 'فشل إتمام العملية');
    } finally {
      setLoading(false);
    }
  };
  handleCheckoutRef.current = handleCheckout;

  const renderCartPanel = (isMobilePanel: boolean = false) => {
    return (
      <div className="flex flex-col h-full bg-surface">
        {/* Cart Header */}
        <div className="p-4 sm:px-6 sm:py-5 border-b border-border flex items-center justify-between shrink-0 relative">
          <div className="flex items-center gap-2">
            {isMobilePanel && <div className="lg:hidden w-10 h-1 bg-border rounded-full absolute top-2 left-1/2 -translate-x-1/2" />}
            <ShoppingCart size={22} className="text-brand" />
            <h2 className="text-base lg:text-lg font-black text-content">
              {t('pos.cart_title', 'سلة المشتريات')}
            </h2>
            <span className="bg-brand/10 text-brand text-xs px-2.5 py-0.5 rounded-full font-black">{cart.length}</span>
          </div>
          {isMobilePanel && (
            <button 
              onClick={() => setShowCartOnMobile(false)}
              className="p-2 text-content-muted hover:bg-surface-muted rounded-full transition-all cursor-pointer"
            >
              <X size={20} />
            </button>
          )}
        </div>

        {/* Customer Selector */}
        <div className="p-4 sm:px-6 sm:py-5 border-b border-border space-y-3 z-30 shrink-0">
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
                  className="w-full p-2.5 bg-surface text-content border border-border rounded-xl focus:ring-2 focus:ring-brand focus:border-brand shadow-sm font-bold text-sm rtl:pr-9 ltr:pl-9"
                  placeholder={t('pos.search_customer', 'ابحث عن عميل...')}
                  displayValue={(person: Customer) => person?.name || ''}
                  onChange={(event) => setCustomerQuery(event.target.value)}
                />
                <Combobox.Button className="absolute inset-y-0 ltr:right-0 rtl:left-0 flex items-center px-3">
                  <User className="w-4 h-4 text-content-muted" aria-hidden="true" />
                </Combobox.Button>
                <Transition
                  as={React.Fragment}
                  leave="transition ease-in duration-100"
                  leaveFrom="opacity-100"
                  leaveTo="opacity-0"
                  afterLeave={() => setCustomerQuery('')}
                >
                  <Combobox.Options className="absolute mt-1 max-h-60 w-full overflow-auto rounded-xl bg-surface border border-border text-content py-1 shadow-xl ring-1 ring-black ring-opacity-5 focus:outline-none z-50">
                    <Combobox.Option
                      className={({ active }) =>
                        `relative cursor-pointer select-none py-2 px-4 ${
                          active ? 'bg-brand text-white' : 'text-content'
                        }`
                      }
                      value={null}
                    >
                      <span className="block truncate font-bold text-xs">{t('pos.walk_in_customer', 'عميل نقدي (بدون اسم)')}</span>
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
                            active ? 'bg-brand text-white' : 'text-content'
                          }`
                        }
                        value={person}
                      >
                        <span className="block truncate font-bold text-xs">{person.name}</span>
                        <span className="block text-[11px] opacity-80">{person.phone}</span>
                      </Combobox.Option>
                    ))}
                  </Combobox.Options>
                </Transition>
              </div>
            </Combobox>
            <button 
              onClick={() => setIsAddCustomerModalOpen(true)}
              className="p-2.5 bg-surface-muted border border-border rounded-xl text-content-muted hover:text-brand hover:border-brand/50 transition-all flex items-center justify-center shrink-0 cursor-pointer"
              title={t('pos.add_new_customer', 'إضافة عميل جديد')}
            >
              <UserPlus size={18} />
            </button>
          </div>
          {selectedCustomer && (
            <div className="p-3 bg-surface-muted border border-border rounded-xl space-y-1.5 text-xs">
              <div className="flex justify-between items-center text-content-muted">
                <span className="font-medium">{t('pos.customer_name', 'اسم العميل:')}</span>
                <span className="font-black text-content">{selectedCustomer.name}</span>
              </div>
              <div className="flex justify-between items-center text-content-muted">
                <span className="font-medium">{t('pos.customer_phone', 'رقم الجوال:')}</span>
                <span className="font-mono font-bold text-content">{selectedCustomer.phone}</span>
              </div>
              {customerUnpaidBalance > 0 ? (
                <div className="mt-2 p-2 bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 rounded-lg flex justify-between items-center font-bold">
                  <span>{t('pos.previous_due_balance', 'مستحقات سابقة على العميل:')}</span>
                  <span className="font-mono font-black text-sm text-red-700 dark:text-red-300">
                    <PriceDisplay amount={customerUnpaidBalance} />
                  </span>
                </div>
              ) : (
                <div className="mt-2 p-1.5 px-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-lg text-center font-bold text-[11px]">
                  {t('pos.no_previous_due', 'الحساب سليم (لا توجد مبالغ متبقية)')}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Cart Items List */}
        <div className="flex-1 overflow-auto p-4 sm:px-6 sm:py-5 space-y-3">
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
                      <span className="font-medium text-content line-clamp-1">
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
        <div className="p-4 sm:px-6 sm:py-5 border-t border-border bg-surface shadow-lg shrink-0">
          <div className="space-y-2 mb-4">
            <div className="flex justify-between items-center text-xs sm:text-sm">
              <span className="text-content-muted font-bold">{t('pos.subtotal', 'المجموع الفرعي')}</span>
              <span className="text-content font-black"><PriceDisplay amount={subTotalAmount} /></span>
            </div>
            
            {calculatedDiscountAmount > 0 && (
              <div className="flex justify-between items-center text-xs sm:text-sm text-brand font-bold">
                <span>{t('pos.discount_applied', 'الخصم المستقطع')}</span>
                <span className="font-black relative flex items-center">
                  -<PriceDisplay amount={calculatedDiscountAmount} className="inline-flex mr-1" />
                </span>
              </div>
            )}

            {isTaxEnabled && (
              <div className="flex justify-between items-center text-xs sm:text-sm">
                <span className="text-content-muted font-bold">{t('pos.vat', 'الضريبة')} ({vatRate}%)</span>
                <span className="text-content font-black"><PriceDisplay amount={taxAmount} /></span>
              </div>
            )}
          </div>
          
          <div className="flex justify-between items-center mb-4 pt-3 border-t border-border">
            <span className="text-content-muted font-black uppercase tracking-wider text-xs sm:text-sm">
              {t('pos.grand_total', 'الإجمالي')} {isTaxEnabled && t('pos.inclusive_vat', '(شامل الضريبة)')}
            </span>
            <span className="text-xl sm:text-2xl font-black text-brand"><PriceDisplay amount={totalAmount} /></span>
          </div>

          <button
            onClick={() => {
               setIsPaymentModalOpen(true);
               setPaidAmount(totalAmount);
            }}
            disabled={cart.length === 0}
            className="w-full py-3.5 sm:py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-black text-base sm:text-lg transition-all shadow-md shadow-emerald-600/10 active:scale-[0.98] disabled:opacity-50 disabled:grayscale disabled:scale-100 flex items-center justify-center gap-2.5 cursor-pointer"
          >
            <CreditCard size={22} />
            <span>{t('pos.checkout_and_pay', 'الدفع وإتمام الطلب')}</span>
          </button>
        </div>
      </div>
    );
  };

const invoiceData: InvoiceData | null = completedOrder ? {
  invoiceNumber: completedOrder.invoiceNumber,
  issueDate: completedOrder.issuedAt,
  paymentMethod: completedOrder.paymentMethod || 'cash',
  seller: {
    name: brandingSettings?.storeName || 'مؤسسة وضوح الشاملة',
    vatNumber: taxSettings?.trn || '300000000000003',
  },
  customer: {
    name: completedOrder.customerName || 'عميل نقدي',
    vatNumber: completedOrder.customerVat || undefined
  },
  items: completedOrder.items.map((item: any, index: number) => ({
    id: index,
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.price
  })),
  subtotal: completedOrder.subTotal,
  vatAmount: completedOrder.taxAmount,
  discountAmount: completedOrder.discountAmount,
  grandTotal: completedOrder.total,
  qrValue: completedOrder.qrCode,
  invoiceType: completedOrder.invoiceType
} : null;
  return (
    <div className="h-full flex flex-col lg:flex-row font-sans bg-background text-content overflow-hidden w-full" dir={isRtl ? 'rtl' : 'ltr'}>
      <ScannerModal isOpen={isScannerOpen} onClose={() => setIsScannerOpen(false)} onScan={handleScan} />
      {/* Main Pane (70% width on Desktop) */}
      <div className="w-full lg:w-[70%] flex flex-col gap-4 lg:gap-5 overflow-x-hidden transition-all duration-300 p-4 sm:p-6 overflow-y-auto h-auto lg:h-full flex-1">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="group flex-1 flex items-center bg-surface border border-border rounded-xl focus-within:ring-2 focus-within:ring-brand focus-within:border-brand transition-all shadow-sm overflow-hidden h-11">
            <div className="flex items-center justify-center px-3.5 border-e border-border/60 text-content-muted group-focus-within:text-brand h-full shrink-0">
              <Search size={18} />
            </div>
            <input
              ref={searchInputRef}
              type="text"
              placeholder={t('pos.search_placeholder', 'ابحث عن منتج أو باركود...')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 min-w-0 bg-transparent border-none py-2 px-3 text-sm text-content outline-none ring-0 placeholder:text-content-muted/60 font-bold"
            />
            <div className="flex items-center justify-center px-3 border-s border-border/60 h-full shrink-0">
              <button 
                type="button"
                onClick={() => setIsScannerOpen(true)}
                className="text-content-muted hover:text-brand transition-colors flex items-center justify-center focus:outline-none cursor-pointer"
              >
                <Barcode size={18} />
              </button>
            </div>
          </div>

          <button
            onClick={() => setIsShortcutsModalOpen(true)}
            className="hidden sm:flex items-center justify-center gap-2 px-4 h-11 bg-surface border border-border text-content hover:bg-surface-muted rounded-xl transition-all font-black shadow-sm active:scale-95 cursor-pointer text-xs sm:text-sm shrink-0"
            title="جدول اختصارات لوحة المفاتيح"
          >
            <span>⌨️</span>
            <span className="whitespace-nowrap">الاختصارات (F1)</span>
          </button>

          <button
            onClick={() => setIsCustomOrderModalOpen(true)}
            className="flex items-center justify-center gap-2 px-5 h-11 bg-brand text-white rounded-xl hover:bg-brand/90 transition-all font-black shadow-sm active:scale-95 cursor-pointer text-xs sm:text-sm shrink-0"
          >
            <Scissors size={18} />
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
                    "px-4 py-2 rounded-xl text-xs font-black transition-all duration-200 cursor-pointer border shrink-0 active:scale-95",
                    isActive
                      ? "bg-brand text-white border-brand shadow-sm"
                      : "bg-surface text-content-muted border-border hover:bg-surface-muted/80"
                  )}
                >
                  {getCategoryLabel(cat)}
                </button>
              );
            })}
          </div>

          <div className="flex items-center self-end sm:self-center bg-surface border border-border rounded-xl p-1 shadow-sm shrink-0">
            <button
              onClick={() => setViewMode('grid')}
              className={cn(
                "p-2 rounded-lg transition-all duration-200 cursor-pointer flex items-center justify-center",
                viewMode === 'grid'
                  ? "bg-brand text-white shadow-sm"
                  : "text-content-muted hover:bg-surface-muted"
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
                  ? "bg-brand text-white shadow-sm"
                  : "text-content-muted hover:bg-surface-muted"
              )}
              title={t('pos.list_view', 'عرض قائمة')}
            >
              <List size={16} />
            </button>
          </div>
        </div>

        {/* Products Grid / List View */}
        <div className="flex-1 bg-surface border border-border rounded-2xl p-4 sm:p-5 overflow-auto shadow-sm">
          {filteredInventory.length > 0 ? (
            viewMode === 'grid' ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4 w-full">
                {filteredInventory.map(item => (
                  <button
                    key={item.id}
                    onClick={() => addToCart(item)}
                    className="flex flex-col items-center p-3.5 bg-surface border border-border/70 hover:border-brand/50 rounded-2xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 group active:scale-95 cursor-pointer text-center w-full"
                  >
                    <div className="w-full aspect-square bg-surface-muted/60 rounded-xl flex items-center justify-center mb-2.5 group-hover:scale-105 transition-transform overflow-hidden border border-border/40">
                      {item.mainImage ? (
                        <img 
                          src={item.mainImage} 
                          alt={item.name} 
                          className="w-full h-full object-cover rounded-xl"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="p-3 bg-surface rounded-full shadow-inner">
                          <Package size={26} className="text-content-muted group-hover:text-brand transition-colors" />
                        </div>
                      )}
                    </div>
                    <span className="text-xs sm:text-sm font-bold text-content text-center line-clamp-2 min-h-[2.25rem] mb-1 w-full">
                      {i18n.language === 'en' && item.nameEn ? item.nameEn : item.name}
                    </span>
                    <span className="text-brand font-black text-sm sm:text-base"><PriceDisplay amount={item.pricePerUnit} /></span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 w-full">
                {filteredInventory.map(item => (
                  <button
                    key={item.id}
                    onClick={() => addToCart(item)}
                    className="flex items-center p-3 sm:p-3.5 bg-surface border border-border/70 hover:border-brand/50 rounded-2xl shadow-sm hover:shadow-md transition-all duration-200 group active:scale-[0.99] cursor-pointer w-full text-right"
                  >
                    {/* Item Image */}
                    <div className="w-14 h-14 sm:w-16 sm:h-16 bg-surface-muted/60 rounded-xl flex items-center justify-center shrink-0 overflow-hidden border border-border/40 ms-0 me-3.5">
                      {item.mainImage ? (
                        <img 
                          src={item.mainImage} 
                          alt={item.name} 
                          className="w-full h-full object-cover rounded-xl"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <Package size={22} className="text-content-muted group-hover:text-brand transition-colors" />
                      )}
                    </div>

                    {/* Details in the Middle */}
                    <div className="flex-1 min-w-0 flex flex-col items-start text-start justify-center gap-1">
                      <span className="text-xs sm:text-sm font-bold text-content line-clamp-1 w-full text-start">
                        {i18n.language === 'en' && item.nameEn ? item.nameEn : item.name}
                      </span>
                      {item.category && (
                        <span className="text-[10px] sm:text-xs text-content-muted bg-surface-muted px-2.5 py-0.5 rounded-full font-bold">
                          {getCategoryLabel(item.category)}
                        </span>
                      )}
                    </div>

                    {/* Price and Action button on the End/Right */}
                    <div className="flex flex-col items-end justify-center shrink-0 gap-1 ms-3 me-0">
                      <span className="text-brand font-black text-sm sm:text-base">
                        <PriceDisplay amount={item.pricePerUnit} />
                      </span>
                      <div className="px-2.5 py-1 bg-brand/10 text-brand group-hover:bg-brand group-hover:text-white rounded-lg transition-colors text-xs font-black flex items-center gap-1">
                        <Plus size={12} />
                        <span>{t('pos.add_to_cart', 'إضافة')}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-content-muted space-y-2 py-12">
              <Package size={44} className="opacity-20" />
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
                  <div className="w-full max-h-[50vh] overflow-y-auto bg-gray-100 rounded-xl border border-border p-4 flex justify-center custom-scrollbar">
                    {invoiceData && <ThermalInvoice data={invoiceData} size="80mm" />}
                  </div>
                  <div className="grid grid-cols-2 gap-3 w-full pt-4 print:hidden">
                    <button 
                      onClick={async () => {
                        try {
                          const { printElementDetailed, getConfiguredPaperSize } = await import(
                            '../utils/printManager'
                          );
                          const res = await printElementDetailed('pos-invoice-print-area', {
                            paperSize:
                              invoiceData?.invoiceType === 'standard_b2b'
                                ? 'A4'
                                : getConfiguredPaperSize('80mm'),
                            title: 'إيصال فاتورة',
                          });
                          if (!res.ok) toastError('تعذّرت الطباعة', res.message);
                        } catch (e) {
                          console.error('[POS] خطأ الطباعة:', e);
                          window.print();
                        }
                      }}
                      className="flex flex-col items-center justify-center p-4 rounded-2xl border border-border hover:border-brand hover:bg-brand/5 transition-all text-content group cursor-pointer"
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
                         const text = `فاتورة من ${brandingSettings?.storeName || 'المتجر'}\nرقم الفاتورة: ${completedOrder.invoiceNumber}\nالإجمالي: ${completedOrder.total} ﷼.`;
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
                    <h2 className="text-2xl font-black text-content">{t('pos.complete_order', 'إتمام الطلب')}</h2>
                    <button onClick={() => setIsPaymentModalOpen(false)} className="p-2 hover:bg-surface-muted rounded-full">
                      <X size={24} />
                    </button>
                  </div>
                  
                  <div className="space-y-6 flex-1">
                    {/* Customer Unpaid Balance Alert */}
                    {selectedCustomer && customerUnpaidBalance > 0 && (
                      <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl flex items-center justify-between text-red-600 gap-3">
                        <div className="flex items-center gap-2.5">
                          <span className="text-2xl">⚠️</span>
                          <div>
                            <div className="text-sm font-black">{t('pos.customer_has_due', 'تنبيه: يوجد متبقي مستحق سابق على العميل')}</div>
                            <div className="text-xs opacity-80">{selectedCustomer.name}</div>
                          </div>
                        </div>
                        <span className="font-mono font-black text-lg text-red-700 whitespace-nowrap">
                          <PriceDisplay amount={customerUnpaidBalance} />
                        </span>
                      </div>
                    )}

                    {/* Invoice Type */}
                    <div className="bg-surface p-4 rounded-2xl border border-border">
                      <label className="block text-sm font-bold text-content mb-3">{t('pos.invoice_type', 'نوع الفاتورة')}</label>
                      <div className="flex bg-surface-muted p-1 rounded-xl">
                        <button
                          className={cn("flex-1 py-2 text-sm font-bold rounded-lg transition-colors", !isB2B ? "bg-white shadow-sm text-brand" : "text-content-muted hover:text-content")}
                          onClick={() => {
                            setIsB2B(false);
                            setB2bData({ companyName: '', trn: '' });
                          }}
                        >
                          {t('pos.simple_invoice', 'عادي (ضريبية مبسطة)')}
                        </button>
                        <button
                          className={cn("flex-1 py-2 text-sm font-bold rounded-lg transition-colors", isB2B ? "bg-white shadow-sm text-brand" : "text-content-muted hover:text-content")}
                          onClick={() => {
                            setIsB2B(true);
                            setIsB2bModalOpen(true);
                          }}
                        >
                          {t('pos.b2b_invoice', 'ضريبية (أعمال B2B)')}
                        </button>
                      </div>
                      {isB2B && b2bData.companyName && (
                        <div className="mt-3 p-3 bg-brand/5 border border-brand/20 rounded-xl text-sm">
                           <div className="flex justify-between items-center mb-1">
                             <span className="font-bold text-brand">{b2bData.companyName}</span>
                             <button onClick={() => setIsB2bModalOpen(true)} className="text-brand text-xs font-bold hover:underline">{t('common.edit', 'تعديل')}</button>
                           </div>
                           <div className="text-content-muted">{t('pos.trn_label', 'الرقم الضريبي:')} {b2bData.trn}</div>
                        </div>
                      )}
                    </div>

                    {/* Discount */}
                    <div className="bg-surface p-4 rounded-2xl border border-border">
                      <div className="flex justify-between items-center mb-3">
                        <label className="text-sm font-bold text-content">{t('pos.discount', 'الخصم')}</label>
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
                            {t('pos.percentage_label', 'نسبة (%)')}
                          </button>
                          <button
                            type="button"
                            className={cn(
                              "px-3 py-1 text-xs font-bold rounded-md transition-all",
                              discountType === 'fixed' ? "bg-brand text-white shadow-sm" : "text-content-muted hover:text-content"
                            )}
                            onClick={() => setDiscountType('fixed')}
                          >
                            {t('pos.fixed_amount', 'مبلغ ثابت')}
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
                          }}
                          placeholder="0"
                          className="w-full bg-surface-muted border-none rounded-xl py-3 px-4 focus:ring-2 focus:ring-brand text-left tabular-nums font-bold text-lg"
                          dir="ltr"
                        />
                      </div>
                    </div>

                    {/* Payment Method */}
                    <div className="bg-surface p-4 rounded-2xl border border-border">
                      <label className="block text-sm font-bold text-content mb-3">{t('pos.payment_method', 'طريقة الدفع')}</label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {[
                          { id: 'cash', label: t('pos.cash', 'كاش'), icon: Banknote },
                          { id: 'network', label: t('pos.card', 'شبكة'), icon: CreditCard },
                          { id: 'bank_transfer', label: t('pos.bank_transfer', 'تحويل بنكي'), icon: Landmark },
                          { id: 'partial', label: t('pos.partial_credit', 'آجل / دفع جزئي'), icon: Wallet }
                        ].map(method => (
                          <button
                            key={method.id}
                            onClick={() => {
                              setPaymentMethod(method.id as PaymentMethod);
                              if (method.id === 'partial') {
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
                      <label className="block text-sm font-bold text-content mb-3">{t('pos.paid_amount_now', 'المبلغ المدفوع الآن')}</label>
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
                        <span>{t('pos.total_required', 'الإجمالي المطلوب:')}</span>
                        <span className="font-bold text-content line-through opacity-70"><PriceDisplay amount={totalAmount + calculatedDiscountAmount} /></span>
                      </div>
                      {calculatedDiscountAmount > 0 && (
                        <div className="flex justify-between items-center mb-2 px-1 text-red-500 font-bold">
                          <span>{t('pos.discount', 'الخصم')}:</span>
                          <span>-<PriceDisplay amount={calculatedDiscountAmount} /></span>
                        </div>
                      )}
                      <div className="flex justify-between items-center bg-surface-muted p-4 rounded-2xl border border-border mb-4">
                        <span className="font-bold text-content">{t('pos.net_amount', 'الصافي:')}</span>
                        <span className="font-black text-2xl text-brand"><PriceDisplay amount={totalAmount} /></span>
                      </div>
                    </div>
                    
                    <div className="md:hidden flex justify-between items-center mb-4">
                        <div className="flex flex-col">
                            <span className="text-[10px] text-content-muted font-bold uppercase">{t('pos.net_payable', 'الصافي للدفع')}</span>
                            <span className="text-xl font-black text-brand"><PriceDisplay amount={totalAmount} /></span>
                        </div>
                        {totalAmount - paidAmount > 0 && (
                            <div className="flex flex-col items-end">
                                <span className="text-[10px] text-red-500 font-bold uppercase">{t('pos.remaining_amount', 'المتبقي')}</span>
                                <span className="text-lg font-bold text-red-600"><PriceDisplay amount={totalAmount - paidAmount} /></span>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center justify-between bg-surface p-4 rounded-xl border border-border mb-4">
                      <span className="text-sm font-bold text-content">{t('pos.auto_print_enabled', 'الطباعة التلقائية عند الإصدار')}</span>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input 
                          type="checkbox" 
                          className="sr-only peer" 
                          checked={isAutoPrintEnabled} 
                          onChange={(e) => {
                            const val = e.target.checked;
                            setIsAutoPrintEnabled(val);
                            localStorage.setItem('pos_auto_print', String(val));
                          }} 
                        />
                        <div className="w-11 h-6 bg-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand"></div>
                      </label>
                    </div>

                    <button
                      onClick={handleCheckout}
                      disabled={loading}
                      className="w-full py-4 bg-brand text-white rounded-xl md:rounded-2xl font-black text-lg hover:bg-brand/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg active:scale-95"
                    >
                      {loading ? t('common.processing', 'جاري التنفيذ...') : (
                        <>
                          <CheckCircle2 size={24} />
                          {t('pos.issue_invoice', 'إصدار الفاتورة')}
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
                    <h2 className="text-lg font-black text-content">{t('pos.cash_flow_details', 'تدفق نقدية الصندوق')}</h2>
                    <p className="text-xs font-bold text-content-muted mt-0.5">{t('pos.cash_flow_desc', 'تفاصيل وحالة نقدية الوردية الحالية')}</p>
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
                  <span>{t('pos.employee_label', 'الموظف:')} <span className="text-content font-extrabold">{currentStaff?.name || t('common.unknown', 'غير معروف')}</span></span>
                  <span>{t('pos.shift_id_label', 'رقم الوردية:')} <span className="font-sans text-content font-extrabold">#{shiftId?.slice(-6).toUpperCase()}</span></span>
                </div>

                {/* Main Cash Drawer Indicator */}
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-3xl p-5 text-center space-y-2">
                  <span className="text-xs font-black text-emerald-600 block uppercase tracking-widest">
                    {t('pos.expected_cash', 'صافي النقدية المتوقعة بالصندوق (كاش)')}
                  </span>
                  <div className="text-3xl font-black text-emerald-500 tracking-tight">
                    <PriceDisplay amount={cashDrawerBalance} />
                  </div>
                  <p className="text-[10px] text-content-muted">
                    {t('pos.cash_calc_note', '* هذا المبلغ يمثل الرصيد المسجل بالإضافة للمبيعات والإيداعات مخصوماً منه المصروفات والمرتجعات.')}
                  </p>
                </div>

                {/* Operations Breakdown Grid */}
                <div className="space-y-3.5">
                  <h3 className="text-xs font-black text-content-muted uppercase tracking-widest">{t('pos.cash_breakdown_title', 'تفاصيل التدفق المالي')}</h3>
                  
                  <div className="grid grid-cols-1 gap-3">
                    {/* Opening Balance */}
                    <div className="flex items-center justify-between p-3.5 bg-surface-muted/30 border border-border rounded-2xl">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 bg-blue-500/10 text-blue-500 rounded-xl">
                          <Coins size={18} />
                        </div>
                        <span className="text-xs font-bold text-content">{t('pos.opening_balance_label', 'الرصيد الافتتاحي')}</span>
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
                        <span className="text-xs font-bold text-content">{t('pos.cash_sales_label', 'مبيعات كاش')}</span>
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
                          <span className="text-xs font-bold text-content">{t('pos.cash_deposits_label', 'عمليات الإيداع كاش')}</span>
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
                          <span className="text-xs font-bold text-content">{t('pos.cash_returns_label', 'مرتجعات مبيعات (كاش)')}</span>
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
                          <span className="text-xs font-bold text-content">{t('pos.cash_withdrawals_label', 'المصروفات والمسحوبات')}</span>
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
                      toastSuccess(t('pos.cash_drawer_refreshed', 'تم تحديث نقدية الصندوق فورا'));
                    }}
                    className="flex-1 py-3 bg-surface border border-border text-content hover:bg-surface-muted rounded-xl transition-all font-bold text-xs sm:text-sm text-center flex items-center justify-center gap-2 active:scale-95"
                  >
                    <Coins size={16} />
                    <span>{t('common.refresh', 'تحديث البيانات')}</span>
                  </button>
                  <button
                    onClick={() => setShowCashDrawerDetails(false)}
                    className="flex-1 py-3 bg-brand text-white hover:bg-brand/90 rounded-xl transition-all font-bold text-xs sm:text-sm text-center active:scale-95"
                  >
                    {t('common.close', 'إغلاق النافذة')}
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
                  {t('pos.custom_tailoring_title', 'تفصيل جديد')}
                </h2>
                <button onClick={() => setIsCustomOrderModalOpen(false)} className="p-2 hover:bg-surface-muted rounded-full transition-colors shadow-sm text-content-muted">
                  <X size={20} />
                </button>
              </div>
              
              {/* Body (Scrollable) */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
                {/* Customer Selector inside Modal */}
                <div className="bg-brand/5 p-4 rounded-xl border border-brand/10 space-y-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-black text-content flex items-center gap-2">
                      <User size={18} className="text-brand" />
                      {t('pos.customer', 'العميل')}
                    </label>
                    {!selectedCustomer && (
                      <span className="text-xs text-danger font-bold">
                        {t('pos.customer_required_for_custom', '* مطلوب لطلبات التفصيل')}
                      </span>
                    )}
                  </div>
                  
                  <div className="flex gap-2 relative z-50">
                    <Combobox value={selectedCustomer} onChange={(customer: Customer | null) => {
                      setSelectedCustomer(customer);
                      if (customer) {
                         setIsB2B(customer.isB2B || !!customer.companyName || !!customer.trn);
                         setB2bData({
                            companyName: customer.companyName || '',
                            trn: customer.trn || ''
                         });
                         // Auto-fill measurements if exist
                         if (customer.measurements) {
                           setCustomMeasurements(customer.measurements);
                         } else {
                           setCustomMeasurements({});
                         }
                      } else {
                         setIsB2B(false);
                         setB2bData({ companyName: '', trn: '' });
                         setCustomMeasurements({});
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
                          <Combobox.Options className="absolute mt-1 max-h-60 w-full overflow-auto rounded-xl bg-[#FFFFFF] dark:bg-[#1D1D1D] border border-border text-content py-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-[100]">
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
                      className="px-3 bg-[var(--surface)] border border-border rounded-xl text-brand hover:bg-brand hover:text-white transition-all flex items-center justify-center shrink-0 shadow-sm"
                      title={t('pos.add_new_customer', 'إضافة عميل جديد')}
                    >
                      <UserPlus size={20} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                  <div>
                    <label className="block text-xs sm:text-sm font-black text-content-muted uppercase tracking-widest mb-2">{t('pos.garment_type_label', 'نوع الثوب')}</label>
                    <input 
                      type="text" 
                      value={customItemForm.garmentType}
                      onChange={(e) => setCustomItemForm({...customItemForm, garmentType: e.target.value})}
                      className="w-full p-2.5 sm:p-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-brand focus:border-brand text-sm sm:text-base text-content" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs sm:text-sm font-black text-content-muted uppercase tracking-widest mb-2">{t('pos.price_label', 'السعر')}</label>
                    <input 
                      type="number" 
                      value={customItemForm.price}
                      onChange={(e) => setCustomItemForm({...customItemForm, price: Number(e.target.value)})}
                      className="w-full p-2.5 sm:p-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-brand focus:border-brand text-sm sm:text-base text-content" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs sm:text-sm font-black text-content-muted uppercase tracking-widest mb-2">{t('pos.fabric_label', 'القماش')}</label>
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
                        { value: '', label: t('pos.select_fabric_placeholder', 'اختر قماش...') },
                        ...inventory.filter(i => i.category === 'fabric').map(item => ({ value: item.id, label: `${item.name} (${item.quantity} ${item.unit})` })),
                        { value: 'custom', label: t('pos.external_fabric_label', 'قماش خارجي') }
                      ]}
                    />
                  </div>
                  <div>
                    <label className="block text-xs sm:text-sm font-black text-content-muted uppercase tracking-widest mb-2">{t('pos.quantity_label', 'الكمية')}</label>
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
                      <h4 className="font-bold text-sm">{t('pos.customer_saved_measurements', 'مقاسات العميل المحددة')}</h4>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { label: t('measurements.length', 'الطول'), value: selectedCustomer.measurements?.length },
                        { label: t('measurements.shoulder', 'الكتف'), value: selectedCustomer.measurements?.shoulder },
                        { label: t('measurements.chest', 'الصدر'), value: selectedCustomer.measurements?.chest },
                        { label: t('measurements.sleeve', 'الكم'), value: selectedCustomer.measurements?.sleeve },
                      ].map((m) => (
                        <div key={m.label} className="bg-surface p-2 rounded-lg border border-brand/10 text-center">
                          <p className="text-[10px] text-content-muted">{m.label}</p>
                          <p className="text-sm font-bold text-brand">{m.value || '-'}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-content-muted mt-2 flex items-center gap-1">
                      <Zap size={12} />
                      {t('pos.measurements_auto_attached_note', 'سيتم إرفاق المقاسات الحالية للعميل مع هذا الطلب تلقائياً.')}
                    </p>
                  </div>
                )}

                <div className="space-y-4 border-t border-border pt-6">
                  <h4 className="text-xs sm:text-sm font-black text-content-muted uppercase tracking-widest flex items-center gap-2">
                    <Zap size={16} />
                    {t('pos.visual_details_interactive_measurements', 'التفاصيل البصرية والمقاسات التفاعلية')}
                  </h4>
                  <VisualMeasurements 
                    values={customMeasurements} 
                    onChange={(field, val) => setCustomMeasurements({...customMeasurements, [field]: val})} 
                  />
                  
                  <div className="mt-8 pt-8 border-t border-border">
                    <h3 className="text-sm font-black text-content flex items-center gap-2 mb-4">
                      <div className="w-1.5 h-4 bg-brand rounded-full" />
                      {t('pos.interactive_visual_measurement_selector', 'مُحدد المقاسات البصري التفاعلي')}
                    </h3>
                    <ThobeMeasurementSelector 
                      values={customMeasurements as any || {}}
                      onChange={(newMeasurements) => setCustomMeasurements({...customMeasurements, ...newMeasurements})}
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
                  {t('pos.add_to_cart_btn', 'إضافة للسلة')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Customer Modal Refactored to Bottom Sheet */}
      <Transition appear show={isAddCustomerModalOpen} as={React.Fragment}>
        <Dialog as="div" className="relative z-[200] flex items-end sm:items-center justify-center" onClose={() => setIsAddCustomerModalOpen(false)}>
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
                    {t('pos.add_new_customer', 'إضافة عميل جديد')}
                    <button title="Close" onClick={() => setIsAddCustomerModalOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                      <X size={20} />
                    </button>
                  </Dialog.Title>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t('pos.customer_name', 'اسم العميل')} <span className="text-red-500">*</span></label>
                      <input 
                        type="text" 
                        value={newCustomerName}
                        onChange={(e) => setNewCustomerName(e.target.value)}
                        className="w-full p-2.5 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-brand focus:border-brand" 
                        placeholder="محمد عبدالله"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t('pos.mobile_number', 'رقم الجوال')} <span className="text-red-500">*</span></label>
                      <input 
                        type="tel" 
                        value={newCustomerPhone}
                        onChange={(e) => setNewCustomerPhone(formatSaudiPhone(e.target.value))}
                        onBlur={(e) => setNewCustomerPhone(formatSaudiPhone(e.target.value))}
                        className="w-full p-2.5 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-brand focus:border-brand text-right" 
                        placeholder="05XXXXXXXX"
                        dir="ltr"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t('pos.trn_label_clean', 'الرقم الضريبي')} <span className="text-gray-400 text-xs font-normal">{t('pos.for_b2b_only', '(للأعمال B2B)')}</span></label>
                      <input 
                        type="text" 
                        value={newCustomerVat}
                        onChange={(e) => setNewCustomerVat(e.target.value)}
                        className="w-full p-2.5 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-brand focus:border-brand" 
                        placeholder={t('pos.optional_b2b_desc', 'اختياري (سيعتبر العميل شركة)')}
                      />
                    </div>
                  </div>

                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      type="button"
                      className="px-4 py-2 font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
                      onClick={() => setIsAddCustomerModalOpen(false)}
                    >
                      {t('common.cancel', 'إلغاء')}
                    </button>
                    <button
                      type="button"
                      disabled={isSavingCustomer || !newCustomerName || !newCustomerPhone}
                      className="px-4 py-2 font-medium text-white bg-brand hover:bg-brand/90 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm"
                      onClick={handleSaveCustomer}
                    >
                      {isSavingCustomer ? t('common.saving', 'جاري الحفظ...') : t('pos.save_customer', 'حفظ العميل')}
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>

      {/*
        Hidden Invoice to Print
        ------------------------------------------------------------------
        ⚠️ عرض هذا العنصر يجب أن يطابق مقاس الورق المستهدف.
        كان ثابتاً على `w-[80mm]` دائماً، فالفاتورة الضريبية A4 كانت
        تُخطَّط داخل صندوق بعرض 80mm — وهذا سبب خروج مقاسها وهوامشها
        "مضروبة" عند الطباعة من صفحة البيع، وكذلك عند تنزيلها PDF لأن
        مُولِّد الـ PDF يصوّر العنصر بعرضه الفعلي على الشاشة.
      */}
      {completedOrder && invoiceData && (
        <div
          id="pos-invoice-print-area"
          data-paper={invoiceData.invoiceType === 'standard_b2b' ? 'A4' : '80mm'}
          className={`fixed top-0 left-0 opacity-0 pointer-events-none ${
            invoiceData.invoiceType === 'standard_b2b' ? 'w-[194mm]' : 'w-[80mm]'
          } print:opacity-100 print:pointer-events-auto print:static print:w-full print:block print:max-w-none print:m-0 print:p-0 bg-white z-[99999]`}
          dir="rtl"
        >
          {invoiceData.invoiceType === "standard_b2b" ? (
             <StandardInvoice data={invoiceData} size="A4" />
          ) : (
             <ThermalInvoice data={invoiceData} size="80mm" />
          )}
        </div>
      )}

      {/* B2B Data Modal */}
      <Dialog open={isB2bModalOpen} onClose={() => setIsB2bModalOpen(false)} className="relative z-[100]" dir="rtl">
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="w-full max-w-md bg-surface p-6 rounded-2xl shadow-xl border border-border">
            <div className="flex justify-between items-center mb-6">
              <Dialog.Title className="text-xl font-bold text-content">{t('pos.b2b_data_title', 'بيانات الفاتورة الضريبية (B2B)')}</Dialog.Title>
              <button onClick={() => setIsB2bModalOpen(false)} className="p-2 hover:bg-surface-muted rounded-full">
                <X size={20} />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-content mb-2">{t('pos.company_name', 'اسم الشركة')} <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  placeholder={t('pos.company_name_placeholder', 'مثال: شركة وضوح الشاملة')}
                  value={b2bData.companyName}
                  onChange={e => setB2bData({...b2bData, companyName: e.target.value})}
                  className="w-full p-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-brand"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-content mb-2">{t('pos.trn_label_clean', 'الرقم الضريبي')} <span className="text-red-500">*</span></label>
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
                {t('pos.update_and_continue', 'تحديث ومتابعة')}
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
                {t('common.cancel', 'إلغاء')}
              </button>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>

      {/* Keyboard Shortcuts Help Modal */}
      <Transition appear show={isShortcutsModalOpen} as={React.Fragment}>
        <Dialog as="div" className="relative z-[150] flex items-center justify-center" onClose={() => setIsShortcutsModalOpen(false)}>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" onClick={() => setIsShortcutsModalOpen(false)} />
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <Dialog.Panel className="w-full max-w-lg bg-surface p-6 rounded-3xl shadow-2xl border border-border text-right" dir="rtl">
              <div className="flex justify-between items-center mb-6 border-b border-border pb-4">
                <Dialog.Title className="text-xl font-black text-content flex items-center gap-2">
                  <span>⌨️</span>
                  <span>{t('pos.keyboard_shortcuts_title', 'اختصارات لوحة المفاتيح للكاشير')}</span>
                </Dialog.Title>
                <button onClick={() => setIsShortcutsModalOpen(false)} className="p-2 hover:bg-surface-muted rounded-full transition-colors">
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
                <p className="text-sm text-content-muted font-bold mb-4">
                  {t('pos.keyboard_shortcuts_desc', 'استخدم هذه الاختصارات لتسريع عملية البيع وإصدار الفواتير دون الحاجة لاستخدام الماوس:')}
                </p>

                <div className="grid grid-cols-1 gap-2">
                  {[
                    { keys: ['F1', 'Ctrl + /'], label: t('pos.shortcut_toggle_help', 'فتح / إغلاق دليل الاختصارات') },
                    { keys: ['F3', 'Ctrl + F'], label: t('pos.shortcut_focus_search', 'التركيز على حقل البحث عن منتج') },
                    { keys: ['F8', 'Ctrl + Enter'], label: t('pos.shortcut_open_payment', 'فتح نافذة الدفع وإتمام الطلب') },
                    { keys: ['F9'], label: t('pos.shortcut_confirm_payment', 'تأكيد الدفع وإصدار الفاتورة (داخل نافذة الدفع)') },
                    { keys: ['Ctrl + 1'], label: t('pos.shortcut_cash_payment', 'اختيار الدفع النقدي (داخل نافذة الدفع)') },
                    { keys: ['Ctrl + 2'], label: t('pos.shortcut_card_payment', 'اختيار الدفع بالشبكة/مدى (داخل نافذة الدفع)') },
                    { keys: ['Ctrl + P'], label: t('pos.shortcut_quick_print', 'الطباعة السريعة للإيصال (بعد إصدار الفاتورة)') },
                    { keys: ['F2', 'Esc'], label: t('pos.shortcut_close_invoice_new', 'إغلاق شاشة الفاتورة وبدء طلب جديد') },
                    { keys: ['F7', 'Ctrl + Shift + A'], label: t('pos.shortcut_open_custom_thobe', 'فتح نافذة تفصيل ثوب جديد مخصص') },
                    { keys: ['F4'], label: t('pos.shortcut_clear_cart', 'إفراغ سلة المشتريات بالكامل') },
                  ].map((shortcut, idx) => (
                    <div key={idx} className="flex justify-between items-center p-3 bg-surface-muted rounded-xl border border-border/50 hover:bg-brand/5 transition-all">
                      <span className="text-sm font-bold text-content">{shortcut.label}</span>
                      <div className="flex gap-1.5" dir="ltr">
                        {shortcut.keys.map((key, kIdx) => (
                          <React.Fragment key={kIdx}>
                            {kIdx > 0 && <span className="text-content-muted self-center font-bold text-xs">+</span>}
                            <kbd className="px-2 py-1 bg-white dark:bg-zinc-800 border border-border rounded-lg shadow-sm font-mono text-xs font-black text-brand">
                              {key}
                            </kbd>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setIsShortcutsModalOpen(false)}
                  className="px-6 py-2.5 bg-brand text-white font-bold rounded-xl hover:bg-brand/90 transition-all text-sm shadow-md"
                >
                  {t('common.got_it_close', 'فهمت، إغلاق')}
                </button>
              </div>
            </Dialog.Panel>
          </div>
        </Dialog>
      </Transition>

    </div>
  );
}
