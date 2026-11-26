import type { InvoiceData } from '../printing/InvoiceReceipt';

/**
 * The printed receipt of a POS sale (moved out of POS.tsx).
 *
 * seen-merchant-trial-test-2026-11-26.md, phase 1: the seller is the shop
 * itself -- its legal name, VAT number and address -- never the platform's
 * branding (useBranding's storeName is Seen's own, "تطبيق سين"); the branch
 * is the sale's real one and the seller line is the employee who made it.
 */

export interface PosShopDetails {
  legalName?: string | null;
  trn?: string | null;
  address?: string | null;
  phone?: string | null;
}

export interface PosInvoiceContext {
  shop: PosShopDetails | null | undefined;
  branchName?: string | null;
  staffName?: string | null;
}

export function buildPosInvoiceData(completedOrder: any, ctx: PosInvoiceContext): InvoiceData | null {
  if (!completedOrder) return null;
  const shop = ctx.shop || {};
  return {
    invoiceNumber: completedOrder.invoiceNumber,
    provisional: Boolean(completedOrder.provisional),
    issueDate: completedOrder.issuedAt,
    paymentMethod: completedOrder.paymentMethod || 'cash',
    seller: {
      // No fake fallback (ZATCA Phase 0): handleCheckout's guard has already
      // confirmed the shop's TRN and legal name are real by now.
      name: shop.legalName || '',
      vatNumber: shop.trn || '',
      address: shop.address || undefined,
      phone: shop.phone || undefined,
    },
    customer: {
      name: completedOrder.customerName || 'عميل نقدي',
      vatNumber: completedOrder.customerVat || undefined,
    },
    items: (completedOrder.items || []).map((item: any, index: number) => ({
      id: index,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.price,
      taxType: item.taxType,
    })),
    subtotal: completedOrder.subTotal,
    vatAmount: completedOrder.taxAmount,
    discountAmount: completedOrder.discountAmount,
    paidAmount: completedOrder.paidAmount,
    grandTotal: completedOrder.total,
    qrValue: completedOrder.qrCode,
    invoiceType: completedOrder.invoiceType,
    branchName: ctx.branchName || undefined,
    sellerName: ctx.staffName || undefined,
  } as InvoiceData;
}
