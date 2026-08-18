import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase/client';
import { handleError, OperationType } from '../lib/firebase';
import { Order, Customer, InventoryItem, Staff, Shift, Role, PurchaseOrder, Supplier } from '../types';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area
} from 'recharts';
import {
  Download,
  TrendingUp,
  Users, 
  ShoppingBag, 
  DollarSign,
  Filter,
  Search,
  ArrowUpDown,
  FileSpreadsheet,
  FileText,
  ChevronRight,
  Package,
  Clock,
  CheckCircle2,
  AlertTriangle,
  User,
  X,
  Calculator,
  Scissors,
  Truck,
  Landmark
} from 'lucide-react';
import { PriceDisplay } from './PriceDisplay';
import DateTimeDisplay from './DateTimeDisplay';
import { cn } from '../lib/utils';
import Header from './Header';
import TailorStatementReport from './TailorStatementReport';
import Branding from './Branding';
import Select from './ui/Select';
import { DatePicker } from './ui/DatePicker';
import { useToast } from '../contexts/ToastContext';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import ZReport from './ZReport';

import { useStaff } from '../contexts/StaffContext';
import { usePermissions } from '../hooks/usePermissions';
import { useDirection } from '../lib/direction';

const COLORS = ['#1C8FFF', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4'];

type ReportTab = 'general' | 'financial' | 'orders' | 'inventory' | 'staff' | 'zreports' | 'tailor_commissions' | 'profit_loss' | 'suppliers_purchases' | 'vat';

interface DrillDownData {
  title: string;
  data: any[];
  columns: { key: string; label: string; type?: 'currency' | 'date' | 'status' }[];
}

export default function Reports({ tenantId }: { tenantId: string }) {
  const { t, dir, locale } = useDirection();
  const { currentStaff } = useStaff();
  const { hasPermission, loading: permsLoading } = usePermissions(currentStaff);
  const { success: toastSuccess, error: toastError, warning: toastWarning } = useToast();
  
  const canViewReports = hasPermission('reports.view');
  const canExportReports = hasPermission('reports.export');

  const [activeTab, setActiveTab] = useState<ReportTab>('general');
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [shiftPayouts, setShiftPayouts] = useState<{ amount: number; occurred_at: string; reason: string }[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [selectedStaff, setSelectedStaff] = useState('all');
  const [paymentStatus, setPaymentStatus] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [excludeTestData, setExcludeTestData] = useState(true);

  // Drill-down
  const [drillDown, setDrillDown] = useState<DrillDownData | null>(null);
  
  // Z-Report
  const [selectedZDate, setSelectedZDate] = useState(new Date().toISOString().split('T')[0]);
  const [dailyZData, setDailyZData] = useState<any | null>(null);
  const [loadingZ, setLoadingZ] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      if (!tenantId) return;
      setLoading(true);
      try {
        const [ordersRes, customersRes, inventoryRes, staffRes, rolesRes, purchaseOrdersRes, suppliersRes, shiftEntriesRes] = await Promise.all([
          supabase.from('orders').select('*').eq('tenant_id', tenantId).order('order_date', { ascending: false }),
          supabase.from('customers').select('*').eq('tenant_id', tenantId),
          supabase.from('inventory_items').select('*').eq('tenant_id', tenantId),
          // pin_hash intentionally excluded — never expose bcrypt PIN hashes
          // in a multi-row listing (see security note in Staff.tsx).
          supabase.from('staff').select('id, tenant_id, uid, name, email, phone, role, role_id, branch_id, status, must_change_pin, is_test, commission_type, commission_value, has_seen_onboarding, created_at, updated_at').eq('tenant_id', tenantId),
          supabase.from('roles').select('*').or(`tenant_id.is.null,tenant_id.eq.${tenantId}`),
          supabase.from('purchase_orders').select('*, purchase_order_items(*)').eq('tenant_id', tenantId),
          supabase.from('suppliers').select('*').eq('tenant_id', tenantId),
          supabase.from('shift_entries').select('amount, occurred_at, reason').eq('tenant_id', tenantId).eq('entry_type', 'payout')
        ]);

        if (ordersRes.error) throw ordersRes.error;
        if (customersRes.error) throw customersRes.error;
        if (inventoryRes.error) throw inventoryRes.error;
        if (staffRes.error) throw staffRes.error;

        if (rolesRes.data) {
          setRoles(rolesRes.data);
        }

        const supplierNameMap = new Map<string, string>();
        (suppliersRes.data || []).forEach((s: any) => {
          if (s.id && s.name) supplierNameMap.set(s.id, s.name);
        });

        if (purchaseOrdersRes.data) {
          setPurchaseOrders(purchaseOrdersRes.data.map((d: any) => ({
            ...d,
            supplierId: d.supplier_id,
            supplierName: supplierNameMap.get(d.supplier_id) || t('common.unknown_supplier'),
            poNumber: d.po_number,
            tenantId: d.tenant_id,
            branchId: d.branch_id,
            totalAmount: d.total_amount,
            paidAmount: d.paid_amount,
            remainingAmount: d.remaining_amount,
            orderDate: d.order_date,
            orderType: d.po_number?.startsWith('RET') ? 'return' : 'purchase',
            createdBy: d.created_by,
            createdAt: d.created_at,
            updatedAt: d.updated_at,
            items: (d.purchase_order_items || []).map((item: any) => ({
              itemId: item.item_id,
              name: item.name,
              quantity: Number(item.quantity),
              unit: item.unit,
              conversionRate: Number(item.conversion_rate || 1),
              baseQuantity: Number(item.base_quantity || item.quantity),
              pricePerUnit: Number(item.price_per_unit || 0),
              total: Number(item.total || 0)
            }))
          })) as unknown as PurchaseOrder[]);
        }

        if (suppliersRes.data) {
          setSuppliers(suppliersRes.data.map((s: any) => ({
            ...s,
            tenantId: s.tenant_id,
            isTest: s.is_test,
            createdAt: s.created_at
          })) as unknown as Supplier[]);
        }

        if (shiftEntriesRes.data) {
          setShiftPayouts(shiftEntriesRes.data);
        }

        // Map snake_case to camelCase for the UI
        setOrders((ordersRes.data || []).map(o => ({
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
          paymentMethod: o.payment_method,
          customerPhone: o.customer_phone,
          isTest: o.is_test
        } as Order)));

        setCustomers((customersRes.data || []).map(c => ({
          ...c,
          tenantId: c.tenant_id,
          companyName: c.company_name,
          isB2B: c.is_b2b,
          isTest: c.is_test,
          createdAt: c.created_at
        } as Customer)));

        setInventory((inventoryRes.data || []).map(i => ({
          ...i,
          nameEn: i.name_en,
          minThreshold: i.min_threshold,
          pricePerUnit: i.price_per_unit,
          taxType: 'exclusive',
          supplierId: i.supplier_id,
          tenantId: i.tenant_id,
          mainImage: (Array.isArray(i.images) && i.images.length > 0) ? (i.images[0]?.url || i.images[0]) : undefined,
          collarType: i.collar_type,
          cuffType: i.cuff_type,
          pocketType: i.pocket_type,
          chestStyle: i.chest_style,
          isTest: i.is_test,
          updatedAt: i.updated_at
        } as InventoryItem)));

        setStaff((staffRes.data || []).map(s => ({
          ...s,
          tenantId: s.tenant_id,
          branchId: s.branch_id,
          createdAt: s.created_at
        } as Staff)));

      } catch (error) {
        console.error('Error fetching report data:', error);
        handleError(error, OperationType.LIST, 'reports');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [tenantId]);

  // Filtered Data
  const filteredOrders = useMemo(() => {
    return orders.filter(order => {
      const isTestMatch = !excludeTestData || !(order.isTest || (order as any).is_test);
      const dateMatch = (!dateRange.start || order.orderDate >= dateRange.start) && 
                        (!dateRange.end || order.orderDate <= dateRange.end);
      const staffMatch = selectedStaff === 'all' || order.createdBy === selectedStaff;
      const paymentMatch = paymentStatus === 'all' || 
                          (paymentStatus === 'paid' && order.remainingAmount === 0) ||
                          (paymentStatus === 'partial' && order.remainingAmount > 0 && order.paidAmount > 0) ||
                          (paymentStatus === 'unpaid' && order.paidAmount === 0);
      const searchMatch = !searchTerm ||
                         order.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         String(order.orderNumber ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                         order.id.toLowerCase().includes(searchTerm.toLowerCase());
      
      return isTestMatch && dateMatch && staffMatch && paymentMatch && searchMatch;
    });
  }, [orders, dateRange, selectedStaff, paymentStatus, searchTerm, excludeTestData]);

  // Live dropdown preview while typing in the search box -- capped so it
  // stays a quick-glance list rather than duplicating a full table.
  const searchSuggestions = useMemo(() => {
    if (!searchTerm.trim()) return [];
    return filteredOrders.slice(0, 8);
  }, [filteredOrders, searchTerm]);

  // A returned order is set to status 'cancelled' but its original
  // totalAmount/paidAmount are left on the row for audit purposes -- so any
  // revenue/sales figure built from filteredOrders directly would keep
  // counting money that was actually refunded back to the customer. Every
  // financial calculation below uses this non-cancelled subset instead;
  // filteredOrders itself stays the "all orders matching filters" set for
  // status breakdowns and counts that should still show cancelled orders.
  const nonCancelledOrders = useMemo(
    () => filteredOrders.filter(o => o.status !== 'cancelled'),
    [filteredOrders]
  );

  // Financial Calculations
  const financialStats = useMemo(() => {
    const totalRevenue = nonCancelledOrders.reduce((sum, o) => sum + (o.paidAmount || 0), 0);
    const totalSales = nonCancelledOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const totalTax = nonCancelledOrders.reduce((sum, o) => sum + (o.taxAmount || 0), 0);
    const netProfit = totalRevenue - totalTax; // Simplified profit calculation
    const totalReturnsValue = filteredOrders
      .filter(o => o.status === 'cancelled')
      .reduce((sum, o) => sum + (o.totalAmount || 0), 0);

    // Sales by Payment Method
    const paymentMethods = nonCancelledOrders.reduce((acc: any, o) => {
      const method = o.paymentMethod === 'cash' ? t('billing.modal_method_cash') :
                    o.paymentMethod === 'network' ? t('common.payment_methods.network') :
                    o.paymentMethod === 'cash_on_delivery' ? t('orders.payment_on_delivery_short') : t('common.other');
      acc[method] = (acc[method] || 0) + (o.paidAmount || 0);
      return acc;
    }, {});

    const paymentChartData = Object.entries(paymentMethods).map(([name, value]) => ({ name, value }));

    // Revenue Trend
    const trendData = nonCancelledOrders.reduce((acc: any, o) => {
      const date = o.orderDate.split('T')[0];
      if (!acc[date]) acc[date] = { date, revenue: 0, sales: 0 };
      acc[date].revenue += (o.paidAmount || 0);
      acc[date].sales += (o.totalAmount || 0);
      return acc;
    }, {});

    const trendChartData = Object.values(trendData).sort((a: any, b: any) => a.date.localeCompare(b.date));

    return { totalRevenue, totalSales, totalTax, netProfit, totalReturnsValue, paymentChartData, trendChartData };
  }, [nonCancelledOrders, filteredOrders, t]);

  // Purchase orders within the selected date range (the staff/payment-status
  // filters only make sense for sales orders, so purchases only respect the
  // date range and search term).
  const filteredPurchaseOrders = useMemo(() => {
    return purchaseOrders.filter(po => {
      const dateMatch = (!dateRange.start || po.orderDate >= dateRange.start) &&
                        (!dateRange.end || po.orderDate <= dateRange.end);
      const searchMatch = !searchTerm ||
                         po.supplierName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (po.poNumber || (po as any).po_number || '').toLowerCase().includes(searchTerm.toLowerCase());
      return dateMatch && searchMatch;
    });
  }, [purchaseOrders, dateRange, searchTerm]);

  // Weighted-average cost per inventory item, built from every received
  // purchase (all-time, not date-filtered -- a stable baseline cost rather
  // than one that swings with whatever happened to be purchased in the
  // selected range). This is the only real cost data the system has, so
  // COGS below is a weighted-average estimate, not a FIFO/lot-tracked one.
  const avgCostByItemId = useMemo(() => {
    const totals = new Map<string, { cost: number; qty: number }>();
    purchaseOrders.forEach(po => {
      const poType = po.orderType || (po as any).order_type || 'purchase';
      if (poType !== 'purchase' || (po.status || 'draft') !== 'received') return;
      (po.items || []).forEach(item => {
        if (!item.itemId) return;
        const entry = totals.get(item.itemId) || { cost: 0, qty: 0 };
        entry.cost += Number(item.total || 0);
        entry.qty += Number(item.baseQuantity || item.quantity || 0);
        totals.set(item.itemId, entry);
      });
    });
    const map = new Map<string, number>();
    totals.forEach((v, itemId) => { if (v.qty > 0) map.set(itemId, v.cost / v.qty); });
    return map;
  }, [purchaseOrders]);

  // Operating expenses: cash payouts logged against shifts (deliveries,
  // small purchases, etc.) -- the only tenant-wide expense ledger this
  // system tracks outside of supplier purchases.
  const filteredShiftPayouts = useMemo(() => {
    return shiftPayouts.filter(e => {
      const d = e.occurred_at?.split('T')[0];
      return (!dateRange.start || d >= dateRange.start) && (!dateRange.end || d <= dateRange.end);
    });
  }, [shiftPayouts, dateRange]);

  // Profit & Loss: unlike the "simplified" netProfit above (revenue minus
  // tax only), this estimates real cost of goods sold from the weighted
  // average purchase cost of what was actually sold -- ready-made items by
  // itemId/quantity, custom garments by fabricId/consumedMeters -- then
  // subtracts logged cash-drawer expenses too.
  const profitLossStats = useMemo(() => {
    let cogs = 0;
    nonCancelledOrders.forEach(o => {
      (o.items || []).forEach((item: any) => {
        if (item.type === 'ready_made' && item.itemId) {
          cogs += (avgCostByItemId.get(item.itemId) || 0) * Number(item.quantity || 0);
        } else if (item.type === 'custom' && item.fabricId) {
          cogs += (avgCostByItemId.get(item.fabricId) || 0) * Number(item.consumedMeters || item.quantity || 0);
        }
      });
    });

    const netSalesExclVat = financialStats.totalSales - financialStats.totalTax;
    const grossProfit = netSalesExclVat - cogs;
    const grossMargin = netSalesExclVat > 0 ? (grossProfit / netSalesExclVat) * 100 : 0;

    const operatingExpenses = filteredShiftPayouts.reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const netProfit = grossProfit - operatingExpenses;
    const netMargin = netSalesExclVat > 0 ? (netProfit / netSalesExclVat) * 100 : 0;

    const chartData = [
      { name: t('reports.pl_net_sales'), value: netSalesExclVat },
      { name: t('reports.pl_cogs'), value: cogs },
      { name: t('reports.pl_expenses'), value: operatingExpenses },
      { name: t('reports.pl_net_profit'), value: netProfit },
    ];

    return { netSalesExclVat, cogs, grossProfit, grossMargin, operatingExpenses, netProfit, netMargin, chartData };
  }, [nonCancelledOrders, avgCostByItemId, financialStats, filteredShiftPayouts, t]);

  // Suppliers & Purchases
  const supplierStats = useMemo(() => {
    const purchasesOnly = filteredPurchaseOrders.filter(po =>
      (po.orderType || (po as any).order_type || 'purchase') === 'purchase' && po.status === 'received'
    );
    const returnsOnly = filteredPurchaseOrders.filter(po =>
      (po.orderType || (po as any).order_type) === 'return' && po.status === 'returned'
    );

    const totalPurchases = purchasesOnly.reduce((sum, po) => sum + (po.totalAmount || 0), 0);
    const totalPurchaseReturns = returnsOnly.reduce((sum, po) => sum + (po.totalAmount || 0), 0);

    const bySupplier = new Map<string, { id: string; name: string; purchases: number; returns: number }>();
    purchasesOnly.forEach(po => {
      const id = po.supplierId || (po as any).supplier_id;
      const entry = bySupplier.get(id) || { id, name: po.supplierName, purchases: 0, returns: 0 };
      entry.purchases += po.totalAmount || 0;
      bySupplier.set(id, entry);
    });
    returnsOnly.forEach(po => {
      const id = po.supplierId || (po as any).supplier_id;
      const entry = bySupplier.get(id) || { id, name: po.supplierName, purchases: 0, returns: 0 };
      entry.returns += po.totalAmount || 0;
      bySupplier.set(id, entry);
    });

    const supplierBreakdown = Array.from(bySupplier.values())
      .map(v => ({ ...v, net: v.purchases - v.returns }))
      .sort((a, b) => b.net - a.net);

    const totalOutstandingBalance = suppliers
      .filter(s => !excludeTestData || !s.isTest)
      .reduce((sum, s) => sum + (s.balance || 0), 0);

    const trendMap: Record<string, number> = {};
    purchasesOnly.forEach(po => {
      const d = po.orderDate.split('T')[0];
      trendMap[d] = (trendMap[d] || 0) + (po.totalAmount || 0);
    });
    const purchasesTrend = Object.entries(trendMap)
      .map(([date, total]) => ({ date, total }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return { totalPurchases, totalPurchaseReturns, supplierBreakdown, totalOutstandingBalance, purchasesTrend, purchasesOnly, returnsOnly };
  }, [filteredPurchaseOrders, suppliers, excludeTestData]);

  // VAT: purchase totals aren't tracked with a separate tax line, so input
  // VAT is estimated the same way the rest of the app treats order totals --
  // VAT-inclusive at 15% (see SalesRecord.tsx's subtotal/VAT split).
  const vatStats = useMemo(() => {
    const outputVat = financialStats.totalTax;
    const inputVatOnPurchases = supplierStats.totalPurchases - (supplierStats.totalPurchases / 1.15);
    const inputVatOnReturns = supplierStats.totalPurchaseReturns - (supplierStats.totalPurchaseReturns / 1.15);
    const netInputVat = inputVatOnPurchases - inputVatOnReturns;
    const netVatDue = outputVat - netInputVat;

    return { outputVat, inputVat: netInputVat, netVatDue };
  }, [financialStats, supplierStats]);

  // Order Stats
  const orderStats = useMemo(() => {
    const statusCounts = filteredOrders.reduce((acc: any, o) => {
      acc[o.status] = (acc[o.status] || 0) + 1;
      return acc;
    }, {});

    const statusChartData = [
      { name: t('inventory.status_pending'), value: statusCounts['pending'] || 0, key: 'pending' },
      { name: t('reports.status_in_workshop'), value: (statusCounts['cutting'] || 0) + (statusCounts['sewing'] || 0), key: 'processing' },
      { name: t('dashboard.ready'), value: statusCounts['ready'] || 0, key: 'ready' },
      { name: t('common.delivered'), value: statusCounts['delivered'] || 0, key: 'delivered' },
      { name: t('common.status_cancelled'), value: statusCounts['cancelled'] || 0, key: 'cancelled' },
    ];

    // Delayed Orders (Simplified: orders older than 7 days and not delivered)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const delayedOrders = filteredOrders.filter(o => 
      !['delivered', 'cancelled'].includes(o.status) && 
      new Date(o.orderDate) < sevenDaysAgo
    );

    // Average Completion Time
    const completedOrders = filteredOrders.filter(o => o.status === 'delivered');
    let totalDays = 0;
    completedOrders.forEach(o => {
      const start = new Date(o.orderDate);
      const end = new Date(o.history.find(h => h.status === 'delivered')?.updatedAt || o.orderDate);
      totalDays += (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    });
    const avgTime = completedOrders.length > 0 ? (totalDays / completedOrders.length).toFixed(1) : '0';

    return { statusChartData, delayedCount: delayedOrders.length, delayedOrders, avgTime };
  }, [filteredOrders, t]);

  // Filtered Inventory
  const filteredInventory = useMemo(() => {
    return inventory.filter(item => {
      const isTestMatch = !excludeTestData || !item.isTest;
      return isTestMatch;
    });
  }, [inventory, excludeTestData]);

  // Inventory Stats
  const inventoryStats = useMemo(() => {
    const lowStockItems = filteredInventory.filter(item => item.quantity <= item.minThreshold);
    const topItems = [...filteredInventory].sort((a, b) => b.quantity - a.quantity).slice(0, 5);
    
    return { lowStockItems, topItems };
  }, [filteredInventory]);

  // Staff Performance
  const staffStats = useMemo(() => {
    const performance = staff.map(s => {
      const staffOrders = nonCancelledOrders.filter(o => o.createdBy === s.id);
      const totalSales = staffOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
      const completedItems = staffOrders.filter(o => o.status === 'delivered').length;

      return {
        name: s.name,
        sales: totalSales,
        completed: completedItems,
        role: s.role
      };
    }).sort((a, b) => b.sales - a.sales);

    return { performance };
  }, [staff, nonCancelledOrders]);

  // Detailed Employee Performance
  const staffWithPerformance = useMemo(() => {
    return staff.map(s => {
      const staffOrders = filteredOrders.filter(o => o.assignedTo === s.id || o.createdBy === s.id);
      const assignedOrders = filteredOrders.filter(o => o.assignedTo === s.id);
      const ordersToCount = assignedOrders.length > 0 ? assignedOrders : staffOrders;

      const totalHandled = ordersToCount.length;
      const completed = ordersToCount.filter(o => o.status === 'delivered' || o.status === 'ready').length;
      const active = ordersToCount.filter(o => o.status !== 'delivered' && o.status !== 'ready' && o.status !== 'cancelled').length;
      const rate = totalHandled > 0 ? Math.round((completed / totalHandled) * 100) : 0;
      const roleName = roles.find(r => r.roleKey === s.role || r.id === s.role)?.name || s.role;

      return {
        ...s,
        roleName,
        totalHandled,
        completed,
        active,
        rate,
        ordersToCount
      };
    }).sort((a, b) => b.completed - a.completed);
  }, [staff, filteredOrders, roles]);

  // Customer Behavior
  const customerStats = useMemo(() => {
    const filteredCustomers = customers.filter(c => !excludeTestData || !c.isTest);
    const customerPurchases = filteredCustomers.map(c => {
      const customerOrders = nonCancelledOrders.filter(o => o.customerId === c.id || o.customerPhone === c.phone);
      const totalSpent = customerOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
      const orderCount = customerOrders.length;

      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        totalSpent,
        orderCount
      };
    }).filter(c => c.orderCount > 0).sort((a, b) => b.totalSpent - a.totalSpent);

    const topCustomers = customerPurchases.slice(0, 5);
    
    // Calculate returning vs new customers (simplified: 1 order = new, >1 = returning)
    const newCustomers = customerPurchases.filter(c => c.orderCount === 1).length;
    const returningCustomers = customerPurchases.filter(c => c.orderCount > 1).length;

    const retentionChartData = [
      { name: t('reports.new_customers'), value: newCustomers },
      { name: t('reports.returning_customers'), value: returningCustomers }
    ];

    return { topCustomers, retentionChartData, totalActiveCustomers: customerPurchases.length };
  }, [customers, nonCancelledOrders, excludeTestData, t]);

  const fetchDailyZReport = async (date: string) => {
    setLoadingZ(true);
    try {
      const { data: shifts, error } = await supabase
        .from('shifts')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('status', 'closed')
        .gte('end_time', `${date}T00:00:00Z`)
        .lte('end_time', `${date}T23:59:59Z`);

      if (error) throw error;

      if (!shifts || shifts.length === 0) {
        setDailyZData(null);
        toastWarning(t('reports.no_shifts_found', 'لم يتم العثور على ورديات مغلقة لهذا التاريخ لتوليد التقرير المجمع'));
        return;
      }

      // Consolidate Totals
      const consolidatedTotals = shifts.reduce((acc, s) => {
        const t = s.totals!;
        return {
          cash: acc.cash + t.cash,
          card: acc.card + t.card,
          bank_transfer: acc.bank_transfer + t.bank_transfer,
          credit: acc.credit + t.credit,
          cashReturns: acc.cashReturns + t.cashReturns,
          totalReturns: acc.totalReturns + t.totalReturns,
          returnCount: acc.returnCount + (t.returnCount || 0),
          expenses: acc.expenses + t.expenses,
          taxes: acc.taxes + t.taxes,
          totalSales: acc.totalSales + t.totalSales,
          grossSales: acc.grossSales + (t.grossSales || t.totalSales),
          discounts: acc.discounts + (t.discounts || 0)
        };
      }, {
        cash: 0, card: 0, bank_transfer: 0, credit: 0, cashReturns: 0, totalReturns: 0,
        returnCount: 0, expenses: 0, taxes: 0, totalSales: 0, grossSales: 0, discounts: 0
      });

      const startTimes = shifts.map(s => new Date(s.start_time).getTime());
      const endTimes = shifts.map(s => new Date(s.end_time!).getTime());

      // Order count / items sold / product breakdown are computed fresh
      // from the already-loaded orders for this date rather than summed
      // from each shift's stored totals -- those totals may predate this
      // field on older shifts, which would silently understate a
      // multi-shift day instead of reflecting what was actually sold.
      const dayOrders = orders.filter(o => o.orderDate?.startsWith(date) && o.status !== 'cancelled');
      const orderCount = dayOrders.length;
      let itemsSoldCount = 0;
      const productMap = new Map<string, { name: string; quantity: number; total: number }>();
      dayOrders.forEach(o => {
        (o.items || []).forEach((item: any) => {
          const qty = Number(item.quantity || 0);
          itemsSoldCount += qty;
          const key = item.type === 'custom' ? (item.garmentType || t('orders.custom_thobe')) : (item.name || t('orders.ready_made'));
          const entry = productMap.get(key) || { name: key, quantity: 0, total: 0 };
          entry.quantity += qty;
          entry.total += Number(item.price || 0) * qty;
          productMap.set(key, entry);
        });
      });
      const productBreakdown = Array.from(productMap.values()).sort((a, b) => b.quantity - a.quantity);

      setDailyZData({
        id: `EOD-${date}`,
        tenantId,
        staffName: t('reports.consolidated_staff_name'),
        startTime: new Date(Math.min(...startTimes)).toISOString(),
        endTime: new Date(Math.max(...endTimes)).toISOString(),
        openingBalance: shifts.find(s => new Date(s.start_time).getTime() === Math.min(...startTimes))?.opening_balance || 0,
        actualCash: shifts.reduce((sum, s) => sum + (s.actual_cash || 0), 0),
        expectedCash: shifts.reduce((sum, s) => sum + (s.expected_cash || 0), 0),
        discrepancy: shifts.reduce((sum, s) => sum + (s.discrepancy || 0), 0),
        totals: { ...consolidatedTotals, orderCount, itemsSoldCount, productBreakdown },
        type: 'daily'
      });
      
      toastSuccess(t('reports.z_report_success', 'تم توليد التقرير المالي المجمع بنجاح'));
    } catch (error: any) {
      console.error('Error fetching Z-report:', error);
      toastError(error.message || t('reports.z_report_error', 'حدث خطأ أثناء توليد التقرير المالي المجمع'));
    } finally {
      setLoadingZ(false);
    }
  };

  const exportToExcel = (data: any[], filename: string) => {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Report");
    XLSX.writeFile(workbook, `${filename}.xlsx`);
  };

  if (loading || permsLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-surface-muted">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand"></div>
      </div>
    );
  }

  if (!canViewReports) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] text-right" dir={dir}>
        <div className="p-6 bg-rose-500/10 text-rose-600 rounded-[2.5rem] mb-6">
          <AlertTriangle size={48} />
        </div>
        <h2 className="text-2xl font-black text-content mb-2">{t('reports.access_denied_title')}</h2>
        <p className="text-content-muted font-bold">{t('reports.access_denied_desc')}</p>
      </div>
    );
  }

  const reportTabs = [
    { id: 'general', label: t('reports.tab_general'), icon: TrendingUp },
    { id: 'financial', label: t('dashboard.grid.finance'), icon: DollarSign },
    { id: 'profit_loss', label: t('reports.tab_profit_loss'), icon: TrendingUp },
    { id: 'orders', label: t('reports.tab_orders'), icon: ShoppingBag },
    { id: 'inventory', label: t('inventory.reports'), icon: Package },
    { id: 'staff', label: t('reports.tab_staff_customers'), icon: Users },
    { id: 'suppliers_purchases', label: t('reports.tab_suppliers_purchases'), icon: Truck },
    { id: 'vat', label: t('reports.tab_vat'), icon: Landmark },
    { id: 'zreports', label: t('reports.tab_zreports'), icon: Calculator },
    { id: 'tailor_commissions', label: t('reports.tab_tailor_commissions'), icon: Scissors },
  ];
  const activeTabLabel = reportTabs.find(tab => tab.id === activeTab)?.label || '';

  return (
    <div className="space-y-4 sm:space-y-8 text-right pb-20 px-2 sm:px-0" dir={dir}>
      <Header 
        tenantId={tenantId} 
        title={t('reports.title')} 
        subtitle={t('reports.subtitle')}
      >
        <div className="flex flex-col sm:flex-row gap-2.5 w-full sm:w-auto">
          <button 
            onClick={() => canExportReports && exportToExcel(filteredOrders, `orders_report_${activeTab}`)}
            disabled={!canExportReports}
            className={cn(
              "flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 sm:px-6 py-2.5 sm:py-3 bg-surface border border-border rounded-xl sm:rounded-2xl text-content-muted hover:bg-surface-muted font-black text-xs sm:text-sm transition-all shadow-sm",
              !canExportReports && "opacity-50 cursor-not-allowed"
            )}
          >
            <FileSpreadsheet size={16} className="text-emerald-600 sm:w-5 sm:h-5" />
            <span>{t('dashboard.export_excel')}</span>
          </button>
          <button 
            onClick={() => canExportReports && window.print()}
            disabled={!canExportReports}
            className={cn(
              "flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 sm:px-6 py-2.5 sm:py-3 bg-brand text-white rounded-xl sm:rounded-2xl hover:bg-brand/90 font-black text-xs sm:text-sm transition-all shadow-lg shadow-brand/10",
              !canExportReports && "opacity-50 cursor-not-allowed"
            )}
          >
            <Download size={16} className="sm:w-5 sm:h-5" />
            <span>{t('saas.export_pdf')}</span>
          </button>
        </div>
      </Header>

      {/* Filters Bar */}
      <div id="reports-filters-bar" className="bg-surface p-4 sm:p-6 rounded-2xl sm:rounded-[2.5rem] border border-border shadow-sm flex flex-col lg:flex-row lg:items-center gap-4 sm:gap-6">
        <div className="relative w-full lg:flex-1">
          <div className="flex items-center gap-2.5 bg-surface-muted/50 hover:bg-surface-muted/80 border border-border focus-within:border-brand/40 focus-within:bg-surface rounded-2xl px-4 h-12 transition-all shadow-inner shadow-black/5">
            <Search className="text-content-muted shrink-0" size={18} />
            <input
              id="reports-search-input"
              type="text"
              placeholder={t('dashboard.cashier.search_placeholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setTimeout(() => setIsSearchFocused(false), 150)}
              className="w-full bg-transparent border-none p-0 focus:ring-0 font-bold text-sm text-content outline-none"
              autoComplete="off"
            />
          </div>

          {/* Live search results dropdown */}
          {isSearchFocused && searchTerm.trim() && (
            <div className="absolute z-30 top-[calc(100%+6px)] inset-x-0 bg-surface border border-border rounded-2xl shadow-xl overflow-hidden max-h-80 overflow-y-auto">
              {searchSuggestions.length > 0 ? (
                searchSuggestions.map(order => (
                  <button
                    key={order.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setIsSearchFocused(false);
                      setDrillDown({
                        title: t('reports.drilldown_orders_title', { name: order.customerName }),
                        data: [order],
                        columns: [
                          { key: 'id', label: t('dashboard.cashier.col_order_number') },
                          { key: 'customerName', label: t('common.customer') },
                          { key: 'totalAmount', label: t('common.amount'), type: 'currency' },
                          { key: 'orderDate', label: t('common.date'), type: 'date' },
                          { key: 'status', label: t('common.status'), type: 'status' }
                        ]
                      });
                    }}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-muted/60 transition-colors text-right border-b border-border last:border-0"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-black text-content truncate">
                        {order.customerName} <span className="text-content-muted font-bold">#{order.orderNumber ?? order.id.slice(-6).toUpperCase()}</span>
                      </p>
                      <p className="text-[10px] text-content-muted font-bold mt-0.5">
                        <DateTimeDisplay date={order.orderDate} showTime={false} />
                      </p>
                    </div>
                    <span className="text-xs font-black text-brand shrink-0"><PriceDisplay amount={order.totalAmount} /></span>
                  </button>
                ))
              ) : (
                <div className="px-4 py-6 text-center text-xs font-bold text-content-muted">
                  {t('pos.no_orders')}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto">
          {/* Start Date */}
          <div className="flex-1 sm:flex-none min-w-[130px] lg:min-w-[150px]">
            <DatePicker
              id="reports-date-start"
              value={dateRange.start}
              onChange={(val) => setDateRange({ ...dateRange, start: val })}
              placeholder={t('common.from', 'من')}
            />
          </div>

          {/* End Date */}
          <div className="flex-1 sm:flex-none min-w-[130px] lg:min-w-[150px]">
            <DatePicker
              id="reports-date-end"
              value={dateRange.end}
              onChange={(val) => setDateRange({ ...dateRange, end: val })}
              placeholder={t('common.to', 'إلى')}
            />
          </div>

          <div className="flex-1 sm:flex-none sm:min-w-[160px]">
            <Select 
              value={selectedStaff}
              onChange={(val) => setSelectedStaff(val)}
              options={[
                { value: 'all', label: t('reports.filter_all_staff') },
                ...staff.map(s => ({ value: s.id, label: s.name }))
              ]}
              className="h-12 rounded-2xl bg-surface-muted/50 hover:bg-surface-muted/80 border-border text-sm font-bold text-content shadow-inner shadow-black/5 focus:ring-0 focus:border-brand/40"
            />
          </div>

          <div className="flex-1 sm:flex-none sm:min-w-[160px]">
            <Select 
              value={paymentStatus}
              onChange={(val) => setPaymentStatus(val)}
              options={[
                { value: 'all', label: t('reports.filter_all_payment_statuses') },
                { value: 'paid', label: t('orders.fully_paid') },
                { value: 'partial', label: t('common.payment_methods.partial') },
                { value: 'unpaid', label: t('reports.payment_unpaid') }
              ]}
              className="h-12 rounded-2xl bg-surface-muted/50 hover:bg-surface-muted/80 border-border text-sm font-bold text-content shadow-inner shadow-black/5 focus:ring-0 focus:border-brand/40"
            />
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div id="reports-tabs-nav-container" className="w-full overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <div className="flex items-center gap-1.5 sm:gap-2 bg-surface p-1.5 sm:p-2 rounded-xl sm:rounded-[2rem] border border-border shadow-sm w-max">
          {reportTabs.map((tab) => (
            <button
              id={`tab-btn-${tab.id}`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id as ReportTab)}
              className={cn(
                "flex items-center gap-1.5 sm:gap-2 px-3 sm:px-6 py-2 sm:py-3 rounded-lg sm:rounded-2xl font-black text-xs sm:text-sm transition-all shrink-0",
                activeTab === tab.id 
                  ? "bg-brand text-white shadow-lg shadow-brand/10" 
                  : "text-content-muted hover:bg-surface-muted"
              )}
            >
              <tab.icon size={16} className="sm:w-[18px] sm:h-[18px]" />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div
          id="reports-printable-area"
          key={activeTab}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="space-y-4 sm:space-y-8"
        >
          {/* Print-only report header -- invisible on screen, shown only in the
              exported PDF/printout so it reads as a document rather than a raw
              dump of the live dashboard UI. */}
          <div className="hidden print:block mb-6 pb-4 border-b-2 border-black">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-black">{t('reports.title')} — {activeTabLabel}</h1>
                {(dateRange.start || dateRange.end) && (
                  <p className="text-sm font-bold mt-1">
                    {dateRange.start || '...'} {t('common.to', 'إلى')} {dateRange.end || '...'}
                  </p>
                )}
              </div>
              <p className="text-xs font-bold">
                {t('z_report.excel_date', 'التاريخ')}: {new Date().toLocaleDateString(locale)}
              </p>
            </div>
          </div>

          {activeTab === 'general' && (
            <div id="reports-general-grid" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
              {[
                { label: t('dashboard.total_revenue'), value: financialStats.totalRevenue, icon: DollarSign, color: 'text-emerald-600', bg: 'bg-emerald-500/10', isCurrency: true },
                { label: t('dashboard.admin.total_sales'), value: financialStats.totalSales, icon: TrendingUp, color: 'text-brand', bg: 'bg-brand/10', isCurrency: true },
                { label: t('dashboard.orders_count'), value: filteredOrders.length, icon: ShoppingBag, color: 'text-amber-600', bg: 'bg-amber-500/10', isCurrency: false },
                { label: t('reports.delayed_orders'), value: orderStats.delayedCount, icon: AlertTriangle, color: 'text-rose-600', bg: 'bg-rose-500/10', isCurrency: false },
              ].map((stat, i) => (
                <div key={i} className="bg-surface p-3 sm:p-6 lg:p-8 rounded-xl sm:rounded-[2.5rem] border border-border shadow-sm flex flex-col sm:flex-row items-center sm:items-start lg:items-center gap-3 sm:gap-6 text-center sm:text-right">
                  <div className={cn("p-2.5 sm:p-5 rounded-xl sm:rounded-2xl shrink-0", stat.bg, stat.color)}>
                    <stat.icon size={20} className="sm:w-7 sm:h-7" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] sm:text-xs font-black text-content-muted uppercase tracking-widest truncate">{stat.label}</p>
                    <h3 className="text-xs sm:text-xl lg:text-2xl font-black text-content mt-0.5 sm:mt-1 truncate">
                      {typeof stat.value === 'number' && stat.isCurrency
                        ? <PriceDisplay amount={stat.value} />
                        : stat.value.toLocaleString('en-US')}
                    </h3>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'financial' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8">
              {/* Revenue vs Sales Trend */}
              <div className="bg-surface p-4 sm:p-8 rounded-2xl sm:rounded-[2.5rem] border border-border shadow-sm">
                <div className="flex justify-between items-center mb-6 sm:mb-8">
                  <h3 className="text-sm sm:text-lg font-black text-content">{t('reports.revenue_vs_sales')}</h3>
                  <div className="flex gap-2 sm:gap-4 text-[10px] sm:text-xs font-bold">
                    <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-brand rounded-full" /><span>{t('common.sales')}</span></div>
                    <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-emerald-500 rounded-full" /><span>{t('reports.revenue')}</span></div>
                  </div>
                </div>
                <div className="h-64 sm:h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={financialStats.trendChartData}>
                      <defs>
                        <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#1C8FFF" stopOpacity={0.35}/>
                          <stop offset="100%" stopColor="#1C8FFF" stopOpacity={0.0}/>
                        </linearGradient>
                        <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#22C55E" stopOpacity={0.4}/>
                          <stop offset="100%" stopColor="#22C55E" stopOpacity={0.0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="var(--border)" opacity={0.5} />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: 'var(--content-muted)' }} dy={6} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: 'var(--content-muted)' }} />
                      <Tooltip 
                        cursor={{ stroke: 'var(--brand)', strokeWidth: 1.5, strokeDasharray: '4 4', opacity: 0.5 }}
                        content={({ active, payload, label }) => {
                          if (active && payload && payload.length) {
                            const salesVal = payload.find(p => p.dataKey === 'sales')?.value as number || 0;
                            const revVal = payload.find(p => p.dataKey === 'revenue')?.value as number || 0;
                            return (
                              <div className="bg-surface/95 backdrop-blur-md p-4 rounded-2xl shadow-2xl border border-border text-right min-w-[200px] animate-in fade-in zoom-in-95 duration-150">
                                <div className="text-xs font-black text-content pb-2 mb-2 border-b border-border/60">{label}</div>
                                <div className="space-y-2 text-xs font-bold">
                                  <div className="flex items-center justify-between gap-4">
                                    <span className="text-content-muted flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#1C8FFF]" />{t('common.sales')}:</span>
                                    <span className="font-black text-[#1C8FFF]"><PriceDisplay amount={salesVal} /></span>
                                  </div>
                                  <div className="flex items-center justify-between gap-4">
                                    <span className="text-content-muted flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#22C55E]" />{t('reports.revenue')}:</span>
                                    <span className="font-black text-emerald-600"><PriceDisplay amount={revVal} /></span>
                                  </div>
                                </div>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Area type="monotone" dataKey="sales" stroke="#1C8FFF" strokeWidth={3} fillOpacity={1} fill="url(#colorSales)" activeDot={{ r: 6, strokeWidth: 2, stroke: 'var(--surface)' }} />
                      <Area type="monotone" dataKey="revenue" stroke="#22C55E" strokeWidth={3} fillOpacity={1} fill="url(#colorRevenue)" activeDot={{ r: 6, strokeWidth: 2, stroke: 'var(--surface)' }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Payment Methods */}
              <div className="bg-surface p-4 sm:p-8 rounded-2xl sm:rounded-[2.5rem] border border-border shadow-sm">
                <h3 className="text-sm sm:text-lg font-black text-content mb-6 sm:mb-8">{t('reports.sales_by_payment_method')}</h3>
                <div className="h-64 sm:h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={financialStats.paymentChartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={85}
                        paddingAngle={6}
                        dataKey="value"
                      >
                        {financialStats.paymentChartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontWeight: 800, backgroundColor: 'var(--color-surface)', color: 'var(--color-content)', fontSize: '12px' }}
                        formatter={(value: number) => <PriceDisplay amount={value} />}
                      />
                      <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: 700 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Tax, Profit & Returns Cards */}
              <div className="lg:col-span-2 grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6">
                <div className="bg-surface p-4 sm:p-8 rounded-2xl sm:rounded-[2.5rem] border border-border shadow-sm">
                  <p className="text-[10px] sm:text-xs font-black text-content-muted uppercase tracking-widest">{t('reports.total_tax')}</p>
                  <h3 className="text-base sm:text-2xl font-black text-rose-600 mt-1 sm:mt-2"><PriceDisplay amount={financialStats.totalTax} /></h3>
                  <p className="text-[9px] sm:text-[10px] text-content-muted mt-0.5 sm:mt-1 font-bold">{t('dashboard.admin.vat_15')}</p>
                </div>
                <div className="bg-surface p-4 sm:p-8 rounded-2xl sm:rounded-[2.5rem] border border-border shadow-sm">
                  <p className="text-[10px] sm:text-xs font-black text-content-muted uppercase tracking-widest">{t('reports.net_profit')}</p>
                  <h3 className="text-base sm:text-2xl font-black text-emerald-600 mt-1 sm:mt-2"><PriceDisplay amount={financialStats.netProfit} /></h3>
                  <p className="text-[9px] sm:text-[10px] text-content-muted mt-0.5 sm:mt-1 font-bold">{t('reports.after_tax_deduction')}</p>
                </div>
                <div className="bg-surface p-4 sm:p-8 rounded-2xl sm:rounded-[2.5rem] border border-border shadow-sm">
                  <p className="text-[10px] sm:text-xs font-black text-content-muted uppercase tracking-widest">{t('reports.avg_order_value')}</p>
                  <h3 className="text-base sm:text-2xl font-black text-brand mt-1 sm:mt-2">
                    <PriceDisplay amount={nonCancelledOrders.length > 0 ? financialStats.totalSales / nonCancelledOrders.length : 0} />
                  </h3>
                  <p className="text-[9px] sm:text-[10px] text-content-muted mt-0.5 sm:mt-1 font-bold">{t('reports.based_on_orders', { n: nonCancelledOrders.length })}</p>
                </div>
                <div className="bg-surface p-4 sm:p-8 rounded-2xl sm:rounded-[2.5rem] border border-border shadow-sm">
                  <p className="text-[10px] sm:text-xs font-black text-content-muted uppercase tracking-widest">{t('reports.total_returns_value')}</p>
                  <h3 className="text-base sm:text-2xl font-black text-danger mt-1 sm:mt-2"><PriceDisplay amount={financialStats.totalReturnsValue} /></h3>
                  <p className="text-[9px] sm:text-[10px] text-content-muted mt-0.5 sm:mt-1 font-bold">{t('common.status_cancelled')}</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'profit_loss' && (
            <div className="space-y-4 sm:space-y-8">
              <div className="bg-amber-500/5 border border-amber-500/15 text-amber-700 dark:text-amber-400 rounded-2xl p-4 text-xs sm:text-sm font-bold flex items-start gap-3">
                <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                <span>{t('reports.pl_estimate_disclaimer')}</span>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-6">
                {[
                  { label: t('reports.pl_net_sales'), value: profitLossStats.netSalesExclVat, color: 'text-brand', bg: 'bg-brand/10' },
                  { label: t('reports.pl_cogs'), value: profitLossStats.cogs, color: 'text-amber-600', bg: 'bg-amber-500/10' },
                  { label: t('reports.pl_gross_profit'), value: profitLossStats.grossProfit, color: 'text-emerald-600', bg: 'bg-emerald-500/10', sub: t('reports.pl_margin', { n: profitLossStats.grossMargin.toFixed(1) }) },
                  { label: t('reports.pl_expenses'), value: profitLossStats.operatingExpenses, color: 'text-rose-600', bg: 'bg-rose-500/10' },
                  { label: t('reports.pl_net_profit'), value: profitLossStats.netProfit, color: profitLossStats.netProfit >= 0 ? 'text-emerald-600' : 'text-danger', bg: profitLossStats.netProfit >= 0 ? 'bg-emerald-500/10' : 'bg-danger/10', sub: t('reports.pl_margin', { n: profitLossStats.netMargin.toFixed(1) }) },
                ].map((card, i) => (
                  <div key={i} className="bg-surface p-3 sm:p-6 rounded-xl sm:rounded-[2.5rem] border border-border shadow-sm">
                    <p className="text-[10px] sm:text-xs font-black text-content-muted uppercase tracking-widest truncate">{card.label}</p>
                    <h3 className={cn("text-sm sm:text-xl font-black mt-1 sm:mt-2 truncate", card.color)}><PriceDisplay amount={card.value} /></h3>
                    {card.sub && <p className="text-[9px] sm:text-[10px] text-content-muted mt-0.5 sm:mt-1 font-bold">{card.sub}</p>}
                  </div>
                ))}
              </div>

              <div className="bg-surface p-4 sm:p-8 rounded-2xl sm:rounded-[2.5rem] border border-border shadow-sm">
                <h3 className="text-sm sm:text-lg font-black text-content mb-6 sm:mb-8">{t('reports.pl_breakdown_title')}</h3>
                <div className="h-64 sm:h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={profitLossStats.chartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-border" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: 'currentColor' }} className="text-content-muted" />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: 'currentColor' }} className="text-content-muted" />
                      <Tooltip
                        cursor={{ fill: 'var(--color-surface-muted)' }}
                        contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontWeight: 800, backgroundColor: 'var(--color-surface)', color: 'var(--color-content)', fontSize: '12px' }}
                        formatter={(value: number) => <PriceDisplay amount={value} />}
                      />
                      <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                        {profitLossStats.chartData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'orders' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-8">
              {/* Order Status Bar Chart */}
              <div className="lg:col-span-2 bg-surface p-4 sm:p-8 rounded-2xl sm:rounded-[2.5rem] border border-border shadow-sm">
                <h3 className="text-sm sm:text-lg font-black text-content mb-6 sm:mb-8">{t('reports.current_order_statuses')}</h3>
                <div className="h-64 sm:h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={orderStats.statusChartData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-border" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: 'currentColor' }} className="text-content-muted" />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: 'currentColor' }} className="text-content-muted" />
                      <Tooltip 
                        cursor={{ fill: 'var(--color-surface-muted)' }}
                        contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontWeight: 800, backgroundColor: 'var(--color-surface)', color: 'var(--color-content)', fontSize: '12px' }}
                      />
                      <Bar 
                        dataKey="value" 
                        fill="#1C8FFF" 
                        radius={[6, 6, 0, 0]} 
                        onClick={(data) => setDrillDown({
                          title: t('reports.drilldown_orders_title', { name: data.name }),
                          data: filteredOrders.filter(o => {
                            if (data.key === 'processing') return ['cutting', 'sewing'].includes(o.status);
                            return o.status === data.key;
                          }),
                          columns: [
                            { key: 'id', label: t('dashboard.cashier.col_order_number') },
                            { key: 'customerName', label: t('common.customer') },
                            { key: 'totalAmount', label: t('common.amount'), type: 'currency' },
                            { key: 'orderDate', label: t('common.date'), type: 'date' },
                            { key: 'status', label: t('common.status'), type: 'status' }
                          ]
                        })}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* KPIs */}
              <div className="grid grid-cols-2 lg:grid-cols-1 gap-3 sm:gap-6">
                <div className="bg-surface p-4 sm:p-8 rounded-2xl sm:rounded-[2.5rem] border border-border shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2 sm:gap-4 mb-2 sm:mb-4">
                      <div className="p-2 bg-amber-500/10 text-amber-600 rounded-lg sm:rounded-xl shrink-0"><Clock size={16} className="sm:w-6 sm:h-6" /></div>
                      <h4 className="font-black text-xs sm:text-base text-content">{t('reports.completion_time')}</h4>
                    </div>
                    <h3 className="text-lg sm:text-3xl font-black text-content">{t('reports.days_value', { n: orderStats.avgTime })}</h3>
                  </div>
                  <p className="text-[9px] sm:text-xs text-content-muted font-bold mt-2">{t('reports.from_order_to_delivery')}</p>
                </div>

                <div 
                  className="bg-surface p-4 sm:p-8 rounded-2xl sm:rounded-[2.5rem] border border-border shadow-sm cursor-pointer hover:border-rose-500/30 transition-all flex flex-col justify-between"
                  onClick={() => setDrillDown({
                    title: t('reports.delayed_orders_title'),
                    data: orderStats.delayedOrders,
                    columns: [
                      { key: 'id', label: t('dashboard.cashier.col_order_number') },
                      { key: 'customerName', label: t('common.customer') },
                      { key: 'orderDate', label: t('reports.col_order_date'), type: 'date' },
                      { key: 'status', label: t('reports.col_current_status'), type: 'status' }
                    ]
                  })}
                >
                  <div>
                    <div className="flex items-center gap-2 sm:gap-4 mb-2 sm:mb-4">
                      <div className="p-2 bg-rose-500/10 text-rose-600 rounded-lg sm:rounded-xl shrink-0"><AlertTriangle size={16} className="sm:w-6 sm:h-6" /></div>
                      <h4 className="font-black text-xs sm:text-base text-content">{t('reports.delayed_orders')}</h4>
                    </div>
                    <h3 className="text-lg sm:text-3xl font-black text-rose-600">{orderStats.delayedCount}</h3>
                  </div>
                  <p className="text-[9px] sm:text-xs text-content-muted font-bold mt-2">{t('reports.over_seven_working_days')}</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'inventory' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8">
              {/* Low Stock Alerts */}
              <div className="bg-surface p-4 sm:p-8 rounded-2xl sm:rounded-[2.5rem] border border-border shadow-sm">
                <div className="flex items-center justify-between mb-6 sm:mb-8">
                  <h3 className="text-sm sm:text-lg font-black text-content flex items-center gap-1.5 sm:gap-2">
                    <AlertTriangle className="text-rose-500 shrink-0 sm:w-5 sm:h-5" size={18} />
                    {t('reports.low_stock_alerts')}
                  </h3>
                  <span className="px-2.5 py-0.5 sm:px-3 sm:py-1 bg-rose-500/10 text-rose-600 rounded-full text-[10px] sm:text-xs font-black">
                    {t('reports.items_count', { n: inventoryStats.lowStockItems.length })}
                  </span>
                </div>
                <div className="space-y-3 sm:space-y-4 max-h-[320px] overflow-y-auto pr-1">
                  {inventoryStats.lowStockItems.length > 0 ? (
                    inventoryStats.lowStockItems.map(item => (
                      <div key={item.id} className="flex items-center justify-between p-3 sm:p-4 bg-surface-muted rounded-xl sm:rounded-2xl">
                        <div className="flex items-center gap-2 sm:gap-3">
                          <div className="w-8 h-8 sm:w-10 sm:h-10 bg-surface rounded-lg sm:rounded-xl flex items-center justify-center text-rose-500 shadow-sm shrink-0">
                            <Package size={16} className="sm:w-5 sm:h-5" />
                          </div>
                          <div>
                            <p className="text-xs sm:text-sm font-black text-content truncate max-w-[120px] sm:max-w-none">{item.name}</p>
                            <p className="text-[9px] sm:text-[10px] text-content-muted font-bold">{t('reports.min_threshold_value', { value: item.minThreshold, unit: item.unit })}</p>
                          </div>
                        </div>
                        <div className="text-left">
                          <p className="text-xs sm:text-sm font-black text-rose-600">{item.quantity} {item.unit}</p>
                          <p className="text-[9px] sm:text-[10px] text-content-muted font-bold">{t('reports.current_quantity')}</p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-12">
                      <CheckCircle2 size={40} className="text-emerald-500/20 mx-auto mb-3 sm:w-12 sm:h-12" />
                      <p className="text-content-muted font-bold text-xs sm:text-sm">{t('reports.stock_healthy')}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Top Consumed Items */}
              <div className="bg-surface p-4 sm:p-8 rounded-2xl sm:rounded-[2.5rem] border border-border shadow-sm">
                <h3 className="text-sm sm:text-lg font-black text-content mb-6 sm:mb-8">{t('reports.most_available_items')}</h3>
                <div className="h-64 sm:h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={inventoryStats.topItems} layout="vertical" margin={{ left: 10, right: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="currentColor" className="text-border" />
                      <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 700, fill: 'currentColor' }} className="text-content-muted" />
                      <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 700, fill: 'currentColor' }} className="text-content-muted" width={70} />
                      <Tooltip 
                        cursor={{ fill: 'var(--color-surface-muted)' }}
                        contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontWeight: 800, backgroundColor: 'var(--color-surface)', color: 'var(--color-content)', fontSize: '12px' }}
                      />
                      <Bar dataKey="quantity" fill="#1C8FFF" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'staff' && (
            <div className="space-y-4 sm:space-y-8">
              {/* Detailed Employee Performance Table */}
              <div className="bg-surface p-4 sm:p-8 rounded-2xl sm:rounded-[2.5rem] border border-border shadow-sm space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-base sm:text-xl font-black text-content flex items-center gap-2">
                      <TrendingUp className="text-brand shrink-0" size={22} />
                      {t('reports.staff_performance_title')}
                    </h3>
                    <p className="text-xs font-medium text-content-muted mt-1">
                      {t('reports.staff_performance_desc')}
                    </p>
                  </div>
                  <span className="px-3.5 py-1.5 bg-brand/10 text-brand rounded-full text-xs font-black self-start sm:self-auto">
                    {t('reports.staff_count', { n: staffWithPerformance.length })}
                  </span>
                </div>

                <div className="overflow-x-auto whitespace-nowrap -mx-4 sm:-mx-8 px-4 sm:px-8">
                  <div className="rounded-2xl border border-border overflow-hidden min-w-max">
                    <table className="w-full text-right min-w-max">
                      <thead>
                        <tr className="bg-surface-muted border-b border-border">
                          <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-widest">{t('common.employee')}</th>
                          <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-widest">{t('common.role')}</th>
                          <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-widest">{t('staff.total_tasks')}</th>
                          <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-widest">{t('staff.in_progress')}</th>
                          <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-widest">{t('staff.completed_tasks')}</th>
                          <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-widest">{t('reports.completion_rate')}</th>
                          <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-widest">{t('common.details')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {staffWithPerformance.map((member) => (
                          <tr key={member.id} className="hover:bg-surface-muted/50 transition-colors">
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center text-brand font-black">
                                  {member.name.charAt(0)}
                                </div>
                                <span className="font-bold text-content">{member.name}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className="text-xs font-bold text-content-muted bg-surface-muted px-2.5 py-1 rounded-full">
                                {member.roleName}
                              </span>
                            </td>
                            <td className="px-6 py-4 font-black text-content">{member.totalHandled}</td>
                            <td className="px-6 py-4 font-black text-brand">{member.active}</td>
                            <td className="px-6 py-4 font-black text-emerald-600">{member.completed}</td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3 min-w-[140px]">
                                <div className="flex-1 h-2 bg-surface-muted rounded-full overflow-hidden">
                                  <div className="h-full bg-brand transition-all" style={{ width: `${member.rate}%` }} />
                                </div>
                                <span className="text-xs font-black text-brand">{member.rate}%</span>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <button 
                                onClick={() => setDrillDown({
                                  title: t('reports.staff_orders_title', { name: member.name }),
                                  data: member.ordersToCount,
                                  columns: [
                                    { key: 'orderNumber', label: t('dashboard.cashier.col_order_number') },
                                    { key: 'customerName', label: t('common.customer') },
                                    { key: 'totalAmount', label: t('common.amount'), type: 'currency' },
                                    { key: 'orderDate', label: t('common.date'), type: 'date' },
                                    { key: 'status', label: t('common.status'), type: 'status' }
                                  ]
                                })}
                                className="px-3 py-1.5 bg-brand/10 text-brand hover:bg-brand/20 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer"
                                title={t('reports.view_staff_orders')}
                              >
                                <TrendingUp size={14} />
                                <span>{t('permissions.items.orders.orders_view.name')}</span>
                              </button>
                            </td>
                          </tr>
                        ))}
                        {staffWithPerformance.length === 0 && (
                          <tr>
                            <td colSpan={7} className="text-center py-8 text-content-muted font-bold text-xs sm:text-sm">
                              {t('reports.no_staff_registered')}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Staff Section */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8">
                {/* Staff Productivity */}
                <div className="bg-surface p-4 sm:p-8 rounded-2xl sm:rounded-[2.5rem] border border-border shadow-sm">
                  <h3 className="text-sm sm:text-lg font-black text-content mb-6 sm:mb-8">{t('reports.staff_productivity')}</h3>
                  <div className="h-64 sm:h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={staffStats.performance}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-border" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: 'currentColor' }} className="text-content-muted" />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: 'currentColor' }} className="text-content-muted" />
                        <Tooltip 
                          cursor={{ fill: 'var(--color-surface-muted)' }}
                          contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontWeight: 800, backgroundColor: 'var(--color-surface)', color: 'var(--color-content)', fontSize: '12px' }}
                        />
                        <Bar dataKey="completed" fill="#22C55E" radius={[6, 6, 0, 0]} name={t('reports.delivered_orders')} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Staff Sales */}
                <div className="bg-surface p-4 sm:p-8 rounded-2xl sm:rounded-[2.5rem] border border-border shadow-sm">
                  <h3 className="text-sm sm:text-lg font-black text-content mb-6 sm:mb-8">{t('reports.cashier_total_sales')}</h3>
                  <div className="space-y-4 sm:space-y-6">
                    {staffStats.performance.filter(s => s.role === 'cashier' || s.role === 'owner' || s.role === 'admin').map((s, i) => (
                      <div key={i} className="flex items-center gap-3 sm:gap-4">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-surface-muted rounded-xl sm:rounded-2xl flex items-center justify-center text-content-muted shrink-0">
                          <User size={20} className="sm:w-6 sm:h-6" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-center mb-1.5 sm:mb-2">
                            <span className="text-xs sm:text-sm font-black text-content truncate">{s.name}</span>
                            <span className="text-xs sm:text-sm font-black text-brand shrink-0"><PriceDisplay amount={s.sales} /></span>
                          </div>
                          <div className="h-1.5 sm:h-2 bg-surface-muted rounded-full overflow-hidden">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${(s.sales / Math.max(...staffStats.performance.map(x => x.sales), 1)) * 100}%` }}
                              className="h-full bg-brand rounded-full"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Customer Insights Section */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8">
                {/* Top Customers */}
                <div className="bg-surface p-4 sm:p-8 rounded-2xl sm:rounded-[2.5rem] border border-border shadow-sm">
                  <div className="flex items-center justify-between mb-6 sm:mb-8">
                    <h3 className="text-sm sm:text-lg font-black text-content">{t('reports.top_customers')}</h3>
                    <span className="px-2.5 py-0.5 sm:px-3 sm:py-1 bg-brand/10 text-brand rounded-full text-[10px] sm:text-xs font-black">
                      {t('reports.active_customers_count', { n: customerStats.totalActiveCustomers })}
                    </span>
                  </div>
                  <div className="space-y-3 sm:space-y-4">
                    {customerStats.topCustomers.map((customer, index) => (
                      <div key={customer.id} className="flex items-center justify-between p-3 sm:p-4 bg-surface-muted rounded-xl sm:rounded-2xl">
                        <div className="flex items-center gap-2 sm:gap-3">
                          <div className="w-8 h-8 sm:w-10 sm:h-10 bg-brand text-white rounded-lg sm:rounded-xl flex items-center justify-center font-black shadow-sm text-xs sm:text-sm shrink-0">
                            {index + 1}
                          </div>
                          <div>
                            <p className="text-xs sm:text-sm font-black text-content truncate max-w-[120px] sm:max-w-none">{customer.name}</p>
                            <p className="text-[9px] sm:text-[10px] text-content-muted font-bold">{t('reports.customer_orders_count', { n: customer.orderCount })}</p>
                          </div>
                        </div>
                        <div className="text-left">
                          <p className="text-xs sm:text-sm font-black text-brand"><PriceDisplay amount={customer.totalSpent} /></p>
                          <p className="text-[9px] sm:text-[10px] text-content-muted font-bold">{t('reports.total_purchases')}</p>
                        </div>
                      </div>
                    ))}
                    {customerStats.topCustomers.length === 0 && (
                      <div className="text-center py-8 text-content-muted font-bold text-xs sm:text-sm">
                        {t('reports.no_customer_data')}
                      </div>
                    )}
                  </div>
                </div>

                {/* Customer Retention */}
                <div className="bg-surface p-4 sm:p-8 rounded-2xl sm:rounded-[2.5rem] border border-border shadow-sm">
                  <h3 className="text-sm sm:text-lg font-black text-content mb-6 sm:mb-8">{t('reports.customer_retention')}</h3>
                  <div className="h-64 sm:h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={customerStats.retentionChartData}
                          cx="50%"
                          cy="50%"
                          innerRadius={55}
                          outerRadius={85}
                          paddingAngle={6}
                          dataKey="value"
                        >
                          {customerStats.retentionChartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={index === 0 ? '#1C8FFF' : '#22C55E'} />
                          ))}
                        </Pie>
                        <Tooltip 
                          contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontWeight: 800, backgroundColor: 'var(--color-surface)', color: 'var(--color-content)', fontSize: '12px' }}
                        />
                        <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: 700 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'suppliers_purchases' && (
            <div className="space-y-4 sm:space-y-8">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
                {[
                  { label: t('reports.sp_total_purchases'), value: supplierStats.totalPurchases, color: 'text-brand', bg: 'bg-brand/10' },
                  { label: t('reports.sp_total_returns'), value: supplierStats.totalPurchaseReturns, color: 'text-danger', bg: 'bg-danger/10' },
                  { label: t('reports.sp_net_purchases'), value: supplierStats.totalPurchases - supplierStats.totalPurchaseReturns, color: 'text-emerald-600', bg: 'bg-emerald-500/10' },
                  { label: t('reports.sp_outstanding_balance'), value: supplierStats.totalOutstandingBalance, color: 'text-amber-600', bg: 'bg-amber-500/10' },
                ].map((stat, i) => (
                  <div key={i} className="bg-surface p-3 sm:p-6 rounded-xl sm:rounded-[2.5rem] border border-border shadow-sm">
                    <p className="text-[10px] sm:text-xs font-black text-content-muted uppercase tracking-widest truncate">{stat.label}</p>
                    <h3 className={cn("text-sm sm:text-xl font-black mt-1 sm:mt-2 truncate", stat.color)}><PriceDisplay amount={stat.value} /></h3>
                  </div>
                ))}
              </div>

              <div className="bg-surface p-4 sm:p-8 rounded-2xl sm:rounded-[2.5rem] border border-border shadow-sm">
                <h3 className="text-sm sm:text-lg font-black text-content mb-6 sm:mb-8">{t('reports.sp_purchases_trend')}</h3>
                <div className="h-64 sm:h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={supplierStats.purchasesTrend}>
                      <defs>
                        <linearGradient id="colorPurchases" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#1C8FFF" stopOpacity={0.35}/>
                          <stop offset="100%" stopColor="#1C8FFF" stopOpacity={0.0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="var(--border)" opacity={0.5} />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: 'var(--content-muted)' }} dy={6} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: 'var(--content-muted)' }} />
                      <Tooltip
                        contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontWeight: 800, backgroundColor: 'var(--color-surface)', color: 'var(--color-content)', fontSize: '12px' }}
                        formatter={(value: number) => <PriceDisplay amount={value} />}
                      />
                      <Area type="monotone" dataKey="total" stroke="#1C8FFF" strokeWidth={3} fillOpacity={1} fill="url(#colorPurchases)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-surface p-4 sm:p-8 rounded-2xl sm:rounded-[2.5rem] border border-border shadow-sm">
                <h3 className="text-sm sm:text-lg font-black text-content mb-6 sm:mb-8">{t('reports.sp_supplier_breakdown')}</h3>
                <div className="overflow-x-auto whitespace-nowrap -mx-4 sm:-mx-8 px-4 sm:px-8">
                  <div className="rounded-2xl border border-border overflow-hidden min-w-max">
                    <table className="w-full text-right min-w-max">
                      <thead>
                        <tr className="bg-surface-muted border-b border-border">
                          <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-widest">{t('procurement.po_supplier', 'المورد')}</th>
                          <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-widest">{t('reports.sp_total_purchases')}</th>
                          <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-widest">{t('reports.sp_total_returns')}</th>
                          <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-widest">{t('reports.sp_net_purchases')}</th>
                          <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-widest">{t('common.details')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {supplierStats.supplierBreakdown.map((s) => (
                          <tr key={s.id} className="hover:bg-surface-muted/50 transition-colors">
                            <td className="px-6 py-4 font-bold text-content">{s.name}</td>
                            <td className="px-6 py-4 font-black text-brand"><PriceDisplay amount={s.purchases} /></td>
                            <td className="px-6 py-4 font-black text-danger"><PriceDisplay amount={s.returns} /></td>
                            <td className="px-6 py-4 font-black text-emerald-600"><PriceDisplay amount={s.net} /></td>
                            <td className="px-6 py-4">
                              <button
                                onClick={() => setDrillDown({
                                  title: t('reports.sp_supplier_orders_title', { name: s.name }),
                                  data: [...supplierStats.purchasesOnly, ...supplierStats.returnsOnly].filter(po => (po.supplierId || (po as any).supplier_id) === s.id),
                                  columns: [
                                    { key: 'poNumber', label: t('procurement.po_number', 'رقم السند') },
                                    { key: 'orderDate', label: t('common.date'), type: 'date' },
                                    { key: 'totalAmount', label: t('common.amount'), type: 'currency' },
                                    { key: 'status', label: t('common.status'), type: 'status' }
                                  ]
                                })}
                                className="px-3 py-1.5 bg-brand/10 text-brand hover:bg-brand/20 rounded-xl text-xs font-black transition-all cursor-pointer"
                              >
                                {t('common.details')}
                              </button>
                            </td>
                          </tr>
                        ))}
                        {supplierStats.supplierBreakdown.length === 0 && (
                          <tr>
                            <td colSpan={5} className="text-center py-8 text-content-muted font-bold text-xs sm:text-sm">
                              {t('reports.sp_no_purchases')}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'vat' && (
            <div className="space-y-4 sm:space-y-8">
              <div className="bg-amber-500/5 border border-amber-500/15 text-amber-700 dark:text-amber-400 rounded-2xl p-4 text-xs sm:text-sm font-bold flex items-start gap-3">
                <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                <span>{t('reports.vat_estimate_disclaimer')}</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-6">
                <div className="bg-surface p-4 sm:p-8 rounded-2xl sm:rounded-[2.5rem] border border-border shadow-sm">
                  <p className="text-[10px] sm:text-xs font-black text-content-muted uppercase tracking-widest">{t('reports.vat_output')}</p>
                  <h3 className="text-base sm:text-2xl font-black text-brand mt-1 sm:mt-2"><PriceDisplay amount={vatStats.outputVat} /></h3>
                  <p className="text-[9px] sm:text-[10px] text-content-muted mt-0.5 sm:mt-1 font-bold">{t('reports.vat_output_desc')}</p>
                </div>
                <div className="bg-surface p-4 sm:p-8 rounded-2xl sm:rounded-[2.5rem] border border-border shadow-sm">
                  <p className="text-[10px] sm:text-xs font-black text-content-muted uppercase tracking-widest">{t('reports.vat_input')}</p>
                  <h3 className="text-base sm:text-2xl font-black text-amber-600 mt-1 sm:mt-2"><PriceDisplay amount={vatStats.inputVat} /></h3>
                  <p className="text-[9px] sm:text-[10px] text-content-muted mt-0.5 sm:mt-1 font-bold">{t('reports.vat_input_desc')}</p>
                </div>
                <div className="bg-surface p-4 sm:p-8 rounded-2xl sm:rounded-[2.5rem] border border-border shadow-sm">
                  <p className="text-[10px] sm:text-xs font-black text-content-muted uppercase tracking-widest">{t('reports.vat_net_due')}</p>
                  <h3 className={cn("text-base sm:text-2xl font-black mt-1 sm:mt-2", vatStats.netVatDue >= 0 ? 'text-danger' : 'text-emerald-600')}>
                    <PriceDisplay amount={Math.abs(vatStats.netVatDue)} />
                  </h3>
                  <p className="text-[9px] sm:text-[10px] text-content-muted mt-0.5 sm:mt-1 font-bold">
                    {vatStats.netVatDue >= 0 ? t('reports.vat_payable') : t('reports.vat_refundable')}
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'zreports' && (
            <div className="space-y-4 sm:space-y-8">
              <div className="bg-surface p-4 sm:p-8 rounded-2xl sm:rounded-[2.5rem] border border-border shadow-sm max-w-xl mx-auto text-center">
                <div className="bg-brand/10 w-12 h-12 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl flex items-center justify-center text-brand mx-auto mb-4 sm:mb-6">
                  <Calculator size={28} className="sm:w-8 sm:h-8" />
                </div>
                <h3 className="text-base sm:text-xl font-black text-content mb-2">{t('reports.eod_title')}</h3>
                <p className="text-content-muted font-bold mb-6 sm:mb-8 text-xs sm:text-sm px-4 sm:px-8">{t('reports.eod_desc')}</p>
                
                <div className="flex flex-col gap-4 max-w-sm mx-auto">
                  <div className="space-y-1.5 sm:space-y-2 text-right">
                    <label className="text-[10px] sm:text-xs font-black text-content-muted uppercase tracking-widest mr-2">{t('reports.select_date')}</label>
                    <DatePicker 
                      id="report-date-input" 
                      value={selectedZDate} 
                      onChange={(val) => setSelectedZDate(val)} 
                    />
                  </div>
                  <button 
                    onClick={() => fetchDailyZReport(selectedZDate)}
                    disabled={loadingZ || !selectedZDate}
                    className="w-full bg-brand text-white py-3 sm:py-4 rounded-2xl font-black text-sm sm:text-lg shadow-xl shadow-brand/20 hover:bg-brand/90 transition-all disabled:opacity-50 flex items-center justify-center gap-3"
                  >
                    {loadingZ ? (
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    ) : (
                      <>
                        <FileText size={18} className="sm:w-5 sm:h-5" />
                        <span>{t('reports.generate_consolidated')}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {dailyZData && (
                <div className="bg-white rounded-2xl sm:rounded-[2.5rem] border border-border shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4">
                  <ZReport 
                    data={dailyZData} 
                    onClose={() => setDailyZData(null)} 
                  />
                </div>
              )}

              {!dailyZData && !loadingZ && (
                <div className="text-center py-12 text-gray-400 font-bold text-xs sm:text-sm">
                  {t('reports.no_report_generated')}
                </div>
              )}
            </div>
          )}

          {activeTab === 'tailor_commissions' && (
            <TailorStatementReport tenantId={tenantId} />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Drill-down Modal */}
      <AnimatePresence>
        {drillDown && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-md" 
              onClick={() => setDrillDown(null)} 
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }} 
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-surface w-full max-w-5xl rounded-2xl sm:rounded-[2.5rem] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh] border border-border"
            >
              <div className="p-4 sm:p-8 border-b border-border flex flex-col sm:flex-row gap-4 justify-between sm:items-center bg-surface-muted/50">
                <div className="flex items-center gap-3 sm:gap-4">
                  <div className="p-2.5 sm:p-4 bg-brand text-white rounded-xl sm:rounded-2xl shadow-lg shadow-brand/10 shrink-0">
                    <FileText size={20} className="sm:w-6 sm:h-6" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base sm:text-2xl font-black text-content truncate">{drillDown.title}</h2>
                    <p className="text-[10px] text-content-muted font-bold uppercase tracking-widest">{t('reports.drilldown_subtitle')}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto border-t sm:border-0 pt-3 sm:pt-0 border-border">
                  <button 
                    onClick={() => exportToExcel(drillDown.data, drillDown.title)}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-emerald-500/10 px-4 py-2 sm:py-2.5 rounded-xl border border-emerald-500/20 text-xs sm:text-sm font-bold text-emerald-600 hover:bg-emerald-500/20 transition-all"
                  >
                    <FileSpreadsheet size={16} />
                    {t('dashboard.export_excel')}
                  </button>
                  <button onClick={() => setDrillDown(null)} className="p-2 hover:bg-surface rounded-full transition-colors shadow-sm shrink-0">
                    <X size={20} className="text-content-muted sm:w-6 sm:h-6" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-x-auto whitespace-nowrap p-4 sm:p-8">
                <div className="bg-surface rounded-2xl border border-border min-w-max">
                  <table className="w-full text-right min-w-max">
                    <thead className="bg-surface-muted text-[10px] font-black text-content-muted uppercase tracking-widest">
                      <tr>
                        {drillDown.columns.map((col, idx) => (
                          <th key={idx} className="px-6 py-4">{col.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {drillDown.data.map((row, i) => (
                        <tr key={i} className="hover:bg-brand/5 transition-colors">
                          {drillDown.columns.map((col, idx) => (
                            <td key={idx} className="px-6 py-4 text-sm font-bold text-content">
                              {col.type === 'currency' ? <PriceDisplay amount={row[col.key]} /> :
                               col.type === 'date' ? new Date(row[col.key]).toLocaleDateString(locale) :
                               col.type === 'status' ? (
                                 <span className="px-2 py-1 bg-surface-muted rounded-lg text-[10px] text-content-muted">
                                   {row[col.key]}
                                 </span>
                               ) : row[col.key]}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
