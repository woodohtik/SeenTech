import { calculateItemTax } from './b2bHelper';
import { ProductTaxType } from '../types';

export interface CartTotalsItem {
  price: number;
  quantity: number;
  taxType?: ProductTaxType;
}

export interface CartTaxSettings {
  enabled?: boolean;
  trn?: string;
  vatRate?: number;
}

export type DiscountType = 'percent' | 'fixed';

export interface CartTotals {
  isTaxEnabled: boolean;
  /** Percentage (e.g. 15), not a 0-1 ratio -- matches taxSettings.vatRate's own unit. */
  vatRate: number;
  subTotalAmount: number;
  calculatedDiscountAmount: number;
  discountedSubtotal: number;
  taxAmount: number;
  totalAmount: number;
}

/**
 * مراجعة-الفريق-التقني-الكامل-2026-10-19.md (QA، حرجة): حساب إجمالي السلة
 * (الضريبة، الخصم، المجموع النهائي) كان مكتوباً مباشرة داخل جسم مكوّن
 * POS.tsx (3026 سطراً) بلا أي اختبار -- تغيير في منطق الخصم أو الضريبة يمر
 * عبر CI أخضر رغم كسر حساب الفاتورة النهائية في الإنتاج. استُخرج هنا بلا أي
 * تغيير في الصيغ أو ترتيب العمليات (مطابق حرفياً لما كان في POS.tsx) ليصبح
 * قابلاً للاختبار بمعزل عن تهيئة React/Supabase الكاملة.
 */
export function computeCartTotals(
  cart: CartTotalsItem[],
  taxSettings: CartTaxSettings | null | undefined,
  discountType: DiscountType,
  discountValue: number
): CartTotals {
  const isTaxEnabled = taxSettings?.enabled ?? Boolean(taxSettings?.trn);
  const effectiveVatRate = isTaxEnabled ? (Number(taxSettings?.vatRate ?? 15) / 100) : 0;

  const subTotalAmount = cart.reduce((sum, item) => {
    const calc = calculateItemTax(item.price, item.taxType || 'exclusive', effectiveVatRate, item.quantity);
    return sum + calc.basePrice;
  }, 0);

  const taxAmountPerItem = cart.reduce((sum, item) => {
    const calc = calculateItemTax(item.price, item.taxType || 'exclusive', effectiveVatRate, item.quantity);
    return sum + calc.taxAmount;
  }, 0);

  let calculatedDiscountAmount = 0;
  if (discountValue > 0) {
    calculatedDiscountAmount = discountType === 'percent'
      ? subTotalAmount * (discountValue / 100)
      : discountValue;
  }
  calculatedDiscountAmount = Math.min(calculatedDiscountAmount, subTotalAmount);

  const discountedSubtotal = subTotalAmount - calculatedDiscountAmount;

  const discountRatio = subTotalAmount > 0 ? (subTotalAmount - calculatedDiscountAmount) / subTotalAmount : 1;
  const taxAmount = isTaxEnabled ? taxAmountPerItem * discountRatio : 0;
  const vatRate = isTaxEnabled ? Number(taxSettings?.vatRate ?? 15) : 0;
  const totalAmount = discountedSubtotal + taxAmount;

  return {
    isTaxEnabled,
    vatRate,
    subTotalAmount,
    calculatedDiscountAmount,
    discountedSubtotal,
    taxAmount,
    totalAmount,
  };
}
