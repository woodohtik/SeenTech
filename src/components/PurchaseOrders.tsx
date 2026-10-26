import React, { useState, useEffect } from 'react';
import { Plus, Package, CheckCircle2, Clock, Trash2, X, Search, Eye, Filter, ArrowLeftRight, Check, AlertCircle, RotateCcw, Printer } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { Supplier, PurchaseOrder, InventoryItem, PurchaseOrderItem, ProductVariant } from '../types';
import { listVariantsForTenant } from '../services/variantService';
import { cn } from '../lib/utils';
import { ResponsiveTable } from './ui/ResponsiveTable';
import { IconInput } from './ui/IconInput';
import { SmartSelect } from './ui/SmartSelect';
import { PriceDisplay } from './PriceDisplay';
import { useTranslation } from 'react-i18next';
import { getFriendlyErrorMessage } from '../lib/firebase';
import { useDirection } from '../lib/direction';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { useVerticalConfig } from '../hooks/useVerticalConfig';
import { useTenantCategoryPicker, ADD_NEW_CATEGORY_VALUE } from '../hooks/useTenantCategoryPicker';
import { LEGACY_INVENTORY_CATEGORY_SEED } from '../services/categoryService';
import { mapCategoryKeyToLegacyCategory } from '../services/verticalService';
import { encodeInventoryDescription } from '../utils/b2bHelper';

/**
 * seen-fields-categories-referral-task.md #3 -- قيمة خاصة لعنصر "+ إضافة
 * منتج جديد" في نهاية قائمة اختيار الصنف. الرصيد الافتتاحي حُذف من نموذج
 * إضافة منتج (InventoryManager.tsx)، فهذا هو المسار الوحيد المتبقي لإنشاء
 * منتج جديد ومنحه رصيداً حقيقياً: يُنشأ هنا برصيد صفر، ثم كمية الاستلام في
 * نفس بند أمر الشراء هذا تصبح رصيده الافتتاحي الحقيقي عند تأكيد الأمر
 * (handleConfirmOrder أدناه، عبر RPC confirm_purchase_order).
 */
const ADD_NEW_ITEM_VALUE = '__add_new_item__';

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
  const { dir, isRtl } = useDirection();
  const { error: toastError, success: toastSuccess } = useToast();
  const { confirm } = useConfirm();

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
  // seen-ux-fixes-batch-task.md item 10 -- purchasing an item with variants
  // now requires picking which one (selectedVariantId below) before it can
  // be added to the order; a 'return', though, still can't be traced back
  // to which variant was actually purchased (supplier purchase history is
  // tracked per item_id only), so that mode keeps excluding them.
  const [itemVariantsByItem, setItemVariantsByItem] = useState<Record<string, ProductVariant[]>>({});
  const [selectedVariantId, setSelectedVariantId] = useState('');

  useEffect(() => {
    if (!tenantId) return;
    listVariantsForTenant(tenantId)
      .then(setItemVariantsByItem)
      .catch(() => setItemVariantsByItem({}));
  }, [tenantId]);

  const selectedItemVariants = itemVariantsByItem[selectedItem] || [];

  // seen-fields-categories-referral-task.md #3 -- "+ إضافة منتج جديد" مضمَّن
  // في قائمة اختيار الصنف، بنفس نمط useTenantCategoryPicker الموجود فعلاً.
  const { inventoryCategories, isLegacyVertical } = useVerticalConfig();
  const newItemCategorySeed = isLegacyVertical
    ? LEGACY_INVENTORY_CATEGORY_SEED
    : inventoryCategories.map((c: any) => ({ category_key: c.category_key, label_ar: c.label_ar }));
  const newItemCategoryPicker = useTenantCategoryPicker(tenantId, 'inventory', newItemCategorySeed);
  const [isAddingNewItem, setIsAddingNewItem] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategoryKey, setNewItemCategoryKey] = useState('');
  const [newItemUnit, setNewItemUnit] = useState('meter');
  const [newItemCostPrice, setNewItemCostPrice] = useState(0);
  const [newItemSellingPrice, setNewItemSellingPrice] = useState(0);
  const [savingNewItem, setSavingNewItem] = useState(false);

  const cancelAddNewItem = () => {
    setIsAddingNewItem(false);
    setNewItemName('');
    setNewItemCategoryKey('');
    setNewItemUnit('meter');
    setNewItemCostPrice(0);
    setNewItemSellingPrice(0);
  };

  const handleSaveNewItem = async () => {
    if (!newItemName.trim() || !newItemCategoryKey || newItemCostPrice <= 0 || newItemSellingPrice <= 0) {
      toastError(t('inventory.missing_fields_prompt', { fields: t('inventory.item_name') }));
      return;
    }
    setSavingNewItem(true);
    try {
      const { data: branches } = await supabase.from('branches').select('id, is_main').eq('tenant_id', tenantId);
      const sku = Math.floor(10000000 + Math.random() * 90000000).toString();
      const { data: item, error: itemError } = await supabase
        .from('inventory_items')
        .insert({
          name: newItemName.trim(),
          category: mapCategoryKeyToLegacyCategory(newItemCategoryKey),
          category_key: newItemCategoryKey,
          unit: newItemUnit,
          conversion_rate: 1,
          min_threshold: 10,
          price_per_unit: newItemSellingPrice,
          description: encodeInventoryDescription(newItemCostPrice, 'exclusive', ''),
          sku,
          barcode: Math.random().toString().substring(2, 12),
          quantity: 0,
          show_in_pos: true,
          opening_balance: 0,
          tenant_id: tenantId,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (itemError) throw itemError;

      if (branches && branches.length > 0) {
        await supabase.from('branch_inventory').insert(
          branches.map((b: any) => ({
            branch_id: b.id,
            item_id: item.id,
            quantity: 0,
            tenant_id: tenantId,
            updated_at: new Date().toISOString(),
          }))
        );
      }

      // يُضاف مباشرة كبند في قائمة الفاتورة الحالية -- لا ننتظر تحديث
      // قائمة inventory القادمة من المكوّن الأب (onRefresh غير متزامن).
      const newPoItem: PurchaseOrderItem = {
        itemId: item.id,
        name: item.name,
        quantity,
        unit: item.unit,
        conversionRate: 1,
        baseQuantity: quantity,
        pricePerUnit,
        total: quantity * pricePerUnit,
      };
      setItems((prev) => [...prev, newPoItem]);
      setSelectedItem('');
      setQuantity(1);
      setPricePerUnit(0);
      cancelAddNewItem();
      onRefresh?.();
      toastSuccess(t('inventory.item_added_success', 'تمت إضافة المنتج بنجاح'));
    } catch (error: any) {
      toastError(error ? getFriendlyErrorMessage(error) : t('inventory.save_failed', 'فشل الحفظ'));
    } finally {
      setSavingNewItem(false);
    }
  };

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
          // pin_hash intentionally excluded -- SELECT on it is revoked for
          // authenticated/anon at the DB level (see rls-audit fix migration).
          const { data: staff } = await supabase
            .from('staff')
            .select('id, tenant_id, uid, name, email, phone, role, role_id, branch_id, status, must_change_pin, is_test, commission_type, commission_value, has_seen_onboarding, created_at, updated_at')
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
    if (selectedItemVariants.length > 0 && !selectedVariantId) return;
    const variant = selectedVariantId ? selectedItemVariants.find(v => v.id === selectedVariantId) : undefined;

    const rate = Number(invItem.conversionRate || (invItem as any).conversion_rate || 1);
    const newItem: PurchaseOrderItem = {
      itemId: invItem.id,
      variantId: variant?.id,
      name: variant ? `${invItem.name} — ${variant.name}` : invItem.name,
      quantity,
      unit: invItem.unit,
      conversionRate: rate,
      baseQuantity: quantity * rate,
      pricePerUnit,
      total: quantity * pricePerUnit
    };

    setItems([...items, newItem]);
    setSelectedItem('');
    setSelectedVariantId('');
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

      // One atomic, idempotent RPC (seen-deep-technical-audit.md High #9) --
      // was: INSERT purchase_orders then a disconnected second INSERT
      // purchase_order_items, no idempotency key. A dropped connection after
      // the header insert left a permanent empty draft PO; a double-submit
      // could create two. operationId doubles as the new PO's id, so a
      // retried submission can never create it twice (same pattern as
      // create_pos_sale for POS checkout).
      const operationId = globalThis.crypto.randomUUID();
      const { data: rpcResult, error: poError } = await supabase.rpc('create_purchase_order', {
        p_operation_id: operationId,
        p_header: {
          supplier_id: selectedSupplier,
          branch_id: realBranchId,
          po_number: orderNumber,
          notes: notes || null,
        },
        p_items: items.map(item => ({
          item_id: item.itemId,
          variant_id: item.variantId || null,
          name: item.name,
          quantity: item.quantity,
          unit: item.unit,
          conversion_rate: item.conversionRate,
          base_quantity: item.baseQuantity,
          price_per_unit: item.pricePerUnit,
          total: item.total
        })),
      });

      if (poError) throw poError;
      if (!rpcResult?.purchase_order_id) throw new Error(t('procurement.failed_to_create_po', 'فشل إنشاء الطلب'));

      // handleConfirmOrder shows its own success toast when isConfirmImmediately
      // -- showing "created as draft" here too was misleading on that path.
      if (!isConfirmImmediately) {
        toastSuccess(modalType === 'purchase' ? t('procurement.po_draft_created', 'تم إنشاء السند كمسودة') : t('procurement.return_draft_created', 'تم إنشاء مرتجع المشتريات كمسودة'));
      }

      const foundSupplier = suppliers.find(s => (s.id || '').toLowerCase().trim() === selectedSupplier.toLowerCase().trim());

      const finalOrderObject = {
        id: rpcResult.purchase_order_id,
        supplierId: selectedSupplier,
        supplierName: foundSupplier?.name || t('procurement.supplier_name_fallback'),
        po_number: orderNumber,
        total_amount: rpcResult.total_amount,
        totalAmount: rpcResult.total_amount,
        paidAmount: 0,
        remainingAmount: rpcResult.total_amount,
        status: 'draft',
        orderType: orderNumber.startsWith('RET') ? 'return' : 'purchase',
        orderDate: new Date().toISOString(),
        branch_id: realBranchId,
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
      toastError(error ? getFriendlyErrorMessage(error) : t('procurement.failed_to_create_po', 'فشل بناء السند'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmOrder = async (order: any, skipConfirmationAlert = false) => {
    if (!order || !order.id) {
      toastError(t('procurement.invalid_po_id', 'خطأ: لم يتم تلقي معرّف السند بشكل صحيح.'));
      return;
    }

    if (!skipConfirmationAlert) {
      if (!(await confirm(t('procurement.confirm_process_warning')))) return;
    }
    setIsConfirming(true);
    try {
      // Read-only validation fetch -- keeps today's friendly client-side
      // error messages (missing items). The actual mutation no longer
      // happens here: it all runs inside confirm_purchase_order below.
      const { data: orderDetails, error: fetchErr } = await supabase
        .from('purchase_orders')
        .select('po_number, purchase_order_items(id)')
        .eq('id', order.id)
        .single();

      if (fetchErr) throw fetchErr;
      if (!orderDetails) throw new Error(t('procurement.po_details_not_found'));
      if (!orderDetails.purchase_order_items || orderDetails.purchase_order_items.length === 0) {
        throw new Error(t('procurement.no_items_to_confirm'));
      }

      // Determine order type dynamically and robustly (RET- prefix represents return/refund)
      const orderNumberStr = orderDetails.po_number || order.po_number || order.poNumber || '';
      const finalOrderType = orderNumberStr.startsWith('RET') ? 'return' : 'purchase';

      // مراجعة-الفريق-التقني-الكامل-2026-10-19.md (قاعدة بيانات، عالية):
      // كانت هذه الدالة 3 طلبات شبكة منفصلة تُطبِّق كل أثرها (خصم/إضافة
      // مخزون لكل بند، تحديث رصيد المورد، تحديث حالة السند) بلا معاملة
      // واحدة تجمعها -- انقطاع الاتصال بين أي خطوتين كان يترك حالة جزئية
      // مرئية (أثر مُطبَّق فعلياً، والسند لا يزال "مسودة"). RPC واحد
      // ذرّي (confirm_purchase_order، 20261019060000_atomic_confirm_purchase_order.sql)
      // يؤدي الخطوات الثلاث داخل معاملة قاعدة بيانات واحدة، بنفس مفاتيح
      // idempotency المستخدَمة سابقاً (po:<order_id>:item:<item_id> للمخزون،
      // order.id لرصيد المورد) فيستأنف بأمان أي تأكيد قديم بالنمط السابق
      // انقطع منتصف الطريق دون تكرار أي أثر سبق تطبيقه.
      const { error: confirmErr } = await supabase.rpc('confirm_purchase_order', {
        p_order_id: order.id,
      });
      if (confirmErr) throw confirmErr;

      toastSuccess(finalOrderType === 'return' ? t('procurement.return_confirmed_success') : t('procurement.po_confirmed_success'));
      setSelectedOrder(null);
      if (onRefresh) {
        onRefresh();
      }
    } catch (error: any) {
      console.error('Error in handleConfirmOrder:', error);
      toastError(error ? getFriendlyErrorMessage(error) : t('procurement.confirm_doc_failed'));
    } finally {
      setIsConfirming(false);
    }
  };

  // Item IDs actually received from a given supplier -- used to restrict the
  // return modal's item picker to products that supplier really sold us,
  // instead of the entire inventory catalog.
  const getSupplierPurchasedItemIds = (supplierId: string) => {
    const ids = new Set<string>();
    purchaseOrders.forEach(po => {
      const poType = po.orderType || (po as any).order_type || 'purchase';
      const poSupplierId = po.supplierId || (po as any).supplier_id;
      if (poType !== 'purchase' || poSupplierId !== supplierId) return;
      if ((po.status || 'draft') !== 'received') return;
      (po.items || []).forEach(item => {
        if (item.itemId) ids.add(item.itemId);
      });
    });
    return ids;
  };

  const supplierPurchasedItemIds = modalType === 'return' && selectedSupplier
    ? getSupplierPurchasedItemIds(selectedSupplier)
    : null;

  const itemSelectOptions = [
    ...(supplierPurchasedItemIds
      ? inventory.filter(i => supplierPurchasedItemIds.has(i.id))
      : inventory
    )
      .filter(i => modalType !== 'return' || !itemVariantsByItem[i.id]?.length)
      .map(i => ({ value: i.id, label: t('procurement.item_option_label', { name: i.name, unit: i.unit, quantity: i.quantity }) })),
    ...(modalType === 'purchase'
      ? [{ value: ADD_NEW_ITEM_VALUE, label: t('procurement.add_new_item_option', '+ إضافة منتج جديد') }]
      : []),
  ];

  // What we actually paid this supplier for this item (weighted average
  // across their received purchases) -- a return must credit back the real
  // purchase price, not a price the staff member types in freehand.
  const getSupplierItemPrice = (supplierId: string, itemId: string): number | null => {
    let cost = 0;
    let qty = 0;
    purchaseOrders.forEach(po => {
      const poType = po.orderType || (po as any).order_type || 'purchase';
      const poSupplierId = po.supplierId || (po as any).supplier_id;
      if (poType !== 'purchase' || poSupplierId !== supplierId || (po.status || 'draft') !== 'received') return;
      (po.items || []).forEach(item => {
        if (item.itemId !== itemId) return;
        cost += Number(item.total || 0);
        qty += Number(item.baseQuantity || item.quantity || 0);
      });
    });
    return qty > 0 ? cost / qty : null;
  };

  // Pre-fills the return modal from a specific received purchase order: same
  // supplier and the exact items/quantities that order brought in, so the
  // staff member is adjusting a real invoice instead of rebuilding one from
  // scratch and risking a mismatched supplier/item combination.
  const handleStartReturnFromOrder = (po: PurchaseOrder) => {
    setModalType('return');
    setSelectedSupplier(po.supplierId || (po as any).supplier_id || '');
    setItems((po.items || []).map(item => ({ ...item })));
    setNotes(t('procurement.return_from_po_note', { number: po.poNumber || (po as any).po_number || po.id.slice(0, 8) }));
    setIsModalOpen(true);
  };

  // seen-ux-fixes-batch-task.md #5: no purchase-order printing existed at
  // all. Prints the detail modal's own visible content (same technique
  // TaxInvoices.tsx uses on its #print-area -- printElementDetailed clones
  // whatever DOM is there, no separate hidden template needed) rather than
  // building a whole second printable layout for an internal document.
  const [isPrintingPO, setIsPrintingPO] = useState(false);
  const handlePrintPO = async (po: PurchaseOrder) => {
    setIsPrintingPO(true);
    try {
      const { printElementDetailed } = await import('../utils/printManager');
      const res = await printElementDetailed('po-detail-print-area', {
        paperSize: 'A4',
        title: t('procurement.po_number', 'رقم السند') + ': ' + (po.poNumber || (po as any).po_number || po.id),
      });
      if (!res.ok) {
        toastError(t('printing.print_failed'), res.message);
      }
    } catch (e) {
      console.error('[PurchaseOrders] print error:', e);
      window.print();
    } finally {
      setIsPrintingPO(false);
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
            <span>{t('procurement.po_movement_title', 'حركة المشتريات والمرتجعات')}</span>
          </h2>
          <p className="text-xs text-content-muted mt-1">{t('procurement.po_movement_subtitle', 'تتبع وإدارة فواتير المشتريات المباشرة ومرتجعات الموردين مع التزامن الآلي للمخازن وحسابات الموردين.')}</p>
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
            <span>{t('procurement.create_po', 'إنشاء أمر شراء')}</span>
          </button>
          <button 
            onClick={() => {
              setModalType('return');
              setIsModalOpen(true);
            }}
            className="flex-1 sm:flex-initial bg-danger text-white px-5 py-3 rounded-2xl font-black text-sm flex items-center justify-center gap-2 hover:bg-danger/95 transition-all shadow-lg shadow-danger/10 active:scale-95 duration-100"
          >
            <Plus size={18} />
            <span>{t('procurement.create_return_order', 'أمر إرجاع بضاعة')}</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
        {/* Search Input */}
        <IconInput
          type="text"
          startIcon={Search}
          placeholder={t('procurement.search_po_placeholder', 'بحث برقم السند أو اسم المورد...')}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          containerClassName="lg:col-span-2"
        />

        {/* Type Filter Buttons */}
        <div className="bg-surface rounded-2xl p-1 border border-border flex items-center">
          <button
            onClick={() => setTypeFilter('all')}
            className={cn(
              "flex-1 text-center py-2 text-xs font-black rounded-xl transition-all",
              typeFilter === 'all' ? "bg-brand/10 text-brand font-extrabold" : "text-content-muted hover:text-content"
            )}
          >
            {t('procurement.category_all', 'الكل')}
          </button>
          <button
            onClick={() => setTypeFilter('purchase')}
            className={cn(
              "flex-1 text-center py-2 text-xs font-black rounded-xl transition-all",
              typeFilter === 'purchase' ? "bg-brand text-white font-extrabold shadow" : "text-content-muted hover:text-content"
            )}
          >
            {t('procurement.filter_purchase', 'المشتريات')}
          </button>
          <button
            onClick={() => setTypeFilter('return')}
            className={cn(
              "flex-1 text-center py-2 text-xs font-black rounded-xl transition-all",
              typeFilter === 'return' ? "bg-danger text-white font-extrabold shadow" : "text-content-muted hover:text-content"
            )}
          >
            {t('procurement.returns', 'المرتجعات')}
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
            {t('procurement.po_status', 'الحالة')}: {t('procurement.category_all', 'الكل')}
          </button>
          <button
            onClick={() => setStatusFilter('draft')}
            className={cn(
              "flex-1 text-center py-2 text-[10px] sm:text-xs font-black rounded-xl transition-all",
              statusFilter === 'draft' ? "bg-surface-muted text-content" : "text-content-muted hover:text-content"
            )}
          >
            {t('procurement.po_status_draft', 'مسودة')}
          </button>
          <button
            onClick={() => setStatusFilter('confirmed')}
            className={cn(
              "flex-1 text-center py-2 text-[10px] sm:text-xs font-black rounded-xl transition-all",
              statusFilter === 'confirmed' ? "bg-success/10 text-success" : "text-content-muted hover:text-content"
            )}
          >
            {t('procurement.po_status_confirmed_short', 'مؤكد')}
          </button>
        </div>
      </div>

      {/* Main Data Table & Mobile Cards */}
      <div className="bg-surface rounded-2xl border border-border overflow-hidden shadow-sm">
        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto whitespace-nowrap scrollbar-hide">
          <table className="w-full text-right min-w-max">
            <thead className="bg-surface-muted text-content-muted border-b border-border">
              <tr>
                <th className="px-6 py-4 font-black text-xs uppercase tracking-wider">{t('procurement.po_type', 'نوع السند')}</th>
                <th className="px-6 py-4 font-black text-xs uppercase tracking-wider">{t('procurement.po_number', 'رقم السند')}</th>
                <th className="px-6 py-4 font-black text-xs uppercase tracking-wider">{t('procurement.po_supplier', 'المورد')}</th>
                <th className="px-6 py-4 font-black text-xs uppercase tracking-wider">{t('procurement.po_amount', 'مبلغ السند')}</th>
                <th className="px-6 py-4 font-black text-xs uppercase tracking-wider">{t('procurement.po_date', 'التاريخ')}</th>
                <th className="px-6 py-4 font-black text-xs uppercase tracking-wider">{t('procurement.po_status', 'الحالة')}</th>
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
                        <span className="px-2.5 py-1 text-xs font-black bg-brand/10 text-brand border border-brand/10 rounded-full">{t('procurement.po_type_purchase', 'أمر شراء')}</span>
                      ) : (
                        <span className="px-2.5 py-1 text-xs font-black bg-danger/10 text-danger border border-danger/10 rounded-full">{t('procurement.po_type_return', 'أمر إرجاع')}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 font-mono font-bold text-sm text-content-muted">{po.poNumber || (po as any).po_number || po.id.slice(0, 8)}</td>
                    <td className="px-6 py-4 font-black text-sm text-content">{po.supplierName}</td>
                    <td className="px-6 py-4 font-black text-sm text-brand"><PriceDisplay amount={po.totalAmount} /></td>
                    <td className="px-6 py-4 text-xs font-bold text-content-muted">{new Date(po.orderDate).toLocaleDateString('ar-SA-u-nu-latn')}</td>
                    <td className="px-6 py-4">
                      {poStatus === 'confirmed' || poStatus === 'received' || poStatus === 'returned' ? (
                        <div className="flex items-center gap-1.5 text-success bg-success/10 px-3 py-1 rounded-full w-fit border border-success/10">
                          <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse"></span>
                          <span className="text-[10px] font-black">{t('procurement.po_status_confirmed', 'مؤكد ومرحل')}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-content-muted bg-surface-muted px-3 py-1 rounded-full w-fit">
                          <span className="w-1.5 h-1.5 rounded-full bg-content-muted"></span>
                          <span className="text-[10px] font-black">{t('procurement.po_status_draft', 'مسودة')}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-left">
                      <div className="flex items-center justify-end gap-2">
                        {poType === 'purchase' && poStatus === 'received' && (
                          <button
                            onClick={() => handleStartReturnFromOrder(po)}
                            className="min-w-[40px] min-h-[40px] p-2 bg-danger/10 text-danger hover:bg-danger hover:text-white rounded-xl transition-all flex items-center justify-center cursor-pointer"
                            title={t('procurement.return_goods', 'إرجاع بضاعة')}
                          >
                            <RotateCcw size={16} />
                          </button>
                        )}
                        <button
                          onClick={() => setSelectedOrder(po)}
                          className="min-w-[40px] min-h-[40px] p-2 bg-brand/10 text-brand hover:bg-brand hover:text-white rounded-xl transition-all flex items-center justify-center cursor-pointer"
                          title={t('procurement.po_detail_title', 'عرض التفاصيل')}
                        >
                          <Eye size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-20 text-center text-content-muted bg-surface-muted/50">
                    <Package className="mx-auto mb-4 opacity-20" size={56} />
                    <p className="font-bold text-base">{t('procurement.po_no_data', 'لم يعثر على أي مستندات شراء تطابق الفلترة الحالية')}</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards View */}
        <div className={cn("block md:hidden divide-y divide-border", isRtl ? "text-right" : "text-left")} dir={dir}>
          {filteredOrders.map(po => {
            const poType = po.orderType || (po as any).order_type || 'purchase';
            const poStatus = po.status || 'draft';
            return (
              <div key={po.id} className="p-4 space-y-3 hover:bg-surface-muted/10 transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-content-muted font-bold">
                    {new Date(po.orderDate).toLocaleDateString('ar-SA-u-nu-latn')}
                  </span>
                  <div>
                    {poType === 'purchase' ? (
                      <span className="px-2 py-0.5 text-[9px] font-black bg-brand/10 text-brand rounded-full">{t('procurement.po_type_purchase', 'أمر شراء')}</span>
                    ) : (
                      <span className="px-2 py-0.5 text-[9px] font-black bg-danger/10 text-danger rounded-full">{t('procurement.po_type_return', 'أمر إرجاع')}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-black text-content text-sm">{po.supplierName}</h3>
                    <p className="text-[10px] text-content-muted font-mono mt-0.5">
                      {t('procurement.po_number', 'رقم السند')}: {po.poNumber || (po as any).po_number || po.id.slice(0, 8)}
                    </p>
                  </div>
                  <div className="text-left">
                    <span className="text-xs text-content-muted block text-[10px] font-bold">{t('procurement.po_amount', 'القيمة')}</span>
                    <span className="text-sm font-black text-brand">
                      <PriceDisplay amount={po.totalAmount} />
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <div>
                    {poStatus === 'confirmed' || poStatus === 'received' || poStatus === 'returned' ? (
                      <div className="flex items-center gap-1 text-success bg-success/10 px-2.5 py-0.5 rounded-full border border-success/10">
                        <span className="w-1 h-1 rounded-full bg-success"></span>
                        <span className="text-[9px] font-black">{t('procurement.po_status_confirmed', 'مؤكد ومرحل')}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-content-muted bg-surface-muted px-2.5 py-0.5 rounded-full">
                        <span className="w-1 h-1 rounded-full bg-content-muted"></span>
                        <span className="text-[9px] font-black">{t('procurement.po_status_draft', 'مسودة')}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {poType === 'purchase' && poStatus === 'received' && (
                      <button
                        onClick={() => handleStartReturnFromOrder(po)}
                        className="flex items-center justify-center gap-1.5 bg-danger/10 text-danger px-3 py-1.5 rounded-xl text-[10px] font-black hover:bg-danger hover:text-white transition-all cursor-pointer min-h-[38px]"
                      >
                        <RotateCcw size={13} />
                        <span>{t('procurement.return_goods', 'إرجاع بضاعة')}</span>
                      </button>
                    )}
                    <button
                      onClick={() => setSelectedOrder(po)}
                      className="flex items-center justify-center gap-1.5 bg-brand/10 text-brand px-3 py-1.5 rounded-xl text-[10px] font-black hover:bg-brand hover:text-white transition-all cursor-pointer min-h-[38px]"
                    >
                      <Eye size={13} />
                      <span>{t('procurement.po_detail_title', 'عرض التفاصيل')}</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {filteredOrders.length === 0 && (
            <div className="p-8 text-center text-content-muted bg-surface-muted/30">
              <Package className="mx-auto mb-3 opacity-20" size={40} />
              <p className="text-xs font-bold">{t('procurement.po_no_data', 'لم يعثر على أي مستندات شراء تطابق الفلترة الحالية')}</p>
            </div>
          )}
        </div>
      </div>

      {/* Detail view / Confirmation modal */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 overflow-y-auto p-0 sm:p-4">
          <div className="bg-surface rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-3xl overflow-hidden border border-border flex flex-col max-h-[90vh] sm:max-h-[85vh] animate-in fade-in zoom-in duration-150">
            <div className="p-6 border-b border-border flex justify-between items-center bg-surface-muted/40">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-black text-content">{t('procurement.po_detail_title', 'عرض تفاصيل المستند')}</h2>
                  <span className={cn(
                    "text-xs font-black px-2.5 py-1 rounded-full",
                    (selectedOrder.orderType || (selectedOrder as any).order_type) === 'purchase' ? "bg-brand/15 text-brand" : "bg-danger/15 text-danger"
                  )}>
                    {(selectedOrder.orderType || (selectedOrder as any).order_type) === 'purchase' ? t('procurement.po_type_purchase', 'أمر شراء') : t('procurement.po_type_return', 'أمر إرجاع')}
                  </span>
                </div>
                <p className="text-xs text-content-muted mt-1">{t('procurement.po_number', 'رقم السند')}: <span className="font-mono font-bold text-content">{selectedOrder.poNumber || (selectedOrder as any).po_number || selectedOrder.id}</span></p>
              </div>
              <button 
                onClick={() => setSelectedOrder(null)} 
                className="text-content-muted hover:text-content p-2 hover:bg-surface rounded-full transition-all"
              >
                <X size={24} />
              </button>
            </div>

            <div id="po-detail-print-area" className="p-6 overflow-y-auto flex-1 space-y-6">
              {selectedOrder.status === 'draft' && (
                <div className="text-center text-xs font-black text-warning uppercase tracking-widest print:block">
                  {t('procurement.po_status_draft', 'مسودة')}
                </div>
              )}
              {/* Order Info Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-surface-muted/50 rounded-2xl border border-border">
                  <span className="text-[10px] font-black uppercase text-content-muted">{t('procurement.po_responsible_supplier', 'المورد المسؤول')}</span>
                  <p className="text-sm font-black text-content mt-1">{selectedOrder.supplierName}</p>
                </div>
                <div className="p-4 bg-surface-muted/50 rounded-2xl border border-border">
                  <span className="text-[10px] font-black uppercase text-content-muted">{t('procurement.po_date', 'التاريخ')}</span>
                  <p className="text-sm font-black text-content mt-1">{new Date(selectedOrder.orderDate).toLocaleDateString('ar-SA-u-nu-latn')}</p>
                </div>
                <div className="p-4 bg-surface-muted/50 rounded-2xl border border-border">
                  <span className="text-[10px] font-black uppercase text-content-muted">{t('procurement.po_status_lbl', 'حالة السند')}</span>
                  <div className="mt-1">
                    {(selectedOrder.status || 'draft') === 'confirmed' || (selectedOrder.status || 'draft') === 'received' ? (
                      <span className="text-success text-xs font-black bg-success/15 px-2.5 py-1 rounded-full">{t('procurement.po_status_confirmed_desc', 'مؤكد ومرحل للمخزن')}</span>
                    ) : (
                      <span className="text-content-muted text-xs font-black bg-surface-muted px-2.5 py-1 rounded-full">{t('procurement.po_status_draft_desc', 'مسودة (انتظار التأكيد)')}</span>
                    )}
                  </div>
                </div>
              </div>

              {selectedOrder.notes && (
                <div className="p-4 bg-warning/5 border border-warning/10 rounded-2xl text-xs text-content">
                  <span className="font-black text-warning">{t('procurement.po_notes', 'ملاحظات')}:</span> {selectedOrder.notes}
                </div>
              )}

              {/* Items Table */}
              <div className="border border-border rounded-2xl bg-surface overflow-hidden">
                <ResponsiveTable
                  breakpoint="md"
                  cards={(selectedOrder.items || []).map((item, index) => (
                    <div key={index} className="p-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-content truncate">{item.name}</div>
                        <div className="text-xs text-content-muted mt-0.5">{item.quantity} {item.unit} &times; <PriceDisplay amount={item.pricePerUnit} /></div>
                      </div>
                      <div className="text-sm font-black text-brand shrink-0"><PriceDisplay amount={item.total} /></div>
                    </div>
                  ))}
                  table={
                    <table className="w-full text-right min-w-max">
                      <thead className="bg-surface-muted text-content-muted">
                        <tr>
                          <th className="p-3 text-xs font-black">{t('procurement.item_name', 'اسم المنتج / الصنف')}</th>
                          <th className="p-3 text-xs font-black">{t('procurement.quantity', 'الكمية')}</th>
                          <th className="p-3 text-xs font-black">{t('procurement.price_per_unit', 'السعر للوحدة')}</th>
                          <th className="p-3 text-xs font-black">{t('procurement.total', 'الإجمالي')}</th>
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
                  }
                />
              </div>
            </div>

            <div className="p-6 border-t border-border bg-surface-muted/40 flex flex-col sm:flex-row justify-between items-center gap-4">
              <div className="text-lg font-bold text-content">
                {t('procurement.total_po_amount', 'إجمالي قيمة السند')}: <span className="text-brand font-black text-2xl mr-2"><PriceDisplay amount={selectedOrder.totalAmount} /></span>
              </div>
              <div className="flex gap-3 w-full sm:w-auto">
                <button
                  onClick={() => setSelectedOrder(null)}
                  className="flex-1 sm:flex-initial px-6 py-3 bg-surface border border-border hover:bg-surface-muted rounded-xl text-xs font-black transition-all"
                >
                  {t('procurement.close_detail_modal', 'إغلاق نافذة التفاصيل')}
                </button>
                <button
                  onClick={() => handlePrintPO(selectedOrder)}
                  disabled={isPrintingPO}
                  className="flex-1 sm:flex-initial px-6 py-3 bg-surface border border-border hover:bg-surface-muted rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Printer size={16} />
                  <span>{t('procurement.print_voucher', 'طباعة السند')}</span>
                </button>
                {selectedOrder.status === 'draft' && (
                  <button
                    onClick={() => handleConfirmOrder(selectedOrder)}
                    disabled={isConfirming}
                    className="flex-1 sm:flex-initial bg-success text-white px-8 py-3 rounded-xl font-black text-xs flex items-center justify-center gap-2 hover:bg-success/90 transition-all shadow-lg active:scale-95 disabled:opacity-50"
                  >
                    {isConfirming ? (
                      <span>{t('procurement.processing', 'جاري المعالجة...')}</span>
                    ) : (
                      <>
                        <CheckCircle2 size={16} />
                        <span>{t('procurement.confirm_process_sync', 'تأكيد العملية (ترحيل ومزامنة)')}</span>
                      </>
                    )}
                  </button>
                )}
                {(selectedOrder.orderType || (selectedOrder as any).order_type) === 'purchase' && selectedOrder.status === 'received' && (
                  <button
                    onClick={() => {
                      handleStartReturnFromOrder(selectedOrder);
                      setSelectedOrder(null);
                    }}
                    className="flex-1 sm:flex-initial bg-danger text-white px-8 py-3 rounded-xl font-black text-xs flex items-center justify-center gap-2 hover:bg-danger/90 transition-all shadow-lg active:scale-95"
                  >
                    <RotateCcw size={16} />
                    <span>{t('procurement.return_goods', 'إرجاع بضاعة')}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Order Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 overflow-y-auto p-0 sm:p-4">
          <div className="bg-surface rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden border border-border flex flex-col max-h-[92vh] sm:max-h-[90vh] animate-in fade-in zoom-in duration-150">
            <div className="p-6 border-b border-border flex justify-between items-center bg-surface-muted/50">
              <div>
                <h2 className="text-xl font-black text-content">
                  {modalType === 'purchase' ? t('procurement.register_new_po', 'تسجيل أمر شراء جديد') : t('procurement.register_po_return', 'تسجيل مرتجع مشتريات')}
                </h2>
                <p className="text-xs text-content-muted mt-1">
                  {t('procurement.register_po_subtitle', 'قم باختيار المورد وتحديد قائمة الأصناف والأسعار لبناء فاتورة.')}
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
                <label className="block text-xs font-black text-content-muted uppercase tracking-widest">{t('procurement.supplier', 'المورد')}</label>
                <SmartSelect 
                  value={selectedSupplier}
                  onChange={(val) => setSelectedSupplier(val)}
                  placeholder={t('procurement.select_responsible_supplier', 'اختر المورد المسؤول...')}
                  options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                />
              </div>

              <div className="bg-surface-muted/40 p-4 rounded-2xl border border-border space-y-4">
                <h3 className="font-bold text-sm text-content">{t('procurement.add_items_to_invoice', 'إضافة أصناف لقائمة الفاتورة')}</h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="md:col-span-2">
                    <SmartSelect
                      value={selectedItem}
                      onChange={(val) => {
                        if (val === ADD_NEW_ITEM_VALUE) {
                          setIsAddingNewItem(true);
                          return;
                        }
                        setSelectedItem(val);
                        setSelectedVariantId('');
                        if (modalType === 'return' && selectedSupplier) {
                          // A return must credit back what we actually paid --
                          // not a price the staff member types in freehand.
                          const knownPrice = getSupplierItemPrice(selectedSupplier, val);
                          setPricePerUnit(knownPrice ?? 0);
                        }
                      }}
                      placeholder={t('procurement.select_inventory_item', 'اختر صنف المخزن...')}
                      options={itemSelectOptions}
                      disabled={modalType === 'return' && !selectedSupplier}
                    />
                    {modalType === 'return' && !selectedSupplier && (
                      <p className="text-[10px] font-bold text-content-muted mt-1.5 px-1">{t('procurement.select_supplier_first', 'اختر المورد أولاً لعرض الأصناف المشتراة منه')}</p>
                    )}
                    {modalType === 'return' && selectedSupplier && itemSelectOptions.length === 0 && (
                      <p className="text-[10px] font-bold text-danger mt-1.5 px-1">{t('procurement.no_purchased_items_from_supplier', 'لا توجد أصناف تم شراؤها من هذا المورد بعد')}</p>
                    )}
                    {modalType === 'return' && Object.keys(itemVariantsByItem).length > 0 && (
                      <p className="text-[10px] text-content-muted mt-1.5 px-1">
                        {t('inventory.variants.po_return_not_supported', 'مرتجعات المنتجات ذات السمات غير مدعومة بعد -- عدّل مخزونها يدوياً من شاشة المخزون.')}
                      </p>
                    )}
                    {modalType === 'purchase' && selectedItemVariants.length > 0 && (
                      <div className="mt-2">
                        <SmartSelect
                          value={selectedVariantId}
                          onChange={setSelectedVariantId}
                          placeholder={t('inventory.variants.select_variant_placeholder', 'اختر السمة (اللون/المقاس)...')}
                          options={selectedItemVariants.map(v => ({ value: v.id, label: v.name }))}
                        />
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <label className="block text-xs font-black text-content-muted uppercase tracking-widest">{t('procurement.quantity', 'الكمية')}</label>
                    <input
                      type="number"
                      placeholder="0"
                      value={quantity || ''}
                      onChange={(e) => setQuantity(Number(e.target.value))}
                      className="w-full px-4 py-2 bg-surface border border-border rounded-xl outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand text-content font-bold text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-xs font-black text-content-muted uppercase tracking-widest">{t('procurement.price_per_unit_short', 'السعر / وحدة')}</label>
                    <input
                      type="number"
                      placeholder="0.00"
                      value={pricePerUnit || ''}
                      onChange={(e) => setPricePerUnit(Number(e.target.value))}
                      readOnly={modalType === 'return'}
                      title={modalType === 'return' ? t('procurement.return_price_locked', 'السعر مقفل على سعر الشراء الفعلي ولا يمكن تعديله') : undefined}
                      className={cn(
                        "w-full px-4 py-2 bg-surface border border-border rounded-xl outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand text-content font-bold text-sm",
                        modalType === 'return' && "bg-surface-muted cursor-not-allowed opacity-80"
                      )}
                    />
                  </div>
                </div>

                {isAddingNewItem && (
                  <div className="p-4 rounded-xl border-2 border-brand/40 bg-brand/5 space-y-3">
                    <h4 className="text-xs font-black text-brand uppercase tracking-widest">{t('procurement.add_new_item_option', '+ إضافة منتج جديد')}</h4>
                    <input
                      autoFocus
                      value={newItemName}
                      onChange={(e) => setNewItemName(e.target.value)}
                      placeholder={t('inventory.item_name_placeholder', 'اسم المنتج')}
                      className="w-full px-4 py-2 bg-surface border border-border rounded-xl outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand font-semibold text-sm"
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <SmartSelect
                          value={newItemCategoryKey}
                          onChange={(val) => {
                            if (val === ADD_NEW_CATEGORY_VALUE) {
                              newItemCategoryPicker.setAddingNew(true);
                              return;
                            }
                            setNewItemCategoryKey(val);
                          }}
                          placeholder={t('inventory.category', 'الفئة')}
                          options={[
                            ...newItemCategoryPicker.options,
                            { value: ADD_NEW_CATEGORY_VALUE, label: t('settings_page.categories.add_new', '+ إضافة فئة جديدة') },
                          ]}
                        />
                        {newItemCategoryPicker.addingNew && (
                          <div className="flex items-center gap-2 mt-2 p-2 rounded-xl border-2 border-brand/40 bg-surface">
                            <input
                              autoFocus
                              value={newItemCategoryPicker.newLabel}
                              onChange={(e) => newItemCategoryPicker.setNewLabel(e.target.value)}
                              placeholder={t('settings_page.categories.new_name_placeholder', 'اسم الفئة الجديدة')}
                              className="flex-1 bg-transparent outline-none font-bold text-content text-xs"
                            />
                            <button
                              type="button"
                              onClick={() => newItemCategoryPicker.confirmAdd((key) => setNewItemCategoryKey(key)).catch(() => {})}
                              disabled={!newItemCategoryPicker.newLabel.trim() || newItemCategoryPicker.saving}
                              className="min-h-[28px] px-2 rounded-lg bg-brand text-white font-bold text-[10px] disabled:opacity-50"
                            >
                              {t('common.add', 'إضافة')}
                            </button>
                          </div>
                        )}
                      </div>
                      <SmartSelect
                        value={newItemUnit}
                        onChange={(val) => setNewItemUnit(val)}
                        options={[
                          { value: 'meter', label: t('inventory.unit_meter', 'متر') },
                          { value: 'yard', label: t('inventory.unit_yard', 'يارد') },
                          { value: 'roll', label: t('inventory.unit_roll', 'لفّة') },
                          { value: 'bolt', label: t('inventory.unit_bolt', 'بالة') },
                          { value: 'piece', label: t('inventory.unit_piece', 'قطعة') },
                          { value: 'box', label: t('inventory.unit_box', 'صندوق') },
                        ]}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="number"
                        step="0.01"
                        value={newItemCostPrice || ''}
                        onChange={(e) => setNewItemCostPrice(e.target.value === '' ? 0 : Number(e.target.value))}
                        placeholder={t('inventory.cost_price_label', 'سعر التكلفة')}
                        className="w-full px-4 py-2 bg-surface border border-border rounded-xl outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand font-semibold text-sm"
                      />
                      <input
                        type="number"
                        step="0.01"
                        value={newItemSellingPrice || ''}
                        onChange={(e) => setNewItemSellingPrice(e.target.value === '' ? 0 : Number(e.target.value))}
                        placeholder={t('inventory.selling_price_label', 'سعر البيع')}
                        className="w-full px-4 py-2 bg-surface border border-border rounded-xl outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand font-semibold text-sm"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleSaveNewItem}
                        disabled={savingNewItem || !newItemName.trim() || !newItemCategoryKey || newItemCostPrice <= 0 || newItemSellingPrice <= 0}
                        className="flex-1 bg-brand text-white py-2.5 rounded-xl font-bold text-xs disabled:opacity-50"
                      >
                        {savingNewItem ? t('common.saving', 'جارٍ الحفظ...') : t('procurement.create_and_add_item', 'إنشاء وإضافة للقائمة')}
                      </button>
                      <button
                        type="button"
                        onClick={cancelAddNewItem}
                        className="px-4 py-2.5 rounded-xl text-content-muted font-bold text-xs hover:bg-surface"
                      >
                        {t('common.cancel', 'إلغاء')}
                      </button>
                    </div>
                  </div>
                )}

                <button
                  onClick={handleAddItem}
                  disabled={!selectedItem || quantity <= 0 || pricePerUnit <= 0 || (selectedItemVariants.length > 0 && !selectedVariantId)}
                  className="w-full bg-brand/10 text-brand py-3 rounded-xl font-bold text-xs hover:bg-brand hover:text-white transition-all disabled:opacity-50"
                >
                  {t('procurement.add_item_to_doc_list', 'أضف الصنف لقائمة المستند')}
                </button>
              </div>

              {items.length > 0 && (
                <div className="border border-border rounded-2xl bg-surface overflow-hidden">
                  <ResponsiveTable
                    breakpoint="md"
                    cards={items.map((item, idx) => (
                      <div key={idx} className="p-3 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-bold truncate">{item.name}</div>
                          <div className="text-xs text-content-muted mt-0.5">{item.quantity} {item.unit} &times; <PriceDisplay amount={item.pricePerUnit} /></div>
                          <div className="text-sm font-black text-brand mt-0.5"><PriceDisplay amount={item.total} /></div>
                        </div>
                        <button
                          onClick={() => setItems(items.filter((_, i) => i !== idx))}
                          aria-label={t('common.delete')}
                          className="min-w-[44px] min-h-[44px] flex items-center justify-center text-danger hover:bg-danger/10 rounded-xl transition-all shrink-0"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    ))}
                    table={
                      <table className="w-full text-right min-w-max">
                        <thead className="bg-surface-muted text-content-muted">
                          <tr>
                            <th className="p-3 text-xs font-black">{t('procurement.item', 'الصنف')}</th>
                            <th className="p-3 text-xs font-black">{t('procurement.quantity', 'الكمية')}</th>
                            <th className="p-3 text-xs font-black">{t('procurement.price', 'السعر')}</th>
                            <th className="p-3 text-xs font-black">{t('procurement.total', 'الإجمالي')}</th>
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
                                  aria-label={t('common.delete')}
                                  className="text-danger hover:bg-danger/10 p-2 rounded-xl transition-all"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    }
                  />
                </div>
              )}

              <div className="space-y-1">
                <label htmlFor="po-doc-notes" className="text-xs font-black text-content-muted uppercase">{t('procurement.doc_notes', 'ملاحظات المستند')}</label>
                <textarea
                  id="po-doc-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('procurement.doc_notes_placeholder', 'ملاحظات تفصيلية حول السند أو سبب الارتجاع إن وجد...')}
                  className="w-full px-4 py-3 bg-surface border border-border rounded-xl outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand h-20 resize-none font-medium text-sm text-content"
                />
              </div>
            </div>
            
            <div className="p-6 border-t border-border bg-surface-muted/50 flex flex-col sm:flex-row justify-between items-center gap-4">
              <div className="text-lg font-bold text-content">
                {t('procurement.total_list', 'إجمالي القائمة')}: <span className="text-brand font-black"><PriceDisplay amount={items.reduce((sum, item) => sum + item.total, 0)} /></span>
              </div>
              <div className="flex gap-3 w-full sm:w-auto">
                <button
                  onClick={() => handleCreateOrder(false)}
                  disabled={isSubmitting || items.length === 0 || !selectedSupplier}
                  className="flex-1 sm:flex-initial bg-surface-muted text-content px-5 py-3 rounded-xl font-bold text-xs hover:bg-border transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? t('procurement.saving_loading', 'جاري الحفظ...') : t('procurement.save_as_draft', 'حفظ كمسودة (بدون ترحيل)')}
                </button>
                <button 
                  onClick={() => handleCreateOrder(true)}
                  disabled={isSubmitting || items.length === 0 || !selectedSupplier}
                  className="flex-1 sm:flex-initial bg-success text-white px-6 py-3 rounded-xl font-black text-xs hover:bg-success/90 transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? t('procurement.saving_loading', 'جاري الحفظ...') : t('procurement.save_confirm_sync', 'حفظ وتأكيد السند (ترحيل آلي)')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
