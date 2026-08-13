import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import DateTimeDisplay from './DateTimeDisplay';
import { formatSaudiPhone } from '../utils/phoneUtils';
import { 
  Plus, 
  Search, 
  MoreVertical, 
  UserPlus,
  Users,
  Phone,
  Ruler,
  Trash2,
  Edit2,
  History,
  ShoppingBag,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  X,
  Info,
  ExternalLink,
  Zap,
  ArrowUpDown,
  Filter,
  ArrowLeftRight,
  User,
  Scissors,
  FileText,
  AlertCircle,
  Printer,
  CreditCard,
  Check,
  FileSpreadsheet,
  CheckSquare,
  Square,
  SlidersHorizontal,
  Building2,
  DollarSign,
  Download,
  ArrowDownLeft,
  ArrowUpRight
} from 'lucide-react';
import * as XLSX from 'xlsx';

import { supabase } from '../lib/supabase/client';
import { auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { Customer, Measurements, Styles, Order, ThobeMeasurements } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { customerSchema } from '../lib/validations';
import { PriceDisplay } from './PriceDisplay';
import PageSkeleton from "./PageSkeleton";
import Header from './Header';
import ThobeMeasurementSelector from './ThobeMeasurementSelector';
import VisualMeasurements from './VisualMeasurements';
import { useStaff } from '../contexts/StaffContext';
import { usePermissions } from '../hooks/usePermissions';
import { useToast } from '../contexts/ToastContext';
import { useSafeMutation } from '../hooks/useSafeMutation';
import { logEmployeeAction } from '../services/employeeAuditService';
import { PermissionKey } from '../types';
import { SmartSelect } from './ui/SmartSelect';
import { cn } from '../lib/utils';

import { isRtlLang, localeOf } from '../lib/direction';

interface CustomersProps {
  tenantId: string;
}

export default function Customers({ tenantId }: CustomersProps) {
  const { t, i18n } = useTranslation();
  const isRtl = isRtlLang(i18n.language);
  const { error: toastError, success: toastSuccess, handleError } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'date_asc' | 'name' | 'balance_desc'>('date');
  const [filter, setFilter] = useState<'all' | 'measurements' | 'recent' | 'test' | 'b2b' | 'b2c'>('all');
  const [balanceFilter, setBalanceFilter] = useState<'all' | 'debtor' | 'creditor' | 'balanced'>('all');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  
  // Selection & Bulk Actions State
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerOrders, setCustomerOrders] = useState<Order[]>([]);
  const [customerBalances, setCustomerBalances] = useState<Record<string, number>>({});
  const [customerOrderCounts, setCustomerOrderCounts] = useState<Record<string, number>>({});
  const [customerTotalPurchases, setCustomerTotalPurchases] = useState<Record<string, number>>({});
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [isStatementOpen, setIsStatementOpen] = useState(false);
  const [statementCustomer, setStatementCustomer] = useState<Customer | null>(null);
  const [statementOrders, setStatementOrders] = useState<Order[]>([]);
  const { currentStaff } = useStaff();
  const { hasPermission, checkPermission } = usePermissions(currentStaff);
  const navigate = useNavigate();

  // Centralized Mutations for Secure, Strict Persistence
  const saveCustomerMutation = useSafeMutation(
    async ({ customerData, id }: { customerData: any; id?: string }) => {
      if (id) {
        const { error } = await supabase.from('customers').update(customerData).eq('id', id);
        if (error) throw error;
        
        if (currentStaff) {
          await logEmployeeAction(
            tenantId,
            currentStaff.id,
            currentStaff.name,
            'edit_measurements',
            t('customers.audit_edit_measurements', { name: customerData.name })
          );
        }
      } else {
        const { error } = await supabase.from('customers').insert(customerData);
        if (error) throw error;
      }
    },
    {
      onSuccess: () => {
        setIsModalOpen(false);
        setEditingCustomer(null);
        reset();
        fetchCustomers(false);
      }
    }
  );

  const deleteCustomerMutation = useSafeMutation(
    async (id: string) => {
      const { error } = await supabase.from('customers').delete().eq('id', id);
      if (error) throw error;
    },
    {
      successMessage: t('customers.delete_success'),
      errorMessage: t('customers.delete_fail'),
      onSuccess: () => {
        fetchCustomers(false);
      }
    }
  );

  const canCreate = hasPermission('customers.create');
  const canEdit = hasPermission('customers.edit');
  const canDelete = hasPermission('customers.delete');

  const { register, handleSubmit, reset, setValue, watch, control, formState: { errors, isSubmitting } } = useForm({
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

  const watchMeasurements = watch('measurements');

  const fetchCustomers = React.useCallback(async (showLoading = true) => {
    if (!tenantId) return;
    if (showLoading) setIsLoading(true);
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    
    if (error) {
      handleFirestoreError(error, OperationType.LIST, 'customers');
    } else {
      const mapped = (data || []).map(c => ({
        ...c,
        isTest: c.is_test,
        isB2B: !!c.company_name,
        companyName: c.company_name,
        trn: c.vat_number,
        createdAt: c.created_at,
        tenantId: c.tenant_id
      }) as unknown as Customer);
      setCustomers(mapped);

      // Fetch balances, counts, and purchases (all non-cancelled orders for the tenant)
      try {
        const { data: ordersData, error: ordersError } = await supabase
          .from('orders')
          .select('customer_id, remaining_amount, total_amount')
          .eq('tenant_id', tenantId)
          .neq('status', 'cancelled');
        
        if (!ordersError && ordersData) {
          const balances: Record<string, number> = {};
          const counts: Record<string, number> = {};
          const purchases: Record<string, number> = {};
          
          ordersData.forEach(o => {
            if (o.customer_id) {
              balances[o.customer_id] = (balances[o.customer_id] || 0) + (Number(o.remaining_amount) || 0);
              counts[o.customer_id] = (counts[o.customer_id] || 0) + 1;
              purchases[o.customer_id] = (purchases[o.customer_id] || 0) + (Number(o.total_amount) || 0);
            }
          });
          setCustomerBalances(balances);
          setCustomerOrderCounts(counts);
          setCustomerTotalPurchases(purchases);
        }
      } catch (err) {
        console.error('Error fetching customer balances and order counts:', err);
      }
    }
    if (showLoading) setIsLoading(false);
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;

    fetchCustomers(true);

    // Subscribe to customer changes
    const channel = supabase
      .channel('customers-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers', filter: `tenant_id=eq.${tenantId}` }, () => {
        fetchCustomers(false);
      })
      .subscribe();

    // Subscribe to order changes to keep balances in sync in real time
    const ordersChannel = supabase
      .channel('customers-orders-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenantId}` }, () => {
        fetchCustomers(false);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(ordersChannel);
    };
  }, [tenantId, fetchCustomers]);

  const fetchCustomerOrders = async (customerId: string) => {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('customer_id', customerId)
        .order('order_date', { ascending: false });
      
      if (error) throw error;
      setCustomerOrders((data || []).map(o => ({
        ...o,
        customerId: o.customer_id,
        customerName: o.customer_name,
        tenantId: o.tenant_id,
        totalAmount: o.total_amount,
        paidAmount: o.paid_amount,
        remainingAmount: o.remaining_amount,
        taxAmount: o.tax_amount,
        orderDate: o.order_date,
        deliveryDate: o.delivery_date,
        createdBy: o.created_by,
        orderNumber: o.order_number
      }) as unknown as Order));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'orders');
    }
  };

  const onSubmit = async (data: any) => {
    if (!tenantId) return;

    const permission = editingCustomer ? 'customers.edit' : 'customers.create';
    const allowed = await checkPermission(permission, t('customers.manage_customers'));
    if (!allowed) return;
    
    // Explicitly destructure out the fields that are NOT in the customers table.
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
      updated_at: new Date().toISOString(),
      is_test: !!isTest
    };

    if (!editingCustomer) {
      customerData.created_at = new Date().toISOString();
    }

    try {
      await saveCustomerMutation.mutateAsync({ customerData, id: editingCustomer?.id });
      // Centralized success handler inside useSafeMutation handles success toast, resetting, closing, and refreshing!
    } catch (error) {
      // Error is caught and displayed securely by the hook
    }
  };

  const onInvalidSubmit = (formErrors: any) => {
    const missingFields: string[] = [];
    if (formErrors.name) missingFields.push(t('login.full_name'));
    if (formErrors.phone) missingFields.push(t('onboarding.fields.phone'));
    if (formErrors.companyName) missingFields.push(t('customers.company_name'));
    if (formErrors.trn) missingFields.push(t('customers.trn'));

    const msg = missingFields.length > 0
      ? t('customers.missing_fields_prompt', { fields: missingFields.join(t('common.list_separator')) })
      : t('customers.fill_required_fields');
    toastError(msg);

    setTimeout(() => {
      const errorTarget = document.querySelector('.ring-danger, [aria-invalid="true"]');
      if (errorTarget) {
        errorTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  };

  const handleDelete = async (id: string) => {
    const allowed = await checkPermission('customers.delete', t('customers.manage_customers'));
    if (!allowed) return;

    if (window.confirm(t('customers.delete_confirm'))) {
      try {
        await deleteCustomerMutation.mutateAsync(id);
      } catch (error) {
        // Error is handled inside deleteCustomerMutation hook
      }
    }
  };

  const openEditModal = (customer: Customer) => {
    setEditingCustomer(customer);
    
    // Map the stored nested geographical data back to the top-level form fields
    const formData = {
      ...customer,
      address: customer.styles?.address || '',
      city: customer.styles?.city || '',
      latitude: customer.styles?.latitude ? Number(customer.styles.latitude) : undefined,
      longitude: customer.styles?.longitude ? Number(customer.styles.longitude) : undefined,
      companyName: customer.companyName || '',
      trn: customer.trn || '',
      isTest: customer.isTest || false
    };
    
    reset(formData);
    setIsModalOpen(true);
  };

  const openDetails = (customer: Customer) => {
    setSelectedCustomer(customer);
    fetchCustomerOrders(customer.id);
    setIsDetailsOpen(true);
  };

  const openStatement = async (customer: Customer) => {
    setStatementCustomer(customer);
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('customer_id', customer.id)
        .order('order_date', { ascending: false });
      
      if (error) throw error;
      const mappedOrders = (data || []).map(o => ({
        ...o,
        customerId: o.customer_id,
        customerName: o.customer_name,
        tenantId: o.tenant_id,
        totalAmount: o.total_amount,
        paidAmount: o.paid_amount,
        remainingAmount: o.remaining_amount,
        taxAmount: o.tax_amount,
        orderDate: o.order_date,
        deliveryDate: o.delivery_date,
        createdBy: o.created_by,
        orderNumber: o.order_number,
        items: o.items || []
      }) as unknown as Order);
      setStatementOrders(mappedOrders);
      setIsStatementOpen(true);
    } catch (err) {
      console.error('Error fetching statement orders:', err);
    }
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const VISUAL_LABELS: Record<string, string> = {
    'classic': t('customers.visual_classic'),
    'mandarin': t('customers.visual_mandarin'),
    'square': t('customers.visual_square'),
    'round': t('customers.visual_round'),
    'hidden': t('inventory.status_hidden'),
    'visible': t('inventory.status_visible'),
    'plain': t('inventory.chest_plain'),
    'pleated': t('customers.visual_pleated'),
    'padded': t('customers.visual_padded'),
    'double': t('customers.visual_double')
  };

  const VISUAL_ICONS: Record<string, React.ReactNode> = {
    'classic': <div className="w-10 h-5 border-2 border-current rounded-t-xl" />,
    'mandarin': <div className="w-10 h-3 border-2 border-current rounded-t-md" />,
    'square': <div className="w-8 h-8 border-2 border-current" />,
    'round': <div className="w-8 h-8 border-2 border-current rounded-full" />,
    'hidden': <div className="w-8 h-8 border-2 border-dashed border-current opacity-50" />,
    'visible': <div className="w-8 h-8 border-2 border-current rounded-b-xl" />,
    'plain': <div className="w-10 h-10 border-2 border-current" />,
    'pleated': <div className="w-10 h-10 border-2 border-current flex gap-1.5 px-1.5"><div className="w-0.5 h-full bg-current"/><div className="w-0.5 h-full bg-current"/><div className="w-0.5 h-full bg-current"/></div>,
    'padded': <div className="w-10 h-10 border-2 border-current flex items-center justify-center"><div className="w-8 h-3 bg-current opacity-20"/></div>,
    'double': <div className="w-10 h-10 border-2 border-current flex flex-col gap-1.5 p-1.5"><div className="h-0.5 w-full bg-current"/><div className="h-0.5 w-full bg-current"/></div>
  };

  // Selection Helper Handlers
  const toggleSelectCustomer = (id: string) => {
    setSelectedCustomerIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedCustomerIds.length === filteredCustomers.length && filteredCustomers.length > 0) {
      setSelectedCustomerIds([]);
    } else {
      setSelectedCustomerIds(filteredCustomers.map(c => c.id));
    }
  };

  // Excel Export Handler
  const handleExportExcel = (targetCustomers?: Customer[]) => {
    const listToExport = targetCustomers || (selectedCustomerIds.length > 0 
      ? customers.filter(c => selectedCustomerIds.includes(c.id))
      : filteredCustomers);

    if (listToExport.length === 0) {
      toastError(t('customers.no_data_to_export'));
      return;
    }

    try {
      const exportData = listToExport.map((c, index) => {
        const balance = customerBalances[c.id] || 0;
        let balanceStatus = t('customers.balanced');
        if (balance > 0) balanceStatus = t('customers.balance_status_debtor');
        else if (balance < 0) balanceStatus = t('customers.balance_status_creditor');

        return {
          '#': index + 1,
          [t('dashboard.cashier.col_customer_name')]: c.name || '',
          [t('onboarding.fields.phone')]: c.phone || '',
          [t('customers.customer_type')]: c.isB2B ? t('customers.type_b2b_company') : t('customers.type_b2c_individual'),
          [t('customers.company_name')]: c.companyName || '-',
          [t('customers.trn')]: c.trn || '-',
          [t('customers.balance_sar')]: balance,
          [t('customers.balance_status')]: balanceStatus,
          [t('onboarding.fields.city')]: c.styles?.city || c.city || '-',
          [t('procurement.address')]: c.styles?.address || c.address || '-',
          [t('customers.export_col_length')]: c.measurements?.length || '-',
          [t('customers.export_col_shoulder')]: c.measurements?.shoulder || '-',
          [t('customers.export_col_chest')]: c.measurements?.chest || '-',
          [t('customers.export_col_waist')]: c.measurements?.waist || '-',
          [t('customers.export_col_hips')]: c.measurements?.hips || '-',
          [t('customers.export_col_sleeve')]: c.measurements?.sleeve || '-',
          [t('customers.export_col_neck')]: c.measurements?.neck || '-',
          [t('common.notes')]: c.notes || '-',
          [t('saas.tenants.registration_date')]: c.createdAt ? new Date(c.createdAt).toLocaleDateString(localeOf(i18n.language)) : '-'
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(exportData);
      
      // Right-to-Left alignment for Arabic excel sheet
      worksheet['!dir'] = 'rtl';
      
      worksheet['!cols'] = [
        { wch: 6 },  // #
        { wch: 25 }, // Name
        { wch: 18 }, // Phone
        { wch: 12 }, // Type
        { wch: 20 }, // Company
        { wch: 18 }, // TRN
        { wch: 18 }, // Balance
        { wch: 20 }, // Balance status
        { wch: 15 }, // City
        { wch: 25 }, // Address
        { wch: 12 }, // Length
        { wch: 12 }, // Shoulder
        { wch: 12 }, // Chest
        { wch: 12 }, // Waist
        { wch: 12 }, // Hips
        { wch: 12 }, // Sleeve
        { wch: 12 }, // Neck
        { wch: 25 }, // Notes
        { wch: 15 }, // Date
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, t('common.customers'));

      const dateStr = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(workbook, `${t('common.customers')}_${dateStr}.xlsx`);

      toastSuccess(t('customers.export_success', { count: listToExport.length }));
    } catch (err) {
      console.error('Failed to export excel:', err);
      toastError(t('customers.export_error'));
    }
  };

  // Bulk Delete Handler
  const handleBulkDelete = async () => {
    const allowed = await checkPermission('customers.delete', t('customers.manage_customers'));
    if (!allowed) return;

    if (selectedCustomerIds.length === 0) return;

    try {
      const { error } = await supabase
        .from('customers')
        .delete()
        .in('id', selectedCustomerIds);

      if (error) throw error;

      toastSuccess(t('customers.bulk_delete_success', { count: selectedCustomerIds.length }));
      setSelectedCustomerIds([]);
      setIsBulkDeleteModalOpen(false);
      fetchCustomers(false);
    } catch (error) {
      handleError(error as any, t('customers.bulk_delete_fail'));
    }
  };

  const filteredCustomers = customers
    .filter(c => {
      // Search filter
      const searchLower = search.toLowerCase().trim();
      const matchesSearch = !searchLower || searchLower.split(/\s+/).every(term => 
        c.name.toLowerCase().includes(term) || 
        c.phone.includes(term) ||
        (c.companyName && c.companyName.toLowerCase().includes(term)) ||
        (c.trn && c.trn.includes(term)) ||
        (c.styles?.city && c.styles.city.toLowerCase().includes(term))
      );
      if (!matchesSearch) return false;

      // Category filter
      if (filter === 'measurements') {
        const hasMeasurements = c.measurements && Object.values(c.measurements).some(v => v !== undefined && v !== null && v !== '' && v !== 0);
        if (!hasMeasurements) return false;
      }
      if (filter === 'recent') {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        if (new Date(c.createdAt) < sevenDaysAgo) return false;
      }
      if (filter === 'test') {
        if (!c.isTest) return false;
      }
      if (filter === 'b2b') {
        if (!c.isB2B) return false;
      }
      if (filter === 'b2c') {
        if (c.isB2B) return false;
      }

      // Balance Filter
      const balance = customerBalances[c.id] || 0;
      if (balanceFilter === 'debtor' && balance <= 0) return false;
      if (balanceFilter === 'creditor' && balance >= 0) return false;
      if (balanceFilter === 'balanced' && balance !== 0) return false;
      
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name, 'ar');
      if (sortBy === 'date_asc') return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (sortBy === 'balance_desc') {
        const balA = customerBalances[a.id] || 0;
        const balB = customerBalances[b.id] || 0;
        return balB - balA;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });



  if (isLoading) {
    return <PageSkeleton />;
  }

  return (
    <div className={cn("space-y-6 pb-20", isRtl ? "text-right" : "text-left")} dir={isRtl ? "rtl" : "ltr"}>
      <Header 
        tenantId={tenantId} 
        title={t('common.customers')} 
        subtitle={t('customers.subtitle')}
      >
        <div className="flex items-center gap-2">
          <button 
            onClick={() => handleExportExcel()}
            className="bg-surface text-content border border-border px-4 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-surface-muted transition-all text-xs sm:text-sm cursor-pointer shadow-sm hover:border-brand/30"
            title={t('customers.export_excel_title')}
          >
            <FileSpreadsheet size={18} className="text-emerald-600 dark:text-emerald-400" />
            <span className="hidden sm:inline">{t('customers.export_excel')}</span>
          </button>

          {canCreate && (
            <button
              id="tour-customers-add-btn"
              data-tour="customers-add-btn"
              onClick={() => { setEditingCustomer(null); reset({}); setIsModalOpen(true); }}
              className="bg-brand text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-brand/90 transition-all shadow-lg shadow-brand/10 text-sm sm:text-base cursor-pointer"
            >
              <UserPlus size={20} />
              <span>{t('pos.add_new_customer')}</span>
            </button>
          )}
        </div>
      </Header>

      <div className="space-y-4">
        <div className="flex flex-col lg:flex-row gap-3">
          {/* Search Box */}
          <div id="tour-customers-search" data-tour="customers-search" className="flex-1 bg-surface p-3 sm:p-4 rounded-3xl border border-border shadow-sm flex items-center gap-3 group focus-within:border-brand/40 transition-all">
            <Search size={20} className="text-content-muted group-focus-within:text-brand transition-colors shrink-0" />
            <input 
              type="text" 
              placeholder={t('customers.search_placeholder')} 
              className={cn("flex-1 bg-transparent border-none focus:ring-0 text-content placeholder-content-muted font-bold text-sm sm:text-base outline-none", isRtl ? "text-right" : "text-left")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button 
                onClick={() => setSearch('')}
                className="p-1 hover:bg-surface-muted rounded-full text-content-muted hover:text-brand transition-all shrink-0"
              >
                <X size={16} />
              </button>
            )}
          </div>

          {/* Action & Filter Controls */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Advanced Filters Drawer Toggle Button */}
            <button
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className={cn(
                "px-4 py-3 rounded-2xl border font-bold flex items-center gap-2 transition-all cursor-pointer text-xs sm:text-sm shadow-sm relative",
                showAdvancedFilters || balanceFilter !== 'all' || filter === 'b2b' || filter === 'b2c'
                  ? "bg-brand/10 text-brand border-brand/30"
                  : "bg-surface text-content border-border hover:bg-surface-muted"
              )}
            >
              <SlidersHorizontal size={18} />
              <span>{t('customers.filters')}</span>
              {(balanceFilter !== 'all' || filter === 'b2b' || filter === 'b2c') && (
                <span className="w-2.5 h-2.5 rounded-full bg-brand animate-pulse" />
              )}
            </button>

            {/* Sort Select Dropdown */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-surface text-content border border-border px-4 py-3 rounded-2xl font-bold text-xs sm:text-sm outline-none cursor-pointer hover:bg-surface-muted shadow-sm"
            >
              <option value="date">{t('customers.sort_recent')}</option>
              <option value="date_asc">{t('customers.sort_oldest')}</option>
              <option value="name">{t('customers.sort_name')}</option>
              <option value="balance_desc">{t('customers.sort_highest_debt')}</option>
            </select>
          </div>
        </div>

        {/* Advanced Filters Panel Expansion */}
        <AnimatePresence>
          {showAdvancedFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden bg-surface p-4 sm:p-6 rounded-3xl border border-border shadow-sm space-y-4"
            >
              <div className="flex items-center justify-between border-b border-border pb-3">
                <h4 className="text-sm font-black text-content flex items-center gap-2">
                  <Filter size={16} className="text-brand" />
                  <span>{t('customers.advanced_filters')}</span>
                </h4>
                <button
                  onClick={() => {
                    setFilter('all');
                    setBalanceFilter('all');
                    setSearch('');
                  }}
                  className="text-xs font-bold text-brand hover:underline cursor-pointer"
                >
                  {t('customers.reset_all_filters')}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Filter by Type */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-content-muted">{t('customers.filter_type_label')}</label>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { id: 'all', label: t('common.all') },
                      { id: 'b2c', label: t('customers.filter_b2c') },
                      { id: 'b2b', label: t('customers.filter_b2b') },
                      { id: 'test', label: t('orders.test_data_badge') },
                    ].map(typeItem => (
                      <button
                        key={typeItem.id}
                        onClick={() => setFilter(typeItem.id as any)}
                        className={cn(
                          "px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer",
                          filter === typeItem.id
                            ? "bg-brand text-white border-brand shadow-sm"
                            : "bg-surface-muted text-content-muted border-border hover:text-content"
                        )}
                      >
                        {typeItem.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Filter by Balance */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-content-muted">{t('customers.filter_balance_label')}</label>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { id: 'all', label: t('common.all') },
                      { id: 'debtor', label: t('customers.balance_status_debtor') },
                      { id: 'creditor', label: t('customers.balance_status_creditor') },
                      { id: 'balanced', label: t('customers.filter_balanced_zero') },
                    ].map(balItem => (
                      <button
                        key={balItem.id}
                        onClick={() => setBalanceFilter(balItem.id as any)}
                        className={cn(
                          "px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer",
                          balanceFilter === balItem.id
                            ? "bg-brand text-white border-brand shadow-sm"
                            : "bg-surface-muted text-content-muted border-border hover:text-content"
                        )}
                      >
                        {balItem.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Filter by Measurements */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-content-muted">{t('customers.filter_measurements_label')}</label>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { id: 'all', label: t('common.all') },
                      { id: 'measurements', label: t('customers.filter_has_measurements') },
                      { id: 'recent', label: t('customers.filter_registered_7_days') },
                    ].map(mItem => (
                      <button
                        key={mItem.id}
                        onClick={() => setFilter(mItem.id as any)}
                        className={cn(
                          "px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer",
                          filter === mItem.id
                            ? "bg-brand text-white border-brand shadow-sm"
                            : "bg-surface-muted text-content-muted border-border hover:text-content"
                        )}
                      >
                        {mItem.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Filter Chips Bar */}
        <div className="flex overflow-x-auto pb-1.5 gap-2 scrollbar-hide select-none w-full items-center">
          {[
            { id: 'all', label: t('common.all'), icon: Users },
            { id: 'measurements', label: t('customers.filter_measurements'), icon: Ruler },
            { id: 'b2c', label: t('customers.chip_b2c'), icon: User },
            { id: 'b2b', label: t('customers.chip_b2b'), icon: Building2 },
            { id: 'recent', label: t('customers.filter_recent'), icon: History },
            { id: 'test', label: t('common.test_data'), icon: Zap },
          ].map((chip) => (
            <button
              key={chip.id}
              onClick={() => setFilter(chip.id as any)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-full text-xs sm:text-sm font-black transition-all border shrink-0 whitespace-nowrap cursor-pointer",
                filter === chip.id 
                  ? "bg-brand border-brand text-white shadow-md shadow-brand/20 scale-102" 
                  : "bg-surface border-border text-content-muted hover:border-brand/30 hover:text-brand"
              )}
            >
              <chip.icon size={15} />
              <span>{chip.label}</span>
              {filter === chip.id && (
                <span className="bg-white/20 px-2 py-0.5 rounded-full text-[10px]">
                  {filteredCustomers.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Customer Stats Summary Block */}
      {customers.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="flex items-center gap-3 p-4 bg-surface rounded-2xl border border-border/80 shadow-sm transition-all hover:border-brand/20">
            <div className="w-9 h-9 rounded-xl bg-brand/10 text-brand flex items-center justify-center shrink-0">
              <Users size={16} />
            </div>
            <div className="min-w-0">
              <span className="block text-[10px] font-black text-content-muted uppercase tracking-wider leading-none">{t('dashboard.total_customers')}</span>
              <span className="text-sm sm:text-base font-black text-content mt-1 block">{customers.length}</span>
            </div>
          </div>
          
          <div className="flex items-center gap-3 p-4 bg-surface rounded-2xl border border-border/80 shadow-sm transition-all hover:border-brand/20">
            <div className="w-9 h-9 rounded-xl bg-brand/10 text-brand flex items-center justify-center shrink-0">
              <SlidersHorizontal size={16} />
            </div>
            <div className="min-w-0">
              <span className="block text-[10px] font-black text-content-muted uppercase tracking-wider leading-none">{t('customers.filter_results')}</span>
              <span className="text-sm sm:text-base font-black text-brand mt-1 block">{filteredCustomers.length}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 p-4 bg-surface rounded-2xl border border-border/80 shadow-sm transition-all hover:border-red-500/20">
            <div className="w-9 h-9 rounded-xl bg-red-500/10 text-red-500 flex items-center justify-center shrink-0">
              <ArrowDownLeft size={16} />
            </div>
            <div className="min-w-0">
              <span className="block text-[10px] font-black text-content-muted uppercase tracking-wider leading-none">{t('customers.stat_debtors')}</span>
              <span className="text-sm sm:text-base font-black text-red-500 mt-1 block">
                {customers.filter(c => (customerBalances[c.id] || 0) > 0).length}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 p-4 bg-surface rounded-2xl border border-border/80 shadow-sm transition-all hover:border-emerald-500/20">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0">
              <ArrowUpRight size={16} />
            </div>
            <div className="min-w-0">
              <span className="block text-[10px] font-black text-content-muted uppercase tracking-wider leading-none">{t('customers.stat_creditors')}</span>
              <span className="text-sm sm:text-base font-black text-emerald-500 mt-1 block">
                {customers.filter(c => (customerBalances[c.id] || 0) < 0).length}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Customer Rows List */}
      <div className="space-y-3">
        {/* Row Header - Desktop only */}
        {filteredCustomers.length > 0 && (
          <div className="hidden lg:grid grid-cols-12 gap-4 px-6 py-4 bg-surface rounded-2xl text-xs font-black text-content-muted border border-border/80 shadow-sm items-center">
            <div className="col-span-1 flex items-center gap-2.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSelectAll();
                }}
                className={cn(
                  "p-1.5 rounded-lg transition-all cursor-pointer flex items-center justify-center shrink-0 border",
                  selectedCustomerIds.length > 0 && selectedCustomerIds.length === filteredCustomers.length
                    ? "bg-brand border-brand text-white shadow-sm"
                    : "bg-surface-muted/80 text-content-muted border-border hover:text-brand hover:border-brand/40 hover:bg-brand/5"
                )}
                title={selectedCustomerIds.length > 0 && selectedCustomerIds.length === filteredCustomers.length ? t('customers.deselect_all') : t('inventory.select_all')}
              >
                {selectedCustomerIds.length > 0 && selectedCustomerIds.length === filteredCustomers.length ? (
                  <CheckSquare size={13} />
                ) : (
                  <Square size={13} />
                )}
              </button>
            </div>
            <div className="col-span-3">{t('common.customer')}</div>
            <div className="col-span-2">{t('onboarding.fields.phone')}</div>
            <div className="col-span-1">{t('dashboard.orders_count')}</div>
            <div className="col-span-2">{t('customers.total_purchases')}</div>
            <div className="col-span-2">{t('customers.balance')}</div>
            <div className="col-span-1 text-left"></div>
          </div>
        )}

        {filteredCustomers.length > 0 ? (
          filteredCustomers.map((customer, index) => {
            const isSelected = selectedCustomerIds.includes(customer.id);
            const balance = customerBalances[customer.id] || 0;
            return (
              <motion.div
                layout
                key={customer.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => openDetails(customer)}
                className={cn(
                  "bg-surface rounded-2xl border transition-all group relative p-3 sm:p-4 lg:p-6 cursor-pointer select-none",
                  activeMenuId === customer.id ? "z-40" : "z-10",
                  isSelected
                    ? "border-brand ring-2 ring-brand/30 bg-brand/5 shadow-md"
                    : "border-border shadow-sm hover:shadow-lg hover:border-brand/40 hover:-translate-y-0.5 active:scale-[0.99]"
                )}
              >
                {/* Desktop 12-col grid row vs Mobile/Tablet Card Layout */}
                <div className="flex flex-col gap-3 lg:grid lg:grid-cols-12 lg:gap-4 lg:items-center">
                  
                  {/* MOBILE & TABLET HEADER (< lg) */}
                  <div className="flex lg:hidden items-center justify-between gap-3 border-b border-border/50 pb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelectCustomer(customer.id);
                        }}
                        className={cn(
                          "p-2 rounded-xl transition-all cursor-pointer flex items-center justify-center shrink-0",
                          isSelected
                            ? "bg-brand text-white shadow-md shadow-brand/20 scale-105"
                            : "bg-surface-muted/90 text-content-muted hover:text-brand hover:bg-brand/10 border border-border"
                        )}
                        title={isSelected ? t('customers.deselect_customer') : t('customers.select_customer')}
                      >
                        {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                      </button>

                      <div className="w-9 h-9 bg-brand/10 text-brand rounded-xl flex items-center justify-center text-xs font-black shadow-inner shrink-0">
                        {getInitials(customer.name)}
                      </div>

                      <div className="min-w-0">
                        <h3 className="text-sm font-black text-content flex items-center gap-1.5 hover:text-brand transition-colors">
                          <span className="truncate">{customer.name}</span>
                          {customer.isB2B && (
                            <span className="bg-brand/10 text-brand px-1.5 py-0.5 rounded-md text-[9px] font-black shrink-0">B2B</span>
                          )}
                        </h3>
                        <span className="text-[10px] font-bold text-content-muted/80">
                          #{String(index + 1).padStart(2, '0')}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {customer.isTest && (
                        <span className="bg-warning/10 text-warning px-2 py-0.5 rounded-md text-[9px] font-black flex items-center gap-0.5">
                          <Zap size={8} />
                          {t('common.test_data')}
                        </span>
                      )}

                      <div className="relative">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMenuId(activeMenuId === customer.id ? null : customer.id);
                          }}
                          className={cn(
                            "p-2 text-content-muted hover:text-brand hover:bg-brand/10 rounded-xl transition-all cursor-pointer flex items-center justify-center shrink-0 border border-border/60 bg-surface-muted/30 hover:scale-105",
                            activeMenuId === customer.id ? "bg-brand/10 text-brand border-brand/30" : ""
                          )}
                          title={t('common.actions')}
                        >
                          <MoreVertical size={16} />
                        </button>

                        <AnimatePresence>
                          {activeMenuId === customer.id && (
                            <>
                              <div 
                                className="fixed inset-0 z-30 cursor-default" 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveMenuId(null);
                                }}
                              />
                              <motion.div
                                initial={{ opacity: 0, scale: 0.95, y: -10 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95, y: -10 }}
                                className={cn(
                                  "absolute z-50 bg-surface/95 backdrop-blur-md border border-border shadow-2xl rounded-2xl p-2 min-w-[180px] sm:min-w-[200px] flex flex-col gap-0.5 mt-1.5 top-full",
                                  isRtl ? "left-0 origin-top-left" : "right-0 origin-top-right"
                                )}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="px-2.5 py-1 text-[10px] font-black text-content-muted/80 uppercase tracking-wider text-right border-b border-border/40 mb-1">
                                  {t('customers.customer_options')}
                                </div>

                                <button 
                                  type="button"
                                  onClick={() => {
                                    setActiveMenuId(null);
                                    openDetails(customer);
                                  }}
                                  className="w-full flex items-center justify-between px-2.5 py-2 text-right rounded-xl text-xs font-bold text-content-muted hover:text-brand hover:bg-brand/5 transition-all cursor-pointer group"
                                >
                                  <span className="truncate">{t('customers.view_full_profile')}</span>
                                  <div className="w-6 h-6 rounded-lg bg-brand/5 flex items-center justify-center shrink-0 group-hover:bg-brand/15 text-brand transition-all">
                                    <Info size={12} />
                                  </div>
                                </button>

                                <button 
                                  type="button"
                                  onClick={() => {
                                    setActiveMenuId(null);
                                    openStatement(customer);
                                  }}
                                  className="w-full flex items-center justify-between px-2.5 py-2 text-right rounded-xl text-xs font-bold text-content-muted hover:text-brand hover:bg-brand/5 transition-all cursor-pointer group"
                                >
                                  <span className="truncate">{t('customers.account_statement')}</span>
                                  <div className="w-6 h-6 rounded-lg bg-brand/5 flex items-center justify-center shrink-0 group-hover:bg-brand/15 text-brand transition-all">
                                    <FileText size={12} />
                                  </div>
                                </button>

                                <button 
                                  type="button"
                                  onClick={() => {
                                    setActiveMenuId(null);
                                    navigate(`/orders?customerId=${customer.id}`);
                                  }}
                                  className="w-full flex items-center justify-between px-2.5 py-2 text-right rounded-xl text-xs font-bold text-content-muted hover:text-brand hover:bg-brand/5 transition-all cursor-pointer group"
                                >
                                  <span className="truncate">{t('orders.create_new_order')}</span>
                                  <div className="w-6 h-6 rounded-lg bg-brand/5 flex items-center justify-center shrink-0 group-hover:bg-brand/15 text-brand transition-all">
                                    <Plus size={12} />
                                  </div>
                                </button>

                                {canEdit && (
                                  <>
                                    <div className="h-px bg-border/60 my-1" />
                                    <button 
                                      type="button"
                                      onClick={() => {
                                        setActiveMenuId(null);
                                        openEditModal(customer);
                                      }}
                                      className="w-full flex items-center justify-between px-2.5 py-2 text-right rounded-xl text-xs font-bold text-content-muted hover:text-brand hover:bg-brand/5 transition-all cursor-pointer group"
                                    >
                                      <span className="truncate">{t('common.edit')}</span>
                                      <div className="w-6 h-6 rounded-lg bg-brand/5 flex items-center justify-center shrink-0 group-hover:bg-brand/15 text-brand/80 transition-all">
                                        <Edit2 size={12} />
                                      </div>
                                    </button>
                                  </>
                                )}

                                {canDelete && (
                                  <button 
                                    type="button"
                                    onClick={() => {
                                      setActiveMenuId(null);
                                      handleDelete(customer.id);
                                    }}
                                    className="w-full flex items-center justify-between px-2.5 py-2 text-right rounded-xl text-xs font-bold text-red-500 hover:text-red-600 hover:bg-red-500/5 transition-all cursor-pointer group"
                                  >
                                    <span className="truncate">{t('common.delete')}</span>
                                    <div className="w-6 h-6 rounded-lg bg-red-500/5 flex items-center justify-center shrink-0 group-hover:bg-red-500/15 text-red-500 transition-all">
                                      <Trash2 size={12} />
                                    </div>
                                  </button>
                                )}
                              </motion.div>
                            </>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </div>

                  {/* MOBILE & TABLET INFO GRID (< lg) */}
                  <div className="grid lg:hidden grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    {/* Phone */}
                    <div className="bg-surface-muted/60 p-2.5 rounded-xl border border-border/40 flex flex-col gap-1 justify-center">
                      <span className="text-[10px] font-bold text-content-muted flex items-center gap-1">
                        <Phone size={10} className="text-brand shrink-0" />
                        {t('onboarding.fields.phone')}
                      </span>
                      <a 
                        href={`tel:${customer.phone}`} 
                        onClick={(e) => e.stopPropagation()}
                        className="font-bold text-content hover:text-brand transition-colors dir-ltr text-right truncate text-xs"
                      >
                        {customer.phone}
                      </a>
                    </div>

                    {/* Orders count */}
                    <div className="bg-surface-muted/60 p-2.5 rounded-xl border border-border/40 flex flex-col gap-1 justify-center">
                      <span className="text-[10px] font-bold text-content-muted flex items-center gap-1">
                        <ShoppingBag size={10} className="text-brand shrink-0" />
                        {t('dashboard.orders_count')}
                      </span>
                      <span className="font-black text-brand text-xs">
                        {customerOrderCounts[customer.id] || 0}
                      </span>
                    </div>

                    {/* Total purchases */}
                    <div className="bg-surface-muted/60 p-2.5 rounded-xl border border-border/40 flex flex-col gap-1 justify-center">
                      <span className="text-[10px] font-bold text-content-muted flex items-center gap-1">
                        <DollarSign size={10} className="text-brand shrink-0" />
                        {t('customers.total_purchases_short')}
                      </span>
                      <span className="font-black text-content text-xs">
                        <PriceDisplay amount={customerTotalPurchases[customer.id] || 0} />
                      </span>
                    </div>

                    {/* Balance */}
                    <div className="bg-surface-muted/60 p-2.5 rounded-xl border border-border/40 flex flex-col gap-1 justify-center">
                      <span className="text-[10px] font-bold text-content-muted">
                        {t('customers.balance')}
                      </span>
                      <div className="flex items-center">
                        {(() => {
                          if (balance > 0) {
                            return (
                              <span className="bg-red-500/10 text-red-600 border border-red-500/20 px-2 py-0.5 rounded-md text-[10px] font-black flex items-center gap-1 truncate">
                                <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse shrink-0" />
                                <span>{t('customers.debtor')}:</span>
                                <PriceDisplay amount={balance} />
                              </span>
                            );
                          } else if (balance < 0) {
                            return (
                              <span className="bg-green-500/10 text-green-600 border border-green-500/20 px-2 py-0.5 rounded-md text-[10px] font-black flex items-center gap-1 truncate">
                                <span className="w-1.5 h-1.5 bg-green-500 rounded-full shrink-0" />
                                <span>{t('customers.creditor')}:</span>
                                <PriceDisplay amount={Math.abs(balance)} />
                              </span>
                            );
                          } else {
                            return (
                              <span className="text-content-muted font-bold text-[10px] bg-surface-muted border border-border/50 px-2 py-0.5 rounded-md">
                                0
                              </span>
                            );
                          }
                        })()}
                      </div>
                    </div>
                  </div>

                  {/* DESKTOP COLUMNS (lg:grid lg:grid-cols-12) */}
                  
                  {/* Col 1: Checkbox + Number (lg:col-span-1) */}
                  <div className="hidden lg:flex col-span-1 items-center gap-2.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelectCustomer(customer.id);
                      }}
                      className={cn(
                        "p-2 rounded-xl transition-all cursor-pointer flex items-center justify-center shrink-0",
                        isSelected
                          ? "bg-brand text-white shadow-md shadow-brand/20 scale-105"
                          : "bg-surface-muted/90 text-content-muted hover:text-brand hover:bg-brand/10 border border-border"
                      )}
                      title={isSelected ? t('customers.deselect_customer') : t('customers.select_customer')}
                    >
                      {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                    </button>
                    <span className="inline-flex items-center justify-center bg-surface-muted border border-border/60 text-[10px] font-black text-content-muted w-6.5 h-6.5 rounded-full shrink-0 shadow-inner">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                  </div>

                  {/* Col 2: Name & Type & Initials (lg:col-span-3) */}
                  <div className="hidden lg:flex col-span-3 items-center gap-3">
                    <div className="w-10 h-10 bg-brand/10 text-brand rounded-xl flex items-center justify-center text-sm font-black shadow-inner shrink-0">
                      {getInitials(customer.name)}
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-base font-black text-content flex items-center gap-1.5 hover:text-brand transition-colors">
                        <span className="truncate">{customer.name}</span>
                        {customer.isB2B && (
                          <span className="bg-brand/10 text-brand px-1.5 py-0.5 rounded-md text-[9px] font-black shrink-0">B2B</span>
                        )}
                      </h3>
                      {customer.isTest && (
                        <span className="inline-flex bg-warning/10 text-warning px-1.5 py-0.5 rounded-md text-[9px] font-black mt-0.5 items-center gap-0.5">
                          <Zap size={8} />
                          {t('common.test_data')}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Col 3: Phone Number (lg:col-span-2) */}
                  <div className="hidden lg:flex col-span-2 items-center justify-start gap-2 text-sm text-content-muted">
                    <a 
                      href={`tel:${customer.phone}`} 
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs text-content-muted font-bold flex items-center gap-1 hover:text-brand transition-colors"
                    >
                      <Phone size={12} className="text-brand shrink-0" />
                      <span>{customer.phone}</span>
                    </a>
                  </div>

                  {/* Col 4: Number of Orders (lg:col-span-1) */}
                  <div className="hidden lg:flex col-span-1 items-center justify-start gap-2 text-sm text-content">
                    <span className="bg-brand/10 text-brand px-2.5 py-0.5 rounded-lg text-xs font-black">
                      {customerOrderCounts[customer.id] || 0}
                    </span>
                  </div>

                  {/* Col 5: Total Purchase Amount (lg:col-span-2) */}
                  <div className="hidden lg:flex col-span-2 items-center justify-start gap-2 text-sm text-content">
                    <span className="font-bold text-content">
                      <PriceDisplay amount={customerTotalPurchases[customer.id] || 0} />
                    </span>
                  </div>

                  {/* Col 6: Financial Balance (lg:col-span-2) */}
                  <div className="hidden lg:flex col-span-2 items-center justify-start gap-2">
                    {(() => {
                      if (balance > 0) {
                        return (
                          <span className="bg-red-500/10 text-red-600 border border-red-500/20 px-2.5 py-1 rounded-full text-xs font-black whitespace-nowrap flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse shrink-0" />
                            <span>{t('customers.debtor')}:</span>
                            <PriceDisplay amount={balance} />
                          </span>
                        );
                      } else if (balance < 0) {
                        return (
                          <span className="bg-green-500/10 text-green-600 border border-green-500/20 px-2.5 py-1 rounded-full text-xs font-black whitespace-nowrap flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full shrink-0" />
                            <span>{t('customers.creditor')}:</span>
                            <PriceDisplay amount={Math.abs(balance)} />
                          </span>
                        );
                      } else {
                        return (
                          <span className="text-content-muted font-bold text-xs bg-surface-muted/60 border border-border/50 px-2.5 py-1 rounded-full">
                            0
                          </span>
                        );
                      }
                    })()}
                  </div>

                  {/* Col 7: Actions (Desktop only) */}
                  <div className="hidden lg:flex col-span-1 items-center justify-end">
                    <div className="relative flex items-center justify-end">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveMenuId(activeMenuId === customer.id ? null : customer.id);
                        }}
                        className={cn(
                          "p-2 text-content-muted hover:text-brand hover:bg-brand/10 rounded-xl transition-all cursor-pointer flex items-center justify-center shrink-0 border border-border/60 bg-surface-muted/30 hover:scale-105",
                          activeMenuId === customer.id ? "bg-brand/10 text-brand border-brand/30" : ""
                        )}
                        title={t('common.actions')}
                      >
                        <MoreVertical size={16} />
                      </button>

                      <AnimatePresence>
                        {activeMenuId === customer.id && (
                          <>
                            {/* Overlay specifically to catch close clicks */}
                            <div 
                              className="fixed inset-0 z-30 cursor-default" 
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveMenuId(null);
                              }}
                            />
                            
                            <motion.div
                              initial={{ opacity: 0, scale: 0.95, y: -10 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.95, y: -10 }}
                              className={cn(
                                "absolute z-50 bg-surface/95 backdrop-blur-md border border-border shadow-2xl rounded-2xl p-2 min-w-[180px] sm:min-w-[200px] flex flex-col gap-0.5 mt-1.5 top-full",
                                isRtl ? "left-0 origin-top-left" : "right-0 origin-top-right"
                              )}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="px-2.5 py-1 text-[10px] font-black text-content-muted/80 uppercase tracking-wider text-right border-b border-border/40 mb-1">
                                {t('customers.customer_options')}
                              </div>

                              {/* View Profile */}
                              <button 
                                type="button"
                                onClick={() => {
                                  setActiveMenuId(null);
                                  openDetails(customer);
                                }}
                                className="w-full flex items-center justify-between px-2.5 py-2 text-right rounded-xl text-xs font-bold text-content-muted hover:text-brand hover:bg-brand/5 transition-all cursor-pointer group"
                              >
                                <span className="truncate">{t('customers.view_full_profile')}</span>
                                <div className="w-6 h-6 rounded-lg bg-brand/5 flex items-center justify-center shrink-0 group-hover:bg-brand/15 text-brand transition-all">
                                  <Info size={12} />
                                </div>
                              </button>

                              {/* Account Statement */}
                              <button 
                                type="button"
                                onClick={() => {
                                  setActiveMenuId(null);
                                  openStatement(customer);
                                }}
                                className="w-full flex items-center justify-between px-2.5 py-2 text-right rounded-xl text-xs font-bold text-content-muted hover:text-brand hover:bg-brand/5 transition-all cursor-pointer group"
                              >
                                <span className="truncate">{t('customers.account_statement')}</span>
                                <div className="w-6 h-6 rounded-lg bg-brand/5 flex items-center justify-center shrink-0 group-hover:bg-brand/15 text-brand transition-all">
                                  <FileText size={12} />
                                </div>
                              </button>

                              {/* Create New Order */}
                              <button 
                                type="button"
                                onClick={() => {
                                  setActiveMenuId(null);
                                  navigate(`/orders?customerId=${customer.id}`);
                                }}
                                className="w-full flex items-center justify-between px-2.5 py-2 text-right rounded-xl text-xs font-bold text-content-muted hover:text-brand hover:bg-brand/5 transition-all cursor-pointer group"
                              >
                                <span className="truncate">{t('orders.create_new_order')}</span>
                                <div className="w-6 h-6 rounded-lg bg-brand/5 flex items-center justify-center shrink-0 group-hover:bg-brand/15 text-brand transition-all">
                                  <Plus size={12} />
                                </div>
                              </button>

                              {canEdit && (
                                <>
                                  <div className="h-px bg-border/60 my-1" />
                                  <button 
                                    type="button"
                                    onClick={() => {
                                      setActiveMenuId(null);
                                      openEditModal(customer);
                                    }}
                                    className="w-full flex items-center justify-between px-2.5 py-2 text-right rounded-xl text-xs font-bold text-content-muted hover:text-brand hover:bg-brand/5 transition-all cursor-pointer group"
                                  >
                                    <span className="truncate">{t('common.edit')}</span>
                                    <div className="w-6 h-6 rounded-lg bg-brand/5 flex items-center justify-center shrink-0 group-hover:bg-brand/15 text-brand/80 transition-all">
                                      <Edit2 size={12} />
                                    </div>
                                  </button>
                                </>
                              )}

                              {canDelete && (
                                <button 
                                  type="button"
                                  onClick={() => {
                                    setActiveMenuId(null);
                                    handleDelete(customer.id);
                                  }}
                                  className="w-full flex items-center justify-between px-2.5 py-2 text-right rounded-xl text-xs font-bold text-red-500 hover:text-red-600 hover:bg-red-500/5 transition-all cursor-pointer group"
                                >
                                  <span className="truncate">{t('common.delete')}</span>
                                  <div className="w-6 h-6 rounded-lg bg-red-500/5 flex items-center justify-center shrink-0 group-hover:bg-red-500/15 text-red-500 transition-all">
                                    <Trash2 size={12} />
                                  </div>
                                </button>
                              )}
                            </motion.div>
                          </>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                </div>
              </motion.div>
            );
          })
        ) : customers.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center bg-surface rounded-[3rem] border-2 border-dashed border-border text-content-muted">
            <div className="p-6 bg-brand/10 text-brand rounded-full mb-4">
              <UserPlus size={48} />
            </div>
            <h3 className="text-xl font-black text-content mb-2">{t('customers.no_customers_yet')}</h3>
            <p className="text-sm font-bold">{t('customers.add_first_customer_desc')}</p>
            {canCreate && (
              <button 
                onClick={() => { setEditingCustomer(null); reset({}); setIsModalOpen(true); }}
                className="mt-6 bg-brand text-white px-6 py-3 rounded-2xl font-black hover:bg-brand/90 transition-all flex items-center gap-2 cursor-pointer shadow-lg shadow-brand/10"
              >
                <UserPlus size={18} />
                <span>{t('customers.add_first_btn')}</span>
              </button>
            )}
          </div>
        ) : (
          <div className="py-20 flex flex-col items-center justify-center bg-surface rounded-[3rem] border-2 border-dashed border-border text-content-muted">
            <div className="p-6 bg-surface-muted rounded-full mb-4">
              <Search size={48} className="opacity-20" />
            </div>
            <h3 className="text-xl font-black text-content mb-2">{t('customers.no_results')}</h3>
            <p className="text-sm font-bold">{t('customers.no_results_desc')}</p>
            <button 
              onClick={() => { setSearch(''); setFilter('all'); setBalanceFilter('all'); }}
              className="mt-6 text-brand font-black hover:underline cursor-pointer"
            >
              {t('customers.reset_search')}
            </button>
          </div>
        )}
      </div>

      {/* Floating Sticky Bulk Actions Bar */}
      <AnimatePresence>
        {selectedCustomerIds.length > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] bg-slate-900/95 backdrop-blur-md text-white px-5 py-3.5 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] border border-white/10 flex items-center gap-4 max-w-2xl w-[92vw] sm:w-auto justify-between"
          >
            <div className="flex items-center gap-3 shrink-0">
              <span className="bg-brand text-white font-black px-2.5 py-1 rounded-xl text-xs sm:text-sm animate-pulse">
                {selectedCustomerIds.length}
              </span>
              <span className="text-xs sm:text-sm font-black text-slate-200 truncate">
                {t('customers.selected_for_actions')}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => handleExportExcel()}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all hover:scale-102 cursor-pointer border border-emerald-500/10 shadow-lg shadow-emerald-600/10"
                title={t('customers.export_selected_excel')}
              >
                <FileSpreadsheet size={14} />
                <span className="hidden sm:inline">{t('customers.export_excel_short')}</span>
              </button>

              {canDelete && (
                <button
                  onClick={() => setIsBulkDeleteModalOpen(true)}
                  className="bg-red-600 hover:bg-red-500 text-white px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all hover:scale-102 cursor-pointer border border-red-500/10 shadow-lg shadow-red-600/10"
                  title={t('customers.delete_selected_customers')}
                >
                  <Trash2 size={14} />
                  <span className="hidden sm:inline">{t('customers.delete_selected_short')}</span>
                </button>
              )}

              <button
                onClick={() => setSelectedCustomerIds([])}
                className="p-2 hover:bg-white/10 rounded-xl text-slate-400 hover:text-white transition-colors cursor-pointer"
                title={t('credit_notes.cancel_selection')}
              >
                <X size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bulk Delete Modal */}
      <AnimatePresence>
        {isBulkDeleteModalOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-surface p-6 sm:p-8 rounded-3xl border border-border shadow-2xl max-w-md w-full text-right space-y-6"
              dir={isRtl ? "rtl" : "ltr"}
            >
              <div className="flex items-center gap-4 text-danger">
                <div className="p-3 bg-danger/10 rounded-2xl">
                  <AlertCircle size={32} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-content">{t('customers.bulk_delete_title')}</h3>
                  <p className="text-xs text-content-muted mt-1 font-medium">{t('customers.irreversible_action')}</p>
                </div>
              </div>

              <p className="text-sm font-bold text-content leading-relaxed">
                {t('customers.bulk_delete_confirm', { count: selectedCustomerIds.length })}
              </p>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleBulkDelete}
                  className="flex-1 bg-danger hover:bg-danger/90 text-white py-3 rounded-xl font-bold text-sm transition-all shadow-lg shadow-danger/20 cursor-pointer"
                >
                  {t('customers.confirm_bulk_delete')}
                </button>
                <button
                  onClick={() => setIsBulkDeleteModalOpen(false)}
                  className="px-6 py-3 bg-surface-muted text-content font-bold text-sm hover:bg-surface border border-border rounded-xl transition-all cursor-pointer"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modals */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="relative w-full max-w-[clamp(320px,94vw,1100px)] max-h-[90vh] rounded-[var(--radius-card)] bg-[var(--surface)] shadow-2xl flex flex-col my-auto border border-border z-10 overflow-hidden"
              dir={isRtl ? "rtl" : "ltr"}
            >
              <form onSubmit={handleSubmit(onSubmit, onInvalidSubmit)} className="flex flex-col flex-1 max-h-[90vh] overflow-hidden">
                {/* Header (Fixed) */}
                <div className="sticky top-0 z-10 flex items-center justify-between p-4 sm:p-6 border-b border-[var(--border)] bg-[var(--surface)] shrink-0 bg-brand/5">
                  <h3 className="text-base sm:text-lg lg:text-xl font-black text-content">
                    {editingCustomer ? t('customers.edit_customer') : t('pos.add_new_customer')}
                  </h3>
                  <button type="button" onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-surface-muted rounded-full transition-colors text-content-muted">
                    <X size={20} />
                  </button>
                </div>
                
                {/* Body (Scrollable) */}
                <div className={cn("flex-1 overflow-y-auto p-4 sm:p-6 space-y-6", isRtl ? "text-right" : "text-left")}>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-content-muted">{t('login.full_name')}</label>
                    <input 
                      {...register('name')} 
                      className={cn(
                        "w-full bg-surface-muted border-none rounded-xl p-3 focus:ring-2 focus:ring-brand text-content",
                        errors.name && "ring-2 ring-danger",
                        isRtl ? "text-right" : "text-left"
                      )} 
                    />
                    {errors.name && <p className="text-xs text-danger font-bold">{errors.name.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-content-muted">{t('onboarding.fields.phone')}</label>
                    <input 
                      {...register('phone')} 
                      onChange={(e) => {
                        const formatted = formatSaudiPhone(e.target.value);
                        setValue('phone', formatted);
                      }}
                      onBlur={(e) => {
                        const formatted = formatSaudiPhone(e.target.value);
                        setValue('phone', formatted);
                      }}
                      className={cn(
                        "w-full bg-surface-muted border-none rounded-xl p-3 focus:ring-2 focus:ring-brand text-content",
                        errors.phone && "ring-2 ring-danger",
                        isRtl ? "text-right" : "text-left"
                      )} 
                    />
                    {errors.phone && <p className="text-xs text-danger font-bold">{errors.phone.message}</p>}
                  </div>
                </div>

                <h4 className="text-lg font-bold text-content mb-4 pt-4 border-t border-border flex items-center gap-2">
                  <ShoppingBag size={20} className="text-brand" />
                  {t('customers.b2b_data')}
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8 pb-8 border-b border-border">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-content-muted">{t('customers.company_name_full')} <span className="opacity-70 text-xs">({t('common.optional')})</span></label>
                    <input 
                      type="text"
                      {...register('companyName' as any)} 
                      className={cn(
                        "w-full bg-surface-muted border-none rounded-xl p-3 focus:ring-2 focus:ring-brand text-content",
                        errors.companyName && "ring-2 ring-danger",
                        isRtl ? "text-right" : "text-left"
                      )} 
                      placeholder={t('customers.b2b_invoice_note')}
                    />
                    {errors.companyName && <p className="text-xs text-danger font-bold">{errors.companyName.message as string}</p>}
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-content-muted">{t('customers.trn_company')} <span className="opacity-70 text-xs">({t('common.optional')})</span></label>
                    <input 
                      type="text"
                      maxLength={15}
                      {...register('trn' as any)} 
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '').slice(0, 15);
                        setValue('trn' as any, val, { shouldValidate: true });
                      }}
                      className={cn(
                        "w-full bg-surface-muted border-none rounded-xl p-3 focus:ring-2 focus:ring-brand text-content",
                        errors.trn && "ring-2 ring-danger"
                      )} 
                      dir="ltr"
                      placeholder="300000000000003"
                    />
                    {errors.trn && <p className="text-xs text-danger font-bold">{errors.trn.message as string}</p>}
                  </div>
                </div>

                <h4 className="text-lg font-bold text-content mb-4 flex items-center gap-2">
                  <Zap size={20} className="text-brand" />
                  {t('customers.visual_details_and_interactive_measurements')}
                </h4>

                <div className="mb-8">
                  <VisualMeasurements 
                    values={watchMeasurements || {}}
                    onChange={(field, value) => setValue(`measurements.${field}` as any, value)}
                  />
                </div>

                <div className="mb-8 pt-8 border-t border-border">
                  <h3 className="text-sm font-black text-content flex items-center gap-2 mb-4">
                    <div className="w-1.5 h-4 bg-brand rounded-full" />
                    {t('customers.interactive_measurement_selector')}
                  </h3>
                  <ThobeMeasurementSelector 
                    values={(watchMeasurements as Measurements) || {}}
                    onChange={(newMeasurements) => {
                      Object.entries(newMeasurements).forEach(([key, value]) => {
                        setValue(`measurements.${key}` as any, value);
                      });
                    }}
                  />
                </div>

                <div className="space-y-2 mb-8 mt-8 pt-8 border-t border-border">
                  <label className="text-sm font-bold text-content-muted">{t('customers.additional_notes')}</label>
                  <textarea {...register('notes')} className={cn("w-full bg-surface-muted border-none rounded-xl p-3 focus:ring-2 focus:ring-brand h-24 text-content", isRtl ? "text-right" : "text-left")} />
                </div>

                {/* isTest Flag */}
                <div className="flex items-center gap-3 p-4 bg-warning/5 rounded-2xl border border-warning/10 mb-8">
                  <input
                    type="checkbox"
                    id="isTest"
                    {...register('isTest')}
                    className="w-5 h-5 text-brand border-border rounded focus:ring-brand"
                  />
                  <label htmlFor="isTest" className="text-sm font-bold text-warning flex items-center gap-2">
                    <Zap size={16} />
                    {t('common.test_data')}
                  </label>
                </div>

                </div>

                {/* Footer (Fixed) */}
                <div className="sticky bottom-0 z-10 shrink-0 p-4 sm:p-6 border-t border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-3 shadow-md">
                  <div>
                    {Object.keys(errors).length > 0 && (
                      <p className="text-xs text-danger font-bold flex items-center gap-1">
                        <AlertCircle size={14} />
                        <span>{t('customers.name_phone_required')}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => setIsModalOpen(false)} className="px-6 py-2.5 sm:px-8 sm:py-3.5 text-content-muted font-bold hover:text-content transition-colors text-sm sm:text-base">{t('common.cancel')}</button>
                    <button 
                      type="submit" 
                      disabled={isSubmitting}
                      className="bg-brand text-white px-8 py-2.5 sm:px-12 sm:py-3.5 rounded-xl font-bold hover:bg-brand/90 shadow-lg shadow-brand/20 transition-all hover:scale-102 active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base"
                    >
                      {isSubmitting ? t('common.saving') : t('common.save')}
                    </button>
                  </div>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isDetailsOpen && selectedCustomer && (
          <CustomerDetailsModal 
            customer={selectedCustomer} 
            onClose={() => setIsDetailsOpen(false)}
            onEdit={() => { setIsDetailsOpen(false); openEditModal(selectedCustomer); }}
            orders={customerOrders}
            onNewOrder={() => navigate(`/orders?customerId=${selectedCustomer.id}`)}
            visualLabels={VISUAL_LABELS}
            visualIcons={VISUAL_ICONS}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isStatementOpen && statementCustomer && (
          <CustomerStatementModal 
            customer={statementCustomer}
            orders={statementOrders}
            onClose={() => setIsStatementOpen(false)}
            onRefresh={() => openStatement(statementCustomer)}
            tenantId={tenantId}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

const DetailSection = ({ title, icon: Icon, children, defaultOpen = true }: any) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="bg-surface rounded-2xl sm:rounded-3xl border border-border shadow-sm overflow-hidden">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-3.5 sm:p-5 flex items-center justify-between bg-surface-muted/50 hover:bg-surface-muted transition-colors"
      >
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="p-1.5 sm:p-2 bg-surface rounded-lg sm:rounded-xl text-brand shadow-sm">
            <Icon size={16} className="sm:w-5 sm:h-5" />
          </div>
          <h3 className="text-xs sm:text-sm font-black text-content uppercase tracking-widest">{title}</h3>
        </div>
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown size={16} className="text-content-muted sm:w-5 sm:h-5" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
          >
            <div className="p-4 sm:p-6 border-t border-border">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const CustomerDetailsModal = ({ 
  customer, 
  onClose, 
  onEdit, 
  orders,
  onNewOrder,
  visualLabels,
  visualIcons
}: { 
  customer: Customer, 
  onClose: () => void,
  onEdit: () => void,
  orders: Order[],
  onNewOrder: () => void,
  visualLabels: Record<string, string>,
  visualIcons: Record<string, React.ReactNode>
}) => {
  const { t, i18n } = useTranslation();
  const isRtl = isRtlLang(i18n.language);

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-2 sm:p-6">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div 
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        className={cn("bg-surface w-full max-w-5xl rounded-2xl sm:rounded-[2rem] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[92vh] sm:max-h-[90vh] border border-border", isRtl ? "text-right" : "text-left")}
      >
        <div className="p-4 sm:p-6 border-b border-border flex justify-between items-center bg-brand/5">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="p-2.5 sm:p-3 bg-brand text-white rounded-xl sm:rounded-2xl">
              <UserPlus size={20} className="sm:w-6 sm:h-6" />
            </div>
            <div>
              <h2 className="text-base sm:text-xl font-black text-content flex items-center gap-1.5 sm:gap-2">
                {customer.name}
                {customer.isB2B && (
                   <span className="bg-brand text-white px-1.5 py-0.5 rounded-md text-[9px] uppercase font-black tracking-wider">B2B</span>
                )}
              </h2>
              <p className="text-[11px] sm:text-xs text-content-muted font-bold">{customer.phone}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 sm:p-2 hover:bg-surface rounded-full transition-colors shadow-sm">
            <X size={20} className="text-content-muted sm:w-6 sm:h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-6" dir={isRtl ? "rtl" : "ltr"}>
          {customer.isB2B && (
             <DetailSection title={t('customers.b2b_data')} icon={ShoppingBag}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   <div className="bg-surface p-4 rounded-xl sm:rounded-2xl border border-border">
                      <p className="text-[10px] text-content-muted font-black uppercase tracking-wider mb-1">{t('customers.company_name_label')}</p>
                      <p className="text-sm font-black text-content">{customer.companyName || t('orders.none')}</p>
                   </div>
                   <div className="bg-surface p-4 rounded-xl sm:rounded-2xl border border-border">
                      <p className="text-[10px] text-content-muted font-black uppercase tracking-wider mb-1">{t('customers.trn_label')}</p>
                      <p className="text-sm font-mono font-black text-content">{customer.trn || t('orders.none')}</p>
                   </div>
                </div>
             </DetailSection>
          )}

          {/* Measurements Section */}
          <DetailSection title={t('customers.current_measurements')} icon={Ruler}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
              {[
                { label: t('customers.length'), value: customer.measurements?.length, icon: <ArrowUpDown size={14} />, color: 'bg-info/10 text-info' },
                { label: t('customers.shoulder'), value: customer.measurements?.shoulder, icon: <ArrowLeftRight size={14} />, color: 'bg-brand/10 text-brand' },
                { label: t('customers.chest'), value: customer.measurements?.chest, icon: <Users size={14} />, color: 'bg-success/10 text-success' },
                { label: t('customers.waist'), value: customer.measurements?.waist, icon: <Filter size={14} />, color: 'bg-warning/10 text-warning' },
                { label: t('customers.hips'), value: customer.measurements?.hips, icon: <ChevronDown size={14} />, color: 'bg-danger/10 text-danger' },
                { label: t('customers.sleeve'), value: customer.measurements?.sleeve, icon: <Scissors size={14} />, color: 'bg-info/10 text-info' },
                { label: t('customers.neck'), value: customer.measurements?.neck, icon: <User size={14} />, color: 'bg-brand/10 text-brand' },
              ].map((m) => (
                <div key={m.label} className="bg-surface p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-border hover:border-brand/20 transition-all group shadow-sm hover:shadow-md">
                  <div className="flex items-center gap-1.5 sm:gap-2 mb-1.5 sm:mb-2">
                    <div className={cn("p-1.5 rounded-lg", m.color)}>
                      {m.icon}
                    </div>
                    <p className="text-[10px] text-content-muted font-black uppercase tracking-wider">{m.label}</p>
                  </div>
                  <p className="text-base sm:text-xl font-black text-content">
                    {m.value || '-'} 
                    <span className="text-[10px] text-content-muted mr-1 font-bold">{t('customers.cm')}</span>
                  </p>
                </div>
              ))}
            </div>
          </DetailSection>

          {/* Visual Details Section */}
          <DetailSection title={t('customers.visual_details_chart')} icon={Zap}>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
              {[
                { label: t('customers.collar'), value: customer.measurements?.collarType, desc: t('customers.collar_desc') },
                { label: t('customers.cuff'), value: customer.measurements?.cuffType, desc: t('customers.cuff_desc') },
                { label: t('customers.pocket'), value: customer.measurements?.pocketType, desc: t('inventory.pocket_type') },
                { label: t('customers.chest_style'), value: customer.measurements?.chestStyle, desc: t('inventory.chest_style') },
                { label: t('customers.shoulder_style'), value: customer.measurements?.shoulderStyle, desc: t('customers.shoulder_style_desc') },
              ].map((v) => (
                <div key={v.label} className="bg-surface p-3 sm:p-4 rounded-2xl sm:rounded-3xl border border-border flex flex-col items-center text-center group hover:border-brand/40 transition-all shadow-sm hover:shadow-md">
                  <div className="w-12 h-12 sm:w-16 sm:h-16 bg-brand/5 text-brand rounded-xl sm:rounded-2xl flex items-center justify-center mb-2 sm:mb-3 group-hover:scale-110 transition-transform shadow-inner">
                    {v.value ? visualIcons[v.value] : <Info size={20} className="opacity-20 sm:w-6 sm:h-6" />}
                  </div>
                  <p className="text-[10px] text-brand/60 font-black uppercase tracking-widest mb-1">{v.label}</p>
                  <p className="text-xs sm:text-sm font-black text-content truncate w-full">
                    {v.value ? visualLabels[v.value] : t('orders.not_specified')}
                  </p>
                  <p className="text-[8px] sm:text-[9px] text-content-muted font-bold mt-0.5">{v.desc}</p>
                </div>
              ))}
            </div>
          </DetailSection>

          {/* Garment Blueprint Section */}
          <DetailSection title={t('customers.garment_blueprint')} icon={Scissors}>
            <div className="bg-surface-muted/30 rounded-2xl sm:rounded-[2.5rem] p-2 sm:p-4 border border-border pointer-events-none overflow-x-auto scrollbar-hide">
              <ThobeMeasurementSelector 
                values={(customer.measurements as Measurements) || {}}
                onChange={() => {}} // Read-only in details view
                readOnly={true}
              />
            </div>
          </DetailSection>

          {/* Style Preferences Section */}
          <DetailSection title={t('customers.design_preferences')} icon={ShoppingBag} defaultOpen={false}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              <div className="bg-surface-muted p-4 rounded-xl sm:rounded-2xl border border-border">
                <span className="text-[10px] text-content-muted font-bold block mb-1">{t('customers.neck_shape')}</span>
                <span className="text-sm font-bold text-content">
                  {customer.styles?.neckShape === 'round' ? t('customers.neck_shape_round') : customer.styles?.neckShape === 'v-neck' ? t('customers.neck_shape_v') : customer.styles?.neckShape === 'square' ? t('customers.neck_shape_square') : '-'}
                </span>
              </div>
              <div className="bg-surface-muted p-4 rounded-xl sm:rounded-2xl border border-border">
                <span className="text-[10px] text-content-muted font-bold block mb-1">{t('customers.sleeve_type')}</span>
                <span className="text-sm font-bold text-content">
                  {customer.styles?.sleeveStyle === 'normal' ? t('inventory.cuff_regular') : customer.styles?.sleeveStyle === 'cuff' ? t('customers.sleeve_style_cuff') : customer.styles?.sleeveStyle === 'wide' ? t('customers.sleeve_style_wide') : '-'}
                </span>
              </div>
              <div className="bg-surface-muted p-4 rounded-xl sm:rounded-2xl border border-border">
                <span className="text-[10px] text-content-muted font-bold block mb-1">{t('customers.pocket_style')}</span>
                <span className="text-sm font-bold text-content">
                  {customer.styles?.pocketType === 'none' ? t('customers.pocket_none') : customer.styles?.pocketType === 'single' ? t('customers.pocket_single') : customer.styles?.pocketType === 'double' ? t('customers.pocket_double') : '-'}
                </span>
              </div>
            </div>
          </DetailSection>

          {/* Order History Section */}
          <DetailSection title={t('customers.order_history')} icon={History} defaultOpen={false}>
            <div className="space-y-3">
              {orders.length > 0 ? (
                orders.map((order) => (
                  <div key={order.id} className="bg-surface p-4 rounded-xl sm:rounded-2xl border border-border shadow-sm flex items-center justify-between hover:border-brand/20 transition-colors">
                    <div className="flex items-center gap-2.5 sm:gap-3">
                      <div className="p-2 bg-surface-muted rounded-xl text-content-muted animate-pulse">
                        <ShoppingBag size={16} className="sm:w-[18px] sm:h-[18px]" />
                      </div>
                      <div>
                        <p className="text-xs sm:text-sm font-bold text-content">#{order.id.slice(-6).toUpperCase()}</p>
                        <DateTimeDisplay date={order.orderDate} showTime={true} size="xs" />
                      </div>
                    </div>
                    <div className={cn(isRtl ? "text-left" : "text-right")}>
                      <p className="text-xs sm:text-sm font-black text-brand"><PriceDisplay amount={order.totalAmount} /></p>
                      <span className={cn(
                        "text-[9px] sm:text-[10px] font-bold px-2 py-0.5 rounded-full",
                        order.status === 'delivered' ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
                      )}>
                        {order.status === 'delivered' ? t('common.status_delivered') : t('common.status_in_progress')}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 bg-surface-muted rounded-xl sm:rounded-2xl border-2 border-dashed border-border text-content-muted">
                  <p className="text-sm font-bold">{t('customers.no_previous_orders')}</p>
                </div>
              )}
            </div>
          </DetailSection>

          {customer.notes && (
            <DetailSection title={t('common.notes')} icon={Info} defaultOpen={false}>
              <p className="text-sm text-content-muted leading-relaxed bg-warning/5 p-4 rounded-xl sm:rounded-2xl border border-warning/10">
                {customer.notes}
              </p>
            </DetailSection>
          )}
        </div>

        {/* Footer (Fixed) */}
        <div className="sticky bottom-0 z-10 shrink-0 p-4 sm:p-6 border-t border-[var(--border)] bg-[var(--surface)] flex gap-2.5 sm:gap-3 text-xs sm:text-base">
          <button 
            onClick={onEdit}
            className="flex-1 flex items-center justify-center gap-1.5 sm:gap-2 bg-surface text-content py-3 rounded-xl font-bold border border-border hover:bg-surface-muted transition-all"
          >
            <Edit2 size={16} className="sm:w-[18px] sm:h-[18px]" />
            <span>{t('customers.edit_data')}</span>
          </button>
          <button 
            onClick={onNewOrder}
            className="flex-1 flex items-center justify-center gap-1.5 sm:gap-2 bg-brand text-white py-3 rounded-xl font-bold hover:bg-brand/90 transition-all shadow-lg shadow-brand/10"
          >
            <Plus size={16} className="sm:w-[18px] sm:h-[18px]" />
            <span>{t('orders.create_new_order')}</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
};

const CustomerStatementModal = ({
  customer,
  orders,
  onClose,
  onRefresh,
  tenantId
}: {
  customer: Customer;
  orders: Order[];
  onClose: () => void;
  onRefresh: () => void;
  tenantId: string;
}) => {
  const { t, i18n } = useTranslation();
  const isRtl = isRtlLang(i18n.language);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

  const { currentStaff } = useStaff();
  const { error: toastError, success: toastSuccess } = useToast();

  const [payingOrderId, setPayingOrderId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payMethod, setPayMethod] = useState<'cash' | 'network' | 'cash_on_delivery'>('cash');
  const [isPaying, setIsPaying] = useState(false);

  // Financial calculations
  const totalPurchases = orders.reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);
  const totalPaid = orders.reduce((sum, o) => sum + (Number(o.paidAmount) || 0), 0);
  const netBalance = orders.reduce((sum, o) => sum + (Number(o.remainingAmount) || 0), 0);

  const handlePrint = () => {
    window.print();
  };

  const handlePaymentSubmit = async (order: Order) => {
    if (payAmount <= 0) return;
    setIsPaying(true);
    try {
      const newPaidAmount = (order.paidAmount || 0) + payAmount;
      const newRemainingAmount = Math.max(0, (order.totalAmount || 0) - newPaidAmount);

      const historyEntry = {
        status: order.status,
        updatedAt: new Date().toISOString(),
        updatedBy: currentStaff?.name || t('common.roles.owner'),
        updatedByUid: currentStaff?.id || auth.currentUser?.uid,
        notes: t('orders.payment_note', { 
          amount: payAmount, 
          method: t(`common.payment_methods.${payMethod}`) 
        })
      };

      const updatedHistory = [...(order.history || []), historyEntry];

      const { error } = await supabase
        .from('orders')
        .update({
          paid_amount: newPaidAmount,
          history: updatedHistory,
          items: order.items || []
        })
        .eq('id', order.id);

      if (error) throw error;

      // Log action for audit trail
      try {
        await logEmployeeAction(
          tenantId,
          currentStaff?.id || '',
          currentStaff?.name || t('common.roles.owner'),
          'update_order_payment',
          t('customers.audit_pay_remaining', { amount: payAmount, invoice: order.orderNumber || order.id.slice(-6).toUpperCase() })
        );
      } catch (logErr) {
        console.error('Error logging payment action:', logErr);
      }

      toastSuccess(t('orders.payment_success_toast'));
      setPayingOrderId(null);
      setPayAmount(0);
      onRefresh();
    } catch (err) {
      console.error('Error updating payment:', err);
      toastError(t('orders.payment_error_toast'));
    } finally {
      setIsPaying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-2 sm:p-6 print:absolute print:inset-0 print:z-[200] print:p-0 print:bg-white">
      {/* Background Overlay */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm print:hidden"
        onClick={onClose}
      />
      
      {/* Modal Card Container */}
      <motion.div 
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        className={cn(
          "bg-surface w-full max-w-4xl rounded-2xl sm:rounded-[2rem] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[92vh] sm:max-h-[90vh] border border-border print:border-none print:shadow-none print:max-h-none print:rounded-none print:w-full print:static", 
          isRtl ? "text-right" : "text-left"
        )}
      >
        {/* Header */}
        <div className="p-4 sm:p-6 border-b border-border flex justify-between items-center bg-brand/5 print:bg-transparent print:border-b-2 print:border-black">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-brand text-white rounded-xl print:hidden">
              <FileText size={20} className="sm:w-6 sm:h-6" />
            </div>
            <div>
              <h2 className="text-base sm:text-xl font-black text-content print:text-2xl print:text-black">
                {t('customers.account_statement_title')}
              </h2>
              <p className="text-[11px] sm:text-xs text-content-muted font-bold print:text-sm print:text-black mt-0.5">
                {t('common.customer')}: <span className="font-black text-content print:text-black">{customer.name}</span> | {t('common.phone')}: <span className="font-black">{customer.phone}</span>
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 print:hidden">
            <button 
              onClick={handlePrint}
              className="p-2 bg-brand/10 text-brand hover:bg-brand hover:text-white rounded-xl transition-all flex items-center gap-1.5 text-xs font-bold shadow-sm cursor-pointer"
              title={t('tax_invoices.print')}
            >
              <Printer size={16} />
              <span>{t('tax_invoices.print')}</span>
            </button>
            <button onClick={onClose} className="p-1.5 hover:bg-surface rounded-full transition-colors shadow-sm cursor-pointer">
              <X size={20} className="text-content-muted sm:w-6 sm:h-6" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 print:overflow-visible print:p-0 print:space-y-4" dir={isRtl ? "rtl" : "ltr"}>
          {/* Printable Header Info (Visible only during print) */}
          <div className="hidden print:block space-y-2 pb-4 border-b border-gray-200">
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-xl font-bold text-black">{t('customers.store_statement')}</h1>
                <div className="text-xs text-black flex items-center gap-2 mt-1">
                  <span>{t('customers.statement_date')}:</span>
                  <DateTimeDisplay date={new Date()} showTime={true} size="xs" />
                </div>
              </div>
              <div className="text-left">
                <p className="text-sm font-bold text-black">{customer.name}</p>
                <p className="text-xs text-black">{customer.phone}</p>
                {customer.isB2B && customer.trn && (
                  <p className="text-xs text-black">{t('customers.trn')}: {customer.trn}</p>
                )}
              </div>
            </div>
          </div>

          {/* Financial summary metrics bento block */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-surface-muted/50 p-4 rounded-2xl border border-border flex flex-col justify-between print:border-black print:bg-white">
              <span className="text-[10px] text-content-muted font-black uppercase tracking-wider mb-1 print:text-black">{t('customers.statement_total_purchases')}</span>
              <p className="text-lg sm:text-2xl font-black text-brand print:text-black">
                <PriceDisplay amount={totalPurchases} />
              </p>
            </div>
            
            <div className="bg-surface-muted/50 p-4 rounded-2xl border border-border flex flex-col justify-between print:border-black print:bg-white">
              <span className="text-[10px] text-content-muted font-black uppercase tracking-wider mb-1 print:text-black">{t('customers.total_paid')}</span>
              <p className="text-lg sm:text-2xl font-black text-success print:text-black">
                <PriceDisplay amount={totalPaid} />
              </p>
            </div>

            <div className={cn(
              "p-4 rounded-2xl border flex flex-col justify-between print:border-black print:bg-white",
              netBalance > 0 
                ? "bg-red-500/5 border-red-500/10 text-red-600 print:text-black" 
                : netBalance < 0 
                  ? "bg-green-500/5 border-green-500/10 text-green-600 print:text-black" 
                  : "bg-surface-muted/50 border-border text-content print:text-black"
            )}>
              <span className="text-[10px] opacity-80 font-black uppercase tracking-wider mb-1 flex items-center gap-1">
                {netBalance > 0 && <AlertCircle size={12} className="print:hidden" />}
                {t('customers.net_balance')}
              </span>
              <div className="flex items-baseline justify-between">
                <p className="text-lg sm:text-2xl font-black">
                  <PriceDisplay amount={Math.abs(netBalance)} />
                </p>
                <span className="text-xs font-black px-2 py-0.5 rounded-full bg-white/20 print:border print:border-black print:text-black">
                  {netBalance > 0 
                    ? t('customers.debtor') 
                    : netBalance < 0 
                      ? t('customers.creditor') 
                      : t('customers.balanced')
                  }
                </span>
              </div>
            </div>
          </div>

          {/* Detailed ledger table / list */}
          <div className="space-y-3">
            <h3 className="text-sm font-black text-content-muted flex items-center gap-2 border-b border-border pb-2 print:text-black print:border-black">
              <History size={16} />
              {t('customers.detailed_ledger')}
            </h3>
            
            <div className="overflow-x-auto rounded-2xl border border-border print:border-black">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-muted border-b border-border text-content-muted font-black text-xs print:bg-gray-100 print:text-black print:border-b-2 print:border-black">
                    <th className="p-3 text-right">{t('orders.order_id')}</th>
                    <th className="p-3 text-right">{t('common.date')}</th>
                    <th className="p-3 text-right">{t('orders.total')}</th>
                    <th className="p-3 text-right">{t('orders.paid')}</th>
                    <th className="p-3 text-right">{t('common.remaining')}</th>
                    <th className="p-3 text-right">{t('common.status')}</th>
                    <th className="p-3 text-center print:hidden">{t('saas.details')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border print:divide-black">
                  {orders.length > 0 ? (
                    orders.map((order) => {
                      const isExpanded = expandedOrder === order.id;
                      return (
                        <React.Fragment key={order.id}>
                          <tr className={cn(
                            "hover:bg-brand/5 transition-colors print:hover:bg-transparent",
                            order.remainingAmount > 0 ? "bg-red-500/[0.02]" : ""
                          )}>
                            <td className="p-3 font-black text-content print:text-black">
                              #{order.orderNumber || order.id.slice(-6).toUpperCase()}
                            </td>
                            <td className="p-3 text-content-muted print:text-black text-xs">
                              <DateTimeDisplay date={order.orderDate} showTime={true} size="xs" />
                            </td>
                            <td className="p-3 font-bold text-content print:text-black">
                              <PriceDisplay amount={order.totalAmount} />
                            </td>
                            <td className="p-3 font-bold text-success print:text-black">
                              <PriceDisplay amount={order.paidAmount} />
                            </td>
                            <td className={cn(
                              "p-3 font-bold",
                              order.remainingAmount > 0 ? "text-danger print:text-black" : "text-content-muted print:text-black"
                            )}>
                              <PriceDisplay amount={order.remainingAmount} />
                            </td>
                            <td className="p-3">
                              <span className={cn(
                                "text-[10px] font-black px-2.5 py-0.5 rounded-full inline-block",
                                order.status === 'delivered' 
                                  ? "bg-success/10 text-success print:bg-transparent print:text-black print:border print:border-black" 
                                  : order.status === 'cancelled'
                                    ? "bg-surface-muted text-content-muted print:bg-transparent print:text-black print:border print:border-black"
                                    : "bg-warning/10 text-warning print:bg-transparent print:text-black print:border print:border-black"
                              )}>
                                {order.status === 'delivered' 
                                  ? t('common.status_delivered') 
                                  : order.status === 'cancelled'
                                    ? t('common.status_cancelled')
                                    : t('common.status_in_progress')
                                }
                              </span>
                            </td>
                            <td className="p-3 text-center print:hidden">
                              <button 
                                onClick={() => setExpandedOrder(isExpanded ? null : order.id)}
                                className="p-1 hover:bg-brand/10 text-brand rounded-lg transition-colors cursor-pointer"
                              >
                                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                              </button>
                            </td>
                          </tr>

                          {/* Expanded Order Items Row */}
                          {isExpanded && (
                            <tr className="bg-brand/5/20 border-b border-border print:hidden">
                              <td colSpan={7} className="p-4 bg-brand/[0.01]">
                                <div className={cn("grid gap-4", order.remainingAmount > 0 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1")}>
                                  
                                  {/* Order items column */}
                                  <div className="space-y-2 text-xs">
                                    <h4 className="font-black text-content-muted border-b border-border/40 pb-1 flex items-center gap-1.5">
                                      <ShoppingBag size={14} />
                                      {t('orders.order_items')}
                                    </h4>
                                    <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto">
                                      {order.items && order.items.length > 0 ? (
                                        order.items.map((item: any, idx: number) => (
                                          <div key={idx} className="bg-surface p-2.5 rounded-xl border border-border flex justify-between items-center shadow-sm">
                                            <div>
                                              <p className="font-bold text-content">{item.name || item.thobeType || t('orders.thobe_custom')}</p>
                                              <p className="text-[10px] text-content-muted">{t('common.quantity')}: {item.quantity || 1}</p>
                                            </div>
                                            <p className="font-bold text-brand"><PriceDisplay amount={item.price || item.totalPrice} /></p>
                                          </div>
                                        ))
                                      ) : (
                                        <p className="text-content-muted italic">{t('orders.no_items_details')}</p>
                                      )}
                                    </div>
                                  </div>

                                  {/* Pay remaining column */}
                                  {order.remainingAmount > 0 && (
                                    <div className="bg-surface p-4 rounded-2xl border border-red-500/10 space-y-3.5 shadow-sm flex flex-col justify-between">
                                      <div>
                                        <h4 className="font-black text-danger border-b border-border/40 pb-1 flex items-center gap-1.5 text-xs mb-3">
                                          <CreditCard size={14} />
                                          {t('orders.pay_remaining_title')}
                                        </h4>
                                        
                                        {payingOrderId === order.id ? (
                                          <div className="space-y-3.5 animate-in fade-in slide-in-from-top-2 duration-200">
                                            {/* Payment Amount Input */}
                                            <div className="space-y-1">
                                              <label className="text-[10px] font-black text-content-muted uppercase">
                                                {t('orders.pay_amount_now')} (﷼)
                                              </label>
                                              <input 
                                                type="number" 
                                                step="0.01"
                                                max={order.remainingAmount}
                                                value={payAmount === 0 ? '' : payAmount}
                                                onChange={(e) => setPayAmount(e.target.value === '' ? 0 : Math.min(order.remainingAmount, Math.max(0, Number(e.target.value))))}
                                                className="w-full bg-surface-muted border-none rounded-xl p-2.5 text-xs font-bold focus:ring-2 focus:ring-brand text-content"
                                              />
                                            </div>

                                            {/* Payment Method Selection */}
                                            <div className="space-y-1">
                                              <label className="text-[10px] font-black text-content-muted uppercase">
                                                {t('orders.payment_method')}
                                              </label>
                                              <div className="grid grid-cols-3 gap-1.5">
                                                {[
                                                  { id: 'cash', label: t('common.payment_methods.cash_short') },
                                                  { id: 'network', label: t('common.payment_methods.network') },
                                                  { id: 'cash_on_delivery', label: t('orders.payment_on_delivery_short') }
                                                ].map(m => (
                                                  <button
                                                    key={m.id}
                                                    type="button"
                                                    onClick={() => setPayMethod(m.id as any)}
                                                    className={cn(
                                                      "p-2 rounded-lg border text-[10px] font-bold flex flex-col items-center gap-1 transition-all cursor-pointer",
                                                      payMethod === m.id ? "bg-brand border-brand text-white shadow-sm" : "bg-surface-muted border-transparent text-content-muted hover:bg-border/20"
                                                    )}
                                                  >
                                                    <span>{m.label}</span>
                                                  </button>
                                                ))}
                                              </div>
                                            </div>

                                            {/* Buttons */}
                                            <div className="flex gap-2 pt-1.5">
                                              <button 
                                                type="button"
                                                onClick={() => handlePaymentSubmit(order)}
                                                disabled={isPaying || payAmount <= 0}
                                                className="flex-1 bg-success hover:bg-success/90 text-white py-2 rounded-xl font-bold text-xs transition-colors disabled:opacity-50 flex items-center justify-center gap-1 cursor-pointer shadow-sm"
                                              >
                                                {isPaying ? t('orders.processing') : t('orders.confirm_payment')}
                                              </button>
                                              <button 
                                                type="button"
                                                onClick={() => { setPayingOrderId(null); setPayAmount(0); }}
                                                className="px-3 py-2 text-content-muted font-bold text-xs hover:bg-surface-muted rounded-xl transition-colors cursor-pointer"
                                              >
                                                {t('common.cancel')}
                                              </button>
                                            </div>
                                          </div>
                                        ) : (
                                          <div className="space-y-3">
                                            <p className="text-content-muted font-medium text-xs leading-relaxed">
                                              {t('orders.remaining_warning')} <span className="font-black text-danger"><PriceDisplay amount={order.remainingAmount} /></span>. {t('orders.pay_help_text')}
                                            </p>
                                            <button 
                                              type="button"
                                              onClick={() => {
                                                setPayingOrderId(order.id);
                                                setPayAmount(order.remainingAmount);
                                                setPayMethod('cash');
                                              }}
                                              className="w-full bg-brand hover:bg-brand/90 text-white py-2.5 rounded-xl font-black text-xs transition-all flex items-center justify-center gap-1.5 shadow-sm hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                                            >
                                              <CreditCard size={14} />
                                              {t('orders.pay_remaining')}
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}

                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-content-muted font-bold italic">
                        {t('customers.no_statement_transactions')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 z-10 shrink-0 p-4 sm:p-6 border-t border-border bg-surface flex justify-end gap-3 print:hidden">
          <button 
            onClick={onClose}
            className="px-6 py-2.5 bg-surface-muted text-content hover:bg-surface border border-border rounded-xl font-bold transition-all text-xs sm:text-sm cursor-pointer"
          >
            {t('sales.close')}
          </button>
        </div>
      </motion.div>
    </div>
  );
};
