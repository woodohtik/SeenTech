import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Customer, InventoryItem, TaxInvoice } from '../../types/supabase';
import { ShoppingCart, Trash2, CreditCard, Loader2, Minus, Plus } from 'lucide-react';
import { supabase } from '../../lib/supabase/client';
import { generateZatcaQR } from '../../lib/zatca';
import { PriceDisplay } from '../PriceDisplay';
import { motion, AnimatePresence } from 'motion/react';
import { cn, generateOrderNumber } from '../../lib/utils';
import { InvoiceModal } from './InvoiceModal';
import { decodeInventoryDescription, calculateItemTax, encodeInvoiceExtendedNotes } from '../../utils/b2bHelper';
import { useToast } from '../../contexts/ToastContext';

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
  const { t } = useTranslation();
  const { error: toastError } = useToast();
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
      toastError(t('pos.cart_empty_alert'));
      return;
    }
    
    setIsProcessing(true);
    try {
      // 1. Fetch Tenant Settings for ZATCA
      const { data: tenant } = await supabase.from('tenants').select('*').eq('id', tenantId).single();
      if (!tenant) throw new Error(t('pos.store_data_not_found'));
      
      const orderNumber = generateOrderNumber();
      const qrCode = generateZatcaQR(
        tenant.name || 'Local Shop', 
        tenant.vat_number || '300000000000003',
        new Date().toISOString(),
        grandTotal.toFixed(2),
        vatAmount.toFixed(2)
      );

      const isUuid = (val: string | undefined | null) => 
        val ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val) : false;

      // 2. Insert Order (complying with schema requirements)
      const { data: order, error: orderError } = await supabase.from('orders').insert([{
        tenant_id: tenantId,
        customer_id: (selectedCustomer?.id && isUuid(selectedCustomer.id)) ? selectedCustomer.id : null,
        customer_name: selectedCustomer?.name || t('pos.walk_in_customer'),
        order_number: orderNumber,
        payment_method: 'cash',
        discount_amount: Number(discountAmount) >= 0 ? Number(discountAmount) : 0, // Include discount
        tax_amount: Number(vatAmount) >= 0 ? Number(vatAmount) : 0,
        tax_rate: 0.15,
        total_amount: Number(grandTotal) >= 0 ? Number(grandTotal) : 0,
        paid_amount: Number(grandTotal) >= 0 ? Number(grandTotal) : 0,
        status: 'delivered', // valid order_status enum value
        delivery_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        order_date: new Date().toISOString(),
        created_at: new Date().toISOString()
      }]).select().single();

      if (orderError) throw orderError;
      if (!order) throw new Error(t('pos.order_creation_failed'));

      // Insert system notification for the new order
      try {
        await supabase.from('notifications').insert({
          tenant_id: tenantId,
          title: t('orders.notification_new_order_title'),
          message: t('orders.notification_new_order_message', { number: orderNumber, customer: selectedCustomer?.name || t('pos.walk_in_customer'), amount: grandTotal.toFixed(2) }),
          type: 'order',
          status: 'unread',
          created_at: new Date().toISOString(),
          metadata: { order_id: order.id }
        });
      } catch (notifErr) {
        console.warn('Failed to insert order notification:', notifErr);
      }

      // 3. Insert Order Items (order_items table with proper columns)
      const orderItemsToInsert = cartItems.map(cartItem => ({
        tenant_id: tenantId,
        order_id: order.id,
        type: 'ready_made',
        item_id: cartItem.item.id,
        name: cartItem.item.name,
        quantity: Number(cartItem.quantity) > 0 ? Number(cartItem.quantity) : 1,
        price: Number(cartItem.item.price_per_unit) >= 0 ? Number(cartItem.item.price_per_unit) : 0
      }));

      const { error: linesError } = await supabase.from('order_items').insert(orderItemsToInsert);
      if (linesError) throw linesError;

      // 4. Create immutable ZATCA tax invoice (matching tax_invoices schema)
      const invoiceType = (selectedCustomer && selectedCustomer.vat_number) ? 'standard_b2b' : 'simplified_b2c';
      
      // Get sequential number for tenant
      const { count } = await supabase
        .from('tax_invoices')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId);
        
      const sequenceNumber = (count || 0) + 1;
      const invoiceNumber = `INV-${new Date().getFullYear()}-${String(sequenceNumber).padStart(6, '0')}`;

      // We encode the details including invoiceType inside notes via encodeInvoiceExtendedNotes
      const extendedNotesStr = encodeInvoiceExtendedNotes({
         invoiceType: invoiceType,
         isB2B: invoiceType === 'standard_b2b',
         b2bCompanyName: selectedCustomer?.name || undefined,
         items: cartItems.map(cartItem => ({
            name: cartItem.item.name,
            quantity: cartItem.quantity,
            price: Number(cartItem.item.price_per_unit || 0),
            type: 'ready_made'
         })),
         createdBy: 'System'
      });

      const { data: taxInvoice, error: invoiceError } = await supabase.from('tax_invoices').insert([{
         tenant_id: tenantId,
         order_id: order.id,
         invoice_number: invoiceNumber,
         issued_at: new Date().toISOString(),
         status: 'issued',
         customer_id: (selectedCustomer?.id && isUuid(selectedCustomer.id)) ? selectedCustomer.id : null,
         customer_name: selectedCustomer?.name || 'Customer',
         subtotal: Number(subTotal) >= 0 ? Number(subTotal) : 0,
         tax_rate: 0.15,
         tax_amount: Number(vatAmount) >= 0 ? Number(vatAmount) : 0,
         discount_amount: Number(discountAmount) >= 0 ? Number(discountAmount) : 0,
         total_amount: Number(grandTotal) >= 0 ? Number(grandTotal) : 0,
         paid_amount: Number(grandTotal) >= 0 ? Number(grandTotal) : 0,
         qr_payload: qrCode,
         vat_number: selectedCustomer?.vat_number || null,
         notes: extendedNotesStr
      }]).select().single();

      if (invoiceError) throw invoiceError;

      // 5. Update state and open modal
      setTenantInfo({ name: tenant.name || t('pos.local_business_default'), vat: tenant.vat_number || '300000000000003' });
      
      const printItems = cartItems.map(cartItem => ({
        name: cartItem.item.name,
        quantity: cartItem.quantity,
        price: Number(cartItem.item.price_per_unit || 0)
      }));
      setInvoiceItems(printItems);
      
      // Since supabase type expects TaxInvoice to have invoice_type, we can inject it locally on the returned object for the UI representation
      const invoiceForModal = {
        ...taxInvoice,
        invoice_type: invoiceType
      } as TaxInvoice;

      setCurrentInvoice(invoiceForModal);
      setInvoiceModalOpen(true);
      
      // Do not clear yet, wait for user to close modal, or let the parent do it onCheckoutSuccess
      
    } catch (error: any) {
      console.error('Checkout error:', error);
      toastError(t('pos.checkout_failed_msg', { error: error.message }));
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
          {t('pos.cart_and_invoice')}
          <span className="mr-auto px-2.5 py-0.5 rounded-full bg-surface-muted text-content-muted text-xs font-bold">
            {t('pos.products_count', { n: cartItems.length })}
          </span>
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {cartItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-content-muted space-y-4 animate-in fade-in duration-500">
            <div className="w-20 h-20 rounded-full bg-surface-muted flex items-center justify-center">
              <ShoppingCart size={32} className="opacity-20" />
            </div>
            <p className="font-medium">{t('pos.start_adding_products')}</p>
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
                      title={t('common.delete')}
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
            <span className="text-sm font-bold text-content">{t('pos.discount')}</span>
            <div className="flex bg-surface rounded-lg border border-border p-0.5 shadow-sm">
              <button
                type="button"
                className={cn(
                  "px-3 py-1 text-xs font-bold rounded-md transition-all",
                  discountType === 'percent' ? "bg-brand text-white shadow-sm" : "text-content-muted hover:text-content"
                )}
                onClick={() => setDiscountType('percent')}
              >
                {t('settings_page.staff.commissions.percentage')}
              </button>
              <button
                type="button"
                className={cn(
                  "px-3 py-1 text-xs font-bold rounded-md transition-all",
                  discountType === 'fixed' ? "bg-brand text-white shadow-sm" : "text-content-muted hover:text-content"
                )}
                onClick={() => setDiscountType('fixed')}
              >
                {t('settings_page.staff.commissions.fixed_amount')}
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
            <span>{t('pos.subtotal')}</span>
            <span className="text-content font-bold"><PriceDisplay amount={subTotal} /></span>
          </div>
          {discountAmount > 0 && (
            <div className="flex justify-between text-brand font-medium">
              <span>{t('pos.discount_applied')}</span>
              <span className="font-bold cursor-default" title={t('pos.discount_tooltip', { value: discountType === 'percent' ? `${discountValue}%` : t('settings_page.staff.commissions.fixed_amount') })}>
                -<PriceDisplay amount={discountAmount} />
              </span>
            </div>
          )}
          <div className="flex justify-between text-content-muted font-medium">
            <span>{t('pos.vat_15')}</span>
            <span className="text-content font-bold"><PriceDisplay amount={vatAmount} /></span>
          </div>
          <div className="flex justify-between items-end pt-3 border-t border-dashed border-border mt-3">
            <div>
              <p className="text-xs font-bold text-content-muted uppercase tracking-wider mb-1">{t('pos.final_total')}</p>
              <PriceDisplay amount={grandTotal} className="text-3xl font-black text-brand" />
            </div>
            {selectedCustomer && (
              <div className="text-left">
                <p className="text-[10px] font-bold text-content-muted uppercase mb-0.5">{t('pos.selected_customer')}</p>
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
              {t('pos.issue_invoice_confirm_order')}
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
        customerPhone={selectedCustomer?.phone}
      />
    </div>
  );
}
