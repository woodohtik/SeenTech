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
  MessageSquare
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
import Branding from './Branding';
import { PriceDisplay } from './PriceDisplay';
import PurchaseOrders from './PurchaseOrders';
import PurchaseReturns from './PurchaseReturns';
import SuppliersRegistry from './SuppliersRegistry';
import SupplierLedger from './SupplierLedger';
import PaymentVoucherModal from './PaymentVoucherModal';

export default function Suppliers({ tenantId }: { tenantId: string }) {
  const { currentStaff } = useStaff();
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
  const [tenantName, setTenantName] = useState('نظام سين الذكي - SEEN POS');
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
      const { data } = await supabase
        .from('purchase_orders')
        .select('*, purchase_order_items(*)')
        .eq('tenant_id', tenantId);
      if (data) {
        setPurchaseOrders(data.map(d => ({
          ...d,
          supplierId: d.supplier_id,
          supplierName: suppliers.find(s => s.id === d.supplier_id)?.name || d.supplier_name || 'مورد غير معروف',
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
        }) as unknown as PurchaseOrder));
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
    try {
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

        // Audit Log
        if (currentStaff) {
          await logEmployeeAction(
            tenantId,
            currentStaff.id,
            currentStaff.name,
            'add_supplier',
            `إضافة مورد جديد: ${formData.name}`
          );
        }
      }
      setIsModalOpen(false);
      setEditingSupplier(null);
      reset();
    } catch (error) {
      handleError(error as any, OperationType.WRITE, 'suppliers');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('هل أنت متأكد من حذف هذا المورد؟')) return;
    try {
      const { error } = await supabase
        .from('suppliers')
        .delete()
        .eq('id', id);
      if (error) throw error;
      
      const supplier = suppliers.find(s => s.id === id);
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
      handleError(error as any, OperationType.DELETE, 'suppliers');
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
      case 'fabric': return 'أقمشة';
      case 'thread': return 'خيوط';
      case 'button': return 'أزرار';
      default: return 'أخرى';
    }
  };

  const filteredSuppliers = suppliers.filter(s => {
    const matchesSearch = s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.contactPerson || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || s.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="p-4 md:p-6 space-y-6 font-sans" style={{ fontFamily: 'IBM Plex Sans, sans-serif' }}>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-content">الموردين والمشتريات</h1>
          <p className="text-content-muted">إدارة الموردين، أوامر الشراء، والمرتجعات</p>
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
              <span>إضافة مورد</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border pb-px overflow-x-auto">
        <button
          onClick={() => setActiveTab('suppliers')}
          className={cn(
            "px-6 py-3 font-bold text-sm transition-colors whitespace-nowrap border-b-2",
            activeTab === 'suppliers' ? "border-brand text-brand" : "border-transparent text-content-muted hover:text-content"
          )}
        >
          سجل الموردين
        </button>
        <button
          onClick={() => setActiveTab('purchase_orders')}
          className={cn(
            "px-6 py-3 font-bold text-sm transition-colors whitespace-nowrap border-b-2",
            activeTab === 'purchase_orders' ? "border-brand text-brand" : "border-transparent text-content-muted hover:text-content"
          )}
        >
          أوامر الشراء
        </button>
        <button
          onClick={() => setActiveTab('returns')}
          className={cn(
            "px-6 py-3 font-bold text-sm transition-colors whitespace-nowrap border-b-2",
            activeTab === 'returns' ? "border-brand text-brand" : "border-transparent text-content-muted hover:text-content"
          )}
        >
          المرتجعات
        </button>
      </div>

      {activeTab === 'suppliers' && (
        <>
          {selectedLedgerSupplier ? (
            <SupplierLedger
              supplier={{
                id: selectedLedgerSupplier.id,
                name: selectedLedgerSupplier.name,
                phone: selectedLedgerSupplier.phone,
                balance: selectedLedgerSupplier.balance,
                taxNumber: selectedLedgerSupplier.taxNumber,
                contactPerson: selectedLedgerSupplier.contactPerson,
                address: selectedLedgerSupplier.address
              }}
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
                <div className="flex flex-wrap justify-between items-center gap-4">
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setCategoryFilter('all')}
                      className={cn(
                        "px-4 py-2 rounded-xl text-sm font-bold transition-all cursor-pointer",
                        categoryFilter === 'all' 
                          ? "bg-brand text-white shadow-md shadow-brand/10" 
                          : "bg-surface text-content-muted border border-border hover:bg-surface-muted"
                      )}
                    >
                      الكل
                    </button>
                    {[
                      { id: 'fabric', label: 'أقمشة' },
                      { id: 'thread', label: 'خيوط' },
                      { id: 'button', label: 'أزرار' },
                      { id: 'other', label: 'أخرى' }
                    ].map((cat) => (
                      <button
                        key={cat.id}
                        onClick={() => setCategoryFilter(cat.id)}
                        className={cn(
                          "px-4 py-2 rounded-xl text-sm font-bold transition-all cursor-pointer",
                          categoryFilter === cat.id 
                            ? "bg-brand text-white shadow-md shadow-brand/10" 
                            : "bg-surface text-content-muted border border-border hover:bg-surface-muted"
                        )}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>

                  {/* View mode buttons */}
                  <div className="flex bg-surface border border-border p-1 rounded-xl">
                    <button
                      onClick={() => setCategoryFilter('all')}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer",
                        categoryFilter === 'all' ? "bg-brand/10 text-brand" : "text-content-muted hover:text-content"
                      )}
                    >
                      تصفية الكل
                    </button>
                  </div>
                </div>

                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-content-muted" size={20} />
                  <input 
                    type="text"
                    placeholder="بحث عن مورد بسجل المحاسبة..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pr-10 pl-4 py-2 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-brand outline-none text-content"
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
                  <p>لا يوجد موردين مسجلين حالياً لقيد الحساب</p>
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
        />
      )}

      {activeTab === 'returns' && (
        <PurchaseOrders 
          tenantId={tenantId}
          suppliers={suppliers}
          purchaseOrders={purchaseOrders}
          inventory={inventory}
          defaultTypeFilter="return"
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
                {editingSupplier ? 'تعديل مورد' : 'إضافة مورد جديد'}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-content-muted hover:text-content">
                <Plus className="rotate-45" size={24} />
              </button>
            </div>
            <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-content-muted mb-1">اسم الشركة/المورد</label>
                <input 
                  {...register('name')}
                  className={cn(
                    "w-full px-4 py-2 bg-surface-muted border border-border rounded-xl focus:ring-2 focus:ring-brand outline-none text-content",
                    errors.name && "border-red-500"
                  )}
                />
                {errors.name && <p className="text-xs text-red-500 font-bold mt-1">{errors.name.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-content-muted mb-1">الشخص المسؤول</label>
                <input 
                  {...register('contactPerson')}
                  className={cn(
                    "w-full px-4 py-2 bg-surface-muted border border-border rounded-xl focus:ring-2 focus:ring-brand outline-none text-content",
                    errors.contactPerson && "border-red-500"
                  )}
                />
                {errors.contactPerson && <p className="text-xs text-red-500 font-bold mt-1">{errors.contactPerson.message}</p>}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-content-muted mb-1">البريد الإلكتروني</label>
                  <input 
                    type="email"
                    {...register('email')}
                    className={cn(
                      "w-full px-4 py-2 bg-surface-muted border border-border rounded-xl focus:ring-2 focus:ring-brand outline-none text-content",
                      errors.email && "border-red-500"
                    )}
                  />
                  {errors.email && <p className="text-xs text-red-500 font-bold mt-1">{errors.email.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-content-muted mb-1">رقم الهاتف</label>
                  <input 
                    type="tel"
                    {...register('phone')}
                    className={cn(
                      "w-full px-4 py-2 bg-surface-muted border border-border rounded-xl focus:ring-2 focus:ring-brand outline-none text-content",
                      errors.phone && "border-red-500"
                    )}
                  />
                  {errors.phone && <p className="text-xs text-red-500 font-bold mt-1">{errors.phone.message}</p>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-content-muted mb-1">الرقم الضريبي (اختياري)</label>
                  <input 
                    {...register('taxNumber')}
                    className={cn(
                      "w-full px-4 py-2 bg-surface-muted border border-border rounded-xl focus:ring-2 focus:ring-brand outline-none text-content",
                      errors.taxNumber && "border-red-500"
                    )}
                  />
                  {errors.taxNumber && <p className="text-xs text-red-500 font-bold mt-1">{errors.taxNumber.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-content-muted mb-1">التصنيف</label>
                  <Controller
                    control={control}
                    name="category"
                    render={({ field }) => (
                      <SmartSelect
                        {...field}
                        className={cn("w-full", errors.category && "ring-2 ring-red-500")}
                        options={[
                          { value: 'fabric', label: 'أقمشة' },
                          { value: 'accessories', label: 'إكسسوارات' },
                          { value: 'thread', label: 'خيوط' },
                          { value: 'button', label: 'أزرار' },
                          { value: 'lining', label: 'بطانات' },
                          { value: 'other', label: 'أخرى' }
                        ]}
                      />
                    )}
                  />
                  {errors.category && <p className="text-xs text-red-500 font-bold mt-1">{errors.category.message}</p>}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-content-muted mb-1">العنوان</label>
                <textarea 
                  {...register('address')}
                  className={cn(
                    "w-full px-4 py-2 bg-surface-muted border border-border rounded-xl focus:ring-2 focus:ring-brand outline-none h-20 resize-none text-content",
                    errors.address && "border-red-500"
                  )}
                />
                {errors.address && <p className="text-xs text-red-500 font-bold mt-1">{errors.address.message}</p>}
              </div>
              <button 
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-brand text-white py-3 rounded-xl font-bold hover:bg-brand/90 transition-colors mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'جاري الحفظ...' : (editingSupplier ? 'حفظ التعديلات' : 'إضافة المورد')}
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
                  <p className="text-xs font-bold text-content-muted">تفاصيل المورد، المستحقات المالية، والمنتجات المطلوبة</p>
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
                        <span className="text-xs font-bold text-content-muted">مستحقات المنتجات المباشرة (بالمخازن)</span>
                        <div className="mt-2 flex items-baseline justify-between">
                          <span className="text-2xl font-black text-content">
                            <PriceDisplay amount={linkedProductsTotal} />
                          </span>
                          <span className="text-xs font-semibold text-content-muted">({items.length} صنف)</span>
                        </div>
                        <p className="text-[10px] text-content-muted mt-2">محسوبة من: (سعر التكلفة × الكمية المتوفرة) للمنتجات المرتبطة بالمستودع</p>
                      </div>

                      <div className="bg-surface-muted/30 p-5 rounded-2xl border border-border flex flex-col justify-between">
                        <span className="text-xs font-bold text-content-muted">ديون أوامر الشراء المسجلة</span>
                        <div className="mt-2">
                          <span className="text-2xl font-black text-content">
                            <PriceDisplay amount={baseBalance} />
                          </span>
                        </div>
                        <p className="text-[10px] text-content-muted mt-2">المبالغ غير المدفوعة من فواتير وأوامر الشراء المعتمدة</p>
                      </div>

                      <div className="bg-brand/5 p-5 rounded-2xl border border-brand/20 flex flex-col justify-between">
                        <span className="text-xs font-bold text-brand">إجمالي الذمم والمستحقات الكلية</span>
                        <div className="mt-2">
                          <span className="text-3xl font-black text-brand">
                            <PriceDisplay amount={totalDue} />
                          </span>
                        </div>
                        <p className="text-[10px] text-brand/80 mt-2">مجموع مستحقات المخازن المباشرة وفواتير أوامر الشراء</p>
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Information & Contacts */}
              <div className="bg-surface-muted/30 rounded-2xl p-4 border border-border grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <span className="text-[10px] font-black text-content-muted block uppercase">الشخص المسؤول</span>
                  <span className="text-sm font-bold text-content mt-1 block">{selectedSupplierDetails.contactPerson || '—'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-black text-content-muted block uppercase">الهاتف</span>
                  <a href={`tel:${selectedSupplierDetails.phone}`} className="text-sm font-bold text-brand hover:underline mt-1 block">{selectedSupplierDetails.phone || '—'}</a>
                </div>
                <div>
                  <span className="text-[10px] font-black text-content-muted block uppercase">البريد الإلكتروني</span>
                  <a href={`mailto:${selectedSupplierDetails.email}`} className="text-sm font-bold text-brand hover:underline truncate mt-1 block">{selectedSupplierDetails.email || '—'}</a>
                </div>
                <div>
                  <span className="text-[10px] font-black text-content-muted block uppercase">العنوان والموقع</span>
                  <span className="text-sm font-bold text-content truncate mt-1 block">{selectedSupplierDetails.address || '—'}</span>
                </div>
              </div>

              {/* Mapped Goods in Inventory */}
              <div>
                <h3 className="text-md font-black text-content mb-3 flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-brand rounded-full inline-block" />
                  <span>المنتجات المرتبطة بالمورد في المخزون</span>
                  <span className="text-xs font-bold text-content-muted">({inventory.filter(p => p.supplierId === selectedSupplierDetails.id || (p as any).supplier_id === selectedSupplierDetails.id).length} منتج)</span>
                </h3>
                
                {(() => {
                  const linkedItems = inventory.filter(p => p.supplierId === selectedSupplierDetails.id || (p as any).supplier_id === selectedSupplierDetails.id);
                  if (linkedItems.length === 0) {
                    return (
                      <div className="p-8 text-center text-content-muted bg-surface-muted/20 rounded-2xl border border-dashed border-border text-sm">
                        لا يوجد منتجات مرتبطة بهذا المورد مباشرة في كتالوج المخزون المفتوح.
                      </div>
                    );
                  }

                  return (
                    <div className="border border-border rounded-2xl overflow-hidden bg-surface">
                      <table className="w-full text-right border-collapse">
                        <thead>
                          <tr className="bg-surface-muted/50 border-b border-border text-xs font-black text-content-muted">
                            <th className="p-4 text-right">اسم المنتج</th>
                            <th className="p-4 text-right">رمز الصنف (SKU)</th>
                            <th className="p-4 text-right">الكمية المتوفرة</th>
                            <th className="p-4 text-right">سعر التكلفة</th>
                            <th className="p-4 text-right">القيمة الإجمالية</th>
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
                                  {Number(item.quantity).toLocaleString()} {item.unit}
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
                  <span>المنتجات والطلبيات عبر أوامر الشراء العامة</span>
                  <span className="text-xs font-bold text-content-muted">({purchaseOrders.filter(po => po.supplierId === selectedSupplierDetails.id).length} أمر شراء)</span>
                </h3>

                {(() => {
                  const supplierPOs = purchaseOrders.filter(po => po.supplierId === selectedSupplierDetails.id);
                  if (supplierPOs.length === 0) {
                    return (
                      <div className="p-8 text-center text-content-muted bg-surface-muted/20 rounded-2xl border border-dashed border-border text-sm">
                        لم يتم إنشاء أي أوامر شراء بعد لهذا المورد.
                      </div>
                    );
                  }

                  // Gather all unique items ordered in these POs
                  const orderedItemsMap: { [key: string]: { name: string, totalQty: number, avgPrice: number, totalAmount: number, unit: string } } = {};
                  supplierPOs.forEach(po => {
                    (po.items || []).forEach((it: any) => {
                      const name = it.name || 'منتج غير معروف';
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
                      <div className="border border-border rounded-2xl overflow-hidden bg-surface">
                        <div className="p-4 bg-surface-muted/40 font-bold text-sm text-content border-b border-border">إجمالي الكميات والأنواع التي تم توريدها/طلبها</div>
                        {orderedItemsArray.length === 0 ? (
                          <div className="p-4 text-center text-xs text-content-muted">لا توجد بنود تفصيلية في سجلات أوامر الشراء.</div>
                        ) : (
                          <table className="w-full text-right border-collapse">
                            <thead>
                              <tr className="bg-surface-muted/20 border-b border-border text-xs font-black text-content-muted">
                                <th className="p-4 text-right">اسم المنتج المطلـوب</th>
                                <th className="p-4 text-right">إجمالي الكميات المطلوبة</th>
                                <th className="p-4 text-right">متوسط سعر التوريد</th>
                                <th className="p-4 text-right">إجمالي المبلغ المطلوب</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border text-sm">
                              {orderedItemsArray.map((it, idx) => (
                                <tr key={idx} className="hover:bg-surface-muted/10 transition-colors">
                                  <td className="p-4 font-bold text-content">{it.name}</td>
                                  <td className="p-4 text-content font-semibold">{it.totalQty.toLocaleString()} {it.unit}</td>
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
                        <div className="p-4 bg-surface-muted/40 font-bold text-sm text-content border-b border-border">سجل أوامر الشراء المفصل</div>
                        <div className="divide-y divide-border max-h-60 overflow-y-auto">
                          {supplierPOs.map((po) => (
                            <div key={po.id} className="p-4 flex items-center justify-between text-sm hover:bg-surface-muted/20 transition-colors">
                              <div>
                                <div className="font-bold text-content flex items-center gap-2">
                                  <span>أمر شراء رقم: {po.poNumber}</span>
                                  <span className={cn(
                                    "text-[10px] font-black px-2 py-0.5 rounded-full",
                                    po.status === 'confirmed' ? "bg-success/10 text-success" :
                                    po.status === 'draft' ? "bg-surface-muted text-content-muted" : "bg-warning/10 text-warning"
                                  )}>
                                    {po.status === 'confirmed' ? 'معتمد ومستلم' : po.status === 'draft' ? 'مسودة' : 'معلق'}
                                  </span>
                                </div>
                                <div className="text-xs text-content-muted mt-1">تاريخ الطلب: {new Date(po.orderDate).toLocaleDateString('ar-EG')}</div>
                              </div>
                              <div className="text-left">
                                <div className="font-extrabold text-content"><PriceDisplay amount={po.totalAmount} /></div>
                                <div className="text-xs text-content-muted">المتبقي: <PriceDisplay amount={po.remainingAmount || 0} /></div>
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
                إغلاق النافذة
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
