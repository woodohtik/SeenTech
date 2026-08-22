#!/bin/bash
cat << 'INNER_EOF' > /tmp/invoice-replace.ts
const invoiceData: InvoiceData | null = completedOrder ? {
  invoiceNumber: completedOrder.invoiceNumber,
  issueDate: completedOrder.issuedAt,
  seller: {
    name: brandingSettings?.storeName || 'مؤسسة وضوح الشاملة',
    vatNumber: taxSettings?.trn || '300000000000003',
  },
  customer: {
    name: completedOrder.customerName || 'عميل نقدي',
    vatNumber: completedOrder.customerVat || undefined
  },
  items: completedOrder.items.map((item: any, index: number) => ({
    id: index,
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.price
  })),
  subtotal: completedOrder.subTotal,
  vatAmount: completedOrder.taxAmount,
  discountAmount: completedOrder.discountAmount,
  grandTotal: completedOrder.total,
  qrValue: completedOrder.qrCode,
  invoiceType: completedOrder.invoiceType
} : null;
INNER_EOF
