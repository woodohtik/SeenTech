import { supabase } from '../lib/supabase/client';
import { Tenant, TaxInvoice } from '../types';
import { decodeInvoiceExtendedNotes } from '../utils/b2bHelper';

/**
 * Keeps the order's original tax invoice (tax_invoices.paid_amount) in
 * sync whenever a payment changes orders.paid_amount. These are two
 * independent columns with no DB trigger between them -- without this,
 * paying off an order's balance (Orders.tsx's quick payment, or POS's
 * debt settlement) would leave the tax-invoice registry and any re-shown
 * invoice still displaying the old, stale paid/remaining amounts. A
 * missing tax_invoices row (order never had one) is a silent no-op.
 */
export async function syncTaxInvoicePaidAmount(orderId: string, paidAmount: number): Promise<void> {
  await supabase.from('tax_invoices').update({ paid_amount: paidAmount }).eq('order_id', orderId);
}

/**
 * Fetches the real, original tax invoice for a single order -- same
 * mapping TaxInvoices.tsx uses for its registry, scoped to one order_id
 * instead of the whole tenant. Lets any screen that already has an order
 * (Orders, POS's debt-settlement receipt) show/print the exact same
 * invoice as the tax-invoice registry, instead of fabricating a new one.
 *
 * Returns null if the order has no tax invoice at all (e.g. it was never
 * actually sold/issued).
 */
export async function fetchTaxInvoiceForOrder(
  tenantId: string,
  orderId: string
): Promise<{ invoice: TaxInvoice; tenant: Tenant } | null> {
  const [{ data: tenantData }, { data: invoiceRow }, { data: orderRow }] = await Promise.all([
    supabase.from('tenants').select('*').eq('id', tenantId).maybeSingle(),
    supabase.from('tax_invoices').select('*').eq('tenant_id', tenantId).eq('order_id', orderId).maybeSingle(),
    supabase.from('orders').select('branch_id, tracking_token').eq('id', orderId).maybeSingle(),
  ]);

  if (!invoiceRow) return null;

  let branchName: string | undefined;
  if (orderRow?.branch_id) {
    const { data: branch } = await supabase.from('branches').select('name').eq('id', orderRow.branch_id).maybeSingle();
    branchName = branch?.name;
  }

  let creatorName: string | undefined;
  if (invoiceRow.created_by) {
    const { data: staffRow } = await supabase.from('staff').select('name').eq('id', invoiceRow.created_by).maybeSingle();
    creatorName = staffRow?.name;
  }

  const hasVat = Boolean(tenantData?.vat_number && tenantData.vat_number.trim().length > 0);
  const rawTax = tenantData?.tax_settings;
  const resolvedTax = rawTax ? {
    ...rawTax,
    enabled: rawTax.enabled ?? (hasVat || Boolean(rawTax.trn)),
    trn: rawTax.trn || tenantData?.vat_number || '',
    legalName: rawTax.legalName || tenantData?.name || '',
    vatRate: rawTax.vatRate ?? 15,
    tailoringTaxType: rawTax.tailoringTaxType || 'exclusive',
  } : {
    enabled: hasVat,
    trn: tenantData?.vat_number || '',
    legalName: tenantData?.name || '',
    vatRate: 15,
    tailoringTaxType: 'exclusive',
  };

  const tenant = {
    ...tenantData,
    vatNumber: tenantData?.vat_number || resolvedTax.trn,
    taxSettings: resolvedTax,
    logoUrl: tenantData?.logo_url,
    commercialRegister: tenantData?.commercial_register,
    legalName: tenantData?.legal_name,
    createdAt: tenantData?.created_at,
    updatedAt: tenantData?.updated_at,
  } as Tenant;

  const extNotes = decodeInvoiceExtendedNotes(invoiceRow.notes);
  const paidAmount = invoiceRow.paid_amount !== undefined && invoiceRow.paid_amount !== null
    ? Number(invoiceRow.paid_amount)
    : Number(invoiceRow.total_amount);

  const invoice = {
    id: invoiceRow.id,
    invoiceNumber: invoiceRow.invoice_number,
    orderId: invoiceRow.order_id,
    tenantId: invoiceRow.tenant_id,
    customerId: invoiceRow.customer_id,
    customerName: invoiceRow.customer_name,
    items: extNotes.items || invoiceRow.items || [],
    subTotal: invoiceRow.subtotal,
    taxRate: invoiceRow.tax_rate,
    taxAmount: invoiceRow.tax_amount,
    totalAmount: invoiceRow.total_amount,
    isB2B: extNotes.is_b2b !== undefined ? extNotes.is_b2b : (invoiceRow.is_b2b || invoiceRow.invoice_type === 'standard_b2b' || !!invoiceRow.vat_number),
    b2bCompanyName: extNotes.b2b_company_name || invoiceRow.customer_name,
    b2bTRN: invoiceRow.vat_number,
    qrCodeBase64: invoiceRow.zatca_qr_code || invoiceRow.qr_payload,
    issuedAt: invoiceRow.issued_at,
    createdBy: extNotes.created_by || creatorName || invoiceRow.created_by || '',
    status: invoiceRow.status === 'issued' ? 'valid' : 'cancelled',
    paidAmount,
    remainingAmount: Math.max(0, Number(invoiceRow.total_amount) - paidAmount),
    branchName,
    trackingToken: orderRow?.tracking_token || undefined,
  } as TaxInvoice;

  return { invoice, tenant };
}
