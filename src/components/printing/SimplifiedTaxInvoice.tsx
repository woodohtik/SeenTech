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

  return (
    <div className="w-full max-w-md mx-auto my-6 bg-white p-6 border border-slate-200 rounded-3xl shadow-lg relative font-sans text-right print:shadow-none print:border-none print:m-0 print:p-0" dir="rtl">
      
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
      <div id="simplified-invoice-container" className="bg-white px-3.5 py-3 sm:px-4 sm:py-4 print:px-3 print:py-0 text-slate-800 text-[10px]" style={{ zoom: `${fontSizeScale}%` }}>
        
        {/* Store Name - Centered */}
        <div className="text-center mb-4">
          {seller.logoUrl ? (
            <img
              src={seller.logoUrl}
              alt="Seller Logo"
              className="w-14 h-14 object-contain rounded-xl border border-slate-100 p-1 mx-auto mb-2"
              referrerPolicy="no-referrer"
              crossOrigin="anonymous"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mx-auto mb-2">
              <ShoppingBag size={20} />
            </div>
          )}
          
          <h2 className="text-sm font-black text-slate-900 leading-tight">{seller.name}</h2>
          {seller.nameEn && <h3 className="text-[10px] font-semibold text-slate-500 font-sans tracking-wide mt-0.5">{seller.nameEn}</h3>}
        </div>

        {/* Invoice Metadata */}
        <div className="space-y-1.5 mb-4 border-t border-dashed border-slate-300 pt-3 text-[9.5px]">
          {/* Address */}
          <div className="flex justify-between items-center py-0.5">
            <div className="text-right font-bold text-slate-900">
              <span className="text-slate-500 font-medium">العنوان: </span>
              <span>{seller.address}</span>
            </div>
            <span className="text-slate-400 font-sans text-[8px]">Address</span>
          </div>

          {/* Phone */}
          {seller.phone && (
            <div className="flex justify-between items-center py-0.5">
              <div className="text-right font-bold text-slate-900">
                <span className="text-slate-500 font-medium">رقم الهاتف: </span>
                <span className="font-mono" dir="ltr">{seller.phone}</span>
              </div>
              <span className="text-slate-400 font-sans text-[8px]">Phone No.</span>
            </div>
          )}

          {/* Date */}
          <div className="flex justify-between items-center py-0.5">
            <div className="text-right font-bold text-slate-900 flex items-center gap-1.5 flex-wrap">
              <span className="text-slate-500 font-medium">التاريخ والوقت: </span>
              <span className="font-mono text-slate-800" dir="ltr">
                {invoiceDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}
              </span>
              <span className="text-slate-500 font-mono text-[9px]" dir="ltr">
                {invoiceDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
              </span>
            </div>
            <span className="text-slate-400 font-sans text-[8px]">Issue Date</span>
          </div>

          {/* Invoice Number */}
          <div className="flex justify-between items-center py-0.5">
            <div className="text-right font-bold text-slate-900">
              <span className="text-slate-500 font-medium">رقم الفاتورة: </span>
              <span className="font-mono uppercase">#{invoiceNumber}</span>
            </div>
            <span className="text-slate-400 font-sans text-[8px]">Invoice No.</span>
          </div>

          {/* Branch */}
          <div className="flex justify-between items-center py-0.5">
            <div className="text-right font-bold text-slate-900">
              <span className="text-slate-500 font-medium">الفرع: </span>
              <span>{branchName}</span>
            </div>
            <span className="text-slate-400 font-sans text-[8px]">Branch</span>
          </div>

          {/* Seller */}
          <div className="flex justify-between items-center py-0.5">
            <div className="text-right font-bold text-slate-900">
              <span className="text-slate-500 font-medium">البائع: </span>
              <span>{sellerName}</span>
            </div>
            <span className="text-slate-400 font-sans text-[8px]">Seller</span>
          </div>
        </div>

        {/* Invoice Title & Translation */}
        <div className="text-center my-3 py-1.5 border-y border-dashed border-slate-300">
          <h1 className="text-xs font-black text-slate-800">فاتورة ضريبية مبسطة</h1>
          <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 font-sans mt-0.5">Simplified Tax Invoice</p>
        </div>

        {/* Tax Registration Number */}
        <div className="text-center mb-4 text-[10px] font-bold text-slate-800">
          <span>الرقم الضريبي: </span>
          <span className="font-mono text-xs">{seller.vatNumber}</span>
        </div>

        {/* Items Table */}
        <div className="mb-4 border-b border-dashed border-slate-200 pb-3 space-y-1.5">
          <div className="flex justify-between text-[9px] font-black text-slate-400 uppercase tracking-wide border-b pb-1">
            <span className="flex-1 text-right">المنتج / Item</span>
            <span className="w-16 text-center">السعر / Price</span>
            <span className="w-20 text-left font-bold">الإجمالي / Total</span>
          </div>

          {items.map((item, idx) => {
            const itemTotalInc = item.unitPrice * item.quantity;
            return (
              <div key={idx} className="flex justify-between items-start text-[9.5px] py-0.5 text-slate-700 border-b border-slate-50/50 last:border-0">
                <div className="flex-1 text-right">
                  <span className="font-bold text-slate-900 block leading-snug">{item.name}</span>
                  <span className="text-[8.5px] text-slate-400 block mt-0.5">الكمية / Qty: {item.quantity}</span>
                </div>
                <span className="w-16 text-center font-mono text-slate-500 inline-flex items-center justify-center gap-0.5">
                  {item.unitPrice.toFixed(2)} <CurrencySymbol className="h-[1em] w-auto shrink-0" />
                </span>
                <span className="w-20 text-left font-mono font-bold text-slate-900 inline-flex items-center justify-end gap-0.5">
                  {itemTotalInc.toFixed(2)} <CurrencySymbol className="h-[1em] w-auto shrink-0" />
                </span>
              </div>
            );
          })}
        </div>

        {/* Totals Breakdown */}
        <div className="space-y-1.5 border-b border-dashed border-slate-200 pb-3 mb-4 text-[10px]">
          {/* Subtotal excluding VAT */}
          <div className="flex justify-between text-slate-600">
            <span>الإجمالي غير شامل الضريبة / Subtotal:</span>
            <span className="font-mono font-bold inline-flex items-center gap-1">{computedTotals.subtotal.toFixed(2)} <CurrencySymbol className="h-[1em] w-auto shrink-0" /></span>
          </div>

          {/* Discount */}
          {computedTotals.discount > 0 && (
            <div className="flex justify-between text-red-600 font-bold">
              <span>الخصم / Discount:</span>
              <span className="font-mono inline-flex items-center gap-1">-{computedTotals.discount.toFixed(2)} <CurrencySymbol className="h-[1em] w-auto shrink-0" /></span>
            </div>
          )}

          {/* VAT Amount */}
          <div className="flex justify-between text-slate-600">
            <span>الضريبة (15%) / VAT Amount:</span>
            <span className="font-mono font-bold inline-flex items-center gap-1">{computedTotals.vatAmount.toFixed(2)} <CurrencySymbol className="h-[1em] w-auto shrink-0" /></span>
          </div>

          {/* Grand total including VAT */}
          <div className="flex justify-between text-sm font-black text-slate-900 pt-1.5 border-t border-dotted border-slate-300">
            <span>الإجمالي شامل الضريبة / Grand Total:</span>
            <span className="font-mono inline-flex items-center gap-1">{computedTotals.grandTotal.toFixed(2)} <CurrencySymbol className="h-[1em] w-auto shrink-0" /></span>
          </div>
        </div>

        {/* Payment & Pieces Details */}
        <div className="space-y-1.5 border-b border-dashed border-slate-200 pb-3 mb-4 text-[10px]">
          {/* Paid */}
          <div className="flex justify-between text-slate-600">
            <span>المدفوع / Paid Amount:</span>
            <span className="font-mono font-bold inline-flex items-center gap-1">{paidAmount.toFixed(2)} <CurrencySymbol className="h-[1em] w-auto shrink-0" /></span>
          </div>

          {/* Remaining */}
          <div className="flex justify-between text-slate-600">
            <span>المتبقي / Remaining Amount:</span>
            <span className="font-mono font-bold inline-flex items-center gap-1">{remainingAmount.toFixed(2)} <CurrencySymbol className="h-[1em] w-auto shrink-0" /></span>
          </div>

          {/* Number of Pieces */}
          <div className="flex justify-between text-slate-600">
            <span>عدد القطع / Total Pieces:</span>
            <span className="font-mono font-bold">{totalPieces}</span>
          </div>

          {/* Payment Method */}
          <div className="flex justify-between text-slate-600">
            <span>طريقة الدفع / Payment Method:</span>
            <span className="font-bold">{paymentMethod} / {paymentMethodEn}</span>
          </div>
        </div>

        {/* ZATCA Compliant QR Code (ONLY QR Code, no label text above or below) */}
        <div className="flex flex-col items-center justify-center py-2 mb-3">
          <div className="bg-slate-50 p-2 rounded-2xl border border-slate-200/60 shadow-inner">
            <QRCodeSVG value={finalQr} size={115} level="M" />
          </div>
        </div>

        {/* Retail Slip Bottom note */}
        <div className="pt-3 border-t border-dashed border-slate-300 text-center">
          <p className="font-black text-slate-900 text-[10px] mb-0.5">شكراً لزيارتكم وعودتكم تسعدنا</p>
          <p className="text-[9px] text-slate-400 font-sans uppercase tracking-wider">Thank you for your visit</p>
        </div>

      </div>

      {/* Styled Printable thermal Setup */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page { margin: 0; size: 80mm auto; }
          body {
            background: white !important;
            color: black !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          #print-area, #simplified-invoice-container, #simplified-invoice-container * {
            visibility: visible;
          }
          .print\\:hidden, #app-navigation, header, aside, button {
            display: none !important;
          }
          #simplified-invoice-container {
            border: none !important;
            padding: 0 3mm !important;
            margin: 0 auto !important;
            width: 80mm !important;
            max-width: 100% !important;
            box-sizing: border-box;
          }
        }
      `}} />
    </div>
  );
}
