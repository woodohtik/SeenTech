import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  Users, 
  Plus, 
  Search, 
  Mail, 
  Phone, 
  MapPin, 
  Trash2, 
  Edit2, 
  Briefcase,
  Layers,
  Scissors,
  CircleDot,
  Package,
  ExternalLink,
  MessageSquare,
  Building,
  User,
  FileText
} from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { handleError, OperationType } from '../lib/firebase';
import { Supplier, PurchaseOrder, PurchaseReturn, InventoryItem } from '../types';
import { decodeInventoryDescription } from '../utils/b2bHelper';

import { useForm, Controller } from 'react-hook-form';
import { SmartSelect } from './ui/SmartSelect';
import { zodResolver } from '@hookform/resolvers/zod';
import { supplierSchema } from '../lib/validations';
import { logEmployeeAction } from '../services/employeeAuditService';
import { useStaff } from '../contexts/StaffContext';
import { cn } from '../lib/utils';
import { useToast } from '../contexts/ToastContext';
import { useSafeMutation } from '../hooks/useSafeMutation';
import Branding from './Branding';
import { PriceDisplay } from './PriceDisplay';
import PurchaseOrders from './PurchaseOrders';
import PurchaseReturns from './PurchaseReturns';
import SuppliersRegistry from './SuppliersRegistry';
import SupplierLedger from './SupplierLedger';
import PaymentVoucherModal from './PaymentVoucherModal';
import { useTranslation } from 'react-i18next';

export default function Suppliers({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation();
  const { currentStaff } = useStaff();

  // Centralized Mutations for Suppliers (Strict Persistence)
  const saveSupplierMutation = useSafeMutation(
    async ({ supplierData, id }: { supplierData: any; id?: string }) => {
      if (id) {
        const { error } = await supabase
          .from('suppliers')
          .update(supplierData)
          .eq('id', id);
        if (error) throw error;
      } else {
        const { data: newSup, error } = await supabase
          .from('suppliers')
          .insert({
            ...supplierData,
            balance: 0,
            tenant_id: tenantId,
            created_at: new Date().toISOString()
          })
          .select()
          .single();
        if (error) throw error;
        
        // Audit Log for new supplier
        if (currentStaff) {
          await logEmployeeAction(
            tenantId,
            currentStaff.id,
            currentStaff.name,
            'add_supplier',
            `إضافة مورد جديد: ${supplierData.name}`
          );
        }
        return newSup;
      }
    },
    {
      onSuccess: () => {
        setIsModalOpen(false);
        setEditingSupplier(null);
        reset();
        setSupplierReloadTrigger(prev => prev + 1);
      }
    }
  );

  const deleteSupplierMutation = useSafeMutation(
    async (id: string) => {
      const { error } = await supabase
        .from('suppliers')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    {
      successMessage: t('procurement.delete_success') || 'تم حذف المورد بنجاح',
      onSuccess: () => {
        setSupplierReloadTrigger(prev => prev + 1);
      }
    }
  );

  const [activeTab, setActiveTab] = useState<'suppliers' | 'purchase_orders' | 'returns'>('suppliers');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [purchaseReturns, setPurchaseReturns] = useState<PurchaseReturn[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [selectedSupplierDetails, setSelectedSupplierDetails] = useState<Supplier | null>(null);

  const [selectedLedgerSupplier, setSelectedLedgerSupplier] = useState<Supplier | null>(null);
  const [payoutSupplier, setPayoutSupplier] = useState<any | null>(null);
  const [tenantName, setTenantName] = useState('نظام سين - SEEN POS');
  const [supplierReloadTrigger, setSupplierReloadTrigger] = useState(0);

  const { register, handleSubmit, reset, control, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(supplierSchema),
    defaultValues: {
      name: '',
      contactPerson: '',
      email: '',
      phone: '',
      address: '',
      taxNumber: '',
      category: 'fabric' as const
    }
  });

  useEffect(() => {
    if (!tenantId) return;

    const fetchSuppliers = async () => {
      const { data, error } = await supabase
        .from('suppliers')
        .select('*')
        .eq('tenant_id', tenantId);
      if (error) {
        handleError(error, OperationType.LIST, 'suppliers');
      } else {
        setSuppliers((data || []).map(d => ({
          ...d,
          contactPerson: d.contact_person,
          taxNumber: d.tax_number,
          createdAt: d.created_at,
          updatedAt: d.updated_at,
          tenantId: d.tenant_id
        }) as Supplier));
        setLoading(false);
      }
    };

    fetchSuppliers();
    const suppliersChannel = supabase
      .channel('suppliers-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'suppliers', filter: `tenant_id=eq.${tenantId}` }, () => {
        fetchSuppliers();
      })
      .subscribe();

    const fetchPO = async () => {
      const { data: supsData } = await supabase
        .from('suppliers')
        .select('id, name')
        .eq('tenant_id', tenantId);

      const supsMap = new Map();
      if (supsData) {
        supsData.forEach(s => {
          if (s.id && s.name) {
            supsMap.set(s.id.toLowerCase().trim(), s.name);
          }
        });
      }

      const { data } = await supabase
        .from('purchase_orders')
        .select('*, purchase_order_items(*)')
        .eq('tenant_id', tenantId);
      if (data) {
        setPurchaseOrders(data.map(d => {
          const sId = (d.supplier_id || '').toLowerCase().trim();
          return {
            ...d,
            supplierId: d.supplier_id,
            supplierName: supsMap.get(sId) || d.supplier_name || t('common.unknown_supplier'),
            poNumber: d.po_number,
            tenantId: d.tenant_id,
            branchId: d.branch_id,
            totalAmount: d.total_amount,
            paidAmount: d.paid_amount,
            remainingAmount: d.remaining_amount,
            orderDate: d.order_date,
            orderType: d.po_number?.startsWith('RET') ? 'return' : 'purchase',
            expectedDate: d.expected_date,
            receivedDate: d.received_date,
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
          };
        }) as unknown as PurchaseOrder[]);
      }
    };
    fetchPO();
    const poChannel = supabase
      .channel('po-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_orders', filter: `tenant_id=eq.${tenantId}` }, () => {
        fetchPO();
      })
      .subscribe();

    const fetchReturns = async () => {
      const { data } = await supabase
        .from('purchase_returns')
        .select('*')
        .eq('tenant_id', tenantId);
      if (data) {
        setPurchaseReturns(data.map(d => ({
          ...d,
          purchaseOrderId: d.purchase_order_id,
          supplierId: d.supplier_id,
          tenantId: d.tenant_id,
          branchId: d.branch_id,
          totalAmount: d.total_amount,
          returnDate: d.return_date,
          createdBy: d.created_by,
          createdAt: d.created_at
        }) as unknown as PurchaseReturn));
      }
    };
    fetchReturns();
    const returnsChannel = supabase
      .channel('returns-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_returns', filter: `tenant_id=eq.${tenantId}` }, () => {
        fetchReturns();
      })
      .subscribe();

    const fetchInv = async () => {
      const { data } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('tenant_id', tenantId);
      setInventory(data as InventoryItem[] || []);
    };
    fetchInv();
    const invChannel = supabase
      .channel('inv-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_items', filter: `tenant_id=eq.${tenantId}` }, () => {
        fetchInv();
      })
      .subscribe();

    const fetchTenantDetails = async () => {
      try {
        const { data } = await supabase
          .from('tenants')
          .select('name')
          .eq('id', tenantId)
          .single();
        if (data?.name) {
          setTenantName(data.name);
        }
      } catch (err) {
        console.warn('Failed to fetch tenant name details:', err);
      }
    };
    fetchTenantDetails();

    return () => {
      supabase.removeChannel(suppliersChannel);
      supabase.removeChannel(poChannel);
      supabase.removeChannel(returnsChannel);
      supabase.removeChannel(invChannel);
    };
  }, [tenantId, supplierReloadTrigger]);

  const onSubmit = async (formData: any) => {
    const data = {
      name: formData.name,
      contact_person: formData.contactPerson,
      email: formData.email,
      phone: formData.phone,
      address: formData.address,
      tax_number: formData.taxNumber,
      category: formData.category,
      updated_at: new Date().toISOString()
    };

    try {
      await saveSupplierMutation.mutateAsync({ supplierData: data, id: editingSupplier?.id });
    } catch (err) {
      // Handled inside the safe mutation hook
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('procurement.confirm_delete'))) return;
    try {
      const supplier = suppliers.find(s => s.id === id);
      await deleteSupplierMutation.mutateAsync(id);
      
      if (currentStaff && supplier) {
        await logEmployeeAction(
          tenantId,
          currentStaff.id,
          currentStaff.name,
          'delete_supplier',
          `حذف المورد: ${supplier.name}`
        );
      }
    } catch (error) {
      // Handled inside the safe mutation hook
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'fabric': return <Layers size={20} />;
      case 'thread': return <Scissors size={20} />;
      case 'button': return <CircleDot size={20} />;
      default: return <Package size={20} />;
    }
  };

  const getCategoryLabel = (category: string) => {
    switch (category) {
      case 'fabric': return t('procurement.category_fabric', 'أقمشة');
      case 'thread': return t('procurement.category_thread', 'خيوط');
      case 'button': return t('procurement.category_button', 'أزرار');
      default: return t('procurement.category_other', 'أخرى');
    }
  };

  const filteredSuppliers = suppliers.filter(s => {
    const matchesSearch = s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.contactPerson || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || s.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="p-4 md:p-6 space-y-6 font-sans">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-content">{t('procurement.title', 'الموردين والمشتريات')}</h1>
          <p className="text-content-muted">{t('procurement.subtitle', 'إدارة الموردين، أوامر الشراء، والمرتجعات')}</p>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          {activeTab === 'suppliers' && (
            <button 
              onClick={() => {
                setEditingSupplier(null);
                setIsModalOpen(true);
              }}
              className="flex-1 md:flex-none bg-brand text-white px-4 py-2 rounded-xl flex items-center justify-center gap-2 hover:bg-brand/90 transition-colors"
            >
              <Plus size={20} />
              <span>{t('procurement.add_supplier', 'إضافة مورد')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div id="tour-suppliers-tabs" data-tour="suppliers-tabs" className="flex gap-2 border-b border-border pb-px overflow-x-auto">
        <button
          onClick={() => setActiveTab('suppliers')}
          className={cn(
            "px-6 py-3 font-bold text-sm transition-colors whitespace-nowrap border-b-2",
            activeTab === 'suppliers' ? "border-brand text-brand" : "border-transparent text-content-muted hover:text-content"
          )}
        >
          {t('procurement.suppliers_registry', 'سجل الموردين')}
        </button>
        <button
          onClick={() => setActiveTab('purchase_orders')}
          className={cn(
            "px-6 py-3 font-bold text-sm transition-colors whitespace-nowrap border-b-2",
            activeTab === 'purchase_orders' ? "border-brand text-brand" : "border-transparent text-content-muted hover:text-content"
          )}
        >
          {t('procurement.purchase_orders', 'أوامر الشراء')}
        </button>
        <button
          onClick={() => setActiveTab('returns')}
          className={cn(
            "px-6 py-3 font-bold text-sm transition-colors whitespace-nowrap border-b-2",
            activeTab === 'returns' ? "border-brand text-brand" : "border-transparent text-content-muted hover:text-content"
          )}
        >
          {t('procurement.returns', 'المرتجعات')}
        </button>
      </div>

      {activeTab === 'suppliers' && (
        <>
          {selectedLedgerSupplier ? (
            <SupplierLedger
              supplier={(() => {
                const active = suppliers.find(s => s.id === selectedLedgerSupplier.id) || selectedLedgerSupplier;
                return {
                  id: active.id,
                  name: active.name,
                  phone: active.phone,
                  balance: active.balance,
                  taxNumber: active.taxNumber,
                  contactPerson: active.contactPerson,
                  address: active.address
                };
              })()}
              tenantId={tenantId}
              tenantName={tenantName}
              onBack={() => {
                setSelectedLedgerSupplier(null);
                setSupplierReloadTrigger(prev => prev + 1);
              }}
              onReloadSupplier={() => setSupplierReloadTrigger(prev => prev + 1)}
            />
          ) : (
            <>
              {/* Filters & Search & View Toggle */}
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div className="flex overflow-x-auto pb-2 sm:pb-0 gap-2 scrollbar-hide select-none w-full sm:w-auto">
                    <button
                      onClick={() => setCategoryFilter('all')}
                      className={cn(
                        "whitespace-nowrap px-4 py-2 rounded-xl text-sm font-bold transition-all cursor-pointer",
                        categoryFilter === 'all' 
                          ? "bg-brand text-white shadow-md shadow-brand/10" 
                          : "bg-surface text-content-muted border border-border hover:bg-surface-muted"
                      )}
                    >
                      {t('procurement.category_all', 'الكل')}
                    </button>
                    {[
                      { id: 'fabric', label: t('procurement.category_fabric', 'أقمشة') },
                      { id: 'thread', label: t('procurement.category_thread', 'خيوط') },
                      { id: 'button', label: t('procurement.category_button', 'أزرار') },
                      { id: 'other', label: t('procurement.category_other', 'أخرى') }
                    ].map((cat) => (
                      <button
                        key={cat.id}
                        onClick={() => setCategoryFilter(cat.id)}
                        className={cn(
                          "whitespace-nowrap px-4 py-2 rounded-xl text-sm font-bold transition-all cursor-pointer",
                          categoryFilter === cat.id 
                            ? "bg-brand text-white shadow-md shadow-brand/10" 
                            : "bg-surface text-content-muted border border-border hover:bg-surface-muted"
                        )}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2.5 bg-surface-muted/50 hover:bg-surface-muted/80 border border-border focus-within:border-brand/40 focus-within:bg-surface rounded-2xl px-4 h-12 transition-all w-full shadow-inner shadow-black/5">
                  <Search className="text-content-muted shrink-0" size={18} />
                  <input 
                    type="text"
                    placeholder={t('procurement.search_placeholder', 'بحث عن مورد بسجل المحاسبة...')}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full bg-transparent font-bold outline-none text-content border-none p-0 focus:ring-0 text-sm"
                  />
                </div>
              </div>

              {/* Accounts Datatable and Ledger Master */}
              <div className="mt-6">
                <SuppliersRegistry
                  suppliers={filteredSuppliers}
                  tenantId={tenantId}
                  searchTerm={searchTerm}
                  onSelectLedger={(s) => setSelectedLedgerSupplier(s)}
                  onOpenPayout={(s) => setPayoutSupplier(s)}
                  onEdit={(supplier) => {
                    setEditingSupplier(supplier);
                    reset({
                      name: supplier.name,
                      contactPerson: supplier.contactPerson,
                      email: supplier.email,
                      phone: supplier.phone,
                      address: supplier.address,
                      taxNumber: supplier.taxNumber,
                      category: supplier.category as any
                    });
                    setIsModalOpen(true);
                  }}
                  onDelete={handleDelete}
                />
              </div>

              {/* Extra Modal/Popup fallback if user wants supplier contact details */}
              {filteredSuppliers.length === 0 && !loading && (
                <div className="p-12 text-center text-content-muted bg-surface rounded-2xl border border-dashed border-border">
                  <Users className="mx-auto mb-4 opacity-20" size={48} />
                  <p>{t('procurement.no_suppliers_registered', 'لا يوجد موردين مسجلين حالياً لقيد الحساب')}</p>
                </div>
              )}
            </>
          )}
        </>
      )}

      {activeTab === 'purchase_orders' && (
        <PurchaseOrders 
          tenantId={tenantId}
          suppliers={suppliers}
          purchaseOrders={purchaseOrders}
          inventory={inventory}
          defaultTypeFilter="purchase"
          onRefresh={() => setSupplierReloadTrigger(prev => prev + 1)}
        />
      )}

      {activeTab === 'returns' && (
        <PurchaseOrders 
          tenantId={tenantId}
          suppliers={suppliers}
          purchaseOrders={purchaseOrders}
          inventory={inventory}
          defaultTypeFilter="return"
          onRefresh={() => setSupplierReloadTrigger(prev => prev + 1)}
        />
      )}

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-surface rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-border"
          >
            <div className="p-6 border-b border-border flex justify-between items-center bg-surface-muted">
              <h2 className="text-xl font-bold text-content">
                {editingSupplier ? t('procurement.edit_supplier', 'تعديل مورد') : t('procurement.add_supplier_new', 'إضافة مورد جديد')}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-content-muted hover:text-content">
                <Plus className="rotate-45" size={24} />
              </button>
            </div>
            <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-content-muted mb-1">{t('procurement.company_name', 'اسم الشركة/المورد')}</label>
                <div className={cn(
                  "flex items-center gap-2.5 px-3.5 py-2.5 bg-surface-muted border border-border rounded-xl focus-within:ring-2 focus-within:ring-brand focus-within:border-transparent transition-all",
                  errors.name && "border-red-500"
                )}>
                  <Building size={18} className="text-content-muted shrink-0" />
                  <input 
                    {...register('name')}
                    placeholder={t('procurement.company_name', 'اسم الشركة/المورد')}
                    className="w-full bg-transparent border-none p-0 outline-none text-content focus:ring-0 text-sm font-medium"
                  />
                </div>
                {errors.name && <p className="text-xs text-red-500 font-bold mt-1">{errors.name.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-content-muted mb-1">{t('procurement.contact_person', 'الشخص المسؤول')}</label>
                <div className={cn(
                  "flex items-center gap-2.5 px-3.5 py-2.5 bg-surface-muted border border-border rounded-xl focus-within:ring-2 focus-within:ring-brand focus-within:border-transparent transition-all",
                  errors.contactPerson && "border-red-500"
                )}>
                  <User size={18} className="text-content-muted shrink-0" />
                  <input 
                    {...register('contactPerson')}
                    placeholder={t('procurement.contact_person', 'الشخص المسؤول')}
                    className="w-full bg-transparent border-none p-0 outline-none text-content focus:ring-0 text-sm font-medium"
                  />
                </div>
                {errors.contactPerson && <p className="text-xs text-red-500 font-bold mt-1">{errors.contactPerson.message}</p>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-content-muted mb-1">{t('procurement.email', 'البريد الإلكتروني')}</label>
                  <div className={cn(
                    "flex items-center gap-2.5 px-3.5 py-2.5 bg-surface-muted border border-border rounded-xl focus-within:ring-2 focus-within:ring-brand focus-within:border-transparent transition-all",
                    errors.email && "border-red-500"
                  )}>
                    <Mail size={18} className="text-content-muted shrink-0" />
                    <input 
                      type="email"
                      {...register('email')}
                      placeholder={t('procurement.email', 'البريد الإلكتروني')}
                      className="w-full bg-transparent border-none p-0 outline-none text-content focus:ring-0 text-sm font-medium"
                    />
                  </div>
                  {errors.email && <p className="text-xs text-red-500 font-bold mt-1">{errors.email.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-content-muted mb-1">{t('procurement.phone', 'رقم الهاتف')}</label>
                  <div className={cn(
                    "flex items-center gap-2.5 px-3.5 py-2.5 bg-surface-muted border border-border rounded-xl focus-within:ring-2 focus-within:ring-brand focus-within:border-transparent transition-all",
                    errors.phone && "border-red-500"
                  )}>
                    <Phone size={18} className="text-content-muted shrink-0" />
                    <input 
                      type="tel"
                      {...register('phone')}
                      placeholder={t('procurement.phone', 'رقم الهاتف')}
                      className="w-full bg-transparent border-none p-0 outline-none text-content focus:ring-0 text-sm font-medium"
                    />
                  </div>
                  {errors.phone && <p className="text-xs text-red-500 font-bold mt-1">{errors.phone.message}</p>}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-content-muted mb-1">{t('procurement.tax_number', 'الرقم الضريبي (اختياري)')}</label>
                  <div className={cn(
                    "flex items-center gap-2.5 px-3.5 py-2.5 bg-surface-muted border border-border rounded-xl focus-within:ring-2 focus-within:ring-brand focus-within:border-transparent transition-all",
                    errors.taxNumber && "border-red-500"
                  )}>
                    <FileText size={18} className="text-content-muted shrink-0" />
                    <input 
                      {...register('taxNumber')}
                      placeholder={t('procurement.tax_number', 'الرقم الضريبي')}
                      className="w-full bg-transparent border-none p-0 outline-none text-content focus:ring-0 text-sm font-medium"
                    />
                  </div>
                  {errors.taxNumber && <p className="text-xs text-red-500 font-bold mt-1">{errors.taxNumber.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-content-muted mb-1">{t('procurement.category', 'التصنيف')}</label>
                  <Controller
                    control={control}
                    name="category"
                    render={({ field }) => (
                      <SmartSelect
                        {...field}
                        className={cn("w-full", errors.category && "ring-2 ring-red-500")}
                        options={[
                          { value: 'fabric', label: t('procurement.category_fabric', 'أقمشة') },
                          { value: 'accessories', label: t('procurement.category_accessories', 'إكسسوارات') },
                          { value: 'thread', label: t('procurement.category_thread', 'خيوط') },
                          { value: 'button', label: t('procurement.category_button', 'أزرار') },
                          { value: 'lining', label: t('procurement.category_lining', 'بطانات') },
                          { value: 'other', label: t('procurement.category_other', 'أخرى') }
                        ]}
                      />
                    )}
                  />
                  {errors.category && <p className="text-xs text-red-500 font-bold mt-1">{errors.category.message}</p>}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-content-muted mb-1">{t('procurement.address', 'العنوان (اختياري)')}</label>
                <div className={cn(
                  "flex items-start gap-2.5 px-3.5 py-2.5 bg-surface-muted border border-border rounded-xl focus-within:ring-2 focus-within:ring-brand focus-within:border-transparent transition-all",
                  errors.address && "border-red-500"
                )}>
                  <MapPin size={18} className="text-content-muted shrink-0 mt-0.5" />
                  <textarea 
                    {...register('address')}
                    placeholder={t('procurement.address_placeholder', 'العنوان (اختياري)')}
                    className="w-full bg-transparent border-none p-0 outline-none h-20 resize-none text-content focus:ring-0 text-sm font-medium"
                  />
                </div>
                {errors.address && <p className="text-xs text-red-500 font-bold mt-1">{errors.address.message}</p>}
              </div>
              <button 
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-brand text-white py-3 rounded-xl font-bold hover:bg-brand/90 transition-colors mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? t('procurement.saving_loading', 'جاري الحفظ...') : (editingSupplier ? t('procurement.save_changes', 'حفظ التعديلات') : t('procurement.add_supplier', 'إضافة مورد'))}
              </button>
            </form>
          </motion.div>
        </div>
      )}

      {/* Detailed View Modal */}
      {selectedSupplierDetails && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-surface rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden border border-border flex flex-col"
          >
            {/* Header */}
            <div className="p-6 border-b border-border flex justify-between items-center bg-surface-muted/50">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-brand/10 text-brand rounded-2xl">
                  <Users size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-black text-content">{selectedSupplierDetails.name}</h2>
                  <p className="text-xs font-bold text-content-muted">{t('procurement.supplier_details_subtitle', 'تفاصيل المورد، المستحقات المالية، والمنتجات المطلوبة')}</p>
                </div>
              </div>
              <button 
                onClick={() => setSelectedSupplierDetails(null)} 
                className="p-2 text-content-muted hover:text-content hover:bg-surface-muted rounded-xl transition-all"
              >
                <Plus className="rotate-45" size={24} />
              </button>
            </div>

            {/* Content (Scrollable) */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-right" dir="rtl">
              
              {/* Top Stats Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Balance & Due Amounts */}
                {(() => {
                  const items = inventory.filter(p => p.supplierId === selectedSupplierDetails.id || (p as any).supplier_id === selectedSupplierDetails.id);
                  const linkedProductsTotal = items.reduce((sum, p) => {
                    const meta = decodeInventoryDescription(p.description);
                    return sum + (Number(meta.costPrice || 0) * Number(p.quantity || 0));
                  }, 0);
                  const baseBalance = Number(selectedSupplierDetails.balance || 0);
                  const totalDue = baseBalance + linkedProductsTotal;

                  return (
                    <>
                      <div className="bg-surface-muted/30 p-5 rounded-2xl border border-border flex flex-col justify-between">
                        <span className="text-xs font-bold text-content-muted">{t('procurement.direct_products_dues', 'مستحقات المنتجات المباشرة (بالمخازن)')}</span>
                        <div className="mt-2 flex items-baseline justify-between">
                          <span className="text-2xl font-black text-content">
                            <PriceDisplay amount={linkedProductsTotal} />
                          </span>
                          <span className="text-xs font-semibold text-content-muted">({items.length} {t('procurement.item', 'صنف')})</span>
                        </div>
                        <p className="text-[10px] text-content-muted mt-2">{t('procurement.calculated_from_cost', 'محسوبة من: (سعر التكلفة × الكمية المتوفرة) للمنتجات المرتبطة بالمستودع')}</p>
                      </div>

                      <div className="bg-surface-muted/30 p-5 rounded-2xl border border-border flex flex-col justify-between">
                        <span className="text-xs font-bold text-content-muted">{t('procurement.recorded_po_debts', 'ديون أوامر الشراء المسجلة')}</span>
                        <div className="mt-2">
                          <span className="text-2xl font-black text-content">
                            <PriceDisplay amount={baseBalance} />
                          </span>
                        </div>
                        <p className="text-[10px] text-content-muted mt-2">{t('procurement.unpaid_po_amounts', 'المبالغ غير المدفوعة من فواتير وأوامر الشراء المعتمدة')}</p>
                      </div>

                      <div className="bg-brand/5 p-5 rounded-2xl border border-brand/20 flex flex-col justify-between">
                        <span className="text-xs font-bold text-brand">{t('procurement.total_dues_and_liabilities', 'إجمالي الذمم والمستحقات الكلية')}</span>
                        <div className="mt-2">
                          <span className="text-3xl font-black text-brand">
                            <PriceDisplay amount={totalDue} />
                          </span>
                        </div>
                        <p className="text-[10px] text-brand/80 mt-2">{t('procurement.total_direct_dues_and_po', 'مجموع مستحقات المخازن المباشرة وفواتير أوامر الشراء')}</p>
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Information & Contacts */}
              <div className="bg-surface-muted/30 rounded-2xl p-4 border border-border grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <span className="text-[10px] font-black text-content-muted block uppercase">{t('procurement.contact_person', 'الشخص المسؤول')}</span>
                  <span className="text-sm font-bold text-content mt-1 block">{selectedSupplierDetails.contactPerson || '—'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-black text-content-muted block uppercase">{t('procurement.phone', 'الهاتف')}</span>
                  <a href={`tel:${selectedSupplierDetails.phone}`} className="text-sm font-bold text-brand hover:underline mt-1 block">{selectedSupplierDetails.phone || '—'}</a>
                </div>
                <div>
                  <span className="text-[10px] font-black text-content-muted block uppercase">{t('procurement.email', 'البريد الإلكتروني')}</span>
                  <a href={`mailto:${selectedSupplierDetails.email}`} className="text-sm font-bold text-brand hover:underline truncate mt-1 block">{selectedSupplierDetails.email || '—'}</a>
                </div>
                <div>
                  <span className="text-[10px] font-black text-content-muted block uppercase">{t('procurement.address_and_location', 'العنوان والموقع')}</span>
                  <span className="text-sm font-bold text-content truncate mt-1 block">{selectedSupplierDetails.address || '—'}</span>
                </div>
              </div>

              {/* Mapped Goods in Inventory */}
              <div>
                <h3 className="text-md font-black text-content mb-3 flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-brand rounded-full inline-block" />
                  <span>{t('procurement.products_linked_to_supplier', 'المنتجات المرتبطة بالمورد في المخزون')}</span>
                  <span className="text-xs font-bold text-content-muted">({inventory.filter(p => p.supplierId === selectedSupplierDetails.id || (p as any).supplier_id === selectedSupplierDetails.id).length} {t('procurement.product', 'منتج')})</span>
                </h3>
                
                {(() => {
                  const linkedItems = inventory.filter(p => p.supplierId === selectedSupplierDetails.id || (p as any).supplier_id === selectedSupplierDetails.id);
                  if (linkedItems.length === 0) {
                    return (
                      <div className="p-8 text-center text-content-muted bg-surface-muted/20 rounded-2xl border border-dashed border-border text-sm">
                        {t('procurement.no_linked_products', 'لا يوجد منتجات مرتبطة بهذا المورد مباشرة في كتالوج المخزون المفتوح.')}
                      </div>
                    );
                  }

                  return (
                    <div className="border border-border rounded-2xl overflow-x-auto bg-surface scrollbar-hide">
                      <table className="w-full text-right border-collapse min-w-max">
                        <thead>
                          <tr className="bg-surface-muted/50 border-b border-border text-xs font-black text-content-muted">
                            <th className="p-4 text-right">{t('procurement.product_name', 'اسم المنتج')}</th>
                            <th className="p-4 text-right">{t('procurement.sku_code', 'رمز الصنف (SKU)')}</th>
                            <th className="p-4 text-right">{t('procurement.available_quantity', 'الكمية المتوفرة')}</th>
                            <th className="p-4 text-right">{t('procurement.cost_price', 'سعر التكلفة')}</th>
                            <th className="p-4 text-right">{t('procurement.total_value', 'القيمة الإجمالية')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border text-sm">
                          {linkedItems.map((item) => {
                            const meta = decodeInventoryDescription(item.description);
                            const stockValue = Number(meta.costPrice || 0) * Number(item.quantity || 0);

                            return (
                              <tr key={item.id} className="hover:bg-surface-muted/30 transition-colors">
                                <td className="p-4 font-bold text-content">{item.name}</td>
                                <td className="p-4 font-mono text-xs text-content-muted">{item.sku}</td>
                                <td className="p-4 font-bold text-content">
                                  {Number(item.quantity).toLocaleString('en-US')} {item.unit}
                                </td>
                                <td className="p-4 font-bold text-content">
                                  <PriceDisplay amount={Number(meta.costPrice || 0)} />
                                </td>
                                <td className="p-4 font-black text-brand">
                                  <PriceDisplay amount={stockValue} />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>

              {/* Items Ordered via Purchase Orders */}
              <div>
                <h3 className="text-md font-black text-content mb-3 flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-info rounded-full inline-block" />
                  <span>{t('procurement.products_and_orders_via_po', 'المنتجات والطلبيات عبر أوامر الشراء العامة')}</span>
                  <span className="text-xs font-bold text-content-muted">({purchaseOrders.filter(po => po.supplierId === selectedSupplierDetails.id).length} {t('procurement.purchase_order_count', 'أمر شراء')})</span>
                </h3>

                {(() => {
                  const supplierPOs = purchaseOrders.filter(po => po.supplierId === selectedSupplierDetails.id);
                  if (supplierPOs.length === 0) {
                    return (
                      <div className="p-8 text-center text-content-muted bg-surface-muted/20 rounded-2xl border border-dashed border-border text-sm">
                        {t('procurement.no_po_for_supplier', 'لم يتم إنشاء أي أوامر شراء بعد لهذا المورد.')}
                      </div>
                    );
                  }

                  // Gather all unique items ordered in these POs
                  const orderedItemsMap: { [key: string]: { name: string, totalQty: number, avgPrice: number, totalAmount: number, unit: string } } = {};
                  supplierPOs.forEach(po => {
                    (po.items || []).forEach((it: any) => {
                      const name = it.name || t('procurement.unknown_product', 'منتج غير معروف');
                      const qty = Number(it.quantity || 0);
                      const total = Number(it.total || 0);
                      if (!orderedItemsMap[name]) {
                        orderedItemsMap[name] = { name, totalQty: 0, avgPrice: 0, totalAmount: 0, unit: it.unit || '' };
                      }
                      orderedItemsMap[name].totalQty += qty;
                      orderedItemsMap[name].totalAmount += total;
                    });
                  });

                  Object.keys(orderedItemsMap).forEach(key => {
                    const item = orderedItemsMap[key];
                    item.avgPrice = item.totalQty > 0 ? (item.totalAmount / item.totalQty) : 0;
                  });

                  const orderedItemsArray = Object.values(orderedItemsMap);

                  return (
                    <div className="space-y-4">
                      {/* Sub-section: Items ordered summary */}
                      <div className="border border-border rounded-2xl overflow-x-auto bg-surface scrollbar-hide">
                        <div className="p-4 bg-surface-muted/40 font-bold text-sm text-content border-b border-border">{t('procurement.total_supplied_requested_quantities', 'إجمالي الكميات والأنواع التي تم توريدها/طلبها')}</div>
                        {orderedItemsArray.length === 0 ? (
                          <div className="p-4 text-center text-xs text-content-muted">{t('procurement.no_detailed_items_in_po', 'لا توجد بنود تفصيلية في سجلات أوامر الشراء.')}</div>
                        ) : (
                          <table className="w-full text-right border-collapse min-w-max">
                            <thead>
                              <tr className="bg-surface-muted/20 border-b border-border text-xs font-black text-content-muted">
                                <th className="p-4 text-right">{t('procurement.requested_product_name', 'اسم المنتج المطلـوب')}</th>
                                <th className="p-4 text-right">{t('procurement.total_requested_quantities', 'إجمالي الكميات المطلوبة')}</th>
                                <th className="p-4 text-right">{t('procurement.average_supply_price', 'متوسط سعر التوريد')}</th>
                                <th className="p-4 text-right">{t('procurement.total_requested_amount', 'إجمالي المبلغ المطلوب')}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border text-sm">
                              {orderedItemsArray.map((it, idx) => (
                                <tr key={idx} className="hover:bg-surface-muted/10 transition-colors">
                                  <td className="p-4 font-bold text-content">{it.name}</td>
                                  <td className="p-4 text-content font-semibold">{it.totalQty.toLocaleString('en-US')} {it.unit}</td>
                                  <td className="p-4 text-content-muted"><PriceDisplay amount={it.avgPrice} /></td>
                                  <td className="p-4 font-bold text-content"><PriceDisplay amount={it.totalAmount} /></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>

                      {/* Sub-section: Orders list */}
                      <div className="border border-border rounded-2xl overflow-hidden bg-surface">
                        <div className="p-4 bg-surface-muted/40 font-bold text-sm text-content border-b border-border">{t('procurement.detailed_po_record', 'سجل أوامر الشراء المفصل')}</div>
                        <div className="divide-y divide-border max-h-60 overflow-y-auto">
                          {supplierPOs.map((po) => (
                            <div key={po.id} className="p-4 flex items-center justify-between text-sm hover:bg-surface-muted/20 transition-colors">
                              <div>
                                <div className="font-bold text-content flex items-center gap-2">
                                  <span>{t('procurement.po_number_prefix', 'أمر شراء رقم:')} {po.poNumber}</span>
                                  <span className={cn(
                                    "text-[10px] font-black px-2 py-0.5 rounded-full",
                                    (po.status === 'confirmed' || po.status === 'received' || po.status === 'returned') ? "bg-success/10 text-success" :
                                    po.status === 'draft' ? "bg-surface-muted text-content-muted" : "bg-warning/10 text-warning"
                                  )}>
                                    {(po.status === 'confirmed' || po.status === 'received' || po.status === 'returned') ? t('procurement.status_approved_received', 'معتمد ومستلم') : po.status === 'draft' ? t('procurement.status_draft', 'مسودة') : t('procurement.status_pending', 'معلق')}
                                  </span>
                                </div>
                                <div className="text-xs text-content-muted mt-1">{t('procurement.order_date_prefix', 'تاريخ الطلب:')} {new Date(po.orderDate).toLocaleDateString('ar-EG-u-nu-latn')}</div>
                              </div>
                              <div className="text-left">
                                <div className="font-extrabold text-content"><PriceDisplay amount={po.totalAmount} /></div>
                                <div className="text-xs text-content-muted">{t('procurement.remaining_amount_prefix', 'المتبقي:')} <PriceDisplay amount={po.remainingAmount || 0} /></div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>

            </div>

            {/* Footer */}
            <div className="p-6 border-t border-border bg-surface-muted/50 text-left flex justify-end gap-3">
              <button 
                onClick={() => setSelectedSupplierDetails(null)}
                className="px-6 py-2.5 bg-surface border border-border rounded-2xl font-bold text-sm text-content hover:bg-surface-muted transition-all"
              >
                {t('procurement.close_window', 'إغلاق النافذة')}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Payment Voucher Modal Overlay */}
      {payoutSupplier && (
        <PaymentVoucherModal
          supplier={{
            id: payoutSupplier.id,
            name: payoutSupplier.name,
            phone: payoutSupplier.phone,
            balance: payoutSupplier.balance,
            taxNumber: payoutSupplier.taxNumber
          }}
          tenantId={tenantId}
          tenantName={tenantName}
          onClose={() => setPayoutSupplier(null)}
          onSuccess={() => {
            setPayoutSupplier(null);
            setSupplierReloadTrigger((prev) => prev + 1);
          }}
        />
      )}
    </div>
  );
}
