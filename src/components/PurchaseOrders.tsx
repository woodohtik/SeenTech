import React, { useState, useEffect } from 'react';
import { Plus, Package, CheckCircle2, Clock, Trash2, X, Search, Eye, Filter, ArrowLeftRight, Check, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { Supplier, PurchaseOrder, InventoryItem, PurchaseOrderItem } from '../types';
import { cn } from '../lib/utils';
import { addSupplierTransaction } from '../services/supplierAccountsService';
import { SmartSelect } from './ui/SmartSelect';
import { PriceDisplay } from './PriceDisplay';
import { useTranslation } from 'react-i18next';
import { useToast } from '../contexts/ToastContext';

export default function PurchaseOrders({ 
  tenantId, 
  suppliers, 
  purchaseOrders, 
  inventory,
  defaultTypeFilter = 'all',
  onRefresh
}: { 
  tenantId: string, 
  suppliers: Supplier[], 
  purchaseOrders: PurchaseOrder[],
  inventory: InventoryItem[],
  defaultTypeFilter?: 'all' | 'purchase' | 'return',
  onRefresh?: () => void
}) {
  const { t } = useTranslation();
  const { error: toastError, success: toastSuccess } = useToast();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<'purchase' | 'return'>('purchase');

  // Search & Filters state
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'purchase' | 'return'>(defaultTypeFilter);
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'confirmed' | 'received'>('all');

  // Order Details / Confirmation state
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  // New Order Form state
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [items, setItems] = useState<PurchaseOrderItem[]>([]);
  const [selectedItem, setSelectedItem] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [pricePerUnit, setPricePerUnit] = useState(0);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [realBranchId, setRealBranchId] = useState<string | null>(null);
  const [currentStaff, setCurrentStaff] = useState<any>(null);

  useEffect(() => {
    setTypeFilter(defaultTypeFilter);
  }, [defaultTypeFilter]);

  useEffect(() => {
    const fetchBranchAndStaff = async () => {
      try {
        const { data: branches } = await supabase
          .from('branches')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('is_main', true)
          .limit(1);
        if (branches && branches.length > 0) {
          setRealBranchId(branches[0].id);
        } else {
          const { data: anyBranch } = await supabase
            .from('branches')
            .select('id')
            .eq('tenant_id', tenantId)
            .limit(1);
          if (anyBranch && anyBranch.length > 0) {
            setRealBranchId(anyBranch[0].id);
          }
        }

        // Fetch current user details
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: staff } = await supabase
            .from('staff')
            .select('*')
            .eq('user_id', user.id)
            .maybeSingle();
          if (staff) {
            setCurrentStaff(staff);
          }
        }
      } catch (err) {
        console.error('Error fetching defaults:', err);
      }
    };
    fetchBranchAndStaff();
  }, [tenantId]);

  const handleAddItem = () => {
    const invItem = inventory.find(i => i.id === selectedItem);
    if (!invItem) return;

    const rate = Number(invItem.conversionRate || (invItem as any).conversion_rate || 1);
    const newItem: PurchaseOrderItem = {
      itemId: invItem.id,
      name: invItem.name,
      quantity,
      unit: invItem.unit,
      conversionRate: rate,
      baseQuantity: quantity * rate,
      pricePerUnit,
      total: quantity * pricePerUnit
    };

    setItems([...items, newItem]);
    setSelectedItem('');
    setQuantity(1);
    setPricePerUnit(0);
  };

  const handleCreateOrder = async (isConfirmImmediately = false) => {
    if (!selectedSupplier || items.length === 0) return;
    setIsSubmitting(true);
    try {
      const totalAmount = items.reduce((sum, item) => sum + item.total, 0);
      const prefix = modalType === 'purchase' ? 'PO' : 'RET';
      const orderNumber = `${prefix}-${Date.now()}`;

      // 1. Insert order record
      const { data: poData, error: poError } = await supabase
        .from('purchase_orders')
        .insert({
          supplier_id: selectedSupplier,
          tenant_id: tenantId,
          branch_id: realBranchId,
          po_number: orderNumber,
          total_amount: totalAmount,
          paid_amount: 0,
          status: 'draft',
          order_date: new Date().toISOString(),
          notes: notes || null,
          created_by: currentStaff?.id || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();
      
      if (poError) throw poError;
      if (!poData) throw new Error('فشل إنشاء الطلب');

      // 2. Insert items
      const itemsToInsert = items.map(item => ({
        tenant_id: tenantId,
        purchase_order_id: poData.id,
        item_id: item.itemId,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        conversion_rate: item.conversionRate,
        base_quantity: item.baseQuantity,
        price_per_unit: item.pricePerUnit,
        total: item.total
      }));

      const { error: itemsError } = await supabase
        .from('purchase_order_items')
        .insert(itemsToInsert);

      if (itemsError) throw itemsError;

      toastSuccess(modalType === 'purchase' ? 'تم إنشاء السند كمسودة' : 'تم إنشاء مرتجع المشتريات كمسودة');

      const foundSupplier = suppliers.find(s => (s.id || '').toLowerCase().trim() === (poData.supplier_id || '').toLowerCase().trim());

      const finalOrderObject = {
        ...poData,
        supplierId: poData.supplier_id,
        supplierName: foundSupplier?.name || 'مورد معروف',
        totalAmount: poData.total_amount,
        paidAmount: 0,
        remainingAmount: poData.total_amount,
        status: poData.status,
        orderType: poData.po_number?.startsWith('RET') ? 'return' : 'purchase',
        orderDate: poData.order_date,
        items: items
      };

      setIsModalOpen(false);
      setItems([]);
      setSelectedSupplier('');
      setNotes('');

      // If confirm immediately was chosen:
      if (isConfirmImmediately) {
        await handleConfirmOrder(finalOrderObject, true);
      } else {
        onRefresh?.();
      }
    } catch (error: any) {
      toastError(error.message || 'فشل بناء السند');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmOrder = async (order: any, skipConfirmationAlert = false) => {
    if (!order || !order.id) {
      toastError('خطأ: لم يتم تلقي معرّف السند بشكل صحيح.');
      return;
    }

    if (!skipConfirmationAlert) {
      if (!confirm('هل أنت متأكد من تأكيد هذه العملية؟ سيتم تحديث المخزون ورصيد حساب المورد تلقائياً.')) return;
    }
    setIsConfirming(true);
    try {
      // 1. Fetch current items of the purchase order to prevent any client-state mismatch
      const { data: orderDetails, error: fetchErr } = await supabase
        .from('purchase_orders')
        .select('*, purchase_order_items(*)')
        .eq('id', order.id)
        .single();
      
      if (fetchErr) throw fetchErr;
      if (!orderDetails) throw new Error('لم يتم العثور على تفاصيل أمر الشراء في قاعدة البيانات.');

      const orderItems = orderDetails.purchase_order_items || [];
      if (orderItems.length === 0) {
        throw new Error('لا توجد أصناف في هذا الأمر لتأكيد العملية.');
      }

      // Determine order type dynamically and robustly (RET- prefix represents return/refund)
      const orderNumberStr = orderDetails.po_number || order.po_number || order.poNumber || '';
      const finalOrderType = orderNumberStr.startsWith('RET') ? 'return' : 'purchase';

      // 2. Resolve active branch ID dynamically with a fallback to ensure we never have a null branch_id
      let activeBranchId = orderDetails.branch_id || order.branch_id || order.branchId || realBranchId;
      if (!activeBranchId) {
        const { data: fallbackBranches } = await supabase
          .from('branches')
          .select('id')
          .eq('tenant_id', tenantId)
          .limit(1);
        if (fallbackBranches && fallbackBranches.length > 0) {
          activeBranchId = fallbackBranches[0].id;
        }
      }

      if (!activeBranchId) {
        throw new Error('فشل تحديد المستودع/الفرع المسؤول لتحديث مخزونة. يرجى تهيئة الفروع أولاً.');
      }

      // 3. Loop and perform atomic stock, ledger updates
      for (const item of orderItems) {
        // Skip updating inventory for custom items that don't have a database inventory reference
        if (!item.item_id) {
          console.warn(`Skipping stock update for item "${item.name}" because it does not map to a database inventory item ID.`);
          continue;
        }

        // Fetch current stock from inventory_items
        const { data: invItem, error: invErr } = await supabase
          .from('inventory_items')
          .select('quantity')
          .eq('id', item.item_id)
          .single();
        
        if (invErr) {
          console.error(`Error fetching inventory item for item ID ${item.item_id}:`, invErr);
          throw new Error(`تعذر العثور على الصنف "${item.name}" في قائمة المخزون الرئيسية.`);
        }

        const currentQty = Number(invItem.quantity || 0);
        const baseQty = Number(item.base_quantity || item.quantity || 0);

        let newQty = currentQty;
        if (finalOrderType === 'purchase') {
          newQty = currentQty + baseQty;
        } else if (finalOrderType === 'return') {
          newQty = currentQty - baseQty;
        }

        // Update central inventory_items
        const { error: updInvErr } = await supabase
          .from('inventory_items')
          .update({
            quantity: newQty,
            updated_at: new Date().toISOString()
          })
          .eq('id', item.item_id);
        
        if (updInvErr) throw updInvErr;

        // Update branch_inventory
        const { data: bInv } = await supabase
          .from('branch_inventory')
          .select('quantity')
          .eq('branch_id', activeBranchId)
          .eq('item_id', item.item_id)
          .maybeSingle();

        const currentBranchQty = Number(bInv?.quantity || 0);
        let newBranchQty = currentBranchQty;
        if (finalOrderType === 'purchase') {
          newBranchQty = currentBranchQty + baseQty;
        } else if (finalOrderType === 'return') {
          newBranchQty = currentBranchQty - baseQty;
        }

        if (bInv) {
          const { error: updBInvErr } = await supabase
            .from('branch_inventory')
            .update({
              quantity: newBranchQty,
              updated_at: new Date().toISOString()
            })
            .eq('branch_id', activeBranchId)
            .eq('item_id', item.item_id);

          if (updBInvErr) throw updBInvErr;
        } else {
          const { error: insBInvErr } = await supabase
            .from('branch_inventory')
            .insert({
              branch_id: activeBranchId,
              item_id: item.item_id,
              quantity: newBranchQty,
              tenant_id: tenantId,
              updated_at: new Date().toISOString()
            });

          if (insBInvErr) throw insBInvErr;
        }

        // Insert into stock_ledger log
        const { error: ledgerErr } = await supabase.from('stock_ledger').insert({
          item_id: item.item_id,
          branch_id: activeBranchId,
          type: finalOrderType === 'purchase' ? 'addition' : 'deduction',
          previous_quantity: currentBranchQty,
          new_quantity: newBranchQty,
          change: finalOrderType === 'purchase' ? baseQty : -baseQty,
          reference_id: order.id,
          reference_type: finalOrderType === 'purchase' ? 'purchase' : 'return',
          staff_id: currentStaff?.id || null,
          staff_name: currentStaff?.name || 'Staff',
          tenant_id: tenantId,
          created_at: new Date().toISOString()
        });

        if (ledgerErr) {
          console.warn('Could not write into stock ledger log:', ledgerErr);
        }
      }

      // 4. Update Supplier balance and write to transaction ledger
      const supplierIdResolved = orderDetails.supplier_id || order.supplier_id || order.supplierId;
      if (supplierIdResolved) {
        const { data: supplier, error: sErr } = await supabase
          .from('suppliers')
          .select('balance')
          .eq('id', supplierIdResolved)
          .single();
        
        if (!sErr && supplier) {
          const currentBalance = Number(supplier.balance || 0);
          const orderTotal = Number(orderDetails.total_amount || order.total_amount || order.totalAmount || 0);
          const isPurchase = finalOrderType === 'purchase';
          
          await addSupplierTransaction(
            tenantId,
            {
              supplier_id: supplierIdResolved,
              type: isPurchase ? 'purchase' : 'adjustment',
              credit: isPurchase ? orderTotal : 0,
              debit: isPurchase ? 0 : orderTotal,
              reference_number: orderNumberStr || `PO-${order.id.slice(-6).toUpperCase()}`,
              date: new Date().toISOString(),
              notes: isPurchase 
                ? `شراء بضائع ومواد بموجب أمر الشراء رقم ${orderNumberStr || order.id.slice(-6).toUpperCase()}`
                : `مرتجع بضائع ومواد بموجب سند إرجاع رقم ${orderNumberStr || order.id.slice(-6).toUpperCase()}`,
              tenant_id: tenantId,
            },
            currentBalance
          );
        }
      }

      // 5. Update order status to confirmed (received or returned for database ENUM compatibility)
      const targetStatus = finalOrderType === 'purchase' ? 'received' : 'returned';

      const { error: poUpdErr } = await supabase
        .from('purchase_orders')
        .update({
          status: targetStatus,
          received_date: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', order.id);

      if (poUpdErr) throw poUpdErr;

      toastSuccess(finalOrderType === 'return' ? 'تم تأكيد المرتجع وخصم المخزون وموازنة رصيد المورد بنجاح' : 'تم تأكيد أمر الشراء وإدخال الكميات للمخازن وزيادة مستحقات المورد بنجاح');
      setSelectedOrder(null);
      if (onRefresh) {
        onRefresh();
      }
    } catch (error: any) {
      console.error('Error in handleConfirmOrder:', error);
      toastError(error.message || 'فشل تأكيد المستند بشكل تام ومزامنته.');
    } finally {
      setIsConfirming(false);
    }
  };

  // Filter purchase orders
  const filteredOrders = purchaseOrders.filter(po => {
    // 1. Search filter
    const matchesSearch = 
      po.poNumber?.toLowerCase().includes(searchTerm.toLowerCase()) || 
      po.supplierName?.toLowerCase().includes(searchTerm.toLowerCase());
    
    // 2. Type filter
    const poType = po.orderType || (po as any).order_type || 'purchase';
    const matchesType = typeFilter === 'all' || poType === typeFilter;

    // 3. Status filter
    const poStatus = po.status || 'draft';
    let matchesStatus = statusFilter === 'all' || poStatus === statusFilter;
    if (statusFilter === 'confirmed') {
      matchesStatus = poStatus === 'confirmed' || poStatus === 'received' || poStatus === 'returned';
    } else if (statusFilter === 'draft') {
      matchesStatus = poStatus === 'draft';
    }

    return matchesSearch && matchesType && matchesStatus;
  });

  return (
    <div className="space-y-6 font-sans">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-surface p-6 rounded-3xl border border-border">
        <div>
          <h2 className="text-xl font-bold text-content flex items-center gap-2">
            <ArrowLeftRight className="text-brand" size={24} />
            <span>حركة المشتريات والمرتجعات</span>
          </h2>
          <p className="text-xs text-content-muted mt-1">تتبع وإدارة فواتير المشتريات المباشرة ومرتجعات الموردين مع التزامن الآلي للمخازن وحسابات الموردين.</p>
        </div>
        <div className="flex gap-3 w-full sm:w-auto">
          <button 
            onClick={() => {
              setModalType('purchase');
              setIsModalOpen(true);
            }}
            className="flex-1 sm:flex-initial bg-brand text-white px-5 py-3 rounded-2xl font-black text-sm flex items-center justify-center gap-2 hover:bg-brand/95 transition-all shadow-lg shadow-brand/10 active:scale-95 duration-100"
          >
            <Plus size={18} />
            <span>إنشاء أمر شراء</span>
          </button>
          <button 
            onClick={() => {
              setModalType('return');
              setIsModalOpen(true);
            }}
            className="flex-1 sm:flex-initial bg-danger text-white px-5 py-3 rounded-2xl font-black text-sm flex items-center justify-center gap-2 hover:bg-danger/95 transition-all shadow-lg shadow-danger/10 active:scale-95 duration-100"
          >
            <Plus size={18} />
            <span>أمر إرجاع بضاعة</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Search Input */}
        <div className="relative lg:col-span-2">
          <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-content-muted" size={18} />
          <input
            type="text"
            placeholder="بحث برقم السند أو اسم المورد..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-4 pr-12 py-3.5 bg-surface border border-border rounded-2xl focus:ring-2 focus:ring-brand outline-none text-content font-bold placeholder:text-content-muted/80 text-sm"
          />
        </div>

        {/* Type Filter Buttons */}
        <div className="bg-surface rounded-2xl p-1 border border-border flex items-center">
          <button
            onClick={() => setTypeFilter('all')}
            className={cn(
              "flex-1 text-center py-2 text-xs font-black rounded-xl transition-all",
              typeFilter === 'all' ? "bg-brand/10 text-brand font-extrabold" : "text-content-muted hover:text-content"
            )}
          >
            الكل
          </button>
          <button
            onClick={() => setTypeFilter('purchase')}
            className={cn(
              "flex-1 text-center py-2 text-xs font-black rounded-xl transition-all",
              typeFilter === 'purchase' ? "bg-brand text-white font-extrabold shadow" : "text-content-muted hover:text-content"
            )}
          >
            المشتريات
          </button>
          <button
            onClick={() => setTypeFilter('return')}
            className={cn(
              "flex-1 text-center py-2 text-xs font-black rounded-xl transition-all",
              typeFilter === 'return' ? "bg-danger text-white font-extrabold shadow" : "text-content-muted hover:text-content"
            )}
          >
            المرتجعات
          </button>
        </div>

        {/* Status Filter Buttons */}
        <div className="bg-surface rounded-2xl p-1 border border-border flex items-center">
          <button
            onClick={() => setStatusFilter('all')}
            className={cn(
              "flex-1 text-center py-2 text-[10px] sm:text-xs font-black rounded-xl transition-all",
              statusFilter === 'all' ? "bg-brand/10 text-brand" : "text-content-muted hover:text-content"
            )}
          >
            الحالة: الكل
          </button>
          <button
            onClick={() => setStatusFilter('draft')}
            className={cn(
              "flex-1 text-center py-2 text-[10px] sm:text-xs font-black rounded-xl transition-all",
              statusFilter === 'draft' ? "bg-neutral-200 dark:bg-neutral-800 text-content" : "text-content-muted hover:text-content"
            )}
          >
            مسودة
          </button>
          <button
            onClick={() => setStatusFilter('confirmed')}
            className={cn(
              "flex-1 text-center py-2 text-[10px] sm:text-xs font-black rounded-xl transition-all",
              statusFilter === 'confirmed' ? "bg-success/10 text-success" : "text-content-muted hover:text-content"
            )}
          >
            مؤكد
          </button>
        </div>
      </div>

      {/* Main Data Table */}
      <div className="bg-surface rounded-[2rem] border border-border overflow-hidden shadow-sm">
        <div className="overflow-x-auto whitespace-nowrap scrollbar-hide">
          <table className="w-full text-right min-w-max">
            <thead className="bg-surface-muted text-content-muted border-b border-border">
              <tr>
                <th className="px-6 py-4 font-black text-xs uppercase tracking-wider">نوع السند</th>
                <th className="px-6 py-4 font-black text-xs uppercase tracking-wider">رقم السند</th>
                <th className="px-6 py-4 font-black text-xs uppercase tracking-wider">المورد</th>
                <th className="px-6 py-4 font-black text-xs uppercase tracking-wider">مبلغ السند</th>
                <th className="px-6 py-4 font-black text-xs uppercase tracking-wider">التاريخ</th>
                <th className="px-6 py-4 font-black text-xs uppercase tracking-wider">الحالة</th>
                <th className="px-6 py-4 font-black text-xs uppercase tracking-wider"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredOrders.map(po => {
                const poType = po.orderType || (po as any).order_type || 'purchase';
                const poStatus = po.status || 'draft';
                return (
                  <tr key={po.id} className="text-content hover:bg-surface-muted/40 transition-colors">
                    <td className="px-6 py-4 font-bold text-sm">
                      {poType === 'purchase' ? (
                        <span className="px-2.5 py-1 text-xs font-black bg-brand/10 text-brand border border-brand/10 rounded-full">أمر شراء</span>
                      ) : (
                        <span className="px-2.5 py-1 text-xs font-black bg-danger/10 text-danger border border-danger/10 rounded-full">أمر إرجاع</span>
                      )}
                    </td>
                    <td className="px-6 py-4 font-mono font-bold text-sm text-content-muted">{po.poNumber || (po as any).po_number || po.id.slice(0, 8)}</td>
                    <td className="px-6 py-4 font-black text-sm text-content">{po.supplierName}</td>
                    <td className="px-6 py-4 font-black text-sm text-brand"><PriceDisplay amount={po.totalAmount} /></td>
                    <td className="px-6 py-4 text-xs font-bold text-content-muted">{new Date(po.orderDate).toLocaleDateString('ar-SA')}</td>
                    <td className="px-6 py-4">
                      {poStatus === 'confirmed' || poStatus === 'received' || poStatus === 'returned' ? (
                        <div className="flex items-center gap-1.5 text-success bg-success/10 px-3 py-1 rounded-full w-fit border border-success/10">
                          <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse"></span>
                          <span className="text-[10px] font-black">مؤكد ومرحل</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-content-muted bg-neutral-100 dark:bg-neutral-800 px-3 py-1 rounded-full w-fit">
                          <span className="w-1.5 h-1.5 rounded-full bg-neutral-400"></span>
                          <span className="text-[10px] font-black">مسودة (غير مفعل)</span>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-left">
                      <button
                        onClick={() => setSelectedOrder(po)}
                        className="p-2 bg-brand/10 text-brand hover:bg-brand hover:text-white rounded-xl transition-all flex items-center justify-center"
                      >
                        <Eye size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-20 text-center text-content-muted bg-surface-muted/50">
                    <Package className="mx-auto mb-4 opacity-20" size={56} />
                    <p className="font-bold text-base">لم يعثر على أي مستندات شراء تطابق الفلترة الحالية</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail view / Confirmation modal */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-3xl shadow-2xl w-full max-w-3xl overflow-hidden border border-border flex flex-col max-h-[85vh] animate-in fade-in zoom-in duration-150">
            <div className="p-6 border-b border-border flex justify-between items-center bg-surface-muted/40">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-black text-content">عرض تفاصيل المستند</h2>
                  <span className={cn(
                    "text-xs font-black px-2.5 py-1 rounded-full",
                    (selectedOrder.orderType || (selectedOrder as any).order_type) === 'purchase' ? "bg-brand/15 text-brand" : "bg-danger/15 text-danger"
                  )}>
                    {(selectedOrder.orderType || (selectedOrder as any).order_type) === 'purchase' ? 'مشتريات' : 'مرتجع مشتريات'}
                  </span>
                </div>
                <p className="text-xs text-content-muted mt-1">السند: <span className="font-mono font-bold text-content">{selectedOrder.poNumber || (selectedOrder as any).po_number || selectedOrder.id}</span></p>
              </div>
              <button 
                onClick={() => setSelectedOrder(null)} 
                className="text-content-muted hover:text-content p-2 hover:bg-surface rounded-full transition-all"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              {/* Order Info Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-surface-muted/50 rounded-2xl border border-border">
                  <span className="text-[10px] font-black uppercase text-content-muted">المورد المسؤول</span>
                  <p className="text-sm font-black text-content mt-1">{selectedOrder.supplierName}</p>
                </div>
                <div className="p-4 bg-surface-muted/50 rounded-2xl border border-border">
                  <span className="text-[10px] font-black uppercase text-content-muted">التاريخ</span>
                  <p className="text-sm font-black text-content mt-1">{new Date(selectedOrder.orderDate).toLocaleDateString('ar-SA')}</p>
                </div>
                <div className="p-4 bg-surface-muted/50 rounded-2xl border border-border">
                  <span className="text-[10px] font-black uppercase text-content-muted">حالة السند</span>
                  <div className="mt-1">
                    {(selectedOrder.status || 'draft') === 'confirmed' || (selectedOrder.status || 'draft') === 'received' ? (
                      <span className="text-success text-xs font-black bg-success/15 px-2.5 py-1 rounded-full">مؤكد ومرحل للمخزن</span>
                    ) : (
                      <span className="text-content-muted text-xs font-black bg-neutral-100 dark:bg-neutral-800 px-2.5 py-1 rounded-full">مسودة (انتظار التأكيد)</span>
                    )}
                  </div>
                </div>
              </div>

              {selectedOrder.notes && (
                <div className="p-4 bg-warning/5 border border-warning/10 rounded-2xl text-xs text-content">
                  <span className="font-black text-warning">ملاحظات:</span> {selectedOrder.notes}
                </div>
              )}

              {/* Items Table */}
              <div className="border border-border rounded-2xl overflow-hidden bg-surface">
                <table className="w-full text-right">
                  <thead className="bg-surface-muted text-content-muted">
                    <tr>
                      <th className="p-3 text-xs font-black">اسم المنتج / الصنف</th>
                      <th className="p-3 text-xs font-black">الكمية</th>
                      <th className="p-3 text-xs font-black">السعر للوحدة</th>
                      <th className="p-3 text-xs font-black">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {(selectedOrder.items || []).map((item, index) => (
                      <tr key={index} className="hover:bg-surface-muted/20">
                        <td className="p-3 text-sm font-bold text-content">{item.name}</td>
                        <td className="p-3 text-sm font-bold text-content">{item.quantity} {item.unit}</td>
                        <td className="p-3 text-sm font-bold text-content"><PriceDisplay amount={item.pricePerUnit} /></td>
                        <td className="p-3 text-sm font-black text-brand"><PriceDisplay amount={item.total} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="p-6 border-t border-border bg-surface-muted/40 flex flex-col sm:flex-row justify-between items-center gap-4">
              <div className="text-lg font-bold text-content">
                إجمالي قيمة السند: <span className="text-brand font-black text-2xl mr-2"><PriceDisplay amount={selectedOrder.totalAmount} /></span>
              </div>
              <div className="flex gap-3 w-full sm:w-auto">
                <button
                  onClick={() => setSelectedOrder(null)} 
                  className="flex-1 sm:flex-initial px-6 py-3 bg-surface border border-border hover:bg-surface-muted rounded-xl text-xs font-black transition-all"
                >
                  إغلاق نافذة التفاصيل
                </button>
                {selectedOrder.status === 'draft' && (
                  <button 
                    onClick={() => handleConfirmOrder(selectedOrder)}
                    disabled={isConfirming}
                    className="flex-1 sm:flex-initial bg-success text-white px-8 py-3 rounded-xl font-black text-xs flex items-center justify-center gap-2 hover:bg-success/90 transition-all shadow-lg active:scale-95 disabled:opacity-50"
                  >
                    {isConfirming ? (
                      <span>جاري المعالجة...</span>
                    ) : (
                      <>
                        <CheckCircle2 size={16} />
                        <span>تأكيد العملية (ترحيل ومزامنة)</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Order Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden border border-border flex flex-col max-h-[90vh] animate-in fade-in zoom-in duration-150">
            <div className="p-6 border-b border-border flex justify-between items-center bg-surface-muted/50">
              <div>
                <h2 className="text-xl font-black text-content">
                  {modalType === 'purchase' ? 'تسجيل أمر شراء جديد' : 'تسجيل مرتجع مشتريات'}
                </h2>
                <p className="text-xs text-content-muted mt-1">
                  قم باختيار المورد وتحديد قائمة الأصناف والأسعار لبناء فاتورة.
                </p>
              </div>
              <button onClick={() => {
                setIsModalOpen(false);
                setItems([]);
                setSelectedSupplier('');
              }} className="text-content-muted hover:text-content p-2 hover:bg-surface rounded-full">
                <X size={24} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              <div className="space-y-2">
                <label className="block text-xs font-black text-content-muted uppercase tracking-widest">المورد</label>
                <SmartSelect 
                  value={selectedSupplier}
                  onChange={(val) => setSelectedSupplier(val)}
                  placeholder="اختر المورد المسؤول..."
                  options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                />
              </div>

              <div className="bg-surface-muted/40 p-4 rounded-2xl border border-border space-y-4">
                <h3 className="font-bold text-sm text-content">إضافة أصناف لقائمة الفاتورة</h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="md:col-span-2">
                    <SmartSelect 
                      value={selectedItem}
                      onChange={(val) => setSelectedItem(val)}
                      placeholder="اختر صنف المخزن..."
                      options={inventory.map(i => ({ value: i.id, label: `${i.name} (${i.unit}) - متوفر: ${i.quantity}` }))}
                    />
                  </div>
                  <div>
                    <input 
                      type="number" 
                      placeholder="الكمية"
                      value={quantity || ''}
                      onChange={(e) => setQuantity(Number(e.target.value))}
                      className="w-full px-4 py-2 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-brand outline-none text-content font-bold text-sm"
                    />
                  </div>
                  <div>
                    <input 
                      type="number" 
                      placeholder="السعر / وحدة"
                      value={pricePerUnit || ''}
                      onChange={(e) => setPricePerUnit(Number(e.target.value))}
                      className="w-full px-4 py-2 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-brand outline-none text-content font-bold text-sm"
                    />
                  </div>
                </div>
                <button 
                  onClick={handleAddItem}
                  disabled={!selectedItem || quantity <= 0 || pricePerUnit <= 0}
                  className="w-full bg-brand/10 text-brand py-3 rounded-xl font-bold text-xs hover:bg-brand hover:text-white transition-all disabled:opacity-50"
                >
                  أضف الصنف لقائمة المستند
                </button>
              </div>

              {items.length > 0 && (
                <div className="border border-border rounded-2xl overflow-hidden bg-surface">
                  <table className="w-full text-right">
                    <thead className="bg-surface-muted text-content-muted">
                      <tr>
                        <th className="p-3 text-xs font-black">الصنف</th>
                        <th className="p-3 text-xs font-black">الكمية</th>
                        <th className="p-3 text-xs font-black">السعر</th>
                        <th className="p-3 text-xs font-black">الإجمالي</th>
                        <th className="p-3"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {items.map((item, idx) => (
                        <tr key={idx} className="hover:bg-surface-muted/30">
                          <td className="p-3 text-sm font-bold">{item.name}</td>
                          <td className="p-3 text-xs font-bold">{item.quantity} {item.unit}</td>
                          <td className="p-3 text-xs font-bold"><PriceDisplay amount={item.pricePerUnit} /></td>
                          <td className="p-3 text-sm font-black text-brand"><PriceDisplay amount={item.total} /></td>
                          <td className="p-3 text-left">
                            <button 
                              onClick={() => setItems(items.filter((_, i) => i !== idx))}
                              className="text-danger hover:bg-danger/10 p-1.5 rounded-xl transition-all"
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs font-black text-content-muted uppercase">ملاحظات المستند</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="ملاحظات تفصيلية حول السند أو سبب الارتجاع إن وجد..."
                  className="w-full px-4 py-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-brand outline-none h-20 resize-none font-medium text-sm text-content"
                />
              </div>
            </div>
            
            <div className="p-6 border-t border-border bg-surface-muted/50 flex flex-col sm:flex-row justify-between items-center gap-4">
              <div className="text-lg font-bold text-content">
                إجمالي القائمة: <span className="text-brand font-black"><PriceDisplay amount={items.reduce((sum, item) => sum + item.total, 0)} /></span>
              </div>
              <div className="flex gap-3 w-full sm:w-auto">
                <button
                  onClick={() => handleCreateOrder(false)}
                  disabled={isSubmitting || items.length === 0 || !selectedSupplier}
                  className="flex-1 sm:flex-initial bg-neutral-200 dark:bg-neutral-800 text-content px-5 py-3 rounded-xl font-bold text-xs hover:bg-neutral-300 dark:hover:bg-neutral-700 transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? 'جاري الحفظ...' : 'حفظ كمسودة (بدون ترحيل)'}
                </button>
                <button 
                  onClick={() => handleCreateOrder(true)}
                  disabled={isSubmitting || items.length === 0 || !selectedSupplier}
                  className="flex-1 sm:flex-initial bg-success text-white px-6 py-3 rounded-xl font-black text-xs hover:bg-success/90 transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? 'جاري الحفظ...' : 'حفظ وتأكيد السند (ترحيل آلي)'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
