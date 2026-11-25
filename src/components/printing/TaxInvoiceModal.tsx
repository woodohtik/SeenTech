import React from 'react';
import { cn } from '../../lib/utils';
import { useVerticalConfig } from '../../hooks/useVerticalConfig';
import { lineSpecsText } from '../orders/OrderItemAttributes';
import { Tenant, TaxInvoice } from '../../types';
import { computePaidRemaining } from '../../utils/cartTotals';
import { logEmployeeAction } from '../../services/employeeAuditService';
import { Download, X, Printer, Share2, Paperclip } from 'lucide-react';
import { generateZatcaQR } from '../../services/zatcaService';
import { useTranslation } from 'react-i18next';
import StandardTaxInvoice from './TaxInvoice';
import SimplifiedTaxInvoice from './SimplifiedTaxInvoice';
import { downloadInvoicePDF, shareOrDownloadInvoicePDF } from '../../utils/pdfGenerator';
import { useToast } from '../../contexts/ToastContext';
import { openWhatsApp, whatsappMessage } from '../../utils/whatsapp';
import { isRtlLang } from '../../lib/direction';
import { taxRatePercent } from '../../shared/taxRate';

// Extracted from TaxInvoices.tsx so the exact same invoice -- same
// component, same data shape (TaxInvoice, keyed off the tax_invoices
// table) -- can be shown from any screen that already has an order's
// invoice (the tax-invoice registry, Orders, and POS's debt-settlement
// receipt), instead of each place inventing its own look.

interface TaxInvoiceModalProps {
  order: TaxInvoice;
  tenant: Tenant;
  onClose: () => void;
}

// Bug report (2026-11-16): POS's debt-settlement flow needs this exact
// invoice (same mapping, same print/share logic) shown inline inside the
// existing side drawer it already uses for "فاتورة صدرت" after a new
// sale, not as a separate centered popup. Split out everything below the
// popup's own backdrop/positioning wrapper into this component so both
// call sites -- the popup default export here, and POS.tsx's inline
// drawer -- render identically from the same code, instead of POS.tsx
// reimplementing the seller/buyer/totals mapping and print/share/PDF
// logic a second time.
export function TaxInvoiceDocument({ order, tenant, onClose }: TaxInvoiceModalProps) {
  const { t, i18n } = useTranslation();
  const { orderItemFields } = useVerticalConfig();
  const isRtl = isRtlLang(i18n.language);
  const { error: toastError } = useToast();

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        void handlePrint();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [order, onClose]);

  const isB2B = order.isB2B || false;

  // Calculate totals
  const totalIncVat = order.totalAmount || 0;
  const vatAmount = order.taxAmount || 0;
  const totalExcVat = order.subTotal || (totalIncVat - vatAmount);
  // order.taxRate || 15 كان يستبدل 0% (فاتورة معفاة) بـ15% خطأً لأن 0 قيمة
  // falsy في JS.
  // The one reader of a stored rate (src/shared/taxRate.ts, P1.2); a missing
  // rate on an old row prints as 15%, a real 0 as 0.
  const vatRate = taxRatePercent(order.taxRate) ?? 15;

  const invoiceDate = new Date(order.issuedAt || new Date().toISOString());

  const handleDownloadPDF = async () => {
    try {
      await downloadInvoicePDF('print-area', `Invoice-${order.invoiceNumber || order.id}.pdf`);
    } catch (e) {
      console.error(e);
    }
  };

  /**
   * طباعة الفاتورة الضريبية.
   *
   * كانت `window.print()` تطبع الصفحة كاملة بهوامش المتصفح الافتراضية،
   * ومع حشو النافذة (p-4 / md:p-8) وقاعدة `height: 100%` كان يخرج هامش
   * كبير أعلى وأسفل الفاتورة. الآن تمر عبر محرك الطباعة الموحّد فيخرج
   * نفس شكل الفاتورة وبنفس الهوامش على كل الأجهزة.
   *
   * الفاتورة الضريبية الكاملة (B2B) تُطبع على A4، والمبسطة تتبع مقاس
   * الورق المضبوط في إعدادات الطابعة.
   */
  const handlePrint = async () => {
    logEmployeeAction(
      order.tenantId,
      // @ts-expect-error currentStaffId is set on window ad hoc elsewhere, not declared on its type
      window.currentStaffId || 'system',
      // @ts-expect-error currentStaffName is set on window ad hoc elsewhere, not declared on its type
      window.currentStaffName || 'System',
      'print_invoice',
      `طباعة فاتورة ضريبية رقم ${order.invoiceNumber || order.id}`
    );

    try {
      const { printElementDetailed, getConfiguredPaperSize } = await import('../../utils/printManager');
      const res = await printElementDetailed('print-area', {
        paperSize: isB2B ? 'A4' : getConfiguredPaperSize('80mm'),
        title: t('printing.invoice_doc_title', { number: order.invoiceNumber || order.id }),
      });
      if (!res.ok) {
        // مع الطباعة الصامتة قد لا تُفتح نافذة طباعة، فلا بد من إشعار مرئي
        console.error('[TaxInvoiceModal] فشل الطباعة:', res.message);
        toastError(res);
      }
    } catch (e) {
      console.error('[TaxInvoiceModal] خطأ الطباعة:', e);
      window.print();
    }
  };

  // TaxInvoice carries no customer phone field at all -- this modal's
  // order comes from src/types/index.ts's camelCase TaxInvoice, which
  // (unlike the Order type used elsewhere for POS/Orders/SalesRecord)
  // never had one, matching the original blank-recipient behavior below.
  // The user's own customizable template (WhatsAppSettings), not a fixed
  // string -- the invoice share message must match what they configured.
  // Uses /track/:token (the real, working, no-auth public tracking page)
  // -- /order/:id is not a route at all (confirmed in App.tsx: any
  // unmatched path redirects to "/").
  const buildTaxInvoiceWhatsAppText = () => whatsappMessage('invoice', {
    customerName: order.customerName,
    invoiceNumber: String(order.invoiceNumber || order.id),
    total: totalIncVat,
    trackingToken: order.trackingToken,
    storeName: tenant.name,
  });

  // seen-whatsapp-instant-send-task.md: used to await
  // shareOrDownloadInvoicePDF BEFORE opening WhatsApp -- by the time it
  // resolved, the click's "user activation" window had often already
  // expired, so Chrome/Edge silently blocked the window.open as an
  // unwanted popup with no visible error. Now opens WhatsApp immediately,
  // synchronously, in the same click handler. Attaching the invoice as an
  // actual PDF file is a separate, explicit, optional action now
  // (handleAttachInvoicePdf below).
  const handleShareWhatsApp = () => {
    openWhatsApp({ message: buildTaxInvoiceWhatsAppText(), kind: 'customer' });
  };

  // The optional "attach as PDF too" step split out of handleShareWhatsApp
  // above -- native share (text + file together) is the only way a web
  // app can hand both to WhatsApp at once; falls back to downloading the
  // PDF so it's ready to attach manually. Never blocks or precedes
  // opening WhatsApp itself.
  const handleAttachInvoicePdf = async () => {
    const filename = `Invoice-${order.invoiceNumber || order.id}.pdf`;
    await shareOrDownloadInvoicePDF('print-area', filename, buildTaxInvoiceWhatsAppText());
  };

  // Use pre-computed QR, or fallback logic
  // مراجعة-الفريق-التقني-الكامل-2026-10-19.md (امتثال، متوسطة): كان الرقم
  // الضريبي المفقود يُستبدَل صامتاً بـ'000000000000000' -- رقم بصيغة صحيحة
  // (15 رقماً) يبدو حقيقياً، فيُنتج QR يمر كفاتورة ضريبية سليمة ظاهرياً رغم
  // عدم وجود رقم ضريبي حقيقي خلفه. الآن: لا رقم حقيقي = لا QR إطلاقاً، فشل
  // ظاهر (الفاتورة تُطبَع بلا الرمز) بدل بيانات وهمية صامتة.
  const sellerName = order.sellerName || tenant.name || 'المنشأة';
  const vatNumber = order.sellerTRN || tenant.taxSettings?.trn || tenant.vatNumber || '';
  const qrCodeBase64 = order.qrCodeBase64 || (vatNumber
    ? generateZatcaQR(sellerName, vatNumber, invoiceDate.toISOString(), totalIncVat.toFixed(2), vatAmount.toFixed(2))
    : undefined);

  // Build items list
  const formattedItems = order.items.map((item: any) => ({
    name: item.type === 'custom' ? item.garmentType || t('orders.custom_thobe') : item.name || t('orders.ready_made'),
    quantity: Number(item.quantity || 0),
    unitPrice: Number(item.price || item.unitPrice || 0),
    taxType: item.taxType,
    vatAmount: Number((item.price || item.unitPrice || 0) * item.quantity - ((item.price || item.unitPrice || 0) * item.quantity) / (1 + vatRate / 100)),
    total: Number((item.price || item.unitPrice || 0) * item.quantity),
    // The line's specs in the shop's own fields (Phase 3 of
    // seen-verticals-readiness-task.md); empty for men's tailoring, whose
    // options have their own columns. The invoice is printed in Arabic.
    specs: lineSpecsText(item.attributes, orderItemFields, 'ar') || undefined,
  }));

  const sellerInfo = {
    name: sellerName,
    nameEn: (tenant as any).name_en || 'Seen System Brand',
    logoUrl: tenant.logoUrl,
    vatNumber: vatNumber,
    address: tenant.address || 'المملكة العربية السعودية',
    addressEn: (tenant as any).address_en || 'Saudi Arabia',
    crNumber: tenant.commercialRegister,
    phone: tenant.phone || '',
    email: (tenant as any).email || ''
  };

  const buyerInfo = {
    name: order.b2bCompanyName || order.customerName || t('tax_invoices.walk_in_customer'),
    nameEn: (order as any).customer_name_en || 'Guest Client',
    vatNumber: order.b2bTRN,
    address: (order as any).customer_address || '',
    addressEn: (order as any).customer_address_en || '',
    phone: (order as any).customer_phone || ''
  };

  // Was absent entirely -- the printed B2B tax invoice for a partially-paid
  // order showed no outstanding balance (TaxInvoice.tsx had no UI for it
  // at all; now it does -- see that file's own fix).
  const { paidAmount, remainingAmount } = computePaidRemaining(Number(totalIncVat), (order as any).paidAmount);
  const totals = {
    subtotal: Number(totalExcVat),
    discount: Number((order as any).discount_amount || 0),
    taxableAmount: Number(totalExcVat),
    vatAmount: Number(vatAmount),
    grandTotal: Number(totalIncVat),
    paidAmount,
    remainingAmount
  };

  // Extract payment method safely if defined
  // @ts-expect-error order.paymentMethod isn't declared on this order type, only the snake_case DB column is
  const orderPayMethod = String(order.paymentMethod || (order as any).payment_method || 'cash').toLowerCase();
  const paymentMethodAr = (orderPayMethod === 'network' || orderPayMethod === 'card' || orderPayMethod === 'mada') ? t('pos.card') :
    (orderPayMethod === 'bank_transfer' || orderPayMethod === 'transfer') ? t('pos.bank_transfer') :
    (orderPayMethod === 'partial' || orderPayMethod === 'credit') ? t('pos.partial_credit') :
    (orderPayMethod === 'cash_on_delivery' || orderPayMethod === 'cod') ? t('common.payment_methods.cash_on_delivery') :
    t('pos.cash');
  const paymentMethodEn = (orderPayMethod === 'network' || orderPayMethod === 'card' || orderPayMethod === 'mada') ? 'Card/Mada' :
    (orderPayMethod === 'bank_transfer' || orderPayMethod === 'transfer') ? 'Bank Transfer' :
    (orderPayMethod === 'partial' || orderPayMethod === 'credit') ? 'Credit/Partial' :
    (orderPayMethod === 'cash_on_delivery' || orderPayMethod === 'cod') ? 'Cash on Delivery' :
    'Cash';

  return (
    <div className="bg-white rounded-3xl shadow-2xl relative overflow-y-auto max-h-full flex flex-col font-sans border border-border w-full"
      dir={isRtl ? 'rtl' : 'ltr'}>

        {/* Modal Controls */}
        <div className="p-4 border-b border-border flex flex-wrap gap-3 justify-between items-center bg-surface-muted/50 print:hidden shrink-0">
          <h3 className="text-lg font-black text-content">{t('tax_invoices.preview_title')}</h3>
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <button
              onClick={handleDownloadPDF}
              className="flex-1 min-w-[110px] px-3 py-2.5 bg-brand text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-brand/90 transition-all shadow-sm cursor-pointer text-sm"
            >
              <Download size={16} /> {t('sales_record.download_pdf')}
            </button>
            <button
              onClick={handleShareWhatsApp}
              className="flex-1 min-w-[110px] px-3 py-2.5 bg-[#25D366] text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-[#20ba56] transition-all shadow-sm cursor-pointer text-sm"
            >
              <Share2 size={16} /> {t('sales_record.share_whatsapp')}
            </button>
            <button
              onClick={() => void handleAttachInvoicePdf()}
              className="flex-1 min-w-[110px] px-3 py-2.5 bg-surface border border-border text-content-muted hover:text-content rounded-xl font-bold flex items-center justify-center gap-2 transition-all cursor-pointer text-sm"
            >
              <Paperclip size={16} /> {t('tax_invoices.attach_pdf', 'إرفاق PDF أيضاً')}
            </button>
            <button
              onClick={handlePrint}
              className="flex-1 min-w-[90px] px-3 py-2.5 bg-content text-surface rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-content/90 transition-colors shadow-sm cursor-pointer text-sm"
            >
              <Printer size={16} /> {t('tax_invoices.print')}
            </button>
            <button onClick={onClose} aria-label={t('common.close')} className="min-w-[40px] min-h-[40px] flex items-center justify-center hover:bg-surface rounded-full transition-colors shadow-sm text-content-muted cursor-pointer">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Invoice Content (Printable Area) */}
        <div id="print-area" className="flex-1 overflow-y-auto p-2 sm:p-4 bg-surface print:p-2 print:px-3 print:overflow-visible print:max-h-none">
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
              orderId={order.orderId || order.id}
              hidePrintButton={true}
              vatRate={vatRate / 100}
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
              totals={{
                ...totals,
                paidAmount: order.paidAmount,
                remainingAmount: order.remainingAmount
              }}
              qrCodeBase64={qrCodeBase64}
              orderId={order.orderId || order.id}
              hidePrintButton={true}
              branchName={order.branchName}
              sellerName={order.createdBy}
              vatRate={vatRate / 100}
            />
          )}
        </div>

        {/*
          قواعد احتياطية فقط (إن فشل محرك الطباعة الموحّد).
          أُزيل `height: 100%` لأنه كان يُجبر الفاتورة على ملء ارتفاع الورقة
          فيخرج فراغ كبير أسفلها، وأُضيف هامش @page صريح بدل هوامش المتصفح.
        */}
        <style dangerouslySetInnerHTML={{ __html: `
          @media print {
            @page {
              size: A4;
              margin: 8mm;
            }
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
              max-width: 100%;
              height: auto !important;
              min-height: 0 !important;
              max-height: none !important;
              overflow: visible !important;
              padding: 0 !important;
              margin: 0 !important;
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

/**
 * Default export: the same invoice document, as a centered popup with its
 * own backdrop -- unchanged behavior for every existing call site (Orders,
 * the tax-invoice registry). POS.tsx's debt-settlement flow uses
 * TaxInvoiceDocument directly instead, inline inside its own side drawer.
 */
export default function TaxInvoiceModal(props: TaxInvoiceModalProps) {
  const isB2B = props.order.isB2B || false;
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={props.onClose} />
      <div className={cn(
        "relative z-10 max-h-[90vh] w-full transition-all duration-200",
        isB2B ? "max-w-3xl" : "max-w-[92mm] sm:max-w-[100mm]"
      )}>
        <TaxInvoiceDocument {...props} />
      </div>
    </div>
  );
}
