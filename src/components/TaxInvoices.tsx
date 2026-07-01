import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase/client';
import { handleError, OperationType } from '../lib/firebase';
import { Order, Tenant, TaxInvoice } from '../types';
import { decodeInvoiceExtendedNotes } from '../utils/b2bHelper';
import { logEmployeeAction } from '../services/employeeAuditService';
import { PriceDisplay } from './PriceDisplay';
import { FileText, Download, User, Calendar, CreditCard, ShoppingBag, Eye, X, Printer, CheckCircle2, Share2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { generateZatcaQR } from '../services/zatcaService';
import { useTranslation } from 'react-i18next';
import StandardTaxInvoice from './printing/TaxInvoice';
import SimplifiedTaxInvoice from './printing/SimplifiedTaxInvoice';
import { downloadInvoicePDF, shareInvoiceAsPDFFile } from '../utils/pdfGenerator';

export default function TaxInvoices({ tenantId }: { tenantId: string }) {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar' || i18n.language === 'ur';

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
          setTenant({
            ...tenantData,
            taxSettings: tenantData.tax_settings,
            logoUrl: tenantData.logo_url,
            commercialRegister: tenantData.commercial_register,
            legalName: tenantData.legal_name,
            createdAt: tenantData.created_at,
            updatedAt: tenantData.updated_at
          } as Tenant);
        }

        const { data, error } = await supabase
          .from('tax_invoices')
          .select('*')
          .eq('tenant_id', tenantId);

        if (error) throw error;

        const invoicesData = data.map(d => {
          const extNotes = decodeInvoiceExtendedNotes(d.notes);
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
            createdBy: extNotes.created_by || d.created_by || 'System',
            status: d.status === 'issued' ? 'valid' : 'cancelled'
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
    <div className="p-6 font-sans bg-surface" dir={isRtl ? 'rtl' : 'ltr'} style={{ fontFamily: 'IBM Plex Sans, sans-serif' }}>
      <div className="mb-6 flex justify-between items-center bg-surface p-6 rounded-2xl shadow-sm border border-border">
        <div>
          <h2 className="text-xl font-black text-content flex items-center gap-2">
            <FileText className="text-brand" />
            {t('tax_invoices.title', 'الفواتير الضريبية')}
          </h2>
          <p className="text-sm font-bold text-content-muted mt-1">{t('tax_invoices.records_desc', 'سجل الفواتير المتوافقة مع متطلبات هيئة الزكاة والضريبة والجمارك (ZATCA)')}</p>
        </div>
      </div>

      <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden">
        {/* Desktop View Table */}
        <div className="hidden md:block overflow-x-auto whitespace-nowrap scrollbar-hide">
          <table className="w-full text-right min-w-max">
            <thead className="bg-surface-muted border-b border-border text-content-muted text-[10px] uppercase font-black tracking-wider">
              <tr>
                <th className="p-4">{t('tax_invoices.invoice_no', 'رقم الفاتورة')}</th>
                <th className="p-4">{t('tax_invoices.date_time', 'التاريخ والوقت')}</th>
                <th className="p-4">{t('tax_invoices.customer', 'العميل')}</th>
                <th className="p-4">{t('tax_invoices.invoice_type', 'نوع الفاتورة')}</th>
                <th className="p-4">{t('tax_invoices.total_vat', 'المبلغ شامل الضريبة')}</th>
                <th className="p-4 text-left">{t('tax_invoices.actions', 'الإجراءات')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-sm font-medium">
              {invoices.map((inv) => {
                const invoiceType = inv.isB2B ? t('tax_invoices.b2b_label', 'فاتورة ضريبية (B2B)') : t('tax_invoices.b2c_label', 'فاتورة ضريبية مبسطة (B2C)');

                return (
                  <tr key={inv.id} className="hover:bg-brand/5 transition-colors group cursor-pointer" onClick={() => setSelectedInvoice(inv)}>
                    <td className="p-4">
                      <span className="font-mono font-bold text-content">{inv.invoiceNumber}</span>
                    </td>
                    <td className="p-4 text-content-muted font-bold" dir="ltr">{new Date(inv.issuedAt).toLocaleString(i18n.language === 'ar' ? 'ar-SA' : (i18n.language === 'ur' ? 'ur-PK' : 'en-US'))}</td>
                    <td className="p-4 text-content font-bold">{inv.customerName || t('tax_invoices.walk_in_customer', 'عميل نقدي')}</td>
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
                        {t('tax_invoices.view_invoice', 'عرض الفاتورة')}
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
                  <p className="font-bold text-content">{inv.customerName || t('tax_invoices.walk_in_customer', 'عميل نقدي')}</p>
                </div>
                <div className="text-left">
                  <p className="font-black text-brand"><PriceDisplay amount={inv.totalAmount} /></p>
                  <p className="text-[10px] text-content-muted" dir="ltr">{new Date(inv.issuedAt).toLocaleDateString(i18n.language === 'ar' ? 'ar-SA' : (i18n.language === 'ur' ? 'ur-PK' : 'en-US'))}</p>
                </div>
              </div>
              <div className="flex justify-between items-center mt-3">
                <span className="text-[10px] font-bold bg-brand/5 text-brand px-2 py-1 rounded-lg">
                  {inv.isB2B ? 'B2B' : 'B2C'}
                </span>
                <button className="text-brand text-xs font-bold flex items-center gap-1">
                  {t('tax_invoices.view_invoice', 'عرض التفاصيل')} <Eye size={14} />
                </button>
              </div>
            </div>
          ))}
          {invoices.length === 0 && (
            <div className="p-8 text-center text-content-muted font-bold">{t('tax_invoices.no_invoices', 'لا توجد فواتير متاحة حالياً')}</div>
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

// ------------------------------------
// Tax Invoice Modal Component
// ------------------------------------

interface TaxInvoiceModalProps {
  order: TaxInvoice;
  tenant: Tenant;
  onClose: () => void;
}

function TaxInvoiceModal({ order, tenant, onClose }: TaxInvoiceModalProps) {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar' || i18n.language === 'ur';

  const isB2B = order.isB2B || false;

  // Calculate totals
  const totalIncVat = order.totalAmount || 0;
  const vatAmount = order.taxAmount || 0;
  const totalExcVat = order.subTotal || (totalIncVat - vatAmount);
  // @ts-ignore
  const vatRate = order.taxRate || 15;

  const invoiceDate = new Date(order.issuedAt || new Date().toISOString());

  const handleDownloadPDF = async () => {
    try {
      await downloadInvoicePDF('print-area', `Invoice-${order.invoiceNumber || order.id}.pdf`);
    } catch (e) {
      console.error(e);
    }
  };

  const handleShareWhatsApp = async () => {
    const text = `السلام عليكم ورحمة الله وبركاته،\nمرفق الفاتورة الضريبية الصادرة من المتجر:\nرقم الفاتورة: #${order.invoiceNumber || order.id}\nالإجمالي شامل الضريبة: ${totalIncVat.toFixed(2)} ر.س\nشاكرين ومقدرين لكم تواصلكم معنا.`;
    try {
      await shareInvoiceAsPDFFile('print-area', `Invoice-${order.invoiceNumber || order.id}.pdf`, text);
    } catch (e) {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    }
  };
  
  // Use pre-computed QR, or fallback logic
  const sellerName = order.sellerName || tenant.name || 'المنشأة';
  const vatNumber = order.sellerTRN || tenant.taxSettings?.trn || '000000000000000';
  const qrCodeBase64 = order.qrCodeBase64 || generateZatcaQR(sellerName, vatNumber, invoiceDate.toISOString(), totalIncVat.toFixed(2), vatAmount.toFixed(2));

  // Build items list
  const formattedItems = order.items.map((item: any) => ({
    name: item.type === 'custom' ? item.garmentType || 'تفصيل ثوب' : item.name || 'صنف جاهز',
    quantity: Number(item.quantity || 0),
    unitPrice: Number(item.price || item.unitPrice || 0),
    vatAmount: Number((item.price || item.unitPrice || 0) * item.quantity - ((item.price || item.unitPrice || 0) * item.quantity) / 1.15),
    total: Number((item.price || item.unitPrice || 0) * item.quantity)
  }));

  const sellerInfo = {
    name: sellerName,
    nameEn: (tenant as any).name_en || 'Seen Smart System Brand',
    logoUrl: tenant.logoUrl,
    vatNumber: vatNumber,
    address: tenant.address || 'المملكة العربية السعودية',
    addressEn: (tenant as any).address_en || 'Saudi Arabia',
    crNumber: tenant.commercialRegister,
    phone: tenant.phone || '',
    email: (tenant as any).email || ''
  };

  const buyerInfo = {
    name: order.b2bCompanyName || order.customerName || 'عميل نقدي / Guest Customer',
    nameEn: (order as any).customer_name_en || 'Guest Client',
    vatNumber: order.b2bTRN,
    address: (order as any).customer_address || '',
    addressEn: (order as any).customer_address_en || '',
    phone: (order as any).customer_phone || ''
  };

  const totals = {
    subtotal: Number(totalExcVat),
    discount: Number((order as any).discount_amount || 0),
    taxableAmount: Number(totalExcVat),
    vatAmount: Number(vatAmount),
    grandTotal: Number(totalIncVat)
  };

  // Extract payment method safely if defined
  // @ts-ignore
  const orderPayMethod = order.paymentMethod || order.payment_method;
  const paymentMethodAr = orderPayMethod === 'card' ? 'بطاقة مادية' : 'نقدي';
  const paymentMethodEn = orderPayMethod === 'card' ? 'Card/Mada' : 'Cash';

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl relative z-10 overflow-y-auto max-h-[90vh] flex flex-col font-sans border border-border" dir={isRtl ? 'rtl' : 'ltr'} style={{ fontFamily: 'IBM Plex Sans, sans-serif' }}>
        
        {/* Modal Controls */}
        <div className="p-4 border-b border-border flex flex-wrap gap-3 justify-between items-center bg-surface-muted/50 print:hidden shrink-0">
          <h3 className="text-lg font-black text-content">{t('tax_invoices.preview_title', 'معاينة الفاتورة الضريبية')}</h3>
          <div className="flex flex-wrap gap-2">
            <button 
              onClick={handleDownloadPDF}
              className="px-4 py-2 bg-brand text-white rounded-xl font-bold flex items-center gap-2 hover:bg-brand/90 transition-all shadow-sm cursor-pointer text-xs"
            >
              <Download size={16} /> تحميل PDF
            </button>
            <button 
              onClick={handleShareWhatsApp}
              className="px-4 py-2 bg-[#25D366] text-white rounded-xl font-bold flex items-center gap-2 hover:bg-[#20ba56] transition-all shadow-sm cursor-pointer text-xs"
            >
              <Share2 size={16} /> مشاركة واتساب
            </button>
            <button 
              onClick={() => {
                logEmployeeAction(
                  order.tenantId,
                  // @ts-ignore
                  window.currentStaffId || 'system',
                  // @ts-ignore
                  window.currentStaffName || 'System',
                  'print_invoice',
                  `طباعة فاتورة ضريبية رقم ${order.invoiceNumber || order.id}`
                );
                window.print();
              }} 
              className="px-4 py-2 bg-slate-600 text-white rounded-xl font-bold flex items-center gap-2 hover:bg-slate-700 transition-colors shadow-sm cursor-pointer text-xs"
            >
              <Printer size={16} /> {t('tax_invoices.print', 'طباعة')}
            </button>
            <button onClick={onClose} className="p-2 hover:bg-surface rounded-full transition-colors shadow-sm text-content-muted cursor-pointer">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Invoice Content (Printable Area) */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-surface print:p-0" id="print-area">
          {isB2B ? (
            <StandardTaxInvoice
              invoiceNumber={order.invoiceNumber || order.id.slice(0, 8)}
              issueDate={order.issuedAt}
              supplyDate={order.issuedAt}
              paymentMethod={paymentMethodAr}
              paymentMethodEn={paymentMethodEn}
              seller={sellerInfo}
              buyer={buyerInfo}
              items={formattedItems}
              totals={totals}
              qrCodeBase64={qrCodeBase64}
              orderId={order.id}
              hidePrintButton={true}
            />
          ) : (
            <SimplifiedTaxInvoice
              invoiceNumber={order.invoiceNumber || order.id.slice(0, 8)}
              issueDate={order.issuedAt}
              paymentMethod={paymentMethodAr}
              paymentMethodEn={paymentMethodEn}
              seller={sellerInfo}
              customerName={buyerInfo.name}
              items={formattedItems}
              totals={totals}
              qrCodeBase64={qrCodeBase64}
              orderId={order.id}
              hidePrintButton={true}
            />
          )}
        </div>

      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          body * {
            visibility: hidden;
          }
          #print-area, #print-area * {
            visibility: visible;
          }
          #print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            padding: 0;
            margin: 0;
            background-color: white !important;
          }
          .print\\:hidden {
            display: none !important;
          }
        }
      `}} />
    </div>
  );
}
