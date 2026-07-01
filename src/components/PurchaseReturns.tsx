import React, { useState } from 'react';
import { Plus, ExternalLink, Trash2, X } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { handleError, OperationType } from '../lib/firebase';
import { addSupplierTransaction } from '../services/supplierAccountsService';
import { Supplier, PurchaseReturn, InventoryItem, PurchaseOrderItem } from '../types';
import { cn } from '../lib/utils';
import { PriceDisplay } from './PriceDisplay';
import { SmartSelect } from './ui/SmartSelect';
import { useTranslation } from 'react-i18next';
import { adjustStock } from '../services/inventoryService';

export default function PurchaseReturns({ 
  tenantId, 
  suppliers, 
  purchaseReturns, 
  inventory 
}: { 
  tenantId: string, 
  suppliers: Supplier[], 
  purchaseReturns: PurchaseReturn[],
  inventory: InventoryItem[]
}) {
  const { t } = useTranslation();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [items, setItems] = useState<PurchaseOrderItem[]>([]);
  const [selectedItem, setSelectedItem] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [pricePerUnit, setPricePerUnit] = useState(0);
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const handleCreateReturn = async () => {
    if (!selectedSupplier || items.length === 0) return;
    setIsSubmitting(true);
    try {
      const totalAmount = items.reduce((sum, item) => sum + item.total, 0);

      // 1. Create Return Record
      const { error: returnError } = await supabase
        .from('purchase_returns')
        .insert({
          purchase_order_id: 'manual', // Can be linked to specific PO later
          supplier_id: selectedSupplier,
          tenant_id: tenantId,
          branch_id: 'main',
          items,
          total_amount: totalAmount,
          reason,
          return_date: new Date().toISOString(),
          created_by: 'system',
          created_at: new Date().toISOString()
        });
      
      if (returnError) throw returnError;

      // 2. Reduce Supplier Balance & write ledger transaction
      const { data: supplier, error: sErr } = await supabase
        .from('suppliers')
        .select('balance')
        .eq('id', selectedSupplier)
        .single();
      
      const currentBalance = (!sErr && supplier) ? Number(supplier.balance || 0) : 0;
      
      await addSupplierTransaction(
        tenantId,
        {
          supplier_id: selectedSupplier,
          type: 'adjustment',
          credit: 0,
          debit: totalAmount,
          reference_number: `PR-${Math.floor(100000 + Math.random() * 900000)}`,
          date: new Date().toISOString(),
          notes: `مرتجع بضائع ومشتريات للمورد: ${reason || 'إرجاع بضائع'}`,
          tenant_id: tenantId,
        },
        currentBalance
      );

      // 3. Deduct Inventory
      for (const item of items) {
        try {
          await adjustStock({
            branchId: 'main',
            itemId: item.itemId,
            quantity: -item.baseQuantity,
            reason: `مرتجع مشتريات - ${reason}`,
            type: 'out',
            staffId: null,
            tenantId
          });
        } catch (stockError) {
          console.error('Error updating stock for return:', stockError);
        }
      }

      setIsModalOpen(false);
      setItems([]);
      setSelectedSupplier('');
      setReason('');
    } catch (error) {
      handleError(error as any, OperationType.WRITE, 'purchaseReturns');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 font-sans">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-content">{t('procurement.purchase_returns', 'مرتجعات المشتريات')}</h2>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-brand text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-brand/90 transition-all shadow-lg shadow-brand/10 active:scale-95"
        >
          <Plus size={20} />
          <span>{t('procurement.return_goods', 'إرجاع بضاعة')}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {purchaseReturns.map(ret => {
          const supplier = suppliers.find(s => s.id === ret.supplierId);
          return (
            <div key={ret.id} className="bg-surface p-6 rounded-2xl border border-border shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:border-brand/20 transition-all">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <span className="font-bold text-lg text-content">{supplier?.name || t('common.unknown_supplier', 'مورد غير معروف')}</span>
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-danger/10 text-danger border border-danger/10">
                    {t('procurement.return', 'مرتجع')}
                  </span>
                </div>
                <p className="text-sm text-content-muted">{t('common.date', 'التاريخ')}: {new Date(ret.returnDate).toLocaleDateString('ar-SA')}</p>
                <p className="text-sm text-content-muted">{t('common.reason', 'السبب')}: {ret.reason}</p>
                <p className="text-sm text-content-muted mt-2">{t('procurement.return_value', 'قيمة المرتجع')}: <span className="font-bold text-danger"><PriceDisplay amount={ret.totalAmount} /></span></p>
              </div>
            </div>
          );
        })}
        {purchaseReturns.length === 0 && (
          <div className="p-16 text-center text-content-muted bg-surface-muted rounded-3xl border border-dashed border-border">
            <ExternalLink className="mx-auto mb-4 opacity-20" size={56} />
            <p className="font-bold text-lg">{t('procurement.no_returns', 'لا توجد مرتجعات')}</p>
          </div>
        )}
      </div>

      {/* Create Return Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden border border-border flex flex-col max-h-[90vh] animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-border flex justify-between items-center bg-surface-muted/50">
              <h2 className="text-xl font-bold text-content">{t('procurement.return_to_supplier', 'إرجاع بضاعة لمورد')}</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-content-muted hover:text-content p-2 hover:bg-surface rounded-full transition-all">
                <X size={24} />
              </button>
            </div>
            
            <div className="p-8 overflow-y-auto flex-1 space-y-8">
              <div className="space-y-2">
                <label className="block text-sm font-black text-content-muted uppercase tracking-widest">{t('procurement.supplier', 'المورد')}</label>
                <SmartSelect 
                  value={selectedSupplier}
                  onChange={setSelectedSupplier}
                  placeholder={t('procurement.select_supplier', 'اختر المورد...')}
                  options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                />
              </div>

              <div className="bg-surface-muted/40 p-6 rounded-[2rem] border border-border space-y-6">
                <h3 className="font-bold text-content text-sm flex items-center gap-2">
                  <Plus size={18} className="text-brand" />
                  {t('procurement.add_items_to_return', 'إضافة أصناف للإرجاع')}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <SmartSelect 
                      value={selectedItem}
                      onChange={setSelectedItem}
                      placeholder={t('procurement.select_item', 'اختر الصنف...')}
                      options={inventory.map(i => ({ 
                        value: i.id, 
                        label: `${i.name} (${i.unit}) - ${t('inventory.available', 'متاح')}: ${i.quantity}` 
                      }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-content-muted uppercase px-2">{t('common.quantity', 'الكمية')}</label>
                    <input 
                      type="number" 
                      placeholder="0"
                      value={quantity || ''}
                      onChange={(e) => setQuantity(Number(e.target.value))}
                      className="w-full px-6 py-4 bg-surface border-2 border-border rounded-3xl focus:border-brand focus:ring-0 outline-none transition-all font-bold text-lg"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-content-muted uppercase px-2">{t('common.price_per_unit', 'السعر للوحدة')}</label>
                    <input 
                      type="number" 
                      placeholder="0.00"
                      value={pricePerUnit || ''}
                      onChange={(e) => setPricePerUnit(Number(e.target.value))}
                      className="w-full px-6 py-4 bg-surface border-2 border-border rounded-3xl focus:border-brand focus:ring-0 outline-none transition-all font-bold text-lg"
                    />
                  </div>
                </div>
                <button 
                  onClick={handleAddItem}
                  disabled={!selectedItem || quantity <= 0 || pricePerUnit <= 0}
                  className="w-full bg-brand/10 text-brand py-4 rounded-2xl font-bold hover:bg-brand hover:text-white transition-all disabled:opacity-50 active:scale-95 border border-brand/20"
                >
                  {t('common.add_to_list', 'إضافة للقائمة')}
                </button>
              </div>

              {items.length > 0 && (
                <div className="border border-border rounded-[2rem] overflow-hidden shadow-sm bg-surface">
                  {/* Mobile View: Stacked Card List */}
                  <div className="block md:hidden divide-y divide-border">
                    {items.map((item, idx) => (
                      <div key={idx} className="p-4 flex flex-col gap-2">
                        <div className="flex justify-between items-start">
                          <span className="font-bold text-content">{item.name}</span>
                          <button 
                            onClick={() => setItems(items.filter((_, i) => i !== idx))}
                            className="p-1.5 text-danger hover:bg-danger/5 rounded-lg transition-colors"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-content-muted">{item.quantity} {item.unit} × <PriceDisplay amount={item.pricePerUnit} /></span>
                          <span className="font-black text-danger text-sm"><PriceDisplay amount={item.total} /></span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Desktop View: Standard Table */}
                  <div className="hidden md:block overflow-x-auto whitespace-nowrap scrollbar-hide">
                    <table className="w-full text-right min-w-max">
                      <thead className="bg-surface-muted text-content-muted text-xs uppercase tracking-wider">
                        <tr>
                          <th className="p-4 font-black">{t('inventory.item', 'الصنف')}</th>
                          <th className="p-4 font-black">{t('common.quantity', 'الكمية')}</th>
                          <th className="p-4 font-black">{t('common.price', 'السعر')}</th>
                          <th className="p-4 font-black">{t('common.total', 'الإجمالي')}</th>
                          <th className="p-4 font-black"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {items.map((item, idx) => (
                          <tr key={idx} className="bg-surface hover:bg-surface-muted/30 transition-colors">
                            <td className="p-4 font-bold text-content">{item.name}</td>
                            <td className="p-4 font-bold text-content">{item.quantity} {item.unit}</td>
                            <td className="p-4 font-bold text-content"><PriceDisplay amount={item.pricePerUnit} /></td>
                            <td className="p-4 font-bold text-danger"><PriceDisplay amount={item.total} /></td>
                            <td className="p-4 text-left">
                              <button 
                                onClick={() => setItems(items.filter((_, i) => i !== idx))}
                                className="text-danger hover:bg-danger/10 p-2 rounded-xl transition-all"
                              >
                                <Trash2 size={18} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="block text-sm font-black text-content-muted uppercase tracking-widest">{t('common.reason_for_return', 'سبب الإرجاع')}</label>
                <textarea 
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full px-6 py-4 bg-surface-muted border-2 border-border rounded-3xl focus:border-brand focus:ring-0 outline-none h-32 resize-none transition-all font-medium text-content"
                  placeholder={t('procurement.reason_placeholder', 'مثال: قماش تالف، عيوب مصنعية...')}
                />
              </div>
            </div>
            
            <div className="p-8 border-t border-border bg-surface-muted/50 flex flex-col sm:flex-row justify-between items-center gap-6">
              <div className="text-lg font-bold text-content">
                {t('procurement.total_return', 'إجمالي المرتجع')}: <span className="text-2xl font-black text-danger ml-2"><PriceDisplay amount={items.reduce((sum, item) => sum + item.total, 0)} /></span>
              </div>
              <button 
                onClick={handleCreateReturn}
                disabled={isSubmitting || items.length === 0 || !selectedSupplier}
                className="w-full sm:w-auto bg-danger text-white px-12 py-4 rounded-2xl font-black hover:bg-danger/90 transition-all disabled:opacity-50 shadow-xl shadow-danger/10 active:scale-95"
              >
                {isSubmitting ? t('common.saving', 'جاري الحفظ...') : t('procurement.confirm_return', 'تأكيد الإرجاع')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
