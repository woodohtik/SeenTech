import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase/client';
import { handleError, OperationType } from '../lib/firebase';
import { Tenant, TaxInvoice } from '../types';
import { cn } from '../lib/utils';
import { decodeInvoiceExtendedNotes } from '../utils/b2bHelper';
import { PriceDisplay } from './PriceDisplay';
import { FileText, User, Calendar, CreditCard, ShoppingBag, Eye, CheckCircle2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useTranslation } from 'react-i18next';
import TaxInvoiceModal from './printing/TaxInvoiceModal';
import DateTimeDisplay from './DateTimeDisplay';

import { isRtlLang } from '../lib/direction';

export default function TaxInvoices({ tenantId }: { tenantId: string }) {
  const { t, i18n } = useTranslation();
  const isRtl = isRtlLang(i18n.language);

  const [invoices, setInvoices] = useState<TaxInvoice[]>([]);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState<TaxInvoice | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: tenantData } = await supabase
          .from('tenants')
          .select('*')
          .eq('id', tenantId)
          .maybeSingle();

        if (tenantData) {
          const hasVat = Boolean(tenantData.vat_number && tenantData.vat_number.trim().length > 0);
          const rawTax = tenantData.tax_settings;
          const resolvedTax = rawTax ? {
            ...rawTax,
            enabled: rawTax.enabled ?? (hasVat || Boolean(rawTax.trn)),
            trn: rawTax.trn || tenantData.vat_number || '',
            legalName: rawTax.legalName || tenantData.name || '',
            vatRate: rawTax.vatRate ?? 15,
            tailoringTaxType: rawTax.tailoringTaxType || 'exclusive'
          } : {
            enabled: hasVat,
            trn: tenantData.vat_number || '',
            legalName: tenantData.name || '',
            vatRate: 15,
            tailoringTaxType: 'exclusive'
          };

          setTenant({
            ...tenantData,
            vatNumber: tenantData.vat_number || resolvedTax.trn,
            taxSettings: resolvedTax,
            logoUrl: tenantData.logo_url,
            commercialRegister: tenantData.commercial_register,
            legalName: tenantData.legal_name,
            createdAt: tenantData.created_at,
            updatedAt: tenantData.updated_at
          } as Tenant);
        }

        const [{ data: branchesData }, { data: ordersData }, { data: staffData }] = await Promise.all([
          supabase.from('branches').select('*').eq('tenant_id', tenantId),
          supabase.from('orders').select('id, branch_id, tracking_token').eq('tenant_id', tenantId),
          supabase.from('staff').select('id, name')
        ]);

        const branchMap = new Map<string, string>();
        if (branchesData) {
          branchesData.forEach(b => {
            branchMap.set(b.id, b.name);
          });
        }

        const staffMap = new Map<string, string>();
        if (staffData) {
          staffData.forEach(s => {
            if (s.id && s.name) staffMap.set(s.id, s.name);
          });
        }

        const orderBranchMap = new Map<string, string>();
        // seen-whatsapp-instant-send-task.md follow-up: the WhatsApp
        // invoice link needs the order's real tracking_token (/track/:token)
        // -- fetched upfront here, not lazily on click, so opening WhatsApp
        // stays synchronous/instant.
        const orderTrackingTokenMap = new Map<string, string>();
        if (ordersData) {
          ordersData.forEach(o => {
            if (branchesData) {
              const bName = branchMap.get(o.branch_id);
              if (bName && o.id) orderBranchMap.set(o.id, bName);
            }
            if (o.id && o.tracking_token) orderTrackingTokenMap.set(o.id, o.tracking_token);
          });
        }

        const { data, error } = await supabase
          .from('tax_invoices')
          .select('*')
          .eq('tenant_id', tenantId);

        if (error) throw error;

        const invoicesData = data.map(d => {
          const extNotes = decodeInvoiceExtendedNotes(d.notes);
          const resolvedCreator = extNotes.created_by ||
            (d.created_by && staffMap.has(d.created_by) ? staffMap.get(d.created_by) : d.created_by) ||
            t('common.system');

          return {
            id: d.id,
            invoiceNumber: d.invoice_number,
            orderId: d.order_id,
            tenantId: d.tenant_id,
            customerId: d.customer_id,
            customerName: d.customer_name,
            items: extNotes.items || d.items || [],
            subTotal: d.subtotal,
            taxRate: d.tax_rate,
            taxAmount: d.tax_amount,
            totalAmount: d.total_amount,
            isB2B: extNotes.is_b2b !== undefined ? extNotes.is_b2b : (d.is_b2b || d.invoice_type === 'standard_b2b' || !!d.vat_number),
            b2bCompanyName: extNotes.b2b_company_name || d.customer_name,
            b2bTRN: d.vat_number,
            qrCodeBase64: d.zatca_qr_code || d.qr_payload,
            issuedAt: d.issued_at,
            createdBy: resolvedCreator,
            status: d.status === 'issued' ? 'valid' : 'cancelled',
            paidAmount: d.paid_amount !== undefined && d.paid_amount !== null ? Number(d.paid_amount) : Number(d.total_amount),
            remainingAmount: Math.max(0, Number(d.total_amount) - (d.paid_amount !== undefined && d.paid_amount !== null ? Number(d.paid_amount) : Number(d.total_amount))),
            branchName: d.order_id ? (orderBranchMap.get(d.order_id) || t('common.main_branch')) : t('common.main_branch'),
            trackingToken: d.order_id ? orderTrackingTokenMap.get(d.order_id) : undefined
          } as TaxInvoice;
        });

        invoicesData.sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime());
        setInvoices(invoicesData);
      } catch (error) {
        handleError(error as any, OperationType.LIST, 'tax_invoices');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [tenantId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 font-sans bg-surface" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="mb-4 md:mb-6 flex justify-between items-center bg-surface p-4 md:p-6 rounded-2xl shadow-sm border border-border">
        <div>
          <h2 className="text-xl font-black text-content flex items-center gap-2">
            <FileText className="text-brand" />
            {t('tax_invoices.title')}
          </h2>
          <p className="text-sm font-bold text-content-muted mt-1">{t('tax_invoices.records_desc')}</p>
        </div>
      </div>

      <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden">
        {/* Desktop View Table */}
        <div className="hidden md:block overflow-x-auto whitespace-nowrap scrollbar-hide">
          <table className="w-full text-right min-w-max">
            <thead className="bg-surface-muted border-b border-border text-content-muted text-[10px] uppercase font-black tracking-wider">
              <tr>
                <th className="p-4">{t('tax_invoices.invoice_no')}</th>
                <th className="p-4">{t('tax_invoices.date_time')}</th>
                <th className="p-4">{t('tax_invoices.customer')}</th>
                <th className="p-4">{t('tax_invoices.invoice_type')}</th>
                <th className="p-4">{t('tax_invoices.total_vat')}</th>
                <th className="p-4 text-left">{t('tax_invoices.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-sm font-medium">
              {invoices.map((inv) => {
                const invoiceType = inv.isB2B ? t('tax_invoices.b2b_label') : t('tax_invoices.b2c_label');

                return (
                  <tr key={inv.id} className="hover:bg-brand/5 transition-colors group cursor-pointer" onClick={() => setSelectedInvoice(inv)}>
                    <td className="p-4">
                      <span className="font-mono font-bold text-content">{inv.invoiceNumber}</span>
                    </td>
                    <td className="p-4 text-content-muted font-bold">
                      <DateTimeDisplay date={inv.issuedAt} showTime={true} />
                    </td>
                    <td className="p-4 text-content font-bold">{inv.customerName || t('tax_invoices.walk_in_customer')}</td>
                    <td className="p-4 text-content-muted text-xs">
                      <span className="bg-brand/10 text-brand px-2 py-1 rounded-lg font-bold">{invoiceType}</span>
                    </td>
                    <td className="p-4 text-content font-black"><PriceDisplay amount={inv.totalAmount} /></td>
                    <td className="p-4 text-left">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedInvoice(inv);
                        }}
                        className="px-4 py-2 bg-brand/10 text-brand rounded-xl font-bold hover:bg-brand hover:text-white transition-all text-xs flex items-center gap-2 mr-auto"
                      >
                        <Eye size={16} />
                        {t('tax_invoices.view_invoice')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile View Cards */}
        <div className="md:hidden divide-y divide-border">
          {invoices.map((inv) => (
            <div key={inv.id} className="p-4 active:bg-surface-muted" onClick={() => setSelectedInvoice(inv)}>
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="text-xs font-black text-brand mb-1">{inv.invoiceNumber}</p>
                  <p className="font-bold text-content">{inv.customerName || t('tax_invoices.walk_in_customer')}</p>
                </div>
                <div className="text-left">
                  <p className="font-black text-brand"><PriceDisplay amount={inv.totalAmount} /></p>
                  <DateTimeDisplay date={inv.issuedAt} showTime={true} size="xs" />
                </div>
              </div>
              <div className="flex justify-between items-center mt-3">
                <span className="text-[10px] font-bold bg-brand/5 text-brand px-2 py-1 rounded-lg">
                  {inv.isB2B ? 'B2B' : 'B2C'}
                </span>
                <button className="text-brand text-xs font-bold flex items-center gap-1">
                  {t('tax_invoices.view_invoice')} <Eye size={14} />
                </button>
              </div>
            </div>
          ))}
          {invoices.length === 0 && (
            <div className="p-8 text-center text-content-muted font-bold">{t('tax_invoices.no_invoices')}</div>
          )}
        </div>
      </div>

      {/* ZATCA Tax Invoice Modal */}
      {selectedInvoice && tenant && (
        <TaxInvoiceModal
          order={selectedInvoice}
          tenant={tenant}
          onClose={() => setSelectedInvoice(null)}
        />
      )}
    </div>
  );
}
