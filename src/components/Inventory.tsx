import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Package, 
  Plus, 
  Search, 
  AlertTriangle, 
  Trash2, 
  Edit2, 
  ArrowUpRight, 
  ArrowDownLeft,
  Filter,
  History,
  CheckCircle,
  XCircle,
  Truck,
  ChevronDown,
  ChevronUp,
  RefreshCcw,
  Phone,
  MapPin,
  Zap,
  FileSpreadsheet,
  Image as ImageIcon,
  Loader2
} from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { auth, handleError, OperationType } from '../lib/firebase';
import { InventoryItem, Supplier, InventoryReconciliation, Staff } from '../types';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { inventorySchema, supplierSchema, reconciliationSchema } from '../lib/validations';
import { logEmployeeAction } from '../services/employeeAuditService';
import { cn } from '../lib/utils';
import Branding from './Branding';
import { PriceDisplay } from './PriceDisplay';
import * as XLSX from 'xlsx';
import Header from './Header';
import ProductImageUploader from './Inventory/ProductImageUploader';
import { useStaff } from '../contexts/StaffContext';
import { usePermissions } from '../hooks/usePermissions';
import { analytics, AnalyticsEvent } from '../services/analyticsService';
import { useTranslation } from 'react-i18next';

import { useSearchParams } from 'react-router-dom';

export default function Inventory({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [reconciliations, setReconciliations] = useState<InventoryReconciliation[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>(searchParams.get('filter') === 'low_stock' ? 'low_stock' : 'all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isReconcileModalOpen, setIsReconcileModalOpen] = useState(false);
  const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [selectedItemForReconcile, setSelectedItemForReconcile] = useState<InventoryItem | null>(null);
  const [activeTab, setActiveTab] = useState<'inventory' | 'reconciliation' | 'suppliers'>('inventory');
  const [productImage, setProductImage] = useState<string | null>(null);
  const { currentStaff } = useStaff();
  const { hasPermission } = usePermissions(currentStaff);

  const canCreate = hasPermission('inventory.create');
  const canEdit = hasPermission('inventory.edit');
  const canDelete = hasPermission('inventory.delete');
  const canReconcile = hasPermission('inventory.reconcile');
  const canManageSuppliers = hasPermission('suppliers.manage');

  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(inventorySchema),
    defaultValues: {
      name: '',
      nameEn: '',
      type: 'fabric' as const,
      quantity: 0,
      unit: 'meter' as const,
      baseUnit: 'meter' as const,
      conversionRate: 1,
      minThreshold: 5,
      pricePerUnit: 0,
      taxType: 'exclusive' as const,
      supplierId: '',
      sku: '',
      barcode: '',
      isTest: false,
      mainImage: '',
      showInPos: true
    }
  });

  const watchType = watch('type');
  const watchPrice = watch('pricePerUnit');
  const watchTaxType = watch('taxType');

  const { 
    register: registerSupplier, 
    handleSubmit: handleSubmitSupplier, 
    reset: resetSupplier, 
    formState: { errors: supplierErrors, isSubmitting: isSubmittingSupplier } 
  } = useForm({
    resolver: zodResolver(supplierSchema),
    defaultValues: {
      name: '',
      contactPerson: '',
      email: '',
      phone: '',
      address: '',
      category: 'fabric' as const,
      isTest: false
    }
  });

  const {
    register: registerReconcile,
    handleSubmit: handleSubmitReconcile,
    reset: resetReconcile,
    formState: { errors: reconcileErrors, isSubmitting: isSubmittingReconcile }
  } = useForm({
    resolver: zodResolver(reconciliationSchema),
    defaultValues: {
      actualQuantity: 0,
      reason: '' as any,
      staffId: ''
    }
  });

  useEffect(() => {
    if (!tenantId) return;

    const fetchItems = async () => {
      const { data, error } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('tenant_id', tenantId);
      if (data && !error) {
        setItems(data.map(d => ({
          id: d.id,
          name: d.name,
          nameEn: d.name_en,
          category: d.category,
          unit: d.unit,
          baseUnit: d.base_unit,
          conversionRate: d.conversion_rate,
          minThreshold: d.min_threshold,
          pricePerUnit: d.price_per_unit,
          taxType: 'exclusive',
          supplierId: d.supplier_id,
          mainImage: (Array.isArray(d.images) && d.images.length > 0) ? (d.images[0]?.url || d.images[0]) : undefined,
          quantity: d.quantity,
          sku: d.sku,
          isTest: d.is_test,
          showInPos: d.show_in_pos !== false,
          updatedAt: d.updated_at
        } as unknown as InventoryItem)));
      }
      setLoading(false);
    };

    const fetchSuppliers = async () => {
      const { data, error } = await supabase
        .from('suppliers')
        .select('*')
        .eq('tenant_id', tenantId);
      if (data && !error) {
        setSuppliers(data.map(d => ({
          id: d.id,
          name: d.name,
          contactPerson: d.contact_person,
          email: d.email,
          phone: d.phone,
          address: d.address,
          category: d.category,
          taxNumber: d.tax_number,
          balance: d.balance,
          isTest: d.is_test
        } as unknown as Supplier)));
      }
    };

    const fetchStaff = async () => {
      const [{ data: staffData, error }, { data: rolesData }] = await Promise.all([
        supabase
          .from('staff')
          .select('*')
          .eq('tenant_id', tenantId),
        supabase
          .from('roles')
          .select('*')
          .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
      ]);
      if (staffData && !error) {
        const rolesMap = new Map(rolesData?.map(r => [r.id, r.role_key]) || []);
        setStaff(staffData.map(d => {
          const actualRole = d.role_id ? (rolesMap.get(d.role_id) || d.role) : d.role;
          return {
            ...d,
            role: actualRole,
            tenantId: d.tenant_id,
            branchId: d.branch_id,
            roleId: d.role_id,
            pin: d.pin_hash,
            mustChangePin: d.must_change_pin,
            isTest: d.is_test,
            createdAt: d.created_at,
            updatedAt: d.updated_at
          } as unknown as Staff;
        }));
      }
    };

    const fetchReconciliations = async () => {
      const { data, error } = await supabase
        .from('inventory_reconciliations')
        .select('*')
        .eq('tenant_id', tenantId);
      if (data && !error) {
        setReconciliations(data.map(d => ({
          id: d.id,
          itemId: d.item_id,
          itemName: d.item_name,
          previousQuantity: d.previous_quantity,
          actualQuantity: d.actual_quantity,
          difference: d.difference,
          reason: d.reason,
          staffId: d.staff_id,
          staffName: d.staff_name,
          createdAt: d.created_at
        } as unknown as InventoryReconciliation)));
      }
    };

    fetchItems();
    fetchSuppliers();
    fetchStaff();
    fetchReconciliations();

    const itemsSub = supabase.channel('inventory_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_items', filter: `tenant_id=eq.${tenantId}` }, fetchItems)
      .subscribe();

    const suppliersSub = supabase.channel('suppliers_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'suppliers', filter: `tenant_id=eq.${tenantId}` }, fetchSuppliers)
      .subscribe();

    const staffSub = supabase.channel('staff_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff', filter: `tenant_id=eq.${tenantId}` }, fetchStaff)
      .subscribe();

    const reconSub = supabase.channel('recon_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_reconciliations', filter: `tenant_id=eq.${tenantId}` }, fetchReconciliations)
      .subscribe();

    return () => {
      supabase.removeChannel(itemsSub);
      supabase.removeChannel(suppliersSub);
      supabase.removeChannel(staffSub);
      supabase.removeChannel(reconSub);
    };
  }, [tenantId]);

  // Track Low Stock Alerts
  useEffect(() => {
    if (items.length === 0) return;
    
    items.forEach(item => {
      if (item.quantity <= item.minThreshold) {
        // We use a simple local storage check to avoid spamming the same alert
        const alertKey = `low_stock_alert_${item.id}_${item.quantity}`;
        if (!localStorage.getItem(alertKey)) {
          analytics.track(AnalyticsEvent.LOW_STOCK_ALERT, {
            item_id: item.id,
            item_name: item.name,
            current_quantity: item.quantity,
            min_threshold: item.minThreshold,
            category: item.category
          });
          localStorage.setItem(alertKey, 'true');
        }
      }
    });
  }, [items]);

  const onSubmit = async (formData: any) => {
    try {
      const data = {
        name: formData.name,
        name_en: formData.nameEn,
        category: formData.type,
        quantity: formData.quantity,
        unit: formData.unit,
        conversion_rate: formData.conversionRate,
        min_threshold: formData.minThreshold,
        price_per_unit: formData.pricePerUnit,
        supplier_id: formData.supplierId,
        images: formData.mainImage ? [{ url: formData.mainImage }] : undefined,
        sku: formData.sku ? formData.sku.replace(/\D/g, '') : Math.floor(10000000 + Math.random() * 90000000).toString(),
        is_test: formData.isTest,
        show_in_pos: formData.showInPos !== false,
        updated_at: new Date().toISOString()
      };

      if (editingItem) {
        const { error } = await supabase
          .from('inventory_items')
          .update(data)
          .eq('id', editingItem.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('inventory_items')
          .insert({
            ...data,
            tenant_id: tenantId,
            created_at: new Date().toISOString()
          });
        if (error) throw error;
      }
      setIsModalOpen(false);
      setEditingItem(null);
      reset();
    } catch (error) {
      handleError(error as any, OperationType.WRITE, 'inventory');
    }
  };

  const onSupplierSubmit = async (formData: any) => {
    try {
      const data = {
        name: formData.name,
        contact_person: formData.contactPerson,
        email: formData.email,
        phone: formData.phone,
        address: formData.address,
        category: formData.category,
        is_test: formData.isTest,
        updated_at: new Date().toISOString()
      };

      if (editingSupplier) {
        const { error } = await supabase
          .from('suppliers')
          .update(data)
          .eq('id', editingSupplier.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('suppliers')
          .insert({
            ...data,
            balance: 0,
            tenant_id: tenantId,
            created_at: new Date().toISOString()
          });
        if (error) throw error;
      }
      setIsSupplierModalOpen(false);
      setEditingSupplier(null);
      resetSupplier();
    } catch (error) {
      handleError(error as any, OperationType.WRITE, 'suppliers');
    }
  };

  const onReconcileSubmit = async (formData: any) => {
    if (!selectedItemForReconcile) return;

    try {
      const diff = formData.actualQuantity - selectedItemForReconcile.quantity;
      const staffMember = staff.find(s => s.id === formData.staffId);

      const { error: reconError } = await supabase
        .from('inventory_reconciliations')
        .insert({
          tenant_id: tenantId,
          item_id: selectedItemForReconcile.id,
          item_name: selectedItemForReconcile.name,
          previous_quantity: selectedItemForReconcile.quantity,
          actual_quantity: formData.actualQuantity,
          difference: diff,
          reason: formData.reason,
          staff_id: formData.staffId,
          staff_name: staffMember?.name || 'Unknown',
          created_at: new Date().toISOString()
        });
      
      if (reconError) throw reconError;

      const { error: updateError } = await supabase
        .from('inventory_items')
        .update({
          quantity: formData.actualQuantity,
          updated_at: new Date().toISOString()
        })
        .eq('id', selectedItemForReconcile.id);
      
      if (updateError) throw updateError;

      // Audit Log
      if (staffMember) {
        await logEmployeeAction(
          tenantId,
          staffMember.id,
          staffMember.name,
          'adjust_inventory',
          `تسوية مخزون للمنتج ${selectedItemForReconcile.name} من ${selectedItemForReconcile.quantity} إلى ${formData.actualQuantity}`
        );
      }

      setIsReconcileModalOpen(false);
      setSelectedItemForReconcile(null);
      resetReconcile();
    } catch (error) {
      handleError(error as any, OperationType.WRITE, 'inventory_reconciliations');
    }
  };

  const handleExport = () => {
    const exportData = items.map(item => ({
      [t('common.name')]: item.name,
      [t('inventory.category')]: item.category === 'fabric' ? t('inventory.fabric') : 
               item.category === 'thread' ? t('inventory.thread') : 
               item.category === 'button' ? t('inventory.button') : 
               item.category === 'lining' ? t('inventory.lining') : t('common.other'),
      [t('inventory.quantity')]: item.quantity,
      [t('inventory.unit')]: item.unit === 'meter' ? t('inventory.units.meter') : item.unit === 'piece' ? t('inventory.units.piece') : item.unit === 'roll' ? t('inventory.units.roll') : item.unit,
      [t('inventory.min_threshold')]: item.minThreshold,
      [t('inventory.price_per_unit')]: item.pricePerUnit,
      [t('common.total')]: item.quantity * item.pricePerUnit
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const csv = XLSX.utils.sheet_to_csv(worksheet);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `Inventory_${new Date().toLocaleDateString('en-US')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('inventory.delete_confirm', 'هل أنت متأكد من حذف هذا الصنف؟'))) return;
    try {
      // Delete referencing stock_ledger rows first
      await supabase
        .from('stock_ledger')
        .delete()
        .eq('item_id', id)
        .eq('tenant_id', tenantId);

      // Delete referencing stock_transfer_items rows
      await supabase
        .from('stock_transfer_items')
        .delete()
        .eq('item_id', id)
        .eq('tenant_id', tenantId);

      // Delete referencing inventory_reconciliations rows
      await supabase
        .from('inventory_reconciliations')
        .delete()
        .eq('item_id', id)
        .eq('tenant_id', tenantId);

      const { error } = await supabase
        .from('inventory_items')
        .delete()
        .eq('id', id);
      if (error) throw error;
    } catch (error) {
      handleError(error as any, OperationType.DELETE, 'inventory');
    }
  };

  const handleDeleteSupplier = async (id: string) => {
    if (!confirm(t('suppliers.delete_confirm', 'هل أنت متأكد من حذف هذا المورد؟'))) return;
    try {
      const { error } = await supabase
        .from('suppliers')
        .delete()
        .eq('id', id);
      if (error) throw error;
    } catch (error) {
      handleError(error as any, OperationType.DELETE, 'suppliers');
    }
  };

  const filteredItems = items.filter(item => 
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
    (filterCategory === 'all' || 
     (filterCategory === 'low_stock' ? item.quantity <= item.minThreshold : item.category === filterCategory))
  );

  const lowStockItems = items.filter(item => item.quantity <= item.minThreshold);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <Header 
        tenantId={tenantId} 
        title={t('inventory.title')} 
        subtitle={t('inventory.subtitle')}
      >
        <div className="flex gap-2 w-full md:w-auto">
          <div className="flex bg-surface rounded-xl border border-border p-1">
            {[
              { id: 'inventory', label: t('inventory.title'), icon: Package },
              { id: 'suppliers', label: t('suppliers.title'), icon: Truck },
              { id: 'reconciliation', label: t('reconciliation.title'), icon: History }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === tab.id 
                  ? 'bg-brand text-white shadow-sm' 
                  : 'text-content-muted hover:text-brand'
                }`}
              >
                <tab.icon size={18} />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </div>
          <button 
            onClick={handleExport}
            className="p-2 bg-success/10 text-success rounded-xl hover:bg-success/20 transition-colors border border-success/10"
            title={t('common.export')}
          >
            <FileSpreadsheet size={20} />
          </button>
          {canCreate && (
            <button 
              onClick={() => {
                if (activeTab === 'suppliers') {
                  setEditingSupplier(null);
                  setIsSupplierModalOpen(true);
                } else {
                  setEditingItem(null);
                  setIsModalOpen(true);
                }
              }}
              className="bg-brand text-white px-4 py-2 rounded-xl flex items-center justify-center gap-2 hover:bg-brand/90 transition-colors shadow-lg shadow-brand/10"
            >
              <Plus size={20} />
              <span>{activeTab === 'suppliers' ? t('suppliers.add_supplier') : t('inventory.add_item')}</span>
            </button>
          )}
        </div>
      </Header>

      {activeTab === 'inventory' && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="bg-surface p-4 rounded-2xl shadow-sm border border-border flex items-center gap-4">
              <div className="p-3 bg-info/10 text-info rounded-xl">
                <Package size={24} />
              </div>
              <div>
                <p className="text-sm text-content-muted">{t('inventory.total_items')}</p>
                <p className="text-xl font-bold text-content">{items.length.toLocaleString('en-US')}</p>
              </div>
            </div>
            <div className="bg-surface p-4 rounded-2xl shadow-sm border border-border flex items-center gap-4">
              <div className="p-3 bg-warning/10 text-warning rounded-xl">
                <AlertTriangle size={24} />
              </div>
              <div>
                <p className="text-sm text-content-muted">{t('inventory.low_stock_items')}</p>
                <p className="text-xl font-bold text-warning">{lowStockItems.length.toLocaleString('en-US')}</p>
              </div>
            </div>
            <div className="bg-surface p-4 rounded-2xl shadow-sm border border-border flex items-center gap-4 sm:col-span-2 lg:col-span-1">
              <div className="p-3 bg-success/10 text-success rounded-xl">
                <ArrowUpRight size={24} />
              </div>
              <div>
                <p className="text-sm text-content-muted">{t('inventory.estimated_value')}</p>
                <p className="text-xl font-bold text-success">
                  <PriceDisplay amount={items.reduce((acc, item) => acc + (item.quantity * item.pricePerUnit), 0)} />
                </p>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-content-muted" size={20} />
              <input 
                type="text"
                placeholder={t('inventory.search_placeholder', 'بحث عن صنف...')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pr-10 pl-4 py-2 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-brand outline-none text-content placeholder-content-muted"
              />
            </div>
            <div className="flex overflow-x-auto pb-2 lg:pb-0 gap-2 scrollbar-hide">
              {['all', 'low_stock', 'fabric', 'thread', 'button', 'lining', 'other'].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setFilterCategory(cat)}
                  className={`whitespace-nowrap px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                    filterCategory === cat 
                    ? 'bg-brand text-white' 
                    : 'bg-surface text-content-muted border border-border hover:bg-surface-muted'
                  }`}
                >
                  {cat === 'all' ? t('common.all') : 
                   cat === 'low_stock' ? t('inventory.low_stock') :
                   cat === 'fabric' ? t('inventory.fabric') : 
                   cat === 'thread' ? t('inventory.thread') : 
                   cat === 'button' ? t('inventory.button') : 
                   cat === 'lining' ? t('inventory.lining') : t('common.other')}
                </button>
              ))}
            </div>
          </div>

          {/* Inventory Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredItems.map((item) => (
              <motion.div 
                key={item.id}
                layout
                className="bg-surface p-5 rounded-2xl shadow-sm border border-border flex flex-col gap-4"
              >
                <div className="flex justify-between items-start">
                  <div className="flex gap-4">
                    {item.mainImage ? (
                      <img 
                        src={item.mainImage} 
                        alt={item.name} 
                        className="w-16 h-16 rounded-xl object-cover border border-border shadow-sm"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-16 h-16 bg-surface-muted rounded-xl flex items-center justify-center text-content-muted border border-border border-dashed">
                        <ImageIcon size={24} />
                      </div>
                    )}
                    <div>
                      <h3 className="font-bold text-content text-lg flex items-center gap-2">
                        {item.name}
                        {item.isTest && (
                          <span className="text-[10px] bg-danger/10 text-danger px-2 py-0.5 rounded-full font-black uppercase tracking-widest flex items-center gap-1">
                            <Zap size={10} />
                            {t('common.test')}
                          </span>
                        )}
                      </h3>
                      <div className="flex flex-wrap gap-1 mt-1">
                        <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 bg-surface-muted text-content-muted rounded-md border border-border">
                          {item.category === 'fabric' ? t('inventory.fabric') : item.category === 'thread' ? t('inventory.thread') : item.category === 'button' ? t('inventory.button') : item.category === "ready_made" ? 'جاهز' : t('common.other')}
                        </span>
                        {item.taxType === 'inclusive' && <span className="text-[10px] font-black px-2 py-0.5 bg-success/10 text-success rounded-md border border-success/20">شامل الضريبة</span>}
                        {item.taxType === 'exclusive' && <span className="text-[10px] font-black px-2 py-0.5 bg-brand/10 text-brand rounded-md border border-brand/20">غير شامل</span>}
                        {item.taxType === 'exempt' && <span className="text-[10px] font-black px-2 py-0.5 bg-content-muted/10 text-content-muted rounded-md border border-content-muted/20">معفى</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {canReconcile && (
                      <button 
                        onClick={() => {
                          setSelectedItemForReconcile(item);
                          resetReconcile({
                            actualQuantity: item.quantity,
                            reason: '' as any,
                            staffId: currentStaff?.id || ''
                          });
                          setIsReconcileModalOpen(true);
                        }}
                        className="p-2 text-warning hover:bg-warning/10 rounded-lg transition-colors"
                        title="تسوية الكمية"
                      >
                        <RefreshCcw size={18} />
                      </button>
                    )}
                    {canEdit && (
                      <button 
                        onClick={() => {
                          setEditingItem(item);
                          reset({
                            name: item.name,
                            nameEn: item.nameEn || '',
                            type: item.category as any,
                            quantity: item.quantity,
                            unit: item.unit,
                            baseUnit: item.baseUnit || 'meter',
                            conversionRate: item.conversionRate || 1,
                            minThreshold: item.minThreshold,
                            pricePerUnit: item.pricePerUnit,
                            taxType: item.taxType || 'exclusive',
                            supplierId: item.supplierId || '',
                            mainImage: item.mainImage || ''
                          });
                          setIsModalOpen(true);
                        }}
                        className="p-2 text-brand hover:bg-brand/10 rounded-lg transition-colors"
                      >
                        <Edit2 size={18} />
                      </button>
                    )}
                    {canDelete && (
                      <button 
                        onClick={() => handleDelete(item.id)}
                        className="p-2 text-danger hover:bg-danger/10 rounded-lg transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 py-2 border-y border-border">
                  <div>
                    <p className="text-xs text-content-muted mb-1">{t('inventory.quantity')}</p>
                    <p className={`font-bold ${item.quantity <= item.minThreshold ? 'text-danger' : 'text-content'}`}>
                      {item.quantity.toLocaleString('en-US')} {item.unit === 'meter' ? t('inventory.units.meter') : item.unit === 'roll' ? t('inventory.units.roll') : item.unit === 'spool' ? t('inventory.units.spool') : t('inventory.units.piece')}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-content-muted mb-1">{t('inventory.price_per_unit')}</p>
                    <p className="font-bold text-content"><PriceDisplay amount={item.pricePerUnit} /></p>
                  </div>
                </div>

                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2 text-xs text-content-muted">
                    <Truck size={14} />
                    <span>{suppliers.find(s => s.id === item.supplierId)?.name || t('inventory.no_supplier', 'بدون مورد')}</span>
                  </div>
                  {item.quantity <= item.minThreshold && (
                    <div className="flex items-center gap-1 text-xs text-danger font-bold animate-pulse">
                      <AlertTriangle size={14} />
                      <span>{t('inventory.needs_order', 'تحتاج طلب!')}</span>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </>
      )}

      {activeTab === 'suppliers' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {suppliers.map((supplier) => (
            <motion.div 
              key={supplier.id}
              layout
              className="bg-surface p-5 rounded-2xl shadow-sm border border-border space-y-4"
            >
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-brand/10 text-brand rounded-xl">
                    <Truck size={24} />
                  </div>
                  <div>
                    <h3 className="font-bold text-content flex items-center gap-2">
                      {supplier.name}
                      {supplier.isTest && (
                         <span className="text-[10px] bg-danger/10 text-danger px-2 py-0.5 rounded-full font-black uppercase tracking-widest flex items-center gap-1">
                          <Zap size={10} />
                          {t('common.test')}
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-content-muted">{supplier.contactPerson}</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button 
                    onClick={() => {
                      setEditingSupplier(supplier);
                      resetSupplier({
                        name: supplier.name,
                        contactPerson: supplier.contactPerson,
                        email: supplier.email,
                        phone: supplier.phone,
                        address: supplier.address,
                        category: supplier.category as any,
                        isTest: supplier.isTest || false
                      });
                      setIsSupplierModalOpen(true);
                    }}
                    className="p-2 text-brand hover:bg-brand/10 rounded-lg transition-colors"
                  >
                    <Edit2 size={18} />
                  </button>
                  <button 
                    onClick={() => handleDeleteSupplier(supplier.id)}
                    className="p-2 text-danger hover:bg-danger/10 rounded-lg transition-colors"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-content-muted">
                  <Phone size={14} />
                  <span>{supplier.phone}</span>
                </div>
                <div className="flex items-center gap-2 text-content-muted">
                  <Search size={14} />
                  <span>{supplier.email}</span>
                </div>
                <div className="flex items-center gap-2 text-content-muted">
                  <MapPin size={14} />
                  <span className="truncate">{supplier.address}</span>
                </div>
              </div>
              <div className="pt-3 border-t border-border">
                <span className="text-[10px] font-bold uppercase tracking-wider text-brand bg-brand/10 px-2 py-1 rounded-lg">
                  {supplier.category === 'fabric' ? t('inventory.fabric') : 
                   supplier.category === 'thread' ? t('inventory.thread') : 
                   supplier.category === 'button' ? t('inventory.button') : 
                   supplier.category === 'lining' ? t('inventory.lining') : t('common.other')}
                </span>
              </div>
            </motion.div>
          ))}
          {suppliers.length === 0 && (
            <div className="md:col-span-2 lg:col-span-3 p-12 text-center text-content-muted bg-surface rounded-2xl border border-dashed border-border">
              <Truck className="mx-auto mb-4 opacity-20" size={48} />
              <p>{t('suppliers.no_suppliers', 'لا يوجد موردين مسجلين حالياً')}</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'reconciliation' && (
        <div className="bg-surface rounded-2xl shadow-sm border border-border overflow-hidden">
          {/* Mobile View: Stacked Card List */}
          <div className="block md:hidden divide-y divide-border">
            {reconciliations.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((recon) => (
              <div key={recon.id} className="p-4 flex items-center justify-between group hover:bg-surface-muted transition-colors">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-warning/10 text-warning rounded-xl">
                    <RefreshCcw size={20} />
                  </div>
                  <div>
                    <h4 className="font-black text-content text-sm">{recon.itemName}</h4>
                    <p className="text-[10px] text-content-muted font-bold flex items-center gap-1 mt-0.5">
                      <History size={10} />
                      {new Date(recon.createdAt).toLocaleDateString('ar-SA')}
                    </p>
                  </div>
                </div>
                <div className="text-left flex flex-col items-end gap-1">
                  <span className={cn(
                    "px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider",
                    recon.difference > 0 ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
                  )}>
                    {recon.difference > 0 ? '+' : ''}{recon.difference}
                  </span>
                  <span className="text-[10px] text-content-muted font-bold truncate max-w-[100px]">{recon.staffName}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop View: Standard Table */}
          <div className="hidden md:block overflow-x-auto whitespace-nowrap scrollbar-hide">
            <table className="w-full text-right min-w-max">
              <thead className="bg-surface-muted text-content-muted text-sm border-b border-border">
                <tr>
                  <th className="px-6 py-4 font-black uppercase tracking-widest text-[10px]">{t('common.date')}</th>
                  <th className="px-6 py-4 font-black uppercase tracking-widest text-[10px]">{t('inventory.item_name')}</th>
                  <th className="px-6 py-4 font-black uppercase tracking-widest text-[10px]">{t('reconciliation.difference')}</th>
                  <th className="px-6 py-4 font-black uppercase tracking-widest text-[10px]">{t('reconciliation.reason')}</th>
                  <th className="px-6 py-4 font-black uppercase tracking-widest text-[10px]">{t('reconciliation.reconciled_by')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {reconciliations.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((recon) => (
                  <tr key={recon.id} className="hover:bg-surface-muted transition-colors group">
                    <td className="px-6 py-4 text-sm text-content-muted font-medium">
                      {new Date(recon.createdAt).toLocaleDateString('en-US')}
                    </td>
                    <td className="px-6 py-4 font-bold text-content">{recon.itemName}</td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-lg text-xs font-black ${recon.difference > 0 ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
                        {recon.difference > 0 ? '+' : ''}{recon.difference}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-content-muted font-medium">{recon.reason}</td>
                    <td className="px-6 py-4 text-sm text-content-muted font-medium">{recon.staffName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {reconciliations.length === 0 && (
            <div className="p-12 text-center text-content-muted">
              <History className="mx-auto mb-4 opacity-20" size={48} />
              <p>{t('reconciliation.no_reconciliations', 'لا يوجد سجل تسويات حالياً')}</p>
            </div>
          )}
        </div>
      )}

      {/* Item Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-[clamp(320px,90vw,650px)] max-h-[90vh] rounded-[var(--radius-card)] bg-[var(--surface)] shadow-2xl flex flex-col my-auto border border-border overflow-hidden text-right"
              dir="rtl"
            >
              <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col flex-1 max-h-[90vh] overflow-hidden">
                {/* Header (Fixed) */}
                <div className="sticky top-0 z-10 flex items-center justify-between p-4 sm:p-6 border-b border-[var(--border)] bg-[var(--surface)] shrink-0 bg-brand/5">
                  <h3 className="text-base sm:text-lg lg:text-xl font-black text-content">
                    {editingItem ? t('inventory.edit_item') : t('inventory.add_item')}
                  </h3>
                  <button type="button" onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-surface-muted rounded-full transition-colors text-content-muted">
                    <XCircle size={20} />
                  </button>
                </div>
                
                {/* Body (Scrollable) */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="md:col-span-2">
                    <ProductImageUploader 
                      tenantId={tenantId}
                      initialImageUrl={watch('mainImage')}
                      onUploadComplete={(url) => reset((prev) => ({ ...prev, mainImage: url }))}
                    />
                  </div>

                  <div className="md:col-span-2">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-bold text-content mb-1">اسم المنتج (عربي)</label>
                        <input 
                          {...register('name')}
                          className={cn(
                            "w-full px-4 py-2 bg-surface-muted border border-border rounded-xl focus:ring-2 focus:ring-brand outline-none text-content placeholder-content-muted",
                            errors.name && "border-danger"
                          )}
                          placeholder="مثلاً: قماش قطن ياباني أبيض"
                        />
                        {errors.name && <p className="text-xs text-danger font-bold mt-1">{errors.name.message}</p>}
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-content mb-1">Product Name (EN)</label>
                        <input 
                          {...register('nameEn')}
                          className="w-full px-4 py-2 bg-surface-muted border border-border rounded-xl focus:ring-2 focus:ring-brand outline-none text-content placeholder-content-muted text-left"
                          dir="ltr"
                          placeholder="e.g., White Japanese Cotton Fabric"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-content mb-1">{t('inventory.category')}</label>
                    <select 
                      {...register('type')}
                      className="w-full px-4 py-2 bg-surface-muted border border-border rounded-xl focus:ring-2 focus:ring-brand outline-none text-content"
                    >
                      <option value="fabric">قماش (Fabric)</option>
                      <option value="ready_made">جاهز (Ready-made)</option>
                      <option value="accessories">إكسسوارات (Accessories)</option>
                      <option value="thread">خيوط (Thread)</option>
                      <option value="button">أزرار (Buttons)</option>
                      <option value="lining">بطانة (Lining)</option>
                      <option value="other">أخرى (Other)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-content mb-1">الرقم المخزني (SKU)</label>
                    <input 
                      {...register('sku', {
                        onChange: (e) => {
                          e.target.value = e.target.value.replace(/\D/g, '');
                        }
                      })}
                      className="w-full px-4 py-2 bg-surface-muted border border-border rounded-xl focus:ring-2 focus:ring-brand outline-none text-content placeholder-content-muted"
                      placeholder="رقمي فقط (توليد آلي إن تُرك فارغاً)"
                    />
                  </div>

                  {/* Tax Type Logic */}
                  <div className="md:col-span-2">
                    <div className="bg-surface-muted p-4 rounded-2xl border border-border">
                      <div className="flex justify-between items-center mb-4">
                        <label className="text-sm font-black text-brand uppercase tracking-wider flex items-center gap-2">
                          <Zap size={14} />
                          التحكم الضريبي للمنتج (Tax Control)
                        </label>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {[
                          { value: 'inclusive', label: 'شامل الضريبة', sub: 'Inclusive', desc: 'السعر المدخل يشمل 15%' },
                          { value: 'exclusive', label: 'غير شامل الضريبة', sub: 'Exclusive', desc: 'يُضاف 15% فوق السعر' },
                          { value: 'exempt', label: 'معفى ضريبياً', sub: 'Exempt', desc: 'ضريبة بنسبة (0%)' },
                        ].map((tax) => (
                           <label 
                            key={tax.value}
                            className={cn(
                              "relative flex flex-col p-3 rounded-xl border-2 transition-all cursor-pointer group",
                              watchTaxType === tax.value 
                                ? "bg-brand/5 border-brand ring-4 ring-brand/5" 
                                : "bg-surface border-border hover:border-brand/30"
                            )}
                          >
                            <input 
                              type="radio"
                              value={tax.value}
                              className="hidden"
                              {...register('taxType')}
                            />
                            <span className="font-black text-content text-sm">{tax.label}</span>
                            <span className="text-[10px] text-content-muted uppercase font-bold" dir="ltr">{tax.sub}</span>
                            <span className="mt-1 text-[10px] text-content-muted leading-tight opacity-70 group-hover:opacity-100 transition-opacity">
                              {tax.desc}
                            </span>
                            {watchTaxType === tax.value && (
                              <div className="absolute top-2 left-2 text-brand">
                                <CheckCircle size={14} />
                              </div>
                            )}
                          </label>
                        ))}
                      </div>

                      <div className="mt-4 pt-4 border-t border-border/50 grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[10px] font-black text-content-muted mb-1 uppercase tracking-widest">السعر الأساسي (Base Price)</label>
                          <input 
                            type="number"
                            step="0.01"
                            {...register('pricePerUnit')}
                            className="w-full px-4 py-2 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-brand outline-none text-content font-bold"
                          />
                        </div>
                        <div className="flex flex-col justify-center">
                          <p className="text-[10px] font-black text-content-muted mb-1 uppercase tracking-widest">معاينة الحساب (Preview)</p>
                          <div className="px-4 py-2 bg-brand/10 rounded-xl border border-brand/20">
                            {watchTaxType === 'exclusive' ? (
                              <p className="text-sm font-bold text-brand">
                                <PriceDisplay amount={Number(watchPrice || 0) * 1.15} /> <span className="text-[10px] font-normal">(بعد الضريبة)</span>
                              </p>
                            ) : watchTaxType === 'inclusive' ? (
                              <p className="text-sm font-bold text-brand">
                                <PriceDisplay amount={Number(watchPrice || 0) / 1.15} /> <span className="text-[10px] font-normal">(قبل الضريبة)</span>
                              </p>
                            ) : (
                              <p className="text-sm font-bold text-brand">
                                <PriceDisplay amount={Number(watchPrice || 0)} /> <span className="text-[10px] font-normal">(معفى)</span>
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-content mb-1">{t('inventory.unit')}</label>
                    <select 
                      {...register('unit')}
                      className="w-full px-4 py-2 bg-surface-muted border border-border rounded-xl focus:ring-2 focus:ring-brand outline-none text-content"
                    >
                      <option value="meter">{t('inventory.units.meter')}</option>
                      <option value="yard">{t('inventory.units.yard')}</option>
                      <option value="roll">{t('inventory.units.roll')}</option>
                      <option value="bolt">طاقة (Bolt)</option>
                      <option value="piece">{t('inventory.units.piece')}</option>
                      <option value="spool">{t('inventory.units.spool')}</option>
                      <option value="box">{t('inventory.units.box')}</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-content mb-1">الكمية الحالية</label>
                    <input 
                      type="number"
                      step="0.01"
                      {...register('quantity')}
                      className={cn(
                        "w-full px-4 py-2 bg-surface-muted border border-border rounded-xl focus:ring-2 focus:ring-brand outline-none text-content",
                        errors.quantity && "border-red-500"
                      )}
                    />
                    {errors.quantity && <p className="text-xs text-red-500 font-bold mt-1">{errors.quantity.message}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-content mb-1">الحد الأدنى للتنبيه</label>
                    <input 
                      type="number"
                      {...register('minThreshold')}
                      className="w-full px-4 py-2 bg-surface-muted border border-border rounded-xl focus:ring-2 focus:ring-brand outline-none text-content"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-content mb-1">{t('suppliers.title')}</label>
                    <select 
                      {...register('supplierId')}
                      className="w-full px-4 py-2 bg-surface-muted border border-border rounded-xl focus:ring-2 focus:ring-brand outline-none text-content"
                    >
                      <option value="">{t('inventory.select_supplier', 'اختر مورداً...')}</option>
                      {suppliers.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* isTest Flag */}
                  <div className="md:col-span-2 flex items-center gap-3 p-4 bg-warning/5 rounded-2xl border border-warning/10 mt-2 text-right">
                    <input
                      type="checkbox"
                      id="isTest"
                      {...register('isTest')}
                      className="w-5 h-5 text-brand border-border rounded focus:ring-brand"
                    />
                    <label htmlFor="isTest" className="text-sm font-bold text-warning flex items-center gap-2">
                       بيانات تجريبية (Test Data)
                    </label>
                  </div>

                  {/* POS Visibility Flag */}
                  <div className="md:col-span-2 flex items-center gap-3 p-4 bg-brand/5 rounded-2xl border border-brand/10 mt-2 text-right">
                    <input
                      type="checkbox"
                      id="showInPos"
                      {...register('showInPos')}
                      className="w-5 h-5 text-brand border-border rounded focus:ring-brand"
                    />
                    <label htmlFor="showInPos" className="text-sm font-bold text-content flex items-center gap-2">
                       إظهار في شاشة البيع (Show in POS)
                    </label>
                  </div>
                </div>
              </div>

              {/* Footer (Fixed) */}
                <div className="sticky bottom-0 z-10 shrink-0 p-4 sm:p-6 border-t border-[var(--border)] bg-[var(--surface)] flex gap-3 text-sm sm:text-base">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 bg-brand text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-brand/90 transition-all shadow-lg shadow-brand/20 disabled:opacity-50"
                  >
                    {isSubmitting ? <Loader2 className="animate-spin" /> : <Plus size={18} />}
                    {editingItem ? 'حفظ التعديلات' : 'إضافة إلى المخزن'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-6 py-3 bg-surface-muted text-content font-bold rounded-xl hover:bg-surface transition-all"
                  >
                    إلغاء
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Supplier Modal */}
      <AnimatePresence>
        {isSupplierModalOpen && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-surface rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-border flex flex-col my-auto max-h-[90vh]"
            >
              <div className="p-6 border-b border-border flex justify-between items-center bg-brand text-white shrink-0">
                <h2 className="text-xl font-bold">
                  {editingSupplier ? t('suppliers.edit_supplier') : t('suppliers.add_supplier')}
                </h2>
                <button onClick={() => setIsSupplierModalOpen(false)} className="hover:rotate-90 transition-transform">
                  <XCircle size={24} />
                </button>
              </div>
              <form onSubmit={handleSubmitSupplier(onSupplierSubmit)} className="p-6 space-y-4 overflow-y-auto flex-1">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-content-muted mb-1">{t('suppliers.name')}</label>
                    <input 
                      {...registerSupplier('name')}
                      className={cn(
                        "w-full px-4 py-2 bg-surface-muted border border-border rounded-xl focus:ring-2 focus:ring-brand outline-none text-content placeholder-content-muted",
                        supplierErrors.name && "border-red-500"
                      )}
                    />
                    {supplierErrors.name && <p className="text-xs text-red-500 font-bold mt-1">{supplierErrors.name.message}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-content-muted mb-1">{t('suppliers.contact_person')}</label>
                    <input 
                      {...registerSupplier('contactPerson')}
                      className={cn(
                        "w-full px-4 py-2 bg-surface-muted border border-border rounded-xl focus:ring-2 focus:ring-brand outline-none text-content placeholder-content-muted",
                        supplierErrors.contactPerson && "border-red-500"
                      )}
                    />
                    {supplierErrors.contactPerson && <p className="text-xs text-red-500 font-bold mt-1">{supplierErrors.contactPerson.message}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-content-muted mb-1">{t('suppliers.phone')}</label>
                    <input 
                      {...registerSupplier('phone')}
                      className={cn(
                        "w-full px-4 py-2 bg-surface-muted border border-border rounded-xl focus:ring-2 focus:ring-brand outline-none text-content placeholder-content-muted",
                        supplierErrors.phone && "border-red-500"
                      )}
                    />
                    {supplierErrors.phone && <p className="text-xs text-red-500 font-bold mt-1">{supplierErrors.phone.message}</p>}
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-content-muted mb-1">{t('suppliers.email')}</label>
                    <input 
                      type="email"
                      {...registerSupplier('email')}
                      className={cn(
                        "w-full px-4 py-2 bg-surface-muted border border-border rounded-xl focus:ring-2 focus:ring-brand outline-none text-content placeholder-content-muted",
                        supplierErrors.email && "border-red-500"
                      )}
                    />
                    {supplierErrors.email && <p className="text-xs text-red-500 font-bold mt-1">{supplierErrors.email.message}</p>}
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-content-muted mb-1">{t('suppliers.address')}</label>
                    <input 
                      type="text"
                      {...registerSupplier('address')}
                      className={cn(
                        "w-full px-4 py-2 bg-surface-muted border border-border rounded-xl focus:ring-2 focus:ring-brand outline-none text-content placeholder-content-muted",
                        supplierErrors.address && "border-red-500"
                      )}
                    />
                    {supplierErrors.address && <p className="text-xs text-red-500 font-bold mt-1">{supplierErrors.address.message}</p>}
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-content-muted mb-1">{t('suppliers.specialty')}</label>
                    <select 
                      {...registerSupplier('category')}
                      className="w-full px-4 py-2 bg-surface-muted border border-border rounded-xl focus:ring-2 focus:ring-brand outline-none text-content"
                    >
                      <option value="fabric">{t('inventory.fabric')}</option>
                      <option value="thread">{t('inventory.thread')}</option>
                      <option value="button">{t('inventory.button')}</option>
                      <option value="lining">{t('inventory.lining')}</option>
                      <option value="other">{t('common.other')}</option>
                    </select>
                  </div>

                  {/* isTest Flag */}
                  <div className="md:col-span-2 flex items-center gap-3 p-4 bg-warning/5 rounded-2xl border border-warning/10">
                    <input
                      type="checkbox"
                      id="supplierIsTest"
                      {...registerSupplier('isTest')}
                      className="w-5 h-5 text-brand border-border rounded focus:ring-brand"
                    />
                    <label htmlFor="supplierIsTest" className="text-sm font-bold text-warning flex items-center gap-2">
                      <Zap size={16} />
                      {t('common.test_data')}
                    </label>
                  </div>
                </div>
                <button 
                  type="submit"
                  disabled={isSubmittingSupplier}
                  className="w-full bg-brand text-white py-4 rounded-2xl font-bold hover:bg-brand/90 transition-all shadow-lg shadow-brand/10 mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmittingSupplier ? t('common.saving') : (editingSupplier ? t('common.save_changes') : t('suppliers.add_supplier'))}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Reconciliation Modal */}
      <AnimatePresence>
        {isReconcileModalOpen && selectedItemForReconcile && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-surface rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-border flex flex-col my-auto max-h-[90vh]"
            >
              <div className="p-6 border-b border-border bg-warning text-white flex justify-between items-center shrink-0">
                <h2 className="text-xl font-bold">{t('reconciliation.title')}: {selectedItemForReconcile.name}</h2>
                <button onClick={() => setIsReconcileModalOpen(false)}>
                  <XCircle size={24} />
                </button>
              </div>
              <form onSubmit={handleSubmitReconcile(onReconcileSubmit)} className="p-6 space-y-4 overflow-y-auto flex-1">
                <div className="p-4 bg-warning/10 rounded-xl border border-warning/20 text-sm text-warning">
                  <p>{t('inventory.quantity')}: <strong>{selectedItemForReconcile.quantity}</strong></p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-content-muted mb-1">{t('reconciliation.actual')}</label>
                  <input 
                    type="number"
                    step="0.01"
                    {...registerReconcile('actualQuantity')}
                    className={cn(
                      "w-full px-4 py-2 bg-surface-muted border border-border rounded-xl focus:ring-2 focus:ring-warning outline-none text-content",
                      reconcileErrors.actualQuantity && "border-red-500"
                    )}
                  />
                  {reconcileErrors.actualQuantity && <p className="text-xs text-red-500 font-bold mt-1">{reconcileErrors.actualQuantity.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-content-muted mb-1">{t('reconciliation.reason')}</label>
                  <select 
                    {...registerReconcile('reason')}
                    className={cn(
                      "w-full px-4 py-2 bg-surface-muted border border-border rounded-xl focus:ring-2 focus:ring-warning outline-none text-content",
                      reconcileErrors.reason && "border-red-500"
                    )}
                  >
                    <option value="">{t('reconciliation.select_reason')}</option>
                    <option value="damaged">{t('inventory.damaged')}</option>
                    <option value="lost">{t('inventory.lost')}</option>
                    <option value="correction">{t('inventory.correction')}</option>
                    <option value="return">{t('inventory.return')}</option>
                    <option value="other">{t('common.other')}</option>
                  </select>
                  {reconcileErrors.reason && <p className="text-xs text-red-500 font-bold mt-1">{reconcileErrors.reason.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-content-muted mb-1">{t('reconciliation.reconciled_by')}</label>
                  <select 
                    {...registerReconcile('staffId')}
                    className={cn(
                      "w-full px-4 py-2 bg-surface-muted border border-border rounded-xl focus:ring-2 focus:ring-warning outline-none text-content",
                      reconcileErrors.staffId && "border-red-500"
                    )}
                  >
                    <option value="">{t('common.select_staff')}</option>
                    {staff.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  {reconcileErrors.staffId && <p className="text-xs text-red-500 font-bold mt-1">{reconcileErrors.staffId.message}</p>}
                </div>
                <button 
                  type="submit"
                  disabled={isSubmittingReconcile}
                  className="w-full bg-warning text-white py-3 rounded-xl font-bold hover:bg-warning/90 transition-colors mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmittingReconcile ? t('common.saving') : t('reconciliation.update_quantity')}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
