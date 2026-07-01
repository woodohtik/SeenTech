import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
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
  };
  qrCodeBase64?: string;
  orderId?: string;
  onPrint?: () => void;
  hidePrintButton?: boolean;
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
}: SimplifiedTaxInvoiceProps) {
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

  return (
    <div className="w-full max-w-md mx-auto my-6 bg-white p-6 border border-slate-200 rounded-3xl shadow-lg relative font-sans text-right print:shadow-none print:border-none print:m-0 print:p-0" dir="rtl">
      
      {/* Print Trigger Button (Hidden in Print Mode) */}
      {!hidePrintButton && (
        <div className="flex justify-center mb-6 print:hidden">
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs shadow-sm transition-all cursor-pointer"
          >
            <Printer size={14} />
            <span>طباعة الإيصال / Print Receipt</span>
          </button>
        </div>
      )}

      {/* Invoice Frame - 80mm Thermal Style */}
      <div id="simplified-invoice-container" className="bg-white p-4 print:p-0 text-slate-800 text-xs">
        
        {/* Header Block */}
        <div className="text-center mb-6 border-b border-dashed border-slate-300 pb-5">
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
          
          <div className="text-[11px] text-slate-500 mt-2 space-y-0.5">
            <p>{seller.address} {seller.addressEn ? `/ ${seller.addressEn}` : ''}</p>
            {seller.phone && <p dir="ltr">Tel: {seller.phone}</p>}
            <p className="mt-1 font-bold">الرقم الضريبي / VAT: <span className="font-mono">{seller.vatNumber}</span></p>
          </div>

          <div className="mt-4 inline-block bg-slate-100 px-4 py-1.5 rounded-lg border border-slate-200">
            <h1 className="text-xs font-black text-slate-800">فاتورة ضريبية مبسطة</h1>
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 font-sans">Simplified Tax Invoice</p>
          </div>
        </div>

        {/* Invoice Metadata */}
        <div className="space-y-1.5 mb-5 border-b border-dashed border-slate-200 pb-4 text-[11px]">
          <div className="flex justify-between">
            <span className="text-slate-500">رقم الفاتورة / Invoice No:</span>
            <span className="font-mono font-bold text-slate-900 uppercase">#{invoiceNumber}</span>
          </div>

          <div className="flex justify-between">
            <span className="text-slate-500">تاريخ الإصدار / Issue Date:</span>
            <span className="font-bold text-slate-800" dir="ltr">{invoiceDate.toLocaleString('ar-SA')}</span>
          </div>

          <div className="flex justify-between">
            <span className="text-slate-500">طريقة الدفع / Payment:</span>
            <span className="font-bold text-slate-800">{paymentMethod} / {paymentMethodEn}</span>
          </div>

          <div className="flex justify-between">
            <span className="text-slate-500">العميل / Customer:</span>
            <span className="font-bold text-slate-800">{customerName}</span>
          </div>
        </div>

        {/* Simplified Items Receipt Line */}
        <div className="mb-5 border-b border-dashed border-slate-200 pb-4 space-y-1.5">
          <div className="flex justify-between text-[10px] font-black text-slate-400 uppercase tracking-wide border-b pb-1.5">
            <span className="flex-1 text-right">الصنف والوصف / Item</span>
            <span className="w-20 text-center">الكمية / Qty</span>
            <span className="w-24 text-left">المجموع / Total</span>
          </div>

          {items.map((item, idx) => {
            const itemTotalInc = item.unitPrice * item.quantity;
            return (
              <div key={idx} className="flex justify-between items-start text-xs py-0.5 text-slate-700">
                <span className="flex-1 text-right font-bold text-slate-900">{item.name}</span>
                <span className="w-20 text-center font-mono text-slate-500">
                  {item.quantity} × {item.unitPrice.toFixed(2)}
                </span>
                <span className="w-24 text-left font-mono font-bold text-slate-900">
                  {itemTotalInc.toFixed(2)} ر.س
                </span>
              </div>
            );
          })}
        </div>

        {/* Mini Totals Breakdown Structure */}
        <div className="space-y-2 border-b border-dashed border-slate-200 pb-4 mb-5 text-[11px]">
          <div className="flex justify-between text-slate-500">
            <span>المجموع غير شامل الضريبة / Subtotal (Exc. VAT):</span>
            <span className="font-mono font-bold">{computedTotals.subtotal.toFixed(2)} ر.س</span>
          </div>

          {computedTotals.discount > 0 && (
            <div className="flex justify-between text-red-600">
              <span>الخصم الممنوح / Discount:</span>
              <span className="font-mono font-bold">-{computedTotals.discount.toFixed(2)} ر.س</span>
            </div>
          )}

          <div className="flex justify-between text-slate-500">
            <span>الوعاء الضريبي / Taxable Amt:</span>
            <span className="font-mono font-bold">{computedTotals.taxableAmount.toFixed(2)} ر.س</span>
          </div>

          <div className="flex justify-between text-slate-500">
            <span>ضريبة القيمة المضافة (15%) / VAT Amount:</span>
            <span className="font-mono font-bold">{computedTotals.vatAmount.toFixed(2)} ر.س</span>
          </div>

          <div className="flex justify-between text-base font-black text-slate-900 pt-1.5 border-t border-dotted border-slate-200">
            <span>الإجمالي المستحق / Grand Total:</span>
            <span className="font-mono">{computedTotals.grandTotal.toFixed(2)} ر.س</span>
          </div>
        </div>

        {/* Compliant ZATCA QR Code */}
        <div className="flex flex-col items-center justify-center py-2 mb-4">
          <p className="text-[9px] text-slate-400 font-bold mb-2">فاتورة إلكترونية متوافقة / Compliant E-Invoice</p>
          <div className="bg-slate-50 p-2 rounded-xl border border-slate-100">
            <QRCodeSVG value={finalQr} size={110} level="M" />
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
          body {
            background: white !important;
            color: black !important;
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
            margin: 0 !important;
            width: 80mm !important;
            max-width: 100% !important;
          }
        }
      `}} />
    </div>
  );
}
