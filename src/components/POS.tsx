import { ThermalInvoice, StandardInvoice, InvoiceData } from "./printing/InvoiceReceipt";
import { contentReached } from '../lib/shellLayout';
import { AutoGrid } from './ui/AutoGrid';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { formatSaudiPhone } from '../utils/phoneUtils';
import { fuzzyIncludes } from '../utils/fuzzySearch';
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
  List,
  Keyboard,
  Printer,
  Receipt,
  Download,
  Share2,
  AlertTriangle,
  Paperclip
} from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { resolveTaxSettings } from '../utils/taxSettings';
import { cachedOpenShift, cachedTaxSettings, rememberTaxSettings } from '../lib/offline/posOfflineState';
import { saleTimestamp, takeOfflineNumber, topUpOfflineNumbers } from '../lib/offline/offlineNumbers';
import { refreshCustomersCache, refreshInventoryCache, refreshBranchStockCache, getCachedCustomers, getCachedInventory, getCachedBranchStock, getCachedVariantStock } from '../lib/offline/cacheSync';
import { getLastKnown, saveLastKnown } from '../lib/offline/lastKnownCache';
import { enqueuePosSale, isNetworkFailure, decidePosSaleFailureAction, SALE_TIMEOUT_MS } from '../lib/offline/outbox';
import { handleError, OperationType, getFriendlyErrorMessage } from '../lib/appErrors';
import { Combobox, Transition, Dialog } from '@headlessui/react';
import { Customer, InventoryItem, OrderItem, Order, PaymentMethod, OrderStatus, ProductVariant, TaxInvoice, Tenant } from '../types';
import { TaxInvoiceDocument } from './printing/TaxInvoiceModal';
import { fetchTaxInvoiceForOrder, issueTaxInvoiceForOrder } from '../services/taxInvoiceService';
import { cn, generateOrderNumber } from '../lib/utils';
import { SmartSelect } from './ui/SmartSelect';
import { IconInput } from './ui/IconInput';
import { VoiceMicButton } from './ui/VoiceMicButton';
import { isSpeechRecognitionSupported } from '../hooks/useSpeechRecognition';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { PriceDisplay } from './PriceDisplay';
import { decodeInventoryDescription, hasValidTaxSettings } from '../utils/b2bHelper';
import { computeCartTotals } from '../utils/cartTotals';
import { QRCodeSVG } from 'qrcode.react';
import { useStaff } from '../contexts/StaffContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { notifyNewOrderForStaff } from '../utils/orderNotify';
import { submitZatcaInvoice } from '../utils/zatcaSubmit';
import { generateZatcaQR } from '../lib/zatca';
import TailoringOrderForm from './TailoringOrderForm';
import Branding from './Branding';
import { downloadInvoicePDF, shareOrDownloadInvoicePDF } from '../utils/pdfGenerator';
import { buildWhatsAppMessage, getWhatsAppTemplate } from '../utils/whatsapp';
import { useBranding } from '../contexts/BrandingContext';
import { useRealtimeSync } from '../hooks/useRealtimeSync';
import { useRouter, useRefreshCounter } from '../hooks/useRouter';
import { encodeOrderB2BNotes, encodeInvoiceExtendedNotes } from '../utils/b2bHelper';
import { useTranslation } from 'react-i18next';
import ScannerModal from './ScannerModal';
import WhatsAppPhoneModal from './ui/WhatsAppPhoneModal';
import VariantPickerModal from './ui/VariantPickerModal';

import { isRtlLang } from '../lib/direction';
import { useMeasurementUnit } from '../hooks/useMeasurementUnit';
import { cmToDisplayUnit, unitLabelKey, type MeasurementUnit } from '../utils/measurementUnits';
import { measurementRows, measurementSetFor } from '../constants/measurementFields';
import { isLengthItem } from '../utils/itemUnits';
import { isOrdersModuleOn } from '../services/verticalService';
import { useVerticalTerms } from '../hooks/useVerticalTerms';
import { LENGTH_STEP_METERS, firstLengthQuantity, roundMeters, stepMeters, toMeters, type LengthUnit } from '../utils/lengthSale';
import LengthQuantityControl from './pos/LengthQuantityControl';
import { useVerticalConfig } from '../hooks/useVerticalConfig';
import { useTenantCategoryPicker } from '../hooks/useTenantCategoryPicker';
import { LEGACY_INVENTORY_CATEGORY_SEED } from '../services/categoryService';

// Body measurements live on the Customer record (not per order item), so a
// custom-garment item's printed measurement table is the selected
// customer's own measurements at checkout time -- only for 'custom' items,
// and only the fields that are actually filled in.
function buildInvoiceMeasurements(
  item: { type?: string },
  customer: Customer | null,
  t: (key: string) => string,
  measurementUnit: MeasurementUnit
): { label: string; value: string | number }[] | undefined {
  if (item.type !== 'custom' || !customer?.measurements) return undefined;
  const list = measurementRows(customer.measurements).map((row) => ({
    label: t(row.labelKey),
    value: `${cmToDisplayUnit(row.value, measurementUnit)} ${t(unitLabelKey(measurementUnit))}`,
  }));
  return list.length > 0 ? list : undefined;
}

interface DebtOrderSummary {
  id: string;
  orderNumber: number;
  orderDate: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
}

// Shown instead of the real tax invoice when an order has none at all --
// orders created directly in "الطلبات" (not sold through POS's checkout)
// never get a tax_invoices row in the first place, so there's nothing
// real to fetch/show. A dead-end error there would be worse than a
// plain, clearly-not-a-tax-invoice payment confirmation.
interface FallbackPaymentReceipt {
  orderId: string;
  orderNumber: number;
  amountPaid: number;
  customerName: string;
  issuedAt: string;
}

const isUuidLike = (val: string | undefined | null) =>
  val ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val) : false;

export default function POS({ tenantId, shiftId }: { tenantId: string, shiftId?: string }) {
  const router = useRouter();
  const refreshCounter = useRefreshCounter();
  // P3.4 / RELIABILITY-15: bumped when the live updates were cut off and came back.
  const [resyncTick, setResyncTick] = useState(0);
  const bumpResync = useCallback(() => setResyncTick((n) => n + 1), []);
  const { error: toastError, success: toastSuccess, handleError } = useToast();
  const { confirm, alertModal } = useConfirm();
  const { t, i18n } = useTranslation();
  const isRtl = isRtlLang(i18n.language);
  const measurementUnit = useMeasurementUnit(tenantId);
  // Unsupported browsers render VoiceMicButton as null -- without this
  // gate, IconInput's endIcon array would still include the (now-empty)
  // mic wrapper span, showing a blank bordered icon box next to the scan
  // button where none existed before voice input.
  const voiceSupported = isSpeechRecognitionSupported();
  // prefers-reduced-motion: skip the slide/spring enter animation and jump
  // straight to the resting state for every drawer/sheet below.
  const shouldReduceMotion = useReducedMotion();
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [cart, setCart] = useState<OrderItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerUnpaidBalance, setCustomerUnpaidBalance] = useState<number>(0);
  // seen-pos-debt-settlement: standalone debt breakdown/settlement, separate
  // from the new-sale checkout modal -- reachable even with an empty cart.
  const [isDebtModalOpen, setIsDebtModalOpen] = useState(false);
  const [debtOrders, setDebtOrders] = useState<DebtOrderSummary[]>([]);
  const [debtOrdersLoading, setDebtOrdersLoading] = useState(false);
  const [debtPayAmounts, setDebtPayAmounts] = useState<Record<string, number>>({});
  const [settlingOrderId, setSettlingOrderId] = useState<string | null>(null);
  const [isSettlingAllDebt, setIsSettlingAllDebt] = useState(false);
  const [viewingInvoice, setViewingInvoice] = useState<{ invoice: TaxInvoice; tenant: Tenant } | null>(null);
  const [settledOrdersSummary, setSettledOrdersSummary] = useState<{ orderNumber: number; orderId: string; amountPaid: number }[] | null>(null);
  const [fallbackReceipt, setFallbackReceipt] = useState<FallbackPaymentReceipt | null>(null);
  const [isIssuingInvoice, setIsIssuingInvoice] = useState(false);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [branchStock, setBranchStock] = useState<Record<string, number>>({});
  // seen-ux-fixes-batch-task.md item 10 -- stock of each variant row (keyed
  // by variantId) for the cashier's current branch, kept separate from
  // branchStock above (which now only ever reflects the base, no-variant
  // row -- see the fetch/realtime filters below).
  const [variantStock, setVariantStock] = useState<Record<string, number>>({});
  const [itemVariants, setItemVariants] = useState<Record<string, ProductVariant[]>>({});
  const [variantPickerItem, setVariantPickerItem] = useState<InventoryItem | null>(null);
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
  const [whatsappModalOpen, setWhatsappModalOpen] = useState(false);
  const [showCartOnMobile, setShowCartOnMobile] = useState(false);
  const { currentStaff } = useStaff();
  const { user: currentAuthUser } = useAuth();
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  const [taxSettings, setTaxSettings] = useState<any>(null);
  // P3.1 / RELIABILITY-11: the shop's tax settings could not be read (offline,
  // nothing kept on this device) -- selling would mean selling with no VAT.
  const [taxSettingsUnavailable, setTaxSettingsUnavailable] = useState(false);

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
  // الطباعة التلقائية بعد إصدار الفاتورة مفعّلة افتراضياً (ما لم يعطّلها المستخدم صراحةً من الإعدادات).
  const [isAutoPrintEnabled, setIsAutoPrintEnabled] = useState(() => {
    return localStorage.getItem('pos_auto_print') !== 'false';
  });

  // Cash Drawer State
  const [cashDrawerBalance, setCashDrawerBalance] = useState<number>(0);
  const [showCashDrawerDetails, setShowCashDrawerDetails] = useState<boolean>(false);
  const [cashDrawerBreakdown, setCashDrawerBreakdown] = useState({
    opening: 0,
    sales: 0,
    deposits: 0,
    withdrawals: 0,
    returns: 0,
    total: 0
  });

  // Phase 4 of seen-offline-coverage-and-performance-task.md: this used to
  // download the full shifts row, every shift_entries row, and EVERY order
  // for the shift (select('*'), no limit) just to sum a handful of numbers
  // -- and re-ran that full download on every single realtime event on
  // those three tables, so the download grew with every sale made during
  // the shift. get_shift_cash_balance computes the same five numbers
  // (opening/sales/deposits/withdrawals/returns/total) in Postgres --
  // see supabase/migrations/20260916000000_get_shift_cash_balance_rpc.sql
  // for the exact formula, unchanged from what this function used to do.
  const fetchCashDrawerBalance = useCallback(async () => {
    if (!shiftId) return;
    try {
      const { data, error } = await supabase.rpc('get_shift_cash_balance', { p_shift_id: shiftId });
      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return;

      const breakdown = {
        opening: Number(row.opening || 0),
        sales: Number(row.sales || 0),
        deposits: Number(row.deposits || 0),
        withdrawals: Number(row.withdrawals || 0),
        returns: Number(row.returns || 0),
        total: Number(row.total || 0),
      };
      setCashDrawerBalance(breakdown.total);
      setCashDrawerBreakdown(breakdown);
    } catch (err) {
      console.error('Error calculating cash drawer balance:', err);
      handleError(err, t('pos.cash_drawer_balance_failed', 'تعذّر حساب رصيد الدرج النقدي'));
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

  useRealtimeSync('branch_inventory', tenantId, (payload) => {
    if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
      const item = payload.new;
      if (!currentStaff?.branchId || item.branch_id === currentStaff.branchId) {
        if (item.variant_id) {
          setVariantStock(prev => ({ ...prev, [item.variant_id]: Number(item.quantity || 0) }));
        } else {
          setBranchStock(prev => ({
            ...prev,
            [item.item_id]: Number(item.quantity || 0)
          }));
        }
      }
    } else if (payload.eventType === 'DELETE') {
      const item = payload.old;
      if (item.variant_id) {
        setVariantStock(prev => {
          const copy = { ...prev };
          delete copy[item.variant_id];
          return copy;
        });
      } else {
        setBranchStock(prev => {
          const copy = { ...prev };
          delete copy[item.item_id];
          return copy;
        });
      }
    }
  }, bumpResync); // P3.4 / RELIABILITY-15: re-read stock, products and customers after a drop

  useEffect(() => {
    // Phase 5 of seen-offline-coverage-and-performance-task.md: these four
    // reads are independent (none uses another's result) -- were fetched
    // sequentially before. Each is wrapped so a thrown network error
    // resolves as {data:null, error} instead of rejecting the whole
    // Promise.all, which preserves Phase 1's per-query fallback
    // granularity: one query failing must not block the other three from
    // loading (previously, a customers-fetch failure meant the
    // inventory/branch-stock/tenant queries never even ran).
    const settleQuery = <T,>(p: PromiseLike<{ data: T | null; error: any }>): Promise<{ data: T | null; error: any }> =>
      Promise.resolve(p).then(r => r, (error) => ({ data: null, error }));

    const fetchData = async () => {
      const [custResult, invResult, stockResult, tenantResult, variantResult] = await Promise.all([
        settleQuery(supabase.from('customers').select('*').eq('tenant_id', tenantId)),
        settleQuery(supabase.from('inventory_items').select('*').eq('tenant_id', tenantId)),
        settleQuery(supabase.from('branch_inventory').select('*').eq('tenant_id', tenantId)),
        settleQuery(supabase.from('tenants').select('*').eq('id', tenantId).maybeSingle()),
        settleQuery(supabase.from('inventory_variants').select('*').eq('tenant_id', tenantId)),
      ]);

      let customersLoaded = false;
      let inventoryLoaded = false;
      let branchStockLoaded = false;

      if (!custResult.error) {
        setCustomers((custResult.data || []).map(mapCustomer));
        customersLoaded = true;
      } else {
        console.error('Error fetching POS customers:', custResult.error);
      }

      if (!invResult.error) {
        setInventory((invResult.data || []).map(mapInventoryItem));
        inventoryLoaded = true;
      } else {
        console.error('Error fetching POS inventory:', invResult.error);
      }

      if (!stockResult.error) {
        const stockMap: Record<string, number> = {};
        const variantStockMap: Record<string, number> = {};
        (stockResult.data || []).forEach((item: any) => {
          if (!currentStaff?.branchId || item.branch_id === currentStaff.branchId) {
            if (item.variant_id) {
              variantStockMap[item.variant_id] = Number(item.quantity || 0);
            } else {
              stockMap[item.item_id] = Number(item.quantity || 0);
            }
          }
        });
        setBranchStock(stockMap);
        setVariantStock(variantStockMap);
        branchStockLoaded = true;
      } else {
        console.error('Error fetching POS branch stock:', stockResult.error);
      }

      if (!variantResult.error) {
        const byItem: Record<string, ProductVariant[]> = {};
        (variantResult.data || []).forEach((row: any) => {
          const variant: ProductVariant = {
            id: row.id,
            itemId: row.item_id,
            name: row.name,
            options: row.options || {},
            sku: row.sku,
            barcode: row.barcode || undefined,
            priceAdjustment: Number(row.price_adjustment) || 0,
            updatedAt: row.updated_at,
          };
          (byItem[row.item_id] ||= []).push(variant);
        });
        setItemVariants(byItem);
        // P3.4 / RELIABILITY-12: sizes and colours are there offline too.
        saveLastKnown(tenantId, 'pos_variants', byItem);
      } else {
        console.error('Error fetching POS product variants:', variantResult.error);
        if (isNetworkFailure(variantResult.error)) {
          const cachedVariants = getLastKnown<Record<string, ProductVariant[]>>(tenantId, 'pos_variants')?.data;
          if (cachedVariants) setItemVariants(cachedVariants);
        }
      }

      if (customersLoaded && inventoryLoaded && branchStockLoaded) {
        // Warm the offline read cache in the background (Phase 2 of
        // seen-offline-sync-architecture-task.md) -- non-blocking, POS
        // stays fully usable if this fails or is still running.
        refreshCustomersCache(tenantId, mapCustomer).catch(() => {});
        refreshInventoryCache(tenantId, mapInventoryItem).catch(() => {});
        refreshBranchStockCache(tenantId).catch(() => {});
      }

      if (!tenantResult.error && tenantResult.data) {
        // tsconfig `strict` (seen-cto-sprint4-design-quality-task.md item 2):
        // the Supabase client here is created with createClient<any>
        // (services/supabase/client.ts), so settleQuery<T>'s generic
        // inference against it collapses to `never` rather than a usable
        // row type. Narrow typing of just the fields this block actually
        // reads, rather than fixing the client's typing project-wide.
        const tenantData = tenantResult.data as {
          vat_number: string | null;
          name: string | null;
          tax_settings: {
            enabled?: boolean;
            trn?: string;
            legalName?: string;
            vatRate?: number;
            tailoringTaxType?: string;
          } | null;
        };
        // One reading of the shop's tax settings (utils/taxSettings.ts).
        const resolvedTax = resolveTaxSettings(tenantData);
        setTaxSettings(resolvedTax);
        setTaxSettingsUnavailable(false);
        rememberTaxSettings(tenantId, resolvedTax);
        // P3.2: keep a few invoice numbers reserved for a sale made offline.
        void topUpOfflineNumbers(tenantId);
      } else {
        // P3.1 / RELIABILITY-11: no network -- the settings last read online.
        const cached = cachedTaxSettings(tenantId);
        if (cached) {
          setTaxSettings(cached);
          setTaxSettingsUnavailable(false);
        } else {
          setTaxSettingsUnavailable(true);
        }
      }

      // Offline (or otherwise unreachable) fallback: reuse whatever
      // getCachedInventory/getCachedCustomers/getCachedBranchStock last
      // stored via refreshInventoryCache/refreshCustomersCache/
      // refreshBranchStockCache above, so a page reload mid-outage doesn't
      // strand the cashier on empty product/customer lists even though the
      // cache actually holds real data from the last time this tenant was
      // online. Only takes over for whichever of the three queries didn't
      // finish -- a partial failure keeps whatever already loaded
      // successfully.
      if (!customersLoaded && isNetworkFailure(custResult.error)) {
        const cached = await getCachedCustomers(tenantId).catch(() => []);
        if (cached.length) setCustomers(cached);
      }
      if (!inventoryLoaded && isNetworkFailure(invResult.error)) {
        const cached = await getCachedInventory(tenantId).catch(() => []);
        if (cached.length) setInventory(cached);
      }
      // P3.4 / RELIABILITY-12: an employee with no branch of their own sells
      // from the branch of the shift this device last saw open.
      const offlineBranch = currentStaff?.branchId
        || (currentStaff?.id ? cachedOpenShift(tenantId, currentStaff.id)?.branchId : null);
      if (!branchStockLoaded && isNetworkFailure(stockResult.error) && offlineBranch) {
        const cached = await getCachedBranchStock(tenantId, offlineBranch).catch(() => ({}));
        if (Object.keys(cached).length) setBranchStock(cached);
        const cachedVariantStock = await getCachedVariantStock(tenantId, offlineBranch).catch(() => ({}));
        if (Object.keys(cachedVariantStock).length) setVariantStock(cachedVariantStock);
      }
    };
    fetchData();
  }, [tenantId, mapCustomer, mapInventoryItem, refreshCounter, currentStaff?.branchId, resyncTick]);

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

  // Order-level breakdown for the debt-settlement modal -- only fetched
  // when the modal is actually open, separate from the lump-sum total
  // above which is needed just to show/hide the "تسديد المديونية" button.
  useEffect(() => {
    if (!isDebtModalOpen || !selectedCustomer) return;
    let cancelled = false;
    (async () => {
      setDebtOrdersLoading(true);
      try {
        const { data, error } = await supabase
          .from('orders')
          .select('id, order_number, order_date, total_amount, paid_amount, remaining_amount')
          .eq('customer_id', selectedCustomer.id)
          .neq('status', 'cancelled')
          .gt('remaining_amount', 0)
          .order('order_date', { ascending: true });
        if (error) throw error;
        if (cancelled) return;
        const orders: DebtOrderSummary[] = (data || []).map((o: any) => ({
          id: o.id,
          orderNumber: o.order_number,
          orderDate: o.order_date,
          totalAmount: Number(o.total_amount) || 0,
          paidAmount: Number(o.paid_amount) || 0,
          remainingAmount: Number(o.remaining_amount) || 0,
        }));
        setDebtOrders(orders);
        setDebtPayAmounts(Object.fromEntries(orders.map(o => [o.id, o.remainingAmount])));
      } catch (err) {
        if (!cancelled) toastError(t('common.error'), getFriendlyErrorMessage(err));
      } finally {
        if (!cancelled) setDebtOrdersLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isDebtModalOpen, selectedCustomer, refreshCounter]);

  // Shows the order's own real original tax invoice (same component/data
  // the tax-invoice registry and Orders use). Orders created directly in
  // "الطلبات" (not sold through POS's own checkout) never got a
  // tax_invoices row at all -- for those, `fallback` (when given) renders
  // a plain, clearly-not-a-tax-invoice payment confirmation instead of a
  // dead-end "not found" error.
  const handleViewOrderInvoice = async (orderId: string, fallback?: { orderNumber: number; amountPaid: number }) => {
    const result = await fetchTaxInvoiceForOrder(tenantId, orderId);
    if (result) {
      setViewingInvoice(result);
      setSettledOrdersSummary(null);
    } else if (fallback) {
      setFallbackReceipt({
        orderId,
        orderNumber: fallback.orderNumber,
        amountPaid: fallback.amountPaid,
        customerName: selectedCustomer?.name || '',
        issuedAt: new Date().toISOString(),
      });
      setSettledOrdersSummary(null);
    } else {
      toastError(t('common.error'), t('pos.invoice_not_found'));
    }
  };

  // seen-status-fix-regressions-task.md item 7: same explicit, role-gated
  // "إصدار فاتورة ضريبية" action as Orders.tsx -- the order behind a
  // fallback receipt here was just paid off in full (debt settlement), so
  // it is always eligible; still owner/admin/manager/accountant only.
  const canIssueInvoice = !!currentStaff?.role && ['owner', 'admin', 'manager', 'accountant'].includes(currentStaff.role);
  const handleIssueInvoiceFromFallback = async () => {
    if (!fallbackReceipt) return;
    setIsIssuingInvoice(true);
    try {
      const result = await issueTaxInvoiceForOrder(fallbackReceipt.orderId);
      if (!result.ok) {
        toastError(t('tax_invoices.issue_failed'), result.error);
        return;
      }
      const invoice = await fetchTaxInvoiceForOrder(tenantId, fallbackReceipt.orderId);
      if (invoice) {
        setFallbackReceipt(null);
        setViewingInvoice(invoice);
      }
    } finally {
      setIsIssuingInvoice(false);
    }
  };

  const handleSettleDebtOrder = async (order: DebtOrderSummary) => {
    const amount = Math.min(Math.max(0, debtPayAmounts[order.id] ?? order.remainingAmount), order.remainingAmount);
    if (amount <= 0) return;
    setSettlingOrderId(order.id);
    try {
      // seen-cto-sprint4-permissions-task.md item 2: this used to write
      // orders.paid_amount directly, bypassing record_order_payment
      // entirely -- no payments row, no order_history entry, and (unlike
      // Orders.tsx's own debt-settling path) no shift_id, so this cash
      // never entered till reconciliation even though a shift is
      // available here. Same RPC Orders.tsx already uses for the
      // equivalent action.
      const { data: result, error } = await supabase.rpc('record_order_payment', {
        p_operation_id: globalThis.crypto.randomUUID(),
        p_order_id: order.id,
        p_amount: amount,
        p_method: 'cash',
        p_shift_id: (shiftId && isUuidLike(shiftId)) ? shiftId : null,
      });
      if (error) throw error;
      const newPaidAmount = Number(result.paid_amount);
      const newRemaining = Number(result.remaining_amount);
      // The tax invoice follows the order's paid amount in the database (P4, OPERATIONS-08).
      setDebtOrders(prev => newRemaining <= 0
        ? prev.filter(o => o.id !== order.id)
        : prev.map(o => o.id === order.id ? { ...o, paidAmount: newPaidAmount, remainingAmount: newRemaining } : o));
      setCustomerUnpaidBalance(prev => Math.max(0, prev - amount));
      toastSuccess(t('pos.debt_order_settled', { order_number: order.orderNumber }));
      await handleViewOrderInvoice(order.id, { orderNumber: order.orderNumber, amountPaid: amount });
    } catch (err) {
      toastError(t('common.error'), getFriendlyErrorMessage(err));
    } finally {
      setSettlingOrderId(null);
    }
  };

  const handleSettleAllDebt = async () => {
    if (debtOrders.length === 0) return;
    const ok = await confirm({ description: t('pos.confirm_settle_all_debt', { amount: customerUnpaidBalance }) });
    if (!ok) return;
    setIsSettlingAllDebt(true);
    try {
      const ordersToSettle = debtOrders;
      const resolvedShiftId = (shiftId && isUuidLike(shiftId)) ? shiftId : null;
      const results = await Promise.allSettled(
        ordersToSettle.map(async (order) => {
          // Same fix as handleSettleDebtOrder above -- route through
          // record_order_payment instead of writing orders.paid_amount
          // directly, so this is a real, shift-attributed payment.
          const { data: result, error } = await supabase.rpc('record_order_payment', {
            p_operation_id: globalThis.crypto.randomUUID(),
            p_order_id: order.id,
            p_amount: order.remainingAmount,
            p_method: 'cash',
            p_shift_id: resolvedShiftId,
          });
          if (error) throw error;
        })
      );
      const failed = results.filter(r => r.status === 'rejected').length;
      const settled = ordersToSettle.filter((_, i) => results[i].status === 'fulfilled');
      setDebtOrders(prev => prev.filter((_, i) => results[i].status === 'rejected'));
      setCustomerUnpaidBalance(
        ordersToSettle.reduce((sum, o, i) => results[i].status === 'rejected' ? sum + o.remainingAmount : sum, 0)
      );
      if (failed > 0) {
        toastError(t('common.error'), t('pos.debt_settle_partial_failure', { count: failed }));
      }
      if (settled.length > 0) {
        toastSuccess(t('pos.debt_settled_all'));
        setIsDebtModalOpen(false);
        if (settled.length === 1) {
          await handleViewOrderInvoice(settled[0].id, { orderNumber: settled[0].orderNumber, amountPaid: settled[0].remainingAmount });
        } else {
          setSettledOrdersSummary(settled.map(o => ({ orderNumber: o.orderNumber, orderId: o.id, amountPaid: o.remainingAmount })));
        }
      }
    } finally {
      setIsSettlingAllDebt(false);
    }
  };

  // Sync state values to refs to avoid stale closure issues in global shortcut event listeners
  const cartRef = React.useRef(cart);
  const isPaymentModalOpenRef = React.useRef(isPaymentModalOpen);
  const completedOrderRef = React.useRef(completedOrder);
  const totalAmountRef = React.useRef<number>(0);
  const loadingRef = React.useRef(loading);
  const handleCheckoutRef = React.useRef<any>(null);
  // seen-launch-readiness-report.md blocker #3: loadingRef above is only
  // updated as a side effect of render (`loadingRef.current = loading`
  // below runs once per render, AFTER setLoading already triggered one) --
  // it still leaves the same gap `if (loading) return` always had. This ref
  // is instead flipped synchronously as the very first statement inside
  // handleCheckout, before any state read or async work, so a second
  // click/Enter event queued before React re-renders sees it true
  // immediately -- not after the next render, which was the actual gap a
  // fresh operationId per click made real (each click's own idempotency key
  // can't catch a sibling click's genuinely separate one).
  const isSubmittingRef = React.useRef(false);

  cartRef.current = cart;
  isPaymentModalOpenRef.current = isPaymentModalOpen;
  completedOrderRef.current = completedOrder;
  loadingRef.current = loading;

  // Read by the keyboard shortcuts (registered once) -- the current value, not the first render's.
  const ordersModuleOnRef = React.useRef(true);
  React.useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
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
                title: t('pos.receipt_print_title'),
              });
              if (!res.ok) {
                // لا نكتفي بالـ console: مع الطباعة الصامتة قد لا تُفتح نافذة
                // طباعة إطلاقاً، فيبقى الكاشير بلا ورق وبلا أي إشعار.
                console.error('[POS] فشل الطباعة السريعة:', res.message);
                toastError(t('printing.print_failed'), res.message);
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
          if (await confirm(t('pos.confirm_clear_cart'))) {
            setCart([]);
          }
        }
        return;
      }

      // 8. Add custom tailor item with F7 or Ctrl+Shift+A
      if (ordersModuleOnRef.current && (e.key === 'F7' || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a'))) {
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

      // 10. Esc also closes the payment drawer itself before checkout, as
      // long as nothing is mid-submit -- previously Esc only worked on the
      // post-checkout success screen, leaving no keyboard way out while
      // filling in the payment form.
      if (e.key === 'Escape' && isPaymentModalOpenRef.current && !completedOrderRef.current && !loadingRef.current) {
        e.preventDefault();
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

  // seen-ux-fixes-batch-task.md #9 follow-up: فئات المخزون المخصصة لكل
  // مستأجر (tenant_categories) بدل القيمة الثابتة category -- تبويبات
  // النقطة تقرأ الآن category_key (الحر) مع رجوع آمن لـcategory (enum
  // القديم) للعناصر التي لا تحمل category_key بعد.
  const { inventoryCategories, isLegacyVertical, capabilities, modules: verticalModules } = useVerticalConfig();
  // A shop that takes no orders (a fabric store) has no «تفصيل جديد» (Phase 6).
  const ordersModuleOn = isOrdersModuleOn(verticalModules);
  const tv = useVerticalTerms();
  ordersModuleOnRef.current = ordersModuleOn;
  // Measurements print only for an activity that takes them (Phase 4).
  const hasBodyMeasurements = measurementSetFor(capabilities.body_measurements).length > 0;
  const posCategorySeed = useMemo(
    () =>
      isLegacyVertical
        ? LEGACY_INVENTORY_CATEGORY_SEED
        : inventoryCategories.map((c) => ({ category_key: c.category_key, label_ar: c.label_ar, measure_kind: c.measure_kind })),
    [isLegacyVertical, inventoryCategories]
  );
  const categoryPicker = useTenantCategoryPicker(tenantId, 'inventory', posCategorySeed);

  const uniqueCategories = React.useMemo(() => {
    // فئات المستأجر الظاهرة (مرتّبة، غير المخفاة) تبقى ظاهرة دوماً كتبويبات
    // ثابتة حتى لو لم يوجد بعد عنصر فيها -- استمرار لنفس سلوك تبويبي
    // "أقمشة/جاهز" الثابتين سابقاً، معمّماً الآن لكل فئات المستأجر.
    const tenantKeys = new Set(categoryPicker.options.map((o) => o.value));
    // فئات على عناصر موجودة فعلياً لكنها غائبة عن tenant_categories (بيانات
    // أقدم من هذا النظام، أو فئة أُخفيت لاحقاً وما زال عنصر قديم يحملها).
    const extraKeys = new Set<string>();
    inventory.forEach((item) => {
      if (item.showInPos === false) return;
      const key = item.category_key || item.category;
      if (key && !tenantKeys.has(key)) extraKeys.add(key);
    });
    return ['all', ...categoryPicker.options.map((o) => o.value), ...Array.from(extraKeys)];
  }, [inventory, categoryPicker.options]);

  const getCategoryLabel = (cat: string) => {
    if (cat === 'all') return t('pos.categories.all');
    const custom = categoryPicker.options.find((o) => o.value === cat);
    if (custom) return custom.label;
    switch (cat) {
      case 'fabric': return t('pos.categories.fabric');
      case 'ready_made': return t('pos.categories.ready_made');
      case 'clothing': return t('pos.categories.clothing');
      case 'accessory': return t('pos.categories.accessory');
      default: return cat.charAt(0).toUpperCase() + cat.slice(1);
    }
  };

  const filteredInventory = useMemo(() => {
    const matchesNonSearch = (item: InventoryItem) =>
      item.showInPos !== false &&
      (selectedCategory === 'all' || (item.category_key || item.category) === selectedCategory);

    const exact = inventory.filter(item =>
      matchesNonSearch(item) &&
      (item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
       item.barcode?.includes(searchQuery) ||
       item.sku?.includes(searchQuery))
    );
    if (exact.length > 0 || !searchQuery.trim()) return exact;

    // Exact match found nothing -- voice search may have mis-transcribed a
    // letter in the item name. Barcode/SKU aren't fuzzy-matched: they're
    // scanned or typed exactly, never spoken.
    return inventory.filter(item => matchesNonSearch(item) && fuzzyIncludes(item.name, searchQuery));
  }, [inventory, selectedCategory, searchQuery]);

  const handleScan = (decodedText: string) => {
    const item = inventory.find(i => i.barcode === decodedText || i.sku === decodedText);
    if (item) {
      if ((itemVariants[item.id] || []).length > 0) {
        // Scanning the parent item's own barcode when it has variants can't
        // tell us which one -- fall back to the picker instead of guessing.
        setVariantPickerItem(item);
        return;
      }
      addToCart(item);
      toastSuccess(t('pos.item_added_from_scan'));
      return;
    }
    // Not a base item's own barcode/SKU -- check if it matches one specific variant instead.
    for (const parentId of Object.keys(itemVariants)) {
      const variant = itemVariants[parentId].find(v => v.barcode === decodedText || v.sku === decodedText);
      if (variant) {
        const parent = inventory.find(i => i.id === parentId);
        if (parent) {
          addToCart(parent, variant);
          toastSuccess(t('pos.item_added_from_scan'));
          return;
        }
      }
    }
    toastError(t('pos.item_not_found'));
  };

  const addToCart = (item: InventoryItem, variant?: ProductVariant) => {
    // Check stock -- a variant's own row, not the base item's (which is 0
    // once an item's stock has fully moved to its variants).
    const availableStock = variant ? (variantStock[variant.id] || 0) : (branchStock[item.id] || 0);

    // Find current quantity in cart -- keyed by (itemId, variantId) so two
    // variants of the same item stay separate lines.
    const existingInCart = cart.find(i => i.type === 'ready_made' && i.itemId === item.id && (i.variantId || undefined) === variant?.id);
    const currentQtyInCart = existingInCart ? existingInCart.quantity : 0;

    const displayName = variant ? `${item.name} — ${variant.name}` : item.name;
    // Sold by length (fabric store, any length category -- Phase 5 of
    // seen-verticals-readiness-task.md): the quantity is metres, a quarter
    // metre at a time; stock is kept in metres too.
    const isLength = isLengthItem(item as any);
    const addStep = isLength ? LENGTH_STEP_METERS : 1;

    if (availableStock <= 0) {
      toastError(t('pos.out_of_stock'), `${displayName} (${t('inventory.available')}: 0)`);
      return;
    }

    if (currentQtyInCart + (isLength && currentQtyInCart === 0 ? firstLengthQuantity(availableStock) : addStep) > availableStock) {
      toastError(t('pos.insufficient_stock'), `${displayName} (${t('inventory.available')}: ${availableStock})`);
      return;
    }

    setCart(prev => {
      const existing = prev.find(i => i.type === 'ready_made' && i.itemId === item.id && (i.variantId || undefined) === variant?.id);
      if (existing) {
        return prev.map(i => i === existing ? { ...i, quantity: isLength ? roundMeters(i.quantity + addStep) : i.quantity + 1 } : i);
      }
      return [...prev, {
        id: Math.random().toString(36).substr(2, 9),
        type: 'ready_made',
        itemId: item.id,
        variantId: variant?.id,
        name: displayName,
        nameEn: item.nameEn,
        price: item.pricePerUnit + (variant?.priceAdjustment || 0),
        taxType: item.taxType || 'exclusive',
        image: item.mainImage || item.images?.[0] || '',
        quantity: isLength ? firstLengthQuantity(availableStock) : 1,
        ...(isLength ? { isLength: true, conversionRate: Number(item.conversionRate) || 0, lengthUnit: 'meter' as LengthUnit } : {}),
      } as OrderItem];
    });
    // On mobile, maybe show the cart after adding?
    // setShowCartOnMobile(true);
  };

  /** Click handler for a POS product tile -- opens the variant picker instead of adding directly when the item has variants. */
  const handleProductTileClick = (item: InventoryItem) => {
    const variants = itemVariants[item.id] || [];
    if (variants.length > 0) {
      setVariantPickerItem(item);
      return;
    }
    addToCart(item);
  };

  /** Stock badge for a product tile: the base item's own stock, or the sum across its variants once it has any. */
  const getItemDisplayStock = (item: InventoryItem) => {
    const variants = itemVariants[item.id] || [];
    if (variants.length === 0) return branchStock[item.id] || 0;
    return variants.reduce((sum, v) => sum + (variantStock[v.id] || 0), 0);
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

  const removeFromCart = (id: string) => {
    setCart(prev => prev.filter(i => i.id !== id));
  };

  const handleSaveCustomer = async () => {
    if (!newCustomerName || !newCustomerPhone) {
      toastError(t('common.error'), t('pos.enter_customer_name_and_phone'));
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
      toastSuccess(t('pos.customer_added'));
    } catch (error) {
      console.error('Error adding customer:', error);
      toastError(t('common.error'), t('pos.add_customer_failed'));
    } finally {
      setIsSavingCustomer(false);
    }
  };

  const updateQuantity = (id: string, delta: number) => {
    let stockExceeded = false;
    setCart(prev => prev.map(i => {
      if (i.id === id) {
        const newQuantity = (i as any).isLength
          ? stepMeters(i.quantity, delta > 0 ? 1 : -1)
          : Math.max(1, i.quantity + delta);
        if (i.type === 'ready_made' && i.itemId) {
          const availableStock = i.variantId ? (variantStock[i.variantId] || 0) : (branchStock[i.itemId] || 0);
          if (newQuantity > availableStock) {
            stockExceeded = true;
            return i;
          }
        }
        return { ...i, quantity: newQuantity };
      }
      return i;
    }));
    if (stockExceeded) {
      toastError(t('pos.insufficient_stock'));
    }
  };

  /** A length line's quantity typed in metres / yards / rolls (Phase 5): stored in metres, checked against the stock in metres. */
  const setLengthQuantity = (id: string, value: number, unit: LengthUnit) => {
    let stockExceeded = false;
    let invalid = false;
    setCart(prev => prev.map(i => {
      if (i.id !== id) return i;
      const meters = toMeters(value, unit, Number((i as any).conversionRate) || 0);
      if (meters === null) { invalid = true; return i; }
      if (i.itemId) {
        const availableStock = i.variantId ? (variantStock[i.variantId] || 0) : (branchStock[i.itemId] || 0);
        if (meters > availableStock) { stockExceeded = true; return i; }
      }
      return { ...i, quantity: meters, lengthUnit: unit } as OrderItem;
    }));
    if (stockExceeded) toastError(t('pos.insufficient_stock'));
    else if (invalid) toastError(t('pos.length_quantity_invalid', 'أدخل كمية أكبر من صفر'));
  };

  // مراجعة-الفريق-التقني-الكامل-2026-10-19.md (QA، حرجة): مستخرَج الآن إلى
  // src/utils/cartTotals.ts (computeCartTotals) -- نفس الصيغ بالضبط، بلا أي
  // تغيير سلوكي -- ليصبح قابلاً للاختبار بمعزل عن POS.tsx كاملاً (انظر
  // cartTotals.test.ts).
  const {
    isTaxEnabled,
    vatRate,
    subTotalAmount,
    calculatedDiscountAmount,
    discountedSubtotal,
    taxAmount,
    totalAmount,
  } = computeCartTotals(cart, taxSettings, discountType, discountValue);
  totalAmountRef.current = totalAmount;

  const handleCheckout = async () => {
    // Real synchronous re-entrancy guard (see isSubmittingRef's own comment
    // above) -- must be the first thing this function does, before any
    // other check or async work.
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    try {
    if (loading) return;
    if (cart.length === 0) {
      toastError(t('pos.empty_cart'), t('pos.add_products_to_checkout'));
      return;
    }

    // Verify stock before checkout for ready_made items
    for (const item of cart) {
      if (item.type === 'ready_made' && item.itemId) {
        const availableStock = item.variantId ? (variantStock[item.variantId] || 0) : (branchStock[item.itemId] || 0);
        if (item.quantity > availableStock) {
          toastError(t('pos.insufficient_stock_checkout'), `${item.name} (${t('inventory.available')}: ${availableStock})`);
          return;
        }
      }
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
      const b2bCompanyName = isB2B ? b2bData.companyName : '';
      const b2bTRN = isB2B ? b2bData.trn : '';
      
      if (isB2B) {
         if (!b2bCompanyName || !b2bTRN) {
             toastError(t('common.missing_data'), t('pos.b2b_requires_company_and_trn'));
             setLoading(false);
             return;
         }
         invoiceType = 'standard_b2b';
      }

      // ZATCA Phase 0 (seen-zatca-readiness-task.md): this used to fall
      // back to a placeholder trade name/TRN ("مؤسسة وضوح الشاملة" --
      // literally a leftover from the "wdooh" template this app was built
      // on -- and TRN 300000000000003) whenever a tenant hadn't filled in
      // real tax settings yet, silently printing a fake business name and
      // tax number on a real customer-facing tax invoice with no warning.
      // Blocked outright now instead: no invoice may be issued under a
      // fabricated identity.
      //
      // Only enforced when tax invoicing is actually enabled (isTaxEnabled)
      // or the sale itself is marked B2B (a standard tax invoice always
      // needs the seller's own TRN, regardless of the tenant-wide toggle).
      // A merchant who hasn't turned isTaxEnabled on (the default) has no
      // TRN/legal-name fields in Settings at all, so this used to block
      // every sale, plain B2C included, with no way out of the app's own UI
      // (found live via /qa-test on staging: 2026-09-20).
      // P3.1 / RELIABILITY-11: never sell without VAT because the settings
      // could not be loaded (offline, nothing kept on this device yet).
      if (taxSettingsUnavailable) {
        toastError(
          t('pos.tax_settings_offline_title', 'تعذّر تحميل إعدادات الضريبة'),
          t('pos.tax_settings_offline_desc', 'اتصل بالإنترنت مرة واحدة ليحفظ الجهاز إعدادات الضريبة، ثم يمكنك البيع بدون إنترنت.')
        );
        setLoading(false);
        return;
      }

      if ((isTaxEnabled || isB2B) && !hasValidTaxSettings(taxSettings)) {
        toastError(
          t('pos.tax_settings_required_title', 'أكمل إعدادات الضريبة أولاً'),
          t('pos.tax_settings_required_desc', 'يجب إدخال الاسم التجاري والرقم الضريبي الحقيقيين في الإعدادات قبل إصدار أي فاتورة.')
        );
        setLoading(false);
        return;
      }

      // P3.2: whole seconds, the way the server writes the time into the QR.
      const timestamp = saleTimestamp();
      const sellerName = taxSettings?.legalName;
      const trn = taxSettings?.trn;

      // seen-cto-sprint1-financial-engine-task.md (POS-01): the QR used to
      // be built here from totalAmount/taxAmount computed in THIS browser,
      // before create_pos_sale ever ran -- exactly the "browser is the
      // source of truth" pattern this fix closes. The real QR (built from
      // the server's own authoritative total/tax, with the real seller
      // name/TRN read from the tenant row, not whatever this tab had
      // loaded) now comes back from create_pos_sale itself once the sale
      // succeeds (see saleResult.qr_code below). This client-side
      // generateZatcaQR() call only remains as a last-resort placeholder
      // for the OFFLINE-QUEUED path, where no server round-trip has
      // happened yet to get a real one from.
      const isUuid = (val: string | undefined | null) =>
        val ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val) : false;

      const customerId = (selectedCustomer?.id && isUuid(selectedCustomer.id)) ? selectedCustomer.id : null;
      const customerName = selectedCustomer?.name || 'عميل نقدي';
      let invoiceNumber = `INV-${orderNumber}`;

      /* --------------------------------------------------------------------
         Was: 6 separate writes with no shared transaction (orders ->
         order_items -> order_history -> tax_invoices -> audit log -> a
         per-item stock deduction loop whose failures were only
         console.error'd). Any interruption mid-sequence left an order with
         no items, no invoice, or silently un-deducted stock.

         One atomic, idempotent RPC instead (seen-offline-sync-architecture
         -task.md Phase 0) -- operationId doubles as the new order's id, so
         a retried submission after a dropped connection can never create
         the sale twice, and any failure (including insufficient stock)
         rolls back the whole sale instead of leaving it half-written.
         -------------------------------------------------------------------- */
      const operationId = globalThis.crypto.randomUUID();

      const salePayload = {
        p_operation_id: operationId,
        p_order: {
          // branch_id/total_amount/tax_amount/discount_amount/tax_rate/
          // qr_code/order_number are no longer sent -- create_pos_sale now
          // derives branch_id from the open shift itself and computes every
          // money figure and both numbers server-side from the tenant's own
          // catalog/tax settings/role-based discount cap (POS-01). Sending
          // stale client-computed versions of them would just be ignored by
          // the RPC, so they're left out entirely rather than kept as dead
          // weight that looks authoritative but isn't.
          shift_id: (shiftId && isUuid(shiftId)) ? shiftId : null,
          customer_id: customerId,
          customer_name: customerName,
          status: orderStatus,
          payment_method: paymentMethod,
          // paid_amount is still the cashier's own input -- it's what they
          // actually received -- but the RPC now validates it against the
          // REAL total it computes, not the client's estimate.
          paid_amount: Number(paidAmount) >= 0 ? Number(paidAmount) : 0,
          order_date: timestamp,
          delivery_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          notes: encodeOrderB2BNotes(isB2B ? b2bCompanyName : '', isB2B ? b2bTRN : ''),
        },
        p_items: cart.map(item => ({
          type: item.type,
          status: item.type === 'custom' ? orderStatus : null,
          item_id: (item.type === 'ready_made' && item.itemId && isUuid(item.itemId)) ? item.itemId : null,
          variant_id: (item.type === 'ready_made' && item.variantId && isUuid(item.variantId)) ? item.variantId : null,
          name: item.name || item.garmentType || 'منتج مخصص',
          garment_type: item.garmentType || null,
          fabric: item.fabric || null,
          fabric_id: (item.type === 'custom' && item.fabricId) ? item.fabricId : null,
          quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
          // A length line's quantity is metres (Phase 5).
          selected_unit: (item as any).isLength ? 'meter' : (item.selectedUnit || null),
          consumed_meters: item.consumedMeters ? Number(item.consumedMeters) : null,
          price: Number(item.price) >= 0 ? Number(item.price) : 0,
          closure_type: item.closureType || null,
          closure_visibility: item.closureVisibility || null,
          collar_type: item.collarType || null,
          cuff_type: item.cuffType || null,
          pocket_type: item.pocketType || null,
          chest_style: item.chestStyle || null,
          shoulder_style: item.shoulderStyle || null,
          cutting_type: item.cuttingType || null,
          collar_padding: item.collarPadding || null,
          additions: item.additions || null,
          embroidery: item.embroidery || null,
          measurements: (item as any).measurements || {}
        })),
        p_invoice: {
          // invoice_number/subtotal are no longer read by the RPC either --
          // the server allocates its own sequential invoice number and
          // derives subtotal from its own totals (POS-01, POS-19).
          // discount_type/discount_value are the cashier's actual
          // intent -- the RPC caps the applied amount by the caller's own
          // role server-side and returns what was really applied.
          discount_type: discountType,
          discount_value: Number(discountValue) >= 0 ? Number(discountValue) : 0,
          vat_number: b2bTRN || null,
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
        }
      };

      let queuedOffline = false;
      // P3.2: offline with no reserved number left -- a provisional receipt, not a tax invoice.
      let provisionalReceipt = false;

      // Wrapped in its own try/catch: postgrest-js normally resolves with
      // {error} even on a network failure, but that's an implementation
      // detail of the library, not a guarantee -- a thrown exception here
      // must reach the exact same isNetworkFailure/enqueuePosSale fallback
      // below instead of skipping straight to the outer catch, which
      // previously showed a generic "connection failed" toast with no
      // print and nothing queued.
      let saleResult: any = null;
      let saleError: any = null;
      try {
        // P3.3 / RELIABILITY-10: a slow or stuck server is treated as offline after
        // 15 seconds -- the sale goes to the queue (create_pos_sale is idempotent).
        const res = await supabase.rpc('create_pos_sale', salePayload).abortSignal(AbortSignal.timeout(SALE_TIMEOUT_MS));
        saleResult = res.data;
        saleError = res.error ? Object.assign(res.error, { status: res.status }) : null;
      } catch (rpcThrow) {
        saleError = rpcThrow;
      }

      if (saleError) {
        const failureAction = decidePosSaleFailureAction(saleError, isB2B);
        if (failureAction.kind === 'rethrow') throw saleError;
        if (failureAction.kind === 'b2b_offline_blocked') {
          throw new Error(t('pos.b2b_requires_connection', 'الفواتير الضريبية القياسية (B2B) تتطلب اتصالاً حياً بالإنترنت — لا يمكن إصدارها أوفلاين.'));
        }
        // P3.2 / RELIABILITY-02: the number and the time printed are the ones
        // the server keeps (a slot reserved for this device, and sold_at).
        const reserved = tenantId ? takeOfflineNumber(tenantId) : null;
        await enqueuePosSale(operationId, {
          ...salePayload,
          p_order: {
            ...salePayload.p_order,
            sold_at: timestamp,
            ...(reserved ? { offline_number: { block_id: reserved.block_id, slot: reserved.slot } } : {}),
          },
        });
        queuedOffline = true;
        provisionalReceipt = !reserved;
        if (reserved) invoiceNumber = `INV-${reserved.invoiceNumber}`;
        // No server round-trip has happened yet to get a real QR/total
        // from (see the finalTotal/finalTaxAmount fallback below) -- this
        // is a best-effort estimate from this tab's own cart math purely
        // so the printed receipt isn't blank while offline; the real
        // numbers (and tax reporting) only exist once the queue replays.
        qrCodeBase64 = (isTaxEnabled || isB2B) && !provisionalReceipt
          ? generateZatcaQR(sellerName, trn, timestamp, totalAmount.toFixed(2), taxAmount.toFixed(2))
          : '';
      }

      const newOrder = { id: operationId };
      // Only available when the sale actually reached the server (not
      // queued offline) -- create_pos_sale returns the order's real
      // tracking_token (seen-whatsapp-instant-send-task.md follow-up:
      // needed for the WhatsApp invoice link, /track/:token -- the public,
      // no-auth customer tracking page, not the nonexistent /order/:id
      // this used to build).
      const trackingToken: string | undefined = !queuedOffline ? saleResult?.tracking_token : undefined;

      // seen-cto-sprint1-financial-engine-task.md (POS-01): once the sale
      // actually reached the server, print/show the numbers IT computed
      // (catalog prices, role-capped discount, real VAT) -- never the
      // client's own pre-submit estimate, which may differ (e.g. a
      // discount the cashier typed got capped by their role). The
      // client-computed totals remain the fallback only for a sale that
      // got queued offline, where no server round-trip has happened yet
      // to get real numbers from -- that receipt is necessarily a
      // best-effort estimate until the queue replays.
      const finalTotal = !queuedOffline && saleResult ? Number(saleResult.total_amount) : totalAmount;
      const finalSubtotal = !queuedOffline && saleResult ? Number(saleResult.subtotal) : subTotalAmount;
      const finalTaxAmount = !queuedOffline && saleResult ? Number(saleResult.tax_amount) : taxAmount;
      const finalDiscountAmount = !queuedOffline && saleResult ? Number(saleResult.discount_amount) : calculatedDiscountAmount;
      if (!queuedOffline && saleResult) {
        invoiceNumber = saleResult.invoice_number || invoiceNumber;
        qrCodeBase64 = saleResult.qr_code || '';
      }
      // مراجعة-الفريق-التقني-الكامل-2026-10-19.md (امتثال، حرجة): كان رفض
      // زاتكا لفاتورة B2B يُكتشَف بعد فوات الأوان -- toast عابر بعد أن
      // الكاشير رأى شاشة "تم بنجاح" وربما سلّم الفاتورة للعميل فعلاً. زاتكا
      // نفسها تتطلب Clearance متزامنة لفواتير B2B تحديداً (بعكس Reporting
      // غير المتزامنة خلال 24 ساعة لفواتير B2C) -- فالانتظار هنا قبل
      // اعتبار البيع مكتملاً هو السلوك الصحيح تقنياً، لا مجرد تشديد. هذا
      // لا يُلغي البيع/خصم المخزون المُلتزَم بهما فعلاً داخل create_pos_sale
      // (لا توجد بعد RPC عكس/إلغاء مخصّصة لذلك)، لكنه يمنع ظهور الأمر وكأنه
      // اكتمل بنجاح ضريبياً بينما زاتكا رفضته فعلياً -- الكاشير يرى تنبيهاً
      // حاجباً (alertModal) يجب إقراره صراحة قبل المتابعة، لا toast عابر.
      let zatcaRejected = false;
      if (!queuedOffline) {
        void notifyNewOrderForStaff(newOrder.id);
        if (tenantId) void topUpOfflineNumbers(tenantId);
        if (isB2B) {
          // loading (مضبوطة true بالفعل أعلى الدالة) تبقى كما هي خلال هذا
          // الانتظار -- زر الدفع يبقى معطَّلاً/بحالة تحميل، لا حاجة لحالة نص جديدة.
          const zatcaResult = await submitZatcaInvoice(newOrder.id, isB2B);
          if (zatcaResult.status === 'rejected') {
            zatcaRejected = true;
            await alertModal({
              title: t('pos.zatca_clearance_rejected_title', 'رفضت زاتكا الفاتورة'),
              description: t('pos.zatca_clearance_rejected_desc', 'تم تسجيل البيع والمخزون محلياً، لكن زاتكا رفضت اعتماد الفاتورة الضريبية. هذا البيع يحتاج مراجعة يدوية فورية من سجل الفواتير الضريبية -- لا تُسلِّم هذه الفاتورة للعميل كفاتورة ضريبية سارية.',
              ),
              danger: true,
            });
          }
        } else {
          // B2C: Reporting غير متزامنة خلال 24 ساعة حسب مواصفة زاتكا نفسها
          // -- الانتظار هنا غير مطلوب ولا مبرَّر، يبقى "أرسل ولا تنتظر" كما كان.
          void submitZatcaInvoice(newOrder.id, isB2B);
        }
      }

      setCart([]);
      setSelectedCustomer(null);
      setIsB2B(false);
      setB2bData({ companyName: '', trn: '' });
      setPaidAmount(0);
      setCompletedOrder({
         id: newOrder.id,
         trackingToken,
         invoiceNumber,
         invoiceType,
         paymentMethod: paymentMethod,
         total: finalTotal,
         subTotal: finalSubtotal,
         taxAmount: finalTaxAmount,
         discountAmount: finalDiscountAmount,
         // Was absent entirely -- the printed receipt (invoiceData below)
         // had no way to know this sale was a partial payment, so it always
         // showed the full grand total as "paid" with nothing remaining,
         // even though paidAmount was already tracked in POS state and
         // already sent to the server (paid_amount in handleCheckout above).
         paidAmount: Number(paidAmount) >= 0 ? Number(paidAmount) : 0,
         customerName,
         customerPhone: selectedCustomer?.phone,
         customerVat: b2bTRN,
         items: cart.map(item => ({
           name: item.name || item.garmentType || 'منتج مخصص',
           quantity: item.quantity,
           // «2.5 م × السعر» for a line sold by length (Phase 5).
           quantityUnit: (item as any).isLength ? t('pos.unit_meter_short', 'م') : undefined,
           price: item.price,
           // Was dropped here -- every printed receipt line item rendered
           // as if it were VAT-inclusive regardless of how this product is
           // actually configured (ProductFormFields.tsx lets a product be
           // exclusive or exempt too).
           taxType: item.taxType,
           measurements: hasBodyMeasurements ? buildInvoiceMeasurements(item, selectedCustomer, t, measurementUnit) : undefined
         })),
         qrCode: qrCodeBase64,
         issuedAt: timestamp,
         provisional: provisionalReceipt,
      });
      try {
        await fetchCashDrawerBalance();
      } catch (err) {
        console.error('Failed to trigger fetchCashDrawerBalance after order:', err);
      }
      if (!queuedOffline) {
        router.refresh();
      }
      if (queuedOffline) {
        toastSuccess(
          t('pos.sale_queued_offline_title', 'سُجِّلت الفاتورة محلياً'),
          provisionalReceipt
            ? t('pos.sale_queued_provisional_desc', 'طُبع إيصال مؤقت (لا توجد أرقام فواتير محجوزة على هذا الجهاز). تصدر الفاتورة الضريبية فور عودة الإنترنت.')
            : t('pos.sale_queued_offline_desc', 'لا يوجد اتصال حالياً — ستُرسَل تلقائياً للخادم فور عودة الإنترنت.')
        );
      } else if (zatcaRejected) {
        // alertModal الحاجبة أعلى الدالة أبلغت الكاشير صراحة بالفعل -- toast
        // "تم بنجاح" هنا سيناقض تلك الرسالة مباشرة، فلا داعي له إطلاقاً.
      } else if (saleResult?.stock_conflicts > 0) {
        /* Phase 4: a stock deduction lost the race against another
           (likely offline) device selling the same item -- the sale
           itself still succeeded and must not be hidden as a failure,
           but the cashier needs to know a line needs manual stock
           reconciliation. */
        toastError(
          t('pos.stock_conflict_title', 'الفاتورة صدرت، لكن يوجد تعارض مخزون'),
          t('pos.stock_conflict_desc', 'صنف واحد أو أكثر بِيع أكثر من المتاح فعلياً (على الأرجح جهاز آخر باع نفس القطعة). راجع المخزون يدوياً.')
        );
      } else {
        toastSuccess(t('pos.tax_invoice_issued'));
      }

      if (isAutoPrintEnabled && !zatcaRejected) {
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
              title: t('pos.cashier_invoice_print_title'),
            });
            if (!res.ok) {
              console.error('Print failed in POS:', res.message);
              toastError(t('printing.print_failed'), res.message);
            }
          } catch (printErr) {
            console.error('Print error in POS:', printErr);
            window.print();
          }
        }, 250);
      }
    } catch (error) {
      console.error('Checkout error:', error);
      handleError(error as any, t('pos.checkout_failed'));
    } finally {
      setLoading(false);
    }
    } finally {
      isSubmittingRef.current = false;
    }
  };
  handleCheckoutRef.current = handleCheckout;

  const renderCartPanel = (isMobilePanel: boolean = false) => {
    return (
      <div className="flex flex-col h-full bg-surface">
        {/* Cart Header */}
        <div className="p-4 main-640:px-6 main-640:py-5 border-b border-border flex items-center justify-between shrink-0 relative">
          <div className="flex items-center gap-2">
            {isMobilePanel && <div className="main-720:hidden w-10 h-1 bg-border rounded-full absolute top-2 left-1/2 -translate-x-1/2" />}
            <ShoppingCart size={22} className="text-brand" />
            <h2 className="text-base main-900:text-lg font-black text-content">
              {t('pos.cart_title')}
            </h2>
            <span className="bg-brand/10 text-brand text-sm px-2.5 py-0.5 rounded-full font-black">{cart.length}</span>
          </div>
          {isMobilePanel && (
            <button
              onClick={() => setShowCartOnMobile(false)}
              aria-label={t('common.close')}
              className="p-2 text-content-muted hover:bg-surface-muted rounded-full transition-all cursor-pointer"
            >
              <X size={20} />
            </button>
          )}
        </div>

        {/* Customer Selector */}
        <div className="p-4 main-640:px-6 main-640:py-5 border-b border-border space-y-3 z-30 shrink-0">
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
                  placeholder={t('pos.search_customer')}
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
                      <span className="block truncate font-bold text-sm">{t('pos.walk_in_customer')}</span>
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
                        <span className="block truncate font-bold text-sm">{person.name}</span>
                        <span className="block text-sm opacity-80">{person.phone}</span>
                      </Combobox.Option>
                    ))}
                  </Combobox.Options>
                </Transition>
              </div>
            </Combobox>
            <button 
              onClick={() => setIsAddCustomerModalOpen(true)}
              className="p-2.5 bg-surface-muted border border-border rounded-xl text-content-muted hover:text-brand hover:border-brand/50 transition-all flex items-center justify-center shrink-0 cursor-pointer"
              title={t('pos.add_new_customer')}
            >
              <UserPlus size={18} />
            </button>
          </div>
          {selectedCustomer && (
            <div className="p-3 bg-surface-muted border border-border rounded-xl space-y-1.5 text-sm">
              <div className="flex justify-between items-center text-content-muted">
                <span className="font-medium">{t('pos.customer_name')}</span>
                <span className="font-black text-content">{selectedCustomer.name}</span>
              </div>
              <div className="flex justify-between items-center text-content-muted">
                <span className="font-medium">{t('pos.customer_phone')}</span>
                <span className="font-mono font-bold text-content">{selectedCustomer.phone}</span>
              </div>
              {customerUnpaidBalance > 0 ? (
                <div className="mt-2 p-2 bg-[var(--seen-danger-bg)] border border-danger/20 text-danger rounded-lg flex flex-col gap-2">
                  <div className="flex justify-between items-center font-bold">
                    <span>{t('pos.previous_due_balance')}</span>
                    <span className="font-mono font-black text-sm text-danger">
                      <PriceDisplay amount={customerUnpaidBalance} />
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsDebtModalOpen(true)}
                    className="w-full py-1.5 bg-danger text-white rounded-md text-sm font-black hover:bg-danger/90 transition-colors cursor-pointer"
                  >
                    {t('pos.settle_debt')}
                  </button>
                </div>
              ) : (
                <div className="mt-2 p-1.5 px-2 bg-[var(--seen-success-bg)] border border-success/20 text-success rounded-lg text-center font-bold text-sm">
                  {t('pos.no_previous_due')}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Cart Items List */}
        <div className="flex-1 overflow-auto p-4 main-640:px-6 main-640:py-5 space-y-3">
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
                    ? "border-brand ring-2 ring-brand shadow-2xl z-50 relative bg-surface scale-[1.02]"
                    : "bg-surface border-border hover:border-brand/50",
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
                      <div className="w-full h-full bg-surface-muted border border-border rounded-lg flex items-center justify-center text-content-muted">
                        <ImageIcon size={18} />
                      </div>
                    )}
                    {item.type === 'ready_made' && (
                      <label className="absolute -bottom-1 -end-1 w-5 h-5 flex items-center justify-center bg-brand text-white rounded-full cursor-pointer shadow-sm border-2 border-surface transition-transform hover:scale-110">
                        <Camera size={11} />
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
                        <span className="px-2 py-0.5 bg-brand/10 text-brand text-sm font-bold rounded-md flex items-center gap-1">
                          <Scissors size={12} />
                          {tv('pos.type_custom')}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-content-muted/10 text-content-muted text-sm font-bold rounded-md flex items-center gap-1">
                          <Package size={12} />
                          {t('pos.type_ready_made')}
                        </span>
                      )}
                      <span className="font-medium text-content line-clamp-1">
                        {item.type === 'custom' ? item.garmentType : (i18n.language === 'en' && item.nameEn ? item.nameEn : item.name)}
                      </span>
                    </div>
                    <div className="text-brand font-bold">
                      <PriceDisplay amount={item.price} />
                      {(item as any).isLength && <span className="text-sm text-content-muted font-bold"> / {t('pos.per_meter', 'للمتر')}</span>}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    {(item as any).isLength ? (
                      <LengthQuantityControl
                        meters={item.quantity}
                        unit={((item as any).lengthUnit as LengthUnit) || 'meter'}
                        metersPerRoll={Number((item as any).conversionRate) || 0}
                        onStep={(dir) => updateQuantity(item.id!, dir)}
                        onCommit={(value, unit) => setLengthQuantity(item.id!, value, unit)}
                      />
                    ) : (
                    <div className="flex items-center gap-2 bg-surface-muted border border-border rounded-lg p-1">
                      <button onClick={() => updateQuantity(item.id!, -1)} aria-label={t('pos.decrease_quantity')} className="w-11 h-11 flex items-center justify-center hover:bg-surface-muted rounded transition-colors">-</button>
                      <span className="w-6 text-center font-bold text-content">{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.id!, 1)} aria-label={t('pos.increase_quantity')} className="w-11 h-11 flex items-center justify-center hover:bg-surface-muted rounded transition-colors">+</button>
                    </div>
                    )}
                    <button onClick={() => removeFromCart(item.id!)} aria-label={t('pos.remove_item')} className="p-3 text-danger hover:bg-danger/10 rounded-lg transition-colors cursor-pointer">
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>

                {/* Expanded Details when focused */}
                {focusedItemId === item.id && item.type === 'ready_made' && (
                  <div className="mt-3 pt-3 border-t border-border flex flex-wrap gap-2 animate-in fade-in slide-in-from-top-1">
                    <button 
                      className="text-sm font-black text-brand bg-brand/5 px-2 py-1 rounded-md uppercase cursor-pointer"
                      onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = 'image/*';
                        input.onchange = (e: any) => handleItemImageUpload(item.id!, e);
                        input.click();
                      }}
                    >
                      {t('pos.change_image')}
                    </button>
                  </div>
                )}
              </div>
          ))}
          {cart.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-content-muted space-y-2 py-12">
              <ShoppingCart size={48} className="opacity-20" />
              <p>{t('pos.empty_cart')}</p>
            </div>
          )}
        </div>

        {/* Order Summary Block */}
        <div className="p-4 main-640:px-6 main-640:py-5 border-t border-border bg-surface shrink-0">
          <div className="space-y-2 mb-4">
            <div className="flex justify-between items-center text-sm">
              <span className="text-content-muted font-bold">{t('pos.subtotal')}</span>
              <span className="text-content font-black"><PriceDisplay amount={subTotalAmount} /></span>
            </div>
            
            {calculatedDiscountAmount > 0 && (
              <div className="flex justify-between items-center text-sm text-brand font-bold">
                <span>{t('pos.discount_applied')}</span>
                <span className="font-black relative flex items-center">
                  -<PriceDisplay amount={calculatedDiscountAmount} className="inline-flex ms-1" />
                </span>
              </div>
            )}

            {isTaxEnabled && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-content-muted font-bold">{t('pos.vat')} ({vatRate}%)</span>
                <span className="text-content font-black"><PriceDisplay amount={taxAmount} /></span>
              </div>
            )}
          </div>
          
          <div className="flex justify-between items-center mb-4 pt-3 border-t border-border">
            <span className="text-content-muted font-black uppercase text-sm">
              {t('pos.grand_total')} {isTaxEnabled && t('pos.inclusive_vat')}
            </span>
            <span className="text-xl main-640:text-2xl font-black text-brand"><PriceDisplay amount={totalAmount} /></span>
          </div>

          <button
            onClick={() => {
               setIsPaymentModalOpen(true);
               setPaidAmount(totalAmount);
            }}
            disabled={cart.length === 0}
            className="w-full py-3.5 main-640:py-4 bg-success hover:bg-success/90 text-white rounded-2xl font-black text-base main-640:text-lg transition-all active:scale-[0.98] disabled:opacity-50 disabled:grayscale disabled:scale-100 flex items-center justify-center gap-2.5 cursor-pointer"
          >
            <CreditCard size={22} />
            <span>{t('pos.checkout_and_pay')}</span>
          </button>
        </div>
      </div>
    );
  };

const invoiceData: InvoiceData | null = completedOrder ? {
  invoiceNumber: completedOrder.invoiceNumber,
  provisional: Boolean(completedOrder.provisional),
  issueDate: completedOrder.issuedAt,
  paymentMethod: completedOrder.paymentMethod || 'cash',
  seller: {
    // No fake fallback here either (ZATCA Phase 0) -- by the time
    // completedOrder exists, handleCheckout's own guard above has already
    // confirmed taxSettings.trn/legalName are real, so this only ever
    // renders genuine tenant data.
    name: brandingSettings?.storeName || taxSettings?.legalName || '',
    vatNumber: taxSettings?.trn || '',
  },
  customer: {
    name: completedOrder.customerName || 'عميل نقدي',
    vatNumber: completedOrder.customerVat || undefined
  },
  items: completedOrder.items.map((item: any, index: number) => ({
    id: index,
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.price,
    taxType: item.taxType
  })),
  subtotal: completedOrder.subTotal,
  vatAmount: completedOrder.taxAmount,
  discountAmount: completedOrder.discountAmount,
  // Was absent entirely -- see the completedOrder.paidAmount comment above.
  paidAmount: completedOrder.paidAmount,
  grandTotal: completedOrder.total,
  qrValue: completedOrder.qrCode,
  invoiceType: completedOrder.invoiceType
} : null;

  // The user's own customizable template (WhatsAppSettings), not a fixed
  // string -- the invoice share message must match what they configured.
  // invoiceUrl was missing entirely here (seen-whatsapp-instant-send-
  // task.md) -- the default template's {invoice_url} tag resolved to an
  // empty string on every message sent from this, the single most-used
  // WhatsApp send point in the whole system (it appears right after every
  // POS sale). Uses /track/:token (the real, working, no-auth public
  // tracking page) -- NOT /order/:id, which doesn't exist as a route at
  // all (confirmed in App.tsx: any unmatched path just redirects to "/"),
  // despite that being the pattern Orders.tsx's own buildOrderWhatsAppMessage
  // used. trackingToken is only known once the sale actually reached the
  // server (create_pos_sale's return value) -- absent for a queued-offline
  // sale, in which case the link is simply omitted rather than built from
  // a dead route.
  const buildInvoiceMessage = (phone?: string) => buildWhatsAppMessage(getWhatsAppTemplate(), {
    customerName: completedOrder?.customerName,
    orderId: completedOrder?.invoiceNumber,
    totalAmount: completedOrder?.total,
    customerPhone: phone,
    invoiceUrl: completedOrder?.trackingToken ? `${window.location.origin}/track/${completedOrder.trackingToken}` : undefined,
    storeName: brandingSettings?.storeName || t('pos.store_default'),
  });

  const proceedToWhatsApp = (phone: string) => {
    window.open(`https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(buildInvoiceMessage(phone))}`, '_blank');
    setWhatsappModalOpen(false);
  };

  // seen-whatsapp-instant-send-task.md: used to await
  // shareOrDownloadInvoicePDF (a full html-to-image render) BEFORE opening
  // WhatsApp -- by the time it resolved, the click's "user activation"
  // window had often already expired, so Chrome/Edge silently blocked the
  // window.open as an unwanted popup with no visible error. Now opens
  // WhatsApp immediately, synchronously, in the same click handler.
  // Attaching the invoice as an actual PDF file is a separate, explicit,
  // optional action now (handleAttachInvoicePdf below).
  const handleShareWhatsApp = () => {
    if (!completedOrder) return;
    const knownPhone = completedOrder.customerPhone ? formatSaudiPhone(completedOrder.customerPhone).replace('+', '') : '';
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
    if (!completedOrder) return;
    const filename = `Invoice-${completedOrder.invoiceNumber}.pdf`;
    const knownPhone = completedOrder.customerPhone ? formatSaudiPhone(completedOrder.customerPhone).replace('+', '') : '';
    const text = buildInvoiceMessage(knownPhone || undefined);
    await shareOrDownloadInvoicePDF('pos-invoice-print-area', filename, text);
  };

  return (
    <div className="h-full flex flex-col main-720:flex-row font-sans bg-surface text-content overflow-hidden w-full" dir={isRtl ? 'rtl' : 'ltr'}>
      <ScannerModal isOpen={isScannerOpen} onClose={() => setIsScannerOpen(false)} onScan={handleScan} />
      {variantPickerItem && (
        <VariantPickerModal
          isOpen={!!variantPickerItem}
          onClose={() => setVariantPickerItem(null)}
          item={variantPickerItem}
          variants={itemVariants[variantPickerItem.id] || []}
          variantStock={variantStock}
          onConfirm={(variant) => {
            addToCart(variantPickerItem, variant);
            setVariantPickerItem(null);
          }}
        />
      )}
      {whatsappModalOpen && completedOrder && (
        <WhatsAppPhoneModal
          onClose={() => setWhatsappModalOpen(false)}
          onConfirm={proceedToWhatsApp}
          title={t('printing.whatsapp_modal_title', 'إرسال الفاتورة عبر واتساب')}
          description={t('printing.whatsapp_modal_desc', 'أدخل رقم جوال العميل لفتح واتساب مع تفاصيل الفاتورة جاهزة للإرسال.')}
        />
      )}
      {/* Main Pane (70% width on Desktop) */}
      <div className="w-full min-w-0 main-720:w-[70%] flex flex-col gap-4 main-900:gap-5 overflow-x-hidden transition-all duration-300 p-4 main-640:p-6 overflow-y-auto h-auto main-720:h-full flex-1">
        <div className="flex flex-col main-900:flex-row items-stretch main-900:items-center gap-3">
          <IconInput
            ref={searchInputRef}
            type="text"
            startIcon={Search}
            endIcon={[
              ...(voiceSupported ? [
                <span key="mic" className="me-2 inline-flex">
                  <VoiceMicButton onResult={setSearchQuery} />
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
            placeholder={t('pos.search_placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            containerClassName="flex-1"
            className="font-bold"
          />

          <button
            onClick={() => setIsShortcutsModalOpen(true)}
            aria-label={t('pos.shortcuts_button')}
            className="hidden main-640:flex items-center justify-center gap-2 px-4 h-11 bg-surface border border-border text-content hover:bg-surface-muted rounded-xl transition-all font-black shadow-sm active:scale-95 cursor-pointer text-sm shrink-0"
            title={t('pos.shortcuts_tooltip')}
          >
            <Keyboard size={16} />
            <span className="whitespace-nowrap">{t('pos.shortcuts_button')}</span>
          </button>

        </div>

        {/* Category Filters scroll row & View Toggle */}
        <div className="flex flex-col main-900:flex-row main-900:items-center main-900:justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 overflow-x-auto py-1 scrollbar-none w-full main-900:w-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
            {uniqueCategories.map(cat => {
              const isActive = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={cn(
                    "px-4 py-2 rounded-xl text-sm font-black transition-all duration-200 cursor-pointer border shrink-0 active:scale-95",
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

          <div className="flex items-center self-end main-640:self-center bg-surface border border-border rounded-xl p-1 shadow-sm shrink-0">
            <button
              onClick={() => setViewMode('grid')}
              className={cn(
                "p-2 rounded-lg transition-all duration-200 cursor-pointer flex items-center justify-center",
                viewMode === 'grid'
                  ? "bg-brand text-white shadow-sm"
                  : "text-content-muted hover:bg-surface-muted"
              )}
              title={t('pos.grid_view')}
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
              title={t('pos.list_view')}
            >
              <List size={16} />
            </button>
          </div>
        </div>

        {/* Products Grid / List View */}
        {/* سين v5.1 §5/§10 (صقل نقطة البيع): "الارتفاع بالخط الرفيع، مو
            بالظل" -- اللوحة والبطاقات هنا بطاقات عادية ثابتة في مكانها، لا
            عناصر طايرة (قوائم منسدلة/توست/نوافذ)، فلا تأخذ shadow-sm ولا
            أي رفع hover (-translate-y) حسب القاعدة الصريحة "لا تحط ظل على
            بطاقة عادية". التمايز عند hover يبقى حدّياً (تغيّر لون الحد)
            فقط، وrounded-2xl (16px) تحوّلت rounded-xl (12px) لتطابق فئة
            "البطاقات" الوحيدة المسموحة في §4 بدل قيمة وسيطة غير موجودة
            في اللوحة. */}
        <div className="flex-1 bg-surface border border-border rounded-xl p-4 main-640:p-5 overflow-auto">
          {/* "تفصيل جديد" opens a custom tailoring order unrelated to
              inventory stock, so it must stay reachable even when
              filteredInventory is empty (no products yet, or a search with
              no matches) -- it used to live only inside the non-empty
              branch below and vanished along with the product grid. */}
          {viewMode === 'grid' ? (
              // Tiles of at least 128px, as many as the PRODUCT panel holds: it
              // shares the content with the cart, so the content's width said
              // five columns where the panel had room for three, and names
              // went one word a line (seen-responsive-layout-task.md Phase 3).
              <AutoGrid min={128} className="w-full" style={{ ['--auto-grid-gap' as string]: '0.75rem' }}>
                {ordersModuleOn && (
                <button
                  onClick={() => setIsCustomOrderModalOpen(true)}
                  className="flex flex-col items-center p-3.5 bg-brand/5 border border-brand/40 hover:border-brand rounded-xl transition-all duration-200 group active:scale-95 cursor-pointer text-center w-full"
                >
                  <div className="w-full aspect-square bg-brand/10 rounded-xl flex items-center justify-center mb-2.5 group-hover:scale-105 transition-transform overflow-hidden border border-brand/20">
                    <Scissors size={26} className="text-brand" />
                  </div>
                  <span className="text-sm font-bold text-brand text-center line-clamp-2 min-h-[2.25rem] mb-1 w-full flex items-center justify-center">
                    {tv('pos.custom_tailor')}
                  </span>
                </button>
                )}
                {filteredInventory.map(item => (
                  <button
                    key={item.id}
                    onClick={() => handleProductTileClick(item)}
                    className="flex flex-col items-center p-3.5 bg-surface border border-border/70 hover:border-brand/50 rounded-xl transition-all duration-200 group active:scale-95 cursor-pointer text-center w-full"
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
                    <span className="text-sm font-bold text-content text-center line-clamp-2 min-h-[2.25rem] mb-1 w-full">
                      {i18n.language === 'en' && item.nameEn ? item.nameEn : item.name}
                      {(itemVariants[item.id]?.length ?? 0) > 0 && (
                        <span className="block text-sm font-bold text-brand mt-0.5">
                          {itemVariants[item.id].length} {t('inventory.variants.badge_suffix', 'سمات')}
                        </span>
                      )}
                    </span>
                    <div className="flex flex-col items-center justify-center gap-0.5 mb-1 w-full">
                      <span className="text-brand font-black text-sm main-640:text-base"><PriceDisplay amount={item.pricePerUnit} /></span>
                      <span className={cn(
                        "text-sm font-bold px-2 py-0.5 rounded-full",
                        getItemDisplayStock(item) <= 0
                          ? "bg-[var(--seen-danger-bg)] text-danger"
                          : "bg-[var(--seen-success-bg)] text-success"
                      )}>
                        {t('inventory.available')}: {getItemDisplayStock(item)}
                      </span>
                    </div>
                  </button>
                ))}
              </AutoGrid>
            ) : (
              <div className="flex flex-col gap-2.5 w-full">
                {ordersModuleOn && (
                <button
                  onClick={() => setIsCustomOrderModalOpen(true)}
                  className="flex items-center p-3 main-640:p-3.5 bg-brand/5 border border-brand/40 hover:border-brand rounded-xl transition-all duration-200 group active:scale-[0.99] cursor-pointer w-full text-start"
                >
                  <div className="w-14 h-14 main-640:w-16 main-640:h-16 bg-brand/10 rounded-xl flex items-center justify-center shrink-0 overflow-hidden border border-brand/20 ms-0 me-3.5">
                    <Scissors size={22} className="text-brand" />
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col items-start text-start justify-center gap-1">
                    <span className="text-sm font-bold text-brand line-clamp-1 w-full text-start">
                      {tv('pos.custom_tailor')}
                    </span>
                  </div>
                </button>
                )}
                {filteredInventory.map(item => (
                  <button
                    key={item.id}
                    onClick={() => handleProductTileClick(item)}
                    className="flex items-center p-3 main-640:p-3.5 bg-surface border border-border/70 hover:border-brand/50 rounded-xl transition-all duration-200 group active:scale-[0.99] cursor-pointer w-full text-start"
                  >
                    {/* Item Image */}
                    <div className="w-14 h-14 main-640:w-16 main-640:h-16 bg-surface-muted/60 rounded-xl flex items-center justify-center shrink-0 overflow-hidden border border-border/40 ms-0 me-3.5">
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
                      <span className="text-sm font-bold text-content line-clamp-1 w-full text-start">
                        {i18n.language === 'en' && item.nameEn ? item.nameEn : item.name}
                      </span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {(item.category_key || item.category) && (
                          <span className="text-sm text-content-muted bg-surface-muted px-2.5 py-0.5 rounded-full font-bold">
                            {getCategoryLabel(item.category_key || item.category)}
                          </span>
                        )}
                        <span className={cn(
                          "text-sm font-bold px-2 py-0.5 rounded-full",
                          getItemDisplayStock(item) <= 0
                            ? "bg-[var(--seen-danger-bg)] text-danger"
                            : "bg-[var(--seen-success-bg)] text-success"
                        )}>
                          {t('inventory.available')}: {getItemDisplayStock(item)}
                        </span>
                        {(itemVariants[item.id]?.length ?? 0) > 0 && (
                          <span className="text-sm font-bold px-2 py-0.5 rounded-full bg-brand/10 text-brand">
                            {itemVariants[item.id].length} {t('inventory.variants.badge_suffix', 'سمات')}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Price and Action button on the End/Right */}
                    <div className="flex flex-col items-end justify-center shrink-0 gap-1 ms-3 me-0">
                      <span className="text-brand font-black text-sm main-640:text-base">
                        <PriceDisplay amount={item.pricePerUnit} />
                      </span>
                      <div className="px-2.5 py-1 bg-brand/10 text-brand group-hover:bg-brand group-hover:text-white rounded-lg transition-colors text-sm font-black flex items-center gap-1">
                        <Plus size={12} />
                        <span>{t('common.add')}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          {filteredInventory.length === 0 && (
            <div className="flex flex-col items-center justify-center text-content-muted space-y-2 py-12">
              <Package size={44} className="opacity-20" />
              <p className="text-sm font-bold">{t('pos.no_products_found')}</p>
            </div>
          )}
        </div>
      </div>

      {/* Desktop sidebar cart layout (30% width) - Hidden on mobile */}
      <div className="hidden main-720:flex main-720:w-[30%] main-720:min-w-[360px] main-720:max-w-[450px] ltr:border-l rtl:border-r border-border flex-col h-full overflow-hidden shrink-0">
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
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[50] main-720:hidden"
            />
            <motion.div
              initial={shouldReduceMotion ? false : { y: '100%' }}
              animate={{ y: 0 }}
              exit={shouldReduceMotion ? undefined : { y: '100%' }}
              transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', damping: 28, stiffness: 220 }}
              className="fixed inset-x-0 bottom-0 h-[85vh] rounded-t-[2.5rem] bg-surface flex flex-col shadow-2xl z-[60] main-720:hidden overflow-hidden pb-10"
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
          className="main-720:hidden fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-6 z-[40] bg-brand text-white p-5 rounded-2xl shadow-2xl flex items-center gap-3 transition-all"
        >
          <div className="relative">
            <ShoppingCart size={28} />
            <span className="absolute -top-3 -right-3 bg-danger text-white text-sm font-black w-7 h-7 rounded-full flex items-center justify-center ring-4 ring-white shadow-lg">
              {cart.length}
            </span>
          </div>
          <div className="flex flex-col items-start ps-1">
             <span className="text-sm font-bold uppercase opacity-80 leading-none mb-1">{t('common.total')}</span>
             <PriceDisplay amount={totalAmount} className="text-sm font-black leading-none" />
          </div>
        </motion.button>
      )}

      {/* Payment Side Drawer Refactored to Bottom Sheet for mobile */}
      <AnimatePresence>
        {(isPaymentModalOpen || !!viewingInvoice) && (
          <div className="fixed inset-0 z-[60] flex items-end main-900:items-center justify-center overflow-hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => {
                if (completedOrder) return;
                if (viewingInvoice) { setViewingInvoice(null); return; }
                setIsPaymentModalOpen(false);
              }}
            />
            <motion.div
              initial={shouldReduceMotion ? false : { y: contentReached(900) ? 0 : '100%', x: contentReached(900) ? '100%' : 0 }}
              animate={{ y: 0, x: 0 }}
              exit={shouldReduceMotion ? undefined : { y: contentReached(900) ? 0 : '100%', x: contentReached(900) ? '100%' : 0 }}
              transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', damping: 25, stiffness: 200 }}
              className="bg-surface w-full main-900:w-[450px] main-720:h-auto main-900:h-full h-[90vh] shadow-2xl relative z-10 flex flex-col main-900:rounded-none rounded-t-3xl border-t main-900:border-t-0 main-900:border-r border-border overflow-hidden main-900:mr-auto main-720:max-w-md main-720:rounded-3xl main-720:mb-10 main-900:max-w-none main-900:mb-0 main-900:ml-0"
              dir={isRtl ? 'rtl' : 'ltr'}
            >
              <div className="flex-1 overflow-y-auto p-4 main-900:p-6 pb-24 main-900:pb-6">
              {viewingInvoice ? (
                // Bug report (2026-11-16): settling a customer's debt used
                // to pop up a separate centered TaxInvoiceModal -- now
                // shown inline in this same side drawer, the same way a
                // new sale's own invoice is shown right above, instead of
                // as a popup.
                <TaxInvoiceDocument
                  order={viewingInvoice.invoice}
                  tenant={viewingInvoice.tenant}
                  onClose={() => setViewingInvoice(null)}
                />
              ) : completedOrder ? (
                <div className="flex flex-col items-center text-center space-y-6 mt-12">
                  <motion.div 
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="w-20 h-20 bg-success/10 rounded-full flex items-center justify-center mb-2"
                  >
                    <CheckCircle2 size={40} className="text-success" />
                  </motion.div>
                  <div>
                    <h2 className="text-2xl font-black text-content mb-1">{t('pos.invoice_issued')}</h2>
                    <p className="text-content-muted">{completedOrder.invoiceNumber}</p>
                  </div>
                  <div className="w-full max-h-[50vh] overflow-y-auto bg-surface-muted rounded-xl border border-border p-4 flex justify-center custom-scrollbar">
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
                            title: t('pos.receipt_print_title'),
                          });
                          if (!res.ok) toastError(t('printing.print_failed'), res.message);
                        } catch (e) {
                          console.error('[POS] خطأ الطباعة:', e);
                          window.print();
                        }
                      }}
                      className="flex flex-col items-center justify-center p-4 rounded-2xl border border-border hover:border-brand hover:bg-brand/5 transition-all text-content group cursor-pointer"
                    >
                      <Printer size={24} className="mb-2 group-hover:scale-110 transition-transform" />
                      <span className="text-sm font-bold">{t('pos.receipt_print')}</span>
                    </button>
                    <button 
                      onClick={async () => {
                        try {
                          await downloadInvoicePDF('pos-invoice-print-area', `Invoice-${completedOrder.invoiceNumber}.pdf`);
                        } catch (e) {
                          console.error(e);
                          toastError(t('pos.invoice_download_failed'));
                        }
                      }}
                      className="flex flex-col items-center justify-center p-4 rounded-2xl border border-border hover:border-brand hover:bg-brand/5 transition-all text-content group"
                    >
                      <Download size={24} className="mb-2 group-hover:scale-110 transition-transform" />
                      <span className="text-sm font-bold">{t('pos.download_pdf')}</span>
                    </button>
                    <button
                       className="col-span-2 flex flex-col items-center justify-center p-4 rounded-2xl border border-success/20 hover:border-success hover:bg-success/5 transition-all text-success group"
                       onClick={handleShareWhatsApp}
                    >
                      <Share2 size={24} className="mb-2 group-hover:scale-110 transition-transform" />
                      <span className="text-sm font-bold">{t('pos.share_whatsapp')}</span>
                    </button>
                  </div>
                  <button
                    onClick={() => void handleAttachInvoicePdf()}
                    className="w-full flex items-center justify-center gap-2 text-content-muted hover:text-content text-sm font-bold py-2 transition-colors"
                  >
                    <Paperclip size={14} />
                    <span>{t('pos.attach_invoice_pdf', 'إرفاق الفاتورة كملف PDF أيضاً')}</span>
                  </button>

                  <button
                    onClick={() => {
                       setCompletedOrder(null);
                       setIsPaymentModalOpen(false);
                    }}
                    className="w-full mt-4 py-3 bg-surface-muted text-content font-bold rounded-xl hover:bg-border transition-colors"
                  >
                    {t('pos.close_and_new_order')}
                  </button>
                </div>
              ) : (
                // Payment form
                <div className="flex flex-col min-h-full">
                  <div className="flex justify-between items-center mb-6 border-b border-border pb-4">
                    <h2 className="text-2xl font-black text-content">{t('pos.complete_order')}</h2>
                    <button onClick={() => setIsPaymentModalOpen(false)} aria-label={t('common.close')} className="p-2 hover:bg-surface-muted rounded-full">
                      <X size={24} />
                    </button>
                  </div>
                  
                  <div className="space-y-6 flex-1">
                    {/* Customer Unpaid Balance Alert */}
                    {selectedCustomer && customerUnpaidBalance > 0 && (
                      <div className="bg-[var(--seen-danger-bg)] border border-danger/20 p-4 rounded-2xl flex items-center justify-between text-danger gap-3">
                        <div className="flex items-center gap-2.5">
                          <AlertTriangle size={22} />
                          <div>
                            <div className="text-sm font-black">{t('pos.customer_has_due')}</div>
                            <div className="text-sm opacity-80">{selectedCustomer.name}</div>
                          </div>
                        </div>
                        <span className="font-mono font-black text-lg text-danger whitespace-nowrap">
                          <PriceDisplay amount={customerUnpaidBalance} />
                        </span>
                      </div>
                    )}

                    {/* Invoice Type */}
                    <div className="bg-surface p-4 rounded-2xl border border-border">
                      <label className="block text-sm font-bold text-content mb-3">{t('tax_invoices.invoice_type')}</label>
                      <div className="flex bg-surface-muted p-1 rounded-xl">
                        <button
                          className={cn("flex-1 py-2 text-sm font-bold rounded-lg transition-colors", !isB2B ? "bg-surface shadow-sm text-brand" : "text-content-muted hover:text-content")}
                          onClick={() => {
                            setIsB2B(false);
                            setB2bData({ companyName: '', trn: '' });
                          }}
                        >
                          {t('pos.simple_invoice')}
                        </button>
                        <button
                          className={cn("flex-1 py-2 text-sm font-bold rounded-lg transition-colors", isB2B ? "bg-surface shadow-sm text-brand" : "text-content-muted hover:text-content")}
                          onClick={() => {
                            setIsB2B(true);
                            setIsB2bModalOpen(true);
                          }}
                        >
                          {t('pos.b2b_invoice')}
                        </button>
                      </div>
                      {isB2B && b2bData.companyName && (
                        <div className="mt-3 p-3 bg-brand/5 border border-brand/20 rounded-xl text-sm">
                           <div className="flex justify-between items-center mb-1">
                             <span className="font-bold text-brand">{b2bData.companyName}</span>
                             <button onClick={() => setIsB2bModalOpen(true)} className="text-brand text-sm font-bold hover:underline">{t('common.edit')}</button>
                           </div>
                           <div className="text-content-muted">{t('pos.trn_label')} {b2bData.trn}</div>
                        </div>
                      )}
                    </div>

                    {/* Discount */}
                    <div className="bg-surface p-4 rounded-2xl border border-border">
                      <div className="flex justify-between items-center mb-3">
                        <label className="text-sm font-bold text-content">{t('pos.discount')}</label>
                        <div className="flex bg-surface-muted rounded-lg p-0.5">
                          <button
                            type="button"
                            className={cn(
                              "px-3 py-2.5 min-h-[40px] text-sm font-bold rounded-md transition-all",
                              discountType === 'percent' ? "bg-brand text-white shadow-sm" : "text-content-muted hover:text-content"
                            )}
                            onClick={() => {
                              setDiscountType('percent');
                              if (discountValue > 100) setDiscountValue(100);
                            }}
                          >
                            {t('settings_page.staff.commissions.percentage')}
                          </button>
                          <button
                            type="button"
                            className={cn(
                              "px-3 py-2.5 min-h-[40px] text-sm font-bold rounded-md transition-all",
                              discountType === 'fixed' ? "bg-brand text-white shadow-sm" : "text-content-muted hover:text-content"
                            )}
                            onClick={() => setDiscountType('fixed')}
                          >
                            {t('settings_page.staff.commissions.fixed_amount')}
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center bg-surface border border-border rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-brand/20 focus-within:border-brand transition-all" dir="ltr">
                        <button
                          type="button"
                          onClick={() => setDiscountValue(Math.max(0, (discountValue || 0) - 1))}
                          aria-label={t('pos.decrease_quantity')}
                          className="w-11 h-11 shrink-0 flex items-center justify-center text-content-muted hover:bg-surface-muted hover:text-content transition-colors"
                        >-</button>
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
                          className="w-full min-w-0 flex-1 bg-transparent border-none outline-none focus:ring-0 py-3 px-2 text-center tabular-nums font-semibold text-lg"
                        />
                        <button
                          type="button"
                          onClick={() => setDiscountValue(discountType === 'percent' ? Math.min(100, (discountValue || 0) + 1) : (discountValue || 0) + 1)}
                          aria-label={t('pos.increase_quantity')}
                          className="w-11 h-11 shrink-0 flex items-center justify-center text-content-muted hover:bg-surface-muted hover:text-content transition-colors"
                        >+</button>
                      </div>
                    </div>

                    {/* Payment Method */}
                    <div className="bg-surface p-4 rounded-2xl border border-border">
                      <label className="block text-sm font-bold text-content mb-3">{t('pos.payment_method')}</label>
                      <div className="grid grid-cols-2 main-640:grid-cols-4 gap-2">
                        {[
                          { id: 'cash', label: t('pos.cash'), icon: Banknote },
                          { id: 'network', label: t('pos.card'), icon: CreditCard },
                          { id: 'bank_transfer', label: t('pos.bank_transfer'), icon: Landmark },
                          { id: 'partial', label: t('pos.partial_credit'), icon: Wallet }
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
                            <span className="text-sm">{method.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="bg-surface p-4 rounded-2xl border border-border">
                      <label className="block text-sm font-bold text-content mb-3">{t('orders.pay_amount_now')}</label>
                      <div className="flex items-center bg-surface border border-border rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-brand/20 focus-within:border-brand transition-all" dir="ltr">
                        <button
                          type="button"
                          onClick={() => setPaidAmount(Math.max(0, paidAmount - 10))}
                          aria-label={t('pos.decrease_quantity')}
                          className="w-11 h-11 shrink-0 flex items-center justify-center text-content-muted hover:bg-surface-muted hover:text-content transition-colors"
                        >-</button>
                        <input
                          type="number"
                          value={paidAmount === 0 ? '' : paidAmount}
                          onChange={(e) => setPaidAmount(e.target.value === '' ? 0 : Number(e.target.value))}
                          className="w-full min-w-0 flex-1 bg-transparent border-none outline-none focus:ring-0 p-4 font-black text-2xl text-center tabular-nums"
                          min="0"
                          max={totalAmount}
                        />
                        <button
                          type="button"
                          onClick={() => setPaidAmount(Math.min(totalAmount, paidAmount + 10))}
                          aria-label={t('pos.increase_quantity')}
                          className="w-11 h-11 shrink-0 flex items-center justify-center text-content-muted hover:bg-surface-muted hover:text-content transition-colors"
                        >+</button>
                      </div>
                    </div>

                  </div>

                  <div className="absolute bottom-0 right-0 left-0 p-4 main-720:p-6 bg-surface border-t border-border main-720:static main-720:mt-8 main-720:mb-4 main-720:border-none main-720:p-0">
                    <div className="hidden main-720:block">
                      <div className="flex justify-between items-center mb-2 px-1 text-content-muted">
                        <span>{t('pos.total_required')}</span>
                        <span className="font-bold text-content line-through opacity-70"><PriceDisplay amount={totalAmount + calculatedDiscountAmount} /></span>
                      </div>
                      {calculatedDiscountAmount > 0 && (
                        <div className="flex justify-between items-center mb-2 px-1 text-danger font-bold">
                          <span>{t('pos.discount')}:</span>
                          <span>-<PriceDisplay amount={calculatedDiscountAmount} /></span>
                        </div>
                      )}
                      <div className="flex justify-between items-center bg-surface-muted p-4 rounded-2xl border border-border mb-4">
                        <span className="font-bold text-content">{t('pos.net_amount')}</span>
                        <span className="font-black text-2xl text-brand"><PriceDisplay amount={totalAmount} /></span>
                      </div>
                    </div>
                    
                    <div className="main-720:hidden flex justify-between items-center mb-4">
                        <div className="flex flex-col">
                            <span className="text-sm text-content-muted font-bold uppercase">{t('pos.net_payable')}</span>
                            <span className="text-xl font-black text-brand"><PriceDisplay amount={totalAmount} /></span>
                        </div>
                        {totalAmount - paidAmount > 0 && (
                            <div className="flex flex-col items-end">
                                <span className="text-sm text-danger font-bold uppercase">{t('pos.remaining_amount')}</span>
                                <span className="text-lg font-bold text-danger"><PriceDisplay amount={totalAmount - paidAmount} /></span>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center justify-between bg-surface p-4 rounded-xl border border-border mb-4">
                      <span className="text-sm font-bold text-content">{t('pos.auto_print_enabled')}</span>
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
                        <div className="w-11 h-6 bg-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-surface after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand"></div>
                      </label>
                    </div>

                    <button
                      onClick={handleCheckout}
                      disabled={loading}
                      className="w-full py-4 bg-brand text-white rounded-xl main-720:rounded-2xl font-black text-lg hover:bg-brand/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg active:scale-95"
                    >
                      {loading ? t('common.processing') : (
                        <>
                          <CheckCircle2 size={24} />
                          {t('pos.issue_invoice')}
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

      {/* Debt Settlement Modal -- reachable as soon as a customer with an
          outstanding balance is selected, independent of the cart/checkout
          flow above. */}
      <AnimatePresence>
        {isDebtModalOpen && selectedCustomer && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md overflow-y-auto font-sans">
            <motion.div
              initial={shouldReduceMotion ? false : { scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={shouldReduceMotion ? undefined : { scale: 0.95, opacity: 0, y: 20 }}
              transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', damping: 25, stiffness: 200 }}
              className="relative w-full max-w-lg rounded-3xl bg-surface shadow-2xl flex flex-col my-auto border border-border overflow-hidden text-start max-h-[85vh]"
              dir={isRtl ? 'rtl' : 'ltr'}
            >
              {/* Header */}
              <div className="sticky top-0 z-10 flex items-center justify-between p-6 border-b border-border bg-surface shrink-0 bg-danger/5">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-[var(--seen-danger-bg)] text-danger rounded-2xl shrink-0 shadow-sm">
                    <AlertTriangle size={24} />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-content">{t('pos.settle_debt')}</h2>
                    <p className="text-sm font-bold text-content-muted mt-0.5">{selectedCustomer.name}</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsDebtModalOpen(false)}
                  aria-label={t('common.close')}
                  className="p-2 hover:bg-surface-muted rounded-full transition-colors text-content-muted"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Body */}
              <div className="p-6 space-y-4 overflow-y-auto">
                {debtOrdersLoading ? (
                  <p className="text-center text-sm font-bold text-content-muted py-8">{t('common.loading')}</p>
                ) : debtOrders.length === 0 ? (
                  <p className="text-center text-sm font-bold text-content-muted py-8">{t('pos.no_previous_due')}</p>
                ) : (
                  <>
                    <div className="flex items-center justify-between bg-danger/10 border border-danger/20 p-4 rounded-2xl">
                      <span className="text-sm font-black text-danger">{t('pos.total_due')}</span>
                      <span className="font-mono font-black text-xl text-danger">
                        <PriceDisplay amount={customerUnpaidBalance} />
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleSettleAllDebt}
                      disabled={isSettlingAllDebt}
                      className="w-full py-3 bg-brand text-white rounded-xl font-black text-sm hover:bg-brand/90 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {isSettlingAllDebt ? t('common.processing') : t('pos.settle_all_debt')}
                    </button>

                    <div className="space-y-3">
                      {debtOrders.map(order => (
                        <div key={order.id} className="p-4 bg-surface-muted/50 border border-border rounded-2xl space-y-2.5">
                          <div className="flex justify-between items-center text-sm font-bold text-content-muted">
                            <span>{t('staff.order_number', { number: order.orderNumber })}</span>
                            <span>{new Date(order.orderDate).toLocaleDateString()}</span>
                          </div>
                          <div className="flex justify-between items-center text-sm">
                            <span className="text-content-muted">{t('orders.remaining_amount')}</span>
                            <span className="font-black text-danger"><PriceDisplay amount={order.remainingAmount} /></span>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              max={order.remainingAmount}
                              value={debtPayAmounts[order.id] ?? order.remainingAmount}
                              onChange={(e) => setDebtPayAmounts(prev => ({ ...prev, [order.id]: Number(e.target.value) || 0 }))}
                              className="w-28 bg-surface border border-border rounded-lg px-2.5 py-2 text-center font-bold tabular-nums focus:ring-2 focus:ring-brand/20 focus:border-brand outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => handleSettleDebtOrder(order)}
                              disabled={settlingOrderId === order.id}
                              className="flex-1 py-2 bg-[var(--seen-danger-bg)] text-danger rounded-lg font-bold text-sm hover:bg-danger hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
                            >
                              {settlingOrderId === order.id ? t('common.processing') : t('pos.settle_order')}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Fallback for an order with no tax_invoices row at all -- created
          directly in "الطلبات", never sold through POS's checkout, so
          there is no real invoice to fetch. Deliberately NOT styled like
          a tax invoice (no QR, no invoice number) to avoid implying one
          exists. */}
      <AnimatePresence>
        {fallbackReceipt && (
          <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md overflow-y-auto font-sans">
            <motion.div
              initial={shouldReduceMotion ? false : { scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={shouldReduceMotion ? undefined : { scale: 0.95, opacity: 0, y: 20 }}
              transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', damping: 25, stiffness: 200 }}
              className="relative w-full max-w-sm rounded-3xl bg-surface shadow-2xl flex flex-col my-auto border border-border overflow-hidden text-start"
              dir={isRtl ? 'rtl' : 'ltr'}
            >
              <div className="flex items-center justify-between p-6 border-b border-border bg-success/5 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-[var(--seen-success-bg)] text-success rounded-2xl shrink-0 shadow-sm">
                    <CheckCircle2 size={24} />
                  </div>
                  <h2 className="text-lg font-black text-content">{t('pos.payment_confirmation_title')}</h2>
                </div>
                <button
                  onClick={() => setFallbackReceipt(null)}
                  aria-label={t('common.close')}
                  className="p-2 hover:bg-surface-muted rounded-full transition-colors text-content-muted"
                >
                  <X size={20} />
                </button>
              </div>

              <div id="pos-fallback-receipt-print-area" className="p-6 space-y-3 text-sm">
                <p className="text-sm font-bold text-content-muted bg-surface-muted/60 p-2.5 rounded-lg">
                  {t('pos.no_invoice_fallback_notice')}
                </p>
                <div className="flex justify-between"><span className="text-content-muted">{t('pos.customer_name')}</span><span className="font-bold">{fallbackReceipt.customerName}</span></div>
                <div className="flex justify-between"><span className="text-content-muted">{t('common.date')}</span><span className="font-bold">{new Date(fallbackReceipt.issuedAt).toLocaleString()}</span></div>
                <div className="border-t border-border pt-3 flex justify-between items-center">
                  <span className="text-content-muted">{t('staff.order_number', { number: fallbackReceipt.orderNumber })}</span>
                  <span className="font-black text-success"><PriceDisplay amount={fallbackReceipt.amountPaid} /></span>
                </div>
              </div>

              <div className="p-6 pt-0 flex flex-col gap-3">
                {canIssueInvoice && (
                  <button
                    type="button"
                    disabled={isIssuingInvoice}
                    onClick={handleIssueInvoiceFromFallback}
                    className="w-full py-3 bg-success text-white rounded-xl font-black text-sm hover:bg-success/90 transition-colors cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    <Receipt size={18} />
                    {isIssuingInvoice ? t('common.loading') : t('tax_invoices.issue_invoice')}
                  </button>
                )}
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const { printElementDetailed, getConfiguredPaperSize } = await import('../utils/printManager');
                        const res = await printElementDetailed('pos-fallback-receipt-print-area', {
                          paperSize: getConfiguredPaperSize('80mm'),
                          title: t('pos.payment_confirmation_title'),
                        });
                        if (!res.ok) toastError(t('printing.print_failed'), res.message);
                      } catch (e) {
                        console.error('[POS] خطأ طباعة تأكيد الدفع:', e);
                        window.print();
                      }
                    }}
                    className="flex-1 py-3 bg-brand text-white rounded-xl font-black text-sm hover:bg-brand/90 transition-colors cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Printer size={18} />
                    {t('pos.receipt_print')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFallbackReceipt(null)}
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

      {/* "سدد الإجمالي" can settle several distinct orders at once, each
          with its own separate original invoice -- no single document
          covers more than one, so this just lets the cashier pick which
          paid order's real invoice to view/print next. */}
      <AnimatePresence>
        {settledOrdersSummary && (
          <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md overflow-y-auto font-sans">
            <motion.div
              initial={shouldReduceMotion ? false : { scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={shouldReduceMotion ? undefined : { scale: 0.95, opacity: 0, y: 20 }}
              transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', damping: 25, stiffness: 200 }}
              className="relative w-full max-w-sm rounded-3xl bg-surface shadow-2xl flex flex-col my-auto border border-border overflow-hidden text-start"
              dir={isRtl ? 'rtl' : 'ltr'}
            >
              <div className="flex items-center justify-between p-6 border-b border-border bg-success/5 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-[var(--seen-success-bg)] text-success rounded-2xl shrink-0 shadow-sm">
                    <CheckCircle2 size={24} />
                  </div>
                  <h2 className="text-lg font-black text-content">{t('pos.debt_settled_all')}</h2>
                </div>
                <button
                  onClick={() => setSettledOrdersSummary(null)}
                  aria-label={t('common.close')}
                  className="p-2 hover:bg-surface-muted rounded-full transition-colors text-content-muted"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="p-6 space-y-2">
                {settledOrdersSummary.map(o => (
                  <button
                    key={o.orderId}
                    type="button"
                    onClick={() => handleViewOrderInvoice(o.orderId, { orderNumber: o.orderNumber, amountPaid: o.amountPaid })}
                    className="w-full flex items-center justify-between p-3 bg-surface-muted/50 border border-border rounded-xl font-bold text-sm hover:border-brand/50 transition-colors cursor-pointer"
                  >
                    <span>{t('staff.order_number', { number: o.orderNumber })}</span>
                    <span className="text-brand text-sm">{t('tax_invoices.view_invoice')}</span>
                  </button>
                ))}
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
              initial={shouldReduceMotion ? false : { scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={shouldReduceMotion ? undefined : { scale: 0.95, opacity: 0, y: 20 }}
              transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', damping: 25, stiffness: 200 }}
              className="relative w-full max-w-md rounded-3xl bg-surface shadow-2xl flex flex-col my-auto border border-border overflow-hidden text-start"
              dir={isRtl ? 'rtl' : 'ltr'}
            >
              {/* Header */}
              <div className="sticky top-0 z-10 flex items-center justify-between p-6 border-b border-border bg-surface shrink-0 bg-brand/5">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-brand/10 text-brand rounded-2xl shrink-0 shadow-sm">
                    <Wallet size={24} />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-content">{t('sales.cash_drawer_details')}</h2>
                    <p className="text-sm font-bold text-content-muted mt-0.5">{t('sales.shift_cash_details')}</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowCashDrawerDetails(false)}
                  aria-label={t('common.close')}
                  className="p-2 hover:bg-surface-muted rounded-full transition-colors text-content-muted"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Body */}
              <div className="p-6 space-y-6">
                {/* Employee / Shift info */}
                <div className="flex justify-between items-center text-sm font-bold text-content-muted bg-surface-muted/35 px-4 py-2.5 rounded-xl border border-border">
                  <span>{t('pos.employee_label')} <span className="text-content font-extrabold">{currentStaff?.name || t('sales.unknown')}</span></span>
                  <span>{t('pos.shift_id_label')} <span className="font-sans text-content font-extrabold">#{shiftId?.slice(-6).toUpperCase()}</span></span>
                </div>

                {/* Main Cash Drawer Indicator */}
                <div className="bg-success/10 border border-success/20 rounded-3xl p-5 text-center space-y-2">
                  <span className="text-sm font-black text-success block uppercase">
                    {t('sales.expected_cash')}
                  </span>
                  <div className="text-3xl font-black text-success">
                    <PriceDisplay amount={cashDrawerBalance} />
                  </div>
                  <p className="text-sm text-content-muted">
                    {t('sales.expected_cash_desc')}
                  </p>
                </div>

                {/* Operations Breakdown Grid */}
                <div className="space-y-3.5">
                  <h3 className="text-sm font-black text-content-muted uppercase">{t('sales.flow_details')}</h3>
                  
                  <div className="grid grid-cols-1 gap-3">
                    {/* Opening Balance */}
                    <div className="flex items-center justify-between p-3.5 bg-surface-muted/30 border border-border rounded-2xl">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 bg-info/10 text-info rounded-xl">
                          <Coins size={18} />
                        </div>
                        <span className="text-sm font-bold text-content">{t('sales.opening_balance')}</span>
                      </div>
                      <span className="text-sm font-black text-content">
                        <PriceDisplay amount={cashDrawerBreakdown.opening} />
                      </span>
                    </div>

                    {/* Cash Sales */}
                    <div className="flex items-center justify-between p-3.5 bg-surface-muted/30 border border-border rounded-2xl">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 bg-[var(--seen-success-bg)] text-success rounded-xl">
                          <TrendingUp size={18} />
                        </div>
                        <span className="text-sm font-bold text-content">{t('sales.cash_sales')}</span>
                      </div>
                      <span className="text-sm font-black text-success">
                        + <PriceDisplay amount={cashDrawerBreakdown.sales} />
                      </span>
                    </div>

                    {/* Cash Deposits */}
                    {cashDrawerBreakdown.deposits > 0 && (
                      <div className="flex items-center justify-between p-3.5 bg-surface-muted/30 border border-border rounded-2xl">
                        <div className="flex items-center gap-2.5">
                          <div className="p-2 bg-[var(--seen-success-bg)] text-success rounded-xl">
                            <Plus size={18} />
                          </div>
                          <span className="text-sm font-bold text-content">{t('sales.cash_deposits')}</span>
                        </div>
                        <span className="text-sm font-black text-success">
                          + <PriceDisplay amount={cashDrawerBreakdown.deposits} />
                        </span>
                      </div>
                    )}

                    {/* Cash Returns (Subtracted) */}
                    {cashDrawerBreakdown.returns > 0 && (
                      <div className="flex items-center justify-between p-3.5 bg-surface-muted/30 border border-border rounded-2xl">
                        <div className="flex items-center gap-2.5">
                          <div className="p-2 bg-[var(--seen-danger-bg)] text-danger rounded-xl">
                            <TrendingDown size={18} />
                          </div>
                          <span className="text-sm font-bold text-content">{t('sales.cash_returns')}</span>
                        </div>
                        <span className="text-sm font-black text-danger">
                          - <PriceDisplay amount={cashDrawerBreakdown.returns} />
                        </span>
                      </div>
                    )}

                    {/* Cash Withdrawals / Expenditures */}
                    {cashDrawerBreakdown.withdrawals > 0 && (
                      <div className="flex items-center justify-between p-3.5 bg-surface-muted/30 border border-border rounded-2xl">
                        <div className="flex items-center gap-2.5">
                          <div className="p-2 bg-[var(--seen-danger-bg)] text-danger rounded-xl">
                            <X size={18} />
                          </div>
                          <span className="text-sm font-bold text-content">{t('sales.expenses_withdrawals')}</span>
                        </div>
                        <span className="text-sm font-black text-danger">
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
                      toastSuccess(t('pos.cash_drawer_refreshed'));
                    }}
                    className="flex-1 py-3 bg-surface border border-border text-content hover:bg-surface-muted rounded-xl transition-all font-bold text-sm text-center flex items-center justify-center gap-2 active:scale-95"
                  >
                    <Coins size={16} />
                    <span>{t('sales.refresh_data')}</span>
                  </button>
                  <button
                    onClick={() => setShowCashDrawerDetails(false)}
                    className="flex-1 py-3 bg-brand text-white hover:bg-brand/90 rounded-xl transition-all font-bold text-sm text-center active:scale-95"
                  >
                    {t('pos.close_window')}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* New tailoring order: the same form the Orders page opens. It saves
          the order directly and shows its receipt; a tailoring order no longer
          goes through the cart (ready-made items still do). */}
      <TailoringOrderForm
        open={isCustomOrderModalOpen}
        onClose={() => setIsCustomOrderModalOpen(false)}
        tenantId={tenantId}
        initialCustomerId={selectedCustomer?.id}
        showReceipt
      />

      {/* Add Customer Modal Refactored to Bottom Sheet */}
      <Transition appear show={isAddCustomerModalOpen} as={React.Fragment}>
        <Dialog as="div" className="relative z-[200] flex items-end main-640:items-center justify-center" onClose={() => setIsAddCustomerModalOpen(false)}>
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

          <div className="fixed inset-0 overflow-y-auto pt-20 main-720:pt-0">
            <div className="flex min-h-full items-end main-640:items-center justify-center main-640:p-4 text-center">
              <Transition.Child
                as={React.Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 translate-y-full main-640:translate-y-0 main-640:scale-95"
                enterTo="opacity-100 translate-y-0 main-640:scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 translate-y-0 main-640:scale-100"
                leaveTo="opacity-0 translate-y-full main-640:translate-y-0 main-640:scale-95"
              >
                <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-t-3xl main-640:rounded-3xl bg-surface p-6 text-start align-middle shadow-2xl transition-all border border-border">
                  <Dialog.Title
                    as="h3"
                    className="text-lg font-bold leading-6 text-content mb-4 flex items-center justify-between"
                  >
                    {t('pos.add_new_customer')}
                    <button aria-label={t('common.close')} onClick={() => setIsAddCustomerModalOpen(false)} className="text-content-muted hover:text-content transition-colors">
                      <X size={20} />
                    </button>
                  </Dialog.Title>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-content mb-1">{t('pos.customer_name')} <span className="text-danger">*</span></label>
                      <IconInput
                        type="text"
                        value={newCustomerName}
                        onChange={(e) => setNewCustomerName(e.target.value)}
                        placeholder={t('pos.customer_name_placeholder')}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-content mb-1">{t('login.phone')} <span className="text-danger">*</span></label>
                      <IconInput
                        type="tel"
                        value={newCustomerPhone}
                        onChange={(e) => setNewCustomerPhone(e.target.value)}
                        onBlur={(e) => setNewCustomerPhone(formatSaudiPhone(e.target.value))}
                        placeholder="05XXXXXXXX"
                        dir="ltr"
                        className="text-start"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-content mb-1">{t('pos.trn_label_clean')} <span className="text-content-muted text-sm font-normal">{t('pos.for_b2b_only')}</span></label>
                      <IconInput
                        type="text"
                        value={newCustomerVat}
                        onChange={(e) => setNewCustomerVat(e.target.value)}
                        placeholder={t('pos.optional_b2b_desc')}
                      />
                    </div>
                  </div>

                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      type="button"
                      className="px-4 py-2 font-medium text-content bg-surface-muted hover:bg-border/40 rounded-xl transition-colors"
                      onClick={() => setIsAddCustomerModalOpen(false)}
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      type="button"
                      disabled={isSavingCustomer || !newCustomerName || !newCustomerPhone}
                      className="px-4 py-2 font-medium text-white bg-brand hover:bg-brand/90 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm"
                      onClick={handleSaveCustomer}
                    >
                      {isSavingCustomer ? t('common.saving') : t('pos.save_customer')}
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
          } print:opacity-100 print:pointer-events-auto print:static print:w-full print:block print:max-w-none print:m-0 print:p-0 bg-surface z-[99999]`}
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
      <Dialog open={isB2bModalOpen} onClose={() => setIsB2bModalOpen(false)} className="relative z-[100]" dir={isRtl ? 'rtl' : 'ltr'}>
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />
        <div className="fixed inset-0 overflow-y-auto flex items-end main-640:items-center justify-center p-0 main-640:p-4">
          <Dialog.Panel className="w-full max-w-md bg-surface p-6 rounded-t-3xl main-640:rounded-2xl shadow-xl border border-border">
            <div className="flex justify-between items-center mb-6">
              <Dialog.Title className="text-xl font-bold text-content">{t('pos.b2b_data_title')}</Dialog.Title>
              <button onClick={() => setIsB2bModalOpen(false)} aria-label={t('common.close')} className="p-2 hover:bg-surface-muted rounded-full">
                <X size={20} />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-content mb-2">{t('pos.company_name')} <span className="text-danger">*</span></label>
                <IconInput
                  type="text"
                  placeholder={t('pos.company_name_placeholder')}
                  value={b2bData.companyName}
                  onChange={e => setB2bData({...b2bData, companyName: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-content mb-2">{t('pos.trn_label_clean')} <span className="text-danger">*</span></label>
                <IconInput
                  type="text"
                  placeholder="300000000000003"
                  value={b2bData.trn}
                  onChange={e => setB2bData({...b2bData, trn: e.target.value})}
                />
              </div>
            </div>

            <div className="mt-8 flex gap-3">
              <button
                onClick={() => setIsB2bModalOpen(false)}
                className="flex-1 py-3 bg-brand text-white font-bold rounded-xl hover:bg-brand/90 transition-colors"
                disabled={!b2bData.companyName || !b2bData.trn}
              >
                {t('pos.update_and_continue')}
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
                {t('common.cancel')}
              </button>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>

      {/* Keyboard Shortcuts Help Modal */}
      <Transition appear show={isShortcutsModalOpen} as={React.Fragment}>
        <Dialog as="div" className="relative z-[150] flex items-end main-640:items-center justify-center" onClose={() => setIsShortcutsModalOpen(false)}>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" onClick={() => setIsShortcutsModalOpen(false)} />
          <div className="fixed inset-0 overflow-y-auto flex items-end main-640:items-center justify-center p-0 main-640:p-4">
            <Dialog.Panel className="w-full max-w-lg bg-surface p-6 rounded-t-3xl main-640:rounded-3xl shadow-2xl border border-border text-right" dir={isRtl ? 'rtl' : 'ltr'}>
              <div className="flex justify-between items-center mb-6 border-b border-border pb-4">
                <Dialog.Title className="text-xl font-black text-content flex items-center gap-2">
                  <Keyboard size={20} />
                  <span>{t('pos.keyboard_shortcuts_title')}</span>
                </Dialog.Title>
                <button onClick={() => setIsShortcutsModalOpen(false)} aria-label={t('common.close')} className="p-2 hover:bg-surface-muted rounded-full transition-colors">
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
                <p className="text-sm text-content-muted font-bold mb-4">
                  {t('pos.keyboard_shortcuts_desc')}
                </p>

                <div className="grid grid-cols-1 gap-2">
                  {[
                    { keys: ['F1', 'Ctrl + /'], label: t('pos.shortcut_toggle_help') },
                    { keys: ['F3', 'Ctrl + F'], label: t('pos.shortcut_focus_search') },
                    { keys: ['F8', 'Ctrl + Enter'], label: t('pos.shortcut_open_payment') },
                    { keys: ['F9'], label: t('pos.shortcut_confirm_payment') },
                    { keys: ['Ctrl + 1'], label: t('pos.shortcut_cash_payment') },
                    { keys: ['Ctrl + 2'], label: t('pos.shortcut_card_payment') },
                    { keys: ['Ctrl + P'], label: t('pos.shortcut_quick_print') },
                    { keys: ['F2', 'Esc'], label: t('pos.shortcut_close_invoice_new') },
                    { keys: ['F7', 'Ctrl + Shift + A'], label: t('pos.shortcut_open_custom_thobe') },
                    { keys: ['F4'], label: t('pos.shortcut_clear_cart') },
                  ].map((shortcut, idx) => (
                    <div key={idx} className="flex justify-between items-center p-3 bg-surface-muted rounded-xl border border-border/50 hover:bg-brand/5 transition-all">
                      <span className="text-sm font-bold text-content">{shortcut.label}</span>
                      <div className="flex gap-1.5" dir="ltr">
                        {shortcut.keys.map((key, kIdx) => (
                          <React.Fragment key={kIdx}>
                            {kIdx > 0 && <span className="text-content-muted self-center font-bold text-sm">+</span>}
                            <kbd className="px-2 py-1 bg-surface dark:bg-content border border-border rounded-lg shadow-sm font-mono text-sm font-black text-brand">
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
                  {t('common.got_it_close')}
                </button>
              </div>
            </Dialog.Panel>
          </div>
        </Dialog>
      </Transition>

    </div>
  );
}
