import React, { useState } from 'react';
import { Customer, InventoryItem, TaxInvoice } from '../../types/supabase';
import { ShoppingCart, Trash2, CreditCard, Loader2, Minus, Plus } from 'lucide-react';
import { supabase } from '../../lib/supabase/client';
import { generateZatcaQR } from '../../lib/zatca';
import { PriceDisplay } from '../PriceDisplay';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';
import { InvoiceModal } from './InvoiceModal';
import { decodeInventoryDescription, calculateItemTax } from '../../utils/b2bHelper';

export interface CartItem {
  id: string;
  item: InventoryItem;
  quantity: number;
}

interface CartSidebarProps {
  tenantId: string;
  cartItems: CartItem[];
  selectedCustomer: Customer | null;
  onUpdateQuantity: (id: string, qty: number) => void;
  onRemove: (id: string) => void;
  onCheckoutSuccess: () => void;
}

export default function CartSidebar({ 
  tenantId, 
  cartItems, 
  selectedCustomer, 
  onUpdateQuantity, 
  onRemove,
  onCheckoutSuccess
}: CartSidebarProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>('fixed');
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  
  const [currentInvoice, setCurrentInvoice] = useState<TaxInvoice | null>(null);
  const [tenantInfo, setTenantInfo] = useState<{name: string, vat: string}>({name: '', vat: ''});
  const [invoiceItems, setInvoiceItems] = useState<{name: string, quantity: number, price: number}[]>([]);

  const subTotal = cartItems.reduce((acc, current) => {
    const meta = decodeInventoryDescription(current.item.description);
    const calc = calculateItemTax(Number(current.item.price_per_unit || 0), meta.taxType || 'exclusive', 0.15, current.quantity);
    return acc + calc.basePrice;
  }, 0);

  // Discount calculation
  let discountAmount = 0;
  if (discountValue > 0) {
    if (discountType === 'percent') {
      discountAmount = subTotal * (discountValue / 100);
    } else {
      discountAmount = discountValue;
    }
  }
  
  // Ensure we don't discount more than the subtotal
  discountAmount = Math.min(discountAmount, subTotal);
  
  const discountedSubtotal = subTotal - discountAmount;

  const totalTaxAmountBeforeDiscount = cartItems.reduce((acc, current) => {
    const meta = decodeInventoryDescription(current.item.description);
    const calc = calculateItemTax(Number(current.item.price_per_unit || 0), meta.taxType || 'exclusive', 0.15, current.quantity);
    return acc + calc.taxAmount;
  }, 0);

  const discountRatio = subTotal > 0 ? (subTotal - discountAmount) / subTotal : 1;
  const vatAmount = totalTaxAmountBeforeDiscount * discountRatio;
  const grandTotal = discountedSubtotal + vatAmount;

  const handleCheckout = async () => {
    if (cartItems.length === 0) {
      alert('السلة فارغة!');
      return;
    }
    
    setIsProcessing(true);
    try {
      // 1. Fetch Tenant Settings for ZATCA
      const { data: tenant } = await supabase.from('tenants').select('*').eq('id', tenantId).single();
      if (!tenant) throw new Error('تعذر العثور على بيانات المتجر');
      
      const orderNumber = Math.floor(100000 + Math.random() * 900000);
      const qrCode = generateZatcaQR(
        tenant.name || 'Local Shop', 
        tenant.vat_number || '300000000000003',
        new Date().toISOString(),
        grandTotal.toFixed(2),
        vatAmount.toFixed(2)
      );

      // 2. Insert Order
      const { data: order, error: orderError } = await supabase.from('orders').insert([{
        tenant_id: tenantId,
        customer_id: selectedCustomer?.id || null,
        order_number: orderNumber,
        subtotal: subTotal,
        discount_amount: discountAmount, // Include discount
        tax_amount: vatAmount,
        total_amount: grandTotal,
        status: 'draft',
        created_at: new Date().toISOString()
      }]).select().single();

      if (orderError) throw orderError;
      if (!order) throw new Error('فشل في إنشاء الطلب');

      // 3. Insert Order Lines
      const orderLines = cartItems.map(cartItem => ({
        order_id: order.id,
        inventory_item_id: cartItem.item.id,
        quantity: cartItem.quantity,
        unit_price: cartItem.item.price_per_unit,
        total_price: Number(cartItem.item.price_per_unit || 0) * cartItem.quantity
      }));

      const { error: linesError } = await supabase.from('order_lines').insert(orderLines);
      if (linesError) throw linesError;

      // 4. Create immutable ZATCA tax invoice
      const invoiceType = (selectedCustomer && selectedCustomer.vat_number) ? 'standard_b2b' : 'simplified_b2c';
      
      // Get sequential number for tenant
      const { count } = await supabase
        .from('tax_invoices')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId);
        
      const sequenceNumber = (count || 0) + 1;
      const invoiceNumber = `INV-${new Date().getFullYear()}-${String(sequenceNumber).padStart(6, '0')}`;

      const { data: taxInvoice, error: invoiceError } = await supabase.from('tax_invoices').insert([{
         tenant_id: tenantId,
         order_id: order.id,
         invoice_number: invoiceNumber,
         invoice_type: invoiceType,
         issued_at: new Date().toISOString(),
         status: 'issued',
         customer_id: selectedCustomer?.id || null,
         customer_name: selectedCustomer?.name || 'Customer',
         subtotal: subTotal,
         tax_rate: 0.15,
         tax_amount: vatAmount,
         discount_amount: discountAmount,
         total_amount: grandTotal,
         paid_amount: grandTotal,
         qr_payload: qrCode,
         vat_number: selectedCustomer?.vat_number || null,
      }]).select().single();

      if (invoiceError) throw invoiceError;

      // 5. Update state and open modal
      setTenantInfo({ name: tenant.name || 'مؤسسة محلية', vat: tenant.vat_number || '300000000000003' });
      
      const printItems = cartItems.map(cartItem => ({
        name: cartItem.item.name,
        quantity: cartItem.quantity,
        price: Number(cartItem.item.price_per_unit || 0)
      }));
      setInvoiceItems(printItems);
      
      setCurrentInvoice(taxInvoice);
      setInvoiceModalOpen(true);
      
      // Do not clear yet, wait for user to close modal, or let the parent do it onCheckoutSuccess
      
    } catch (error: any) {
      console.error('Checkout error:', error);
      alert('فشل في إتمام الطلب: ' + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="w-full lg:w-[420px] bg-surface lg:border-r border-border flex flex-col shadow-[-10px_0_30px_rgba(0,0,0,0.03)] z-10 shrink-0 h-[85vh] lg:h-full font-sans rounded-t-[2.5rem] lg:rounded-none fixed lg:static bottom-0 inset-x-0">
      <div className="p-6 border-b border-border bg-surface">
        <h2 className="text-xl font-bold text-content flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center">
            <ShoppingCart size={22} className="text-brand" />
          </div>
          السلة والفاتورة
          <span className="mr-auto px-2.5 py-0.5 rounded-full bg-surface-muted text-content-muted text-xs font-bold">
            {cartItems.length} منتجات
          </span>
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {cartItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-content-muted space-y-4 animate-in fade-in duration-500">
            <div className="w-20 h-20 rounded-full bg-surface-muted flex items-center justify-center">
              <ShoppingCart size={32} className="opacity-20" />
            </div>
            <p className="font-medium">ابدأ بإضافة المنتجات إلى السلة</p>
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence initial={false}>
              {cartItems.map(item => (
                <motion.div 
                  key={item.id} 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-surface border border-border p-4 rounded-2xl flex gap-4 shadow-sm hover:border-brand/20 transition-all group pointer-events-auto"
                >
                  <div className="flex-1">
                    <h4 className="font-bold text-content text-base mb-1">{item.item.name}</h4>
                    <div className="text-brand font-black text-lg">
                      <PriceDisplay amount={Number(item.item.price_per_unit || 0)} />
                    </div>
                  </div>

                  <div className="flex flex-col items-end justify-between min-w-[100px]">
                    <button 
                      onClick={() => onRemove(item.id)}
                      className="text-danger/60 hover:text-danger hover:bg-danger/10 p-1.5 rounded-lg transition-all"
                      title="حذف"
                    >
                      <Trash2 size={18} />
                    </button>
                    
                    <div className="flex items-center gap-2 bg-surface-muted rounded-lg p-1 border border-border mt-2">
                      <button 
                        onClick={() => onUpdateQuantity(item.id, Math.max(1, item.quantity - 1))}
                        className="w-7 h-7 flex items-center justify-center bg-surface border border-border rounded text-content hover:text-brand hover:border-brand transition-all"
                      >
                        <Minus size={14} />
                      </button>
                      
                      <span className="text-base font-bold w-8 text-center tabular-nums text-content">
                        {item.quantity}
                      </span>
                      
                      <button 
                        onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                        className="w-7 h-7 flex items-center justify-center bg-surface border border-border rounded text-content hover:text-brand hover:border-brand transition-all"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      <div className="p-6 bg-surface border-t border-border mt-auto">
        {/* Discount Engine */}
        <div className="mb-5 bg-surface-muted rounded-xl p-4 border border-border">
          <div className="flex justify-between items-center mb-3">
            <span className="text-sm font-bold text-content">الخصم</span>
            <div className="flex bg-surface rounded-lg border border-border p-0.5 shadow-sm">
              <button
                type="button"
                className={cn(
                  "px-3 py-1 text-xs font-bold rounded-md transition-all",
                  discountType === 'percent' ? "bg-brand text-white shadow-sm" : "text-content-muted hover:text-content"
                )}
                onClick={() => setDiscountType('percent')}
              >
                نسبة (%)
              </button>
              <button
                type="button"
                className={cn(
                  "px-3 py-1 text-xs font-bold rounded-md transition-all",
                  discountType === 'fixed' ? "bg-brand text-white shadow-sm" : "text-content-muted hover:text-content"
                )}
                onClick={() => setDiscountType('fixed')}
              >
                مبلغ ثابت
              </button>
            </div>
          </div>
          <div className="relative">
            <input
              type="number"
              min="0"
              value={discountValue || ''}
              onChange={(e) => setDiscountValue(Number(e.target.value))}
              placeholder="0"
              className="w-full bg-surface border border-border rounded-lg py-2.5 px-4 focus:ring-2 focus:ring-brand focus:border-brand transition-all outline-none text-left tabular-nums font-bold text-content"
              dir="ltr"
            />
          </div>
        </div>

        <div className="space-y-3 mb-6">
          <div className="flex justify-between text-content-muted font-medium">
            <span>المجموع الفرعي</span>
            <span className="text-content font-bold"><PriceDisplay amount={subTotal} /></span>
          </div>
          {discountAmount > 0 && (
            <div className="flex justify-between text-brand font-medium">
              <span>الخصم المستقطع</span>
              <span className="font-bold cursor-default" title={`الخصم: ${discountType === 'percent' ? `${discountValue}%` : 'مبلغ ثابت'}`}>
                -<PriceDisplay amount={discountAmount} />
              </span>
            </div>
          )}
          <div className="flex justify-between text-content-muted font-medium">
            <span>الضريبة (15%)</span>
            <span className="text-content font-bold"><PriceDisplay amount={vatAmount} /></span>
          </div>
          <div className="flex justify-between items-end pt-3 border-t border-dashed border-border mt-3">
            <div>
              <p className="text-xs font-bold text-content-muted uppercase tracking-wider mb-1">الإجمالي النهائي</p>
              <PriceDisplay amount={grandTotal} className="text-3xl font-black text-brand" />
            </div>
            {selectedCustomer && (
              <div className="text-left">
                <p className="text-[10px] font-bold text-content-muted uppercase mb-0.5">العميل المُختار</p>
                <p className="text-xs font-bold text-content">{selectedCustomer.name}</p>
              </div>
            )}
          </div>
        </div>

        <button
          onClick={handleCheckout}
          disabled={cartItems.length === 0 || isProcessing}
          className="group relative w-full overflow-hidden bg-brand text-white py-4.5 rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-brand/90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_12px_24px_rgba(28,143,255,0.25)]"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out" />
          {isProcessing ? (
            <Loader2 size={24} className="animate-spin" />
          ) : (
            <>
              <CreditCard size={22} />
              إصدار الفاتورة وتأكيد الطلب
            </>
          )}
        </button>
      </div>

      <InvoiceModal
        isOpen={invoiceModalOpen}
        onClose={() => {
          setInvoiceModalOpen(false);
          onCheckoutSuccess();
        }}
        invoice={currentInvoice}
        tenantName={tenantInfo.name}
        tenantVatNumber={tenantInfo.vat}
        items={invoiceItems}
      />
    </div>
  );
}
