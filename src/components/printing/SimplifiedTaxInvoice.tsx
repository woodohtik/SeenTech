import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Barcode from 'react-barcode';
import { generateZatcaQR } from '../../services/zatcaService';
import { ShoppingBag, Printer } from 'lucide-react';
import { CurrencySymbol } from '../CurrencySymbol';

export interface SimplifiedInvoiceItem {
  id?: string;
  name: string;
  quantity: number;
  unitPrice: number; // VAT-inclusive unit price
  vatAmount?: number;
  total?: number;
}

export interface SimplifiedSellerInfo {
  name: string;
  nameEn?: string;
  logoUrl?: string;
  vatNumber: string;
  address: string;
  addressEn?: string;
  phone?: string;
}

export interface SimplifiedTaxInvoiceProps {
  invoiceNumber: string;
  issueDate: string;
  paymentMethod: string;
  paymentMethodEn?: string;
  seller: SimplifiedSellerInfo;
  customerName?: string;
  items: SimplifiedInvoiceItem[];
  totals?: {
    subtotal: number; // Excluding VAT
    discount: number;
    taxableAmount: number;
    vatAmount: number; // 15% VAT
    grandTotal: number;
    paidAmount?: number;
    remainingAmount?: number;
  };
  qrCodeBase64?: string;
  orderId?: string;
  onPrint?: () => void;
  hidePrintButton?: boolean;
  branchName?: string;
  sellerName?: string;
}

export default function SimplifiedTaxInvoice({
  invoiceNumber,
  issueDate,
  paymentMethod,
  paymentMethodEn = 'Cash',
  seller: rawSeller,
  customerName = 'عميل نقدي / Guest Customer',
  items,
  totals,
  qrCodeBase64,
  orderId,
  onPrint,
  hidePrintButton = false,
  branchName = 'الفرع الرئيسي',
  sellerName = 'النظام',
}: SimplifiedTaxInvoiceProps) {
  const [fontSizeScale, setFontSizeScale] = React.useState<number>(100);

  const [layoutSettings] = React.useState(() => {
    try {
      const stored = localStorage.getItem('pos_invoice_settings');
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });

  const seller = {
    ...rawSeller,
    name: layoutSettings?.header?.facilityName || rawSeller.name,
    vatNumber: layoutSettings?.header?.taxId || rawSeller.vatNumber,
    address: layoutSettings?.header?.address || rawSeller.address,
    phone: layoutSettings?.header?.contactNumbers || rawSeller.phone,
    logoUrl: layoutSettings?.header?.logoUrl || rawSeller.logoUrl,
  };

  // If totals are not provided, compute them dynamically (assuming unitPrice is VAT-inclusive)
  const computedTotals = totals || (() => {
    let grandTotal = 0;
    let vatAmount = 0;
    let taxableAmount = 0;
    let subtotal = 0;

    items.forEach((item) => {
      const itemTotalInc = item.unitPrice * item.quantity;
      const itemTotalExc = itemTotalInc / 1.15;
      const itemVat = itemTotalInc - itemTotalExc;

      grandTotal += itemTotalInc;
      vatAmount += itemVat;
      taxableAmount += itemTotalExc;
      subtotal += itemTotalExc;
    });

    return {
      subtotal,
      discount: 0,
      taxableAmount,
      vatAmount,
      grandTotal,
    };
  })();

  const invoiceDate = new Date(issueDate || new Date().toISOString());
  const finalQr = qrCodeBase64 || generateZatcaQR(
    seller.name,
    seller.vatNumber,
    invoiceDate.toISOString(),
    computedTotals.grandTotal.toFixed(2),
    computedTotals.vatAmount.toFixed(2)
  );

  const handlePrint = () => {
    if (onPrint) {
      onPrint();
    } else {
      window.print();
    }
  };

  // Compute total pieces
  const totalPieces = items.reduce((sum, item) => sum + (item.quantity || 1), 0);

  // Paid and remaining calculations
  // @ts-ignore
  const paidAmount = totals?.paidAmount !== undefined ? Number(totals.paidAmount) : computedTotals.grandTotal;
  // @ts-ignore
  const remainingAmount = totals?.remainingAmount !== undefined ? Number(totals.remainingAmount) : Math.max(0, computedTotals.grandTotal - paidAmount);

  // NOTE on `print:mx-auto` below (it used to be `print:m-0`):
  // zeroing the margin in an RTL document makes this narrower block hug the
  // RIGHT edge of the paper. Keeping the auto side margins is what actually
  // centres the receipt on the roll.
  return (
    <div className="w-full max-w-[80mm] mx-auto bg-white p-1 font-sans text-right print:px-3 print:py-1.5" dir="rtl">
      
      {/* Print Controls (Hidden in Print Mode) */}
      {!hidePrintButton && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6 print:hidden bg-slate-50 p-4 rounded-2xl border border-slate-100">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-slate-600">حجم الخط:</span>
            <div className="flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden">
              <button onClick={() => setFontSizeScale(s => Math.max(70, s - 10))} className="px-3 py-1.5 hover:bg-slate-50 text-slate-700 font-bold border-l border-slate-200 cursor-pointer">-</button>
              <span className="px-3 py-1.5 text-xs font-bold text-slate-800 min-w-[3rem] text-center" dir="ltr">{fontSizeScale}%</span>
              <button onClick={() => setFontSizeScale(s => Math.min(150, s + 10))} className="px-3 py-1.5 hover:bg-slate-50 text-slate-700 font-bold border-r border-slate-200 cursor-pointer">+</button>
            </div>
          </div>
          <button
            onClick={handlePrint}
            className="flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs shadow-sm transition-all cursor-pointer w-full sm:w-auto"
          >
            <Printer size={14} />
            <span>طباعة الإيصال / Print</span>
          </button>
        </div>
      )}

      {/* Invoice Frame - 80mm Thermal Style */}
      <div id="simplified-invoice-container" className="bg-white px-2 py-1 print:px-2.5 print:py-1 text-slate-900 text-[9px] leading-tight" style={{ zoom: `${fontSizeScale}%` }}>

        {/* Store Name & Logo - Centered */}
        <div className="text-center mb-1">
          {seller.logoUrl ? (
            <img
              src={seller.logoUrl}
              alt="Seller Logo"
              className="w-16 h-16 object-contain rounded-xl border border-slate-200 p-1 mx-auto mb-1"
              referrerPolicy="no-referrer"
              crossOrigin="anonymous"
            />
          ) : (
            <div className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mx-auto mb-1">
              <ShoppingBag size={20} />
            </div>
          )}
          
          <h2 className="text-[11.5px] font-black text-slate-900 leading-tight">{seller.name}</h2>
          {seller.nameEn && <h3 className="text-[8.5px] font-bold text-slate-600 font-sans tracking-wide mt-0.5">{seller.nameEn}</h3>}
        </div>

        {/* Invoice Metadata — concise bilingual key-values */}
        <div className="space-y-0.5 mb-1 border-t border-solid border-slate-300 pt-1 text-[9px]">
          {/* Address */}
          <div className="flex justify-between items-center py-0.5">
            <div className="text-right font-bold text-slate-900 min-w-0 break-words">
              <span className="text-slate-600 font-bold">العنوان: </span>
              <span>{seller.address}</span>
            </div>
            <span className="text-slate-500 font-sans text-[7.5px] font-bold shrink-0 ps-1 whitespace-nowrap">Address</span>
          </div>

          {/* Phone */}
          {seller.phone && (
            <div className="flex justify-between items-center py-0.5">
              <div className="text-right font-bold text-slate-900 min-w-0 break-words">
                <span className="text-slate-600 font-bold">رقم الهاتف: </span>
                <span className="font-mono text-[9.5px]" dir="ltr">{seller.phone}</span>
              </div>
              <span className="text-slate-500 font-sans text-[7.5px] font-bold shrink-0 ps-1 whitespace-nowrap">Phone No.</span>
            </div>
          )}

          {/* Date & Time with gap */}
          <div className="flex justify-between items-center py-0.5">
            <div className="text-right font-bold text-slate-900 flex items-center gap-1 min-w-0 whitespace-nowrap">
              <span className="text-slate-600 font-bold">التاريخ: </span>
              <span className="font-mono text-slate-900 text-[9.5px]" dir="ltr">
                {invoiceDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}
              </span>
              <span className="font-mono text-slate-700 text-[8.5px] ms-3" dir="ltr">
                {invoiceDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
              </span>
            </div>
            <span className="text-slate-500 font-sans text-[7.5px] font-bold shrink-0 ps-1 whitespace-nowrap">Issue Date</span>
          </div>

          {/* Invoice Number */}
          <div className="flex justify-between items-center py-0.5">
            <div className="text-right font-bold text-slate-900 min-w-0 break-words">
              <span className="text-slate-600 font-bold">رقم الفاتورة: </span>
              <span className="font-mono font-black text-[9.5px] uppercase">#{invoiceNumber}</span>
            </div>
            <span className="text-slate-500 font-sans text-[7.5px] font-bold shrink-0 ps-1 whitespace-nowrap">Invoice No.</span>
          </div>

          {/* Branch */}
          <div className="flex justify-between items-center py-0.5">
            <div className="text-right font-bold text-slate-900 min-w-0 break-words">
              <span className="text-slate-600 font-bold">الفرع: </span>
              <span>{branchName}</span>
            </div>
            <span className="text-slate-500 font-sans text-[7.5px] font-bold shrink-0 ps-1 whitespace-nowrap">Branch</span>
          </div>

          {/* Seller */}
          <div className="flex justify-between items-center py-0.5">
            <div className="text-right font-bold text-slate-900 min-w-0 break-words">
              <span className="text-slate-600 font-bold">البائع: </span>
              <span>{sellerName}</span>
            </div>
            <span className="text-slate-500 font-sans text-[7.5px] font-bold shrink-0 ps-1 whitespace-nowrap">Seller</span>
          </div>
        </div>

        {/* Separator line between Seller info and Tax Invoice Title */}
        <div className="text-center my-1 pt-1 border-t border-solid border-slate-300">
          <h1 className="text-[11.5px] font-black text-slate-900">فاتورة ضريبية مبسطة</h1>
          <p className="text-[8.5px] font-bold uppercase tracking-wider text-slate-600 font-sans mt-0.5">Simplified Tax Invoice</p>
        </div>

        {/* Tax Registration Number */}
        <div className="text-center mb-1 text-[9px] font-bold text-slate-900 whitespace-nowrap">
          <span>الرقم الضريبي: </span>
          <span className="font-mono font-black text-[9.5px]">{seller.vatNumber}</span>
        </div>

        {/* Items Table */}
        <div className="mb-1 border-b border-solid border-slate-300 pb-1 space-y-0.5">
          <div className="flex justify-between items-end text-[8px] font-black text-slate-700 uppercase tracking-tight border-b border-solid border-slate-300 pb-0.5 gap-1">
            <span className="flex-1 min-w-0 text-right">المنتج / Item</span>
            <span className="w-12 shrink-0 text-center">السعر</span>
            <span className="w-14 shrink-0 text-left font-bold">الإجمالي</span>
          </div>

          {items.map((item, idx) => {
            const itemTotalInc = item.unitPrice * item.quantity;
            return (
              <div key={idx} className="flex justify-between items-start text-[9px] py-0.5 text-slate-900 border-b border-solid border-slate-100 last:border-0 gap-1">
                <div className="flex-1 min-w-0 text-right font-bold text-slate-900 leading-tight break-words">
                  <span className="font-mono text-slate-800 font-bold" dir="ltr">× {item.quantity}</span>{' '}
                  {item.name}
                </div>
                <span className="w-12 shrink-0 text-center font-mono font-bold text-slate-800 inline-flex items-center justify-center gap-0.5 whitespace-nowrap">
                  {item.unitPrice.toFixed(2)}<CurrencySymbol className="h-[1em] w-auto shrink-0" />
                </span>
                <span className="w-14 shrink-0 text-left font-mono font-black text-slate-900 inline-flex items-center justify-end gap-0.5 whitespace-nowrap">
                  {itemTotalInc.toFixed(2)}<CurrencySymbol className="h-[1em] w-auto shrink-0" />
                </span>
              </div>
            );
          })}
        </div>

        {/* Separator line after last product and before Totals breakdown */}
        {/* Totals Breakdown */}
        <div className="space-y-0.5 border-b border-solid border-slate-300 pb-1 mb-1 text-[9px]">
          {/* Subtotal excluding VAT */}
          <div className="flex justify-between items-center gap-2 text-slate-800 font-bold">
            <span className="whitespace-nowrap">الإجمالي غير شامل الضريبة / Subtotal:</span>
            <span className="font-mono font-bold shrink-0 inline-flex items-center gap-0.5">{computedTotals.subtotal.toFixed(2)} <CurrencySymbol className="h-[1em] w-auto shrink-0" /></span>
          </div>

          {/* Discount */}
          {computedTotals.discount > 0 && (
            <div className="flex justify-between items-center gap-2 text-red-600 font-black text-[9px]">
              <span className="whitespace-nowrap">الخصم / Discount:</span>
              <span className="font-mono shrink-0 inline-flex items-center gap-0.5">-{computedTotals.discount.toFixed(2)} <CurrencySymbol className="h-[1em] w-auto shrink-0" /></span>
            </div>
          )}

          {/* VAT Amount */}
          <div className="flex justify-between items-center gap-2 text-slate-800 font-bold">
            <span className="whitespace-nowrap">الضريبة (15%) / VAT Amount:</span>
            <span className="font-mono font-bold shrink-0 inline-flex items-center gap-0.5">{computedTotals.vatAmount.toFixed(2)} <CurrencySymbol className="h-[1em] w-auto shrink-0" /></span>
          </div>

          {/* Grand total including VAT */}
          <div className="flex justify-between items-center gap-2 text-[10.5px] font-black text-slate-900 pt-0.5">
            <span className="whitespace-nowrap">الإجمالي شامل الضريبة / Total:</span>
            <span className="font-mono text-[11px] font-black shrink-0 inline-flex items-center gap-0.5">{computedTotals.grandTotal.toFixed(2)} <CurrencySymbol className="h-[1em] w-auto shrink-0" /></span>
          </div>
        </div>

        {/* Separator line between Totals and Payment Details */}
        {/* Payment & Pieces Details */}
        <div className="space-y-0.5 border-b border-solid border-slate-300 pb-1 mb-1 text-[9px]">
          {/* Paid */}
          <div className="flex justify-between items-center gap-2 text-slate-800 font-bold">
            <span className="whitespace-nowrap">المدفوع / Paid Amount:</span>
            <span className="font-mono font-bold shrink-0 inline-flex items-center gap-0.5">{paidAmount.toFixed(2)} <CurrencySymbol className="h-[1em] w-auto shrink-0" /></span>
          </div>

          {/* Remaining */}
          <div className="flex justify-between items-center gap-2 text-slate-800 font-bold">
            <span className="whitespace-nowrap">المتبقي / Remaining:</span>
            <span className="font-mono font-bold shrink-0 inline-flex items-center gap-0.5">{remainingAmount.toFixed(2)} <CurrencySymbol className="h-[1em] w-auto shrink-0" /></span>
          </div>

          {/* Number of Pieces */}
          <div className="flex justify-between items-center gap-2 text-slate-800 font-bold">
            <span className="whitespace-nowrap">عدد القطع / Total Pieces:</span>
            <span className="font-mono font-bold shrink-0">{totalPieces}</span>
          </div>

          {/* Payment Method */}
          <div className="flex justify-between items-center gap-2 text-slate-800 font-bold">
            <span className="whitespace-nowrap">طريقة الدفع / Payment:</span>
            <span className="font-bold text-left min-w-0">{paymentMethod} / {paymentMethodEn}</span>
          </div>
        </div>

        {/* Separator line between Payment Method and QR Code */}
        {/* ZATCA Compliant QR Code */}
        <div className="flex flex-col items-center justify-center py-1 mb-1">
          <div className="bg-slate-50 p-1 rounded-xl border border-slate-200 shadow-inner">
            <QRCodeSVG value={finalQr} size={95} level="M" />
          </div>
        </div>

        {/* Retail Slip Bottom note */}
        <div className="pt-0.5 text-center">
          <p className="font-black text-slate-900 text-[9.5px] mb-0.5">شكراً لزيارتكم وعودتكم تسعدنا</p>
          <p className="text-[7.5px] text-slate-600 font-bold font-sans uppercase tracking-wider">Thank you for your visit</p>
        </div>

      </div>

      {/* Styled Printable thermal Setup */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page { margin: 3mm 4mm 3mm 4mm; size: auto; }
          html, body {
            background: white !important;
            color: black !important;
            margin: 0 !important;
            padding: 0 !important;
            height: auto !important;
            min-height: 0 !important;
            -webkit-text-size-adjust: 100% !important;
            text-size-adjust: 100% !important;
          }
          #print-area, #simplified-invoice-container, #simplified-invoice-container * {
            visibility: visible;
            box-sizing: border-box !important;
            min-height: 0 !important;
            max-height: none !important;
          }
          .print\\:hidden, #app-navigation, header, aside, button {
            display: none !important;
          }
          #simplified-invoice-container {
            border: none !important;
            padding: 1.5mm 2.5mm !important;
            margin: 0 auto !important;
            width: 100% !important;
            max-width: 100% !important;
            box-sizing: border-box !important;
            zoom: 1 !important;
            font-size: 7.5pt !important;
            line-height: 1.25 !important;
            height: auto !important;
            min-height: 0 !important;
          }
          #simplified-invoice-container h1 { font-size: 9.5pt !important; line-height: 1.2 !important; }
          #simplified-invoice-container h2 { font-size: 9pt !important; line-height: 1.2 !important; }
          #simplified-invoice-container h3 { font-size: 7pt !important; line-height: 1.2 !important; }
        }
      `}} />
    </div>
  );
}
