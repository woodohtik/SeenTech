import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Barcode from 'react-barcode';
import { generateZatcaQR } from '../../services/zatcaService';
import { ShoppingBag, Printer } from 'lucide-react';

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
  seller,
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
      <div id="simplified-invoice-container" className="bg-white p-4 print:p-0 text-slate-800 text-xs" style={{ zoom: `${fontSizeScale}%` }}>
        
        {/* Store Name - Centered */}
        <div className="text-center mb-6">
          {seller.logoUrl ? (
            <img
              src={seller.logoUrl}
              alt="Seller Logo"
              className="w-16 h-16 object-contain rounded-xl border border-slate-100 p-1 mx-auto mb-3"
              referrerPolicy="no-referrer"
              crossOrigin="anonymous"
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mx-auto mb-3">
              <ShoppingBag size={24} />
            </div>
          )}
          
          <h2 className="text-base font-black text-slate-900 leading-tight">{seller.name}</h2>
          {seller.nameEn && <h3 className="text-xs font-semibold text-slate-500 font-sans tracking-wide mt-0.5">{seller.nameEn}</h3>}
        </div>

        {/* Invoice Metadata - RTL Arabic with inline data on right, and English opposite on left */}
        <div className="space-y-2 mb-6 border-t border-dashed border-slate-300 pt-4 text-[11px]">
          {/* Address */}
          <div className="flex justify-between items-center py-0.5">
            <div className="text-right font-bold text-slate-900">
              <span className="text-slate-500 font-medium">العنوان: </span>
              <span>{seller.address}</span>
            </div>
            <span className="text-slate-400 font-sans text-[10px]">Address</span>
          </div>

          {/* Phone */}
          {seller.phone && (
            <div className="flex justify-between items-center py-0.5">
              <div className="text-right font-bold text-slate-900">
                <span className="text-slate-500 font-medium">رقم الهاتف: </span>
                <span className="font-mono" dir="ltr">{seller.phone}</span>
              </div>
              <span className="text-slate-400 font-sans text-[10px]">Phone No.</span>
            </div>
          )}

          {/* Date */}
          <div className="flex justify-between items-center py-0.5">
            <div className="text-right font-bold text-slate-900">
              <span className="text-slate-500 font-medium">التاريخ والوقت: </span>
              <span dir="ltr">{invoiceDate.toLocaleString('ar-SA')}</span>
            </div>
            <span className="text-slate-400 font-sans text-[10px]">Issue Date</span>
          </div>

          {/* Invoice Number */}
          <div className="flex justify-between items-center py-0.5">
            <div className="text-right font-bold text-slate-900">
              <span className="text-slate-500 font-medium">رقم الفاتورة: </span>
              <span className="font-mono uppercase">#{invoiceNumber}</span>
            </div>
            <span className="text-slate-400 font-sans text-[10px]">Invoice No.</span>
          </div>

          {/* Branch */}
          <div className="flex justify-between items-center py-0.5">
            <div className="text-right font-bold text-slate-900">
              <span className="text-slate-500 font-medium">الفرع: </span>
              <span>{branchName}</span>
            </div>
            <span className="text-slate-400 font-sans text-[10px]">Branch</span>
          </div>

          {/* Seller */}
          <div className="flex justify-between items-center py-0.5">
            <div className="text-right font-bold text-slate-900">
              <span className="text-slate-500 font-medium">البائع: </span>
              <span>{sellerName}</span>
            </div>
            <span className="text-slate-400 font-sans text-[10px]">Seller</span>
          </div>
        </div>

        {/* Invoice Title & Translation */}
        <div className="text-center my-4 py-2 border-y border-dashed border-slate-300">
          <h1 className="text-sm font-black text-slate-800">فاتورة ضريبية مبسطة</h1>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-sans mt-0.5">Simplified Tax Invoice</p>
        </div>

        {/* Tax Registration Number */}
        <div className="text-center mb-5 text-[11px] font-bold text-slate-800">
          <span>الرقم الضريبي: </span>
          <span className="font-mono text-xs">{seller.vatNumber}</span>
        </div>

        {/* Items Table with Riyal currency symbol added */}
        <div className="mb-5 border-b border-dashed border-slate-200 pb-4 space-y-2">
          <div className="flex justify-between text-[10px] font-black text-slate-400 uppercase tracking-wide border-b pb-1.5">
            <span className="flex-1 text-right">المنتج / Item</span>
            <span className="w-20 text-center">السعر / Price</span>
            <span className="w-24 text-left font-bold">الإجمالي / Total</span>
          </div>

          {items.map((item, idx) => {
            const itemTotalInc = item.unitPrice * item.quantity;
            return (
              <div key={idx} className="flex justify-between items-start text-xs py-1 text-slate-700 border-b border-slate-50/50 last:border-0">
                <div className="flex-1 text-right">
                  <span className="font-bold text-slate-900 block leading-snug">{item.name}</span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">الكمية / Qty: {item.quantity}</span>
                </div>
                <span className="w-20 text-center font-mono text-slate-500">
                  {item.unitPrice.toFixed(2)} ر.س
                </span>
                <span className="w-24 text-left font-mono font-bold text-slate-900">
                  {itemTotalInc.toFixed(2)} ر.س
                </span>
              </div>
            );
          })}
        </div>

        {/* Totals Breakdown */}
        <div className="space-y-2 border-b border-dashed border-slate-200 pb-4 mb-5 text-[11px]">
          {/* Subtotal excluding VAT */}
          <div className="flex justify-between text-slate-600">
            <span>الإجمالي غير شامل الضريبة / Subtotal (Exc. VAT):</span>
            <span className="font-mono font-bold">{computedTotals.subtotal.toFixed(2)} ر.س</span>
          </div>

          {/* Discount */}
          {computedTotals.discount > 0 && (
            <div className="flex justify-between text-red-600 font-bold">
              <span>الخصم / Discount:</span>
              <span className="font-mono">-{computedTotals.discount.toFixed(2)} ر.s</span>
            </div>
          )}

          {/* VAT Amount */}
          <div className="flex justify-between text-slate-600">
            <span>الضريبة (15%) / VAT Amount:</span>
            <span className="font-mono font-bold">{computedTotals.vatAmount.toFixed(2)} ر.س</span>
          </div>

          {/* Grand total including VAT */}
          <div className="flex justify-between text-base font-black text-slate-900 pt-2 border-t border-dotted border-slate-300">
            <span>الإجمالي شامل الضريبة / Grand Total:</span>
            <span className="font-mono">{computedTotals.grandTotal.toFixed(2)} ر.س</span>
          </div>
        </div>

        {/* Payment & Pieces Details */}
        <div className="space-y-2 border-b border-dashed border-slate-200 pb-4 mb-5 text-[11px]">
          {/* Paid */}
          <div className="flex justify-between text-slate-600">
            <span>المدفوع / Paid Amount:</span>
            <span className="font-mono font-bold">{paidAmount.toFixed(2)} ر.س</span>
          </div>

          {/* Remaining */}
          <div className="flex justify-between text-slate-600">
            <span>المتبقي / Remaining Amount:</span>
            <span className="font-mono font-bold">{remainingAmount.toFixed(2)} ر.س</span>
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

        {/* ZATCA Compliant QR Code */}
        <div className="flex flex-col items-center justify-center py-4 mb-2">
          <p className="text-[10px] text-slate-500 font-bold mb-3">فاتورة إلكترونية متوافقة / Compliant E-Invoice</p>
          <div className="bg-slate-50 p-2.5 rounded-2xl border border-slate-200/60 shadow-inner">
            <QRCodeSVG value={finalQr} size={130} level="M" />
          </div>
        </div>

        {/* Public Digital Invoice QR Code */}
        {orderId && (
          <div className="flex flex-col items-center justify-center py-2 mb-4">
            <p className="text-[9px] text-slate-600 font-bold mb-1">امسح الرمز لعرض الفاتورة الرقمية</p>
            <p className="text-[8px] text-slate-400 mb-2 font-sans">Scan to view digital invoice</p>
            <div className="bg-slate-50 p-2 rounded-xl border border-slate-100">
              <QRCodeSVG value={`${window.location.origin}/p/inv/${orderId}`} size={90} level="M" />
            </div>
          </div>
        )}

        {/* Retail Slip Bottom note */}
        <div className="pt-4 border-t border-dashed border-slate-300 text-center">
          <p className="font-black text-slate-900 text-[11px] mb-0.5">شكراً لزيارتكم وعودتكم تسعدنا</p>
          <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider">Thank you for your visit</p>
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
            padding: 0 !important;
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
