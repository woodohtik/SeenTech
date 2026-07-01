import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { generateZatcaQR } from '../../services/zatcaService';
import { FileText, Printer, Mail, Phone, MapPin, Layers, Globe } from 'lucide-react';

export interface InvoiceItem {
  id?: string;
  name: string;
  quantity: number;
  unitPrice: number; // VAT-inclusive unit price
  vatAmount?: number;
  total?: number;
}

export interface SellerInfo {
  name: string;
  nameEn?: string;
  logoUrl?: string;
  vatNumber: string;
  address: string;
  addressEn?: string;
  crNumber?: string;
  phone?: string;
  email?: string;
}

export interface BuyerInfo {
  name: string;
  nameEn?: string;
  vatNumber?: string;
  address?: string;
  addressEn?: string;
  phone?: string;
  email?: string;
  crNumber?: string;
}

export interface TaxInvoiceProps {
  invoiceNumber: string;
  issueDate: string;
  supplyDate: string;
  paymentMethod: string;
  paymentMethodEn?: string;
  seller: SellerInfo;
  buyer: BuyerInfo;
  items: InvoiceItem[];
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

export default function TaxInvoice({
  invoiceNumber,
  issueDate,
  supplyDate,
  paymentMethod,
  paymentMethodEn = 'Cash',
  seller,
  buyer,
  items,
  totals,
  qrCodeBase64,
  orderId,
  onPrint,
  hidePrintButton = false,
}: TaxInvoiceProps) {
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
    <div className="w-full max-w-4xl mx-auto my-6 bg-white p-8 border border-slate-200 rounded-3xl shadow-lg relative font-sans text-right print:shadow-none print:border-none print:m-0 print:p-0" dir="rtl">
      
      {/* Print Trigger Button (Hidden in Print Mode) */}
      {!hidePrintButton && (
        <div className="flex justify-start mb-6 print:hidden">
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-5 py-2.5 bg-brand text-white rounded-xl font-bold text-sm shadow-sm hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
          >
            <Printer size={16} />
            <span>طباعة الفاتورة / Print Invoice</span>
          </button>
        </div>
      )}

      {/* Invoice Frame */}
      <div id="standard-tax-invoice-container" className="bg-white border border-slate-200 rounded-2xl p-8 print:border-none print:p-0">
        
        {/* Bilingual Title Ribbon */}
        <div className="border-b-2 border-slate-800 pb-6 mb-8 flex flex-col md:flex-row justify-between items-center gap-6">
          {/* Logo & Seller Title */}
          <div className="flex items-center gap-4 text-right">
            {seller.logoUrl ? (
              <img
                src={seller.logoUrl}
                alt="Seller Logo"
                className="w-20 h-20 object-contain rounded-xl border border-slate-100 p-1"
                referrerPolicy="no-referrer"
                crossOrigin="anonymous"
              />
            ) : (
              <div className="w-20 h-20 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400">
                <FileText size={32} />
              </div>
            )}
            <div>
              <h2 className="text-xl font-black text-slate-900">{seller.name}</h2>
              {seller.nameEn && <h3 className="text-sm font-semibold text-slate-500 font-sans tracking-wide">{seller.nameEn}</h3>}
              <div className="text-xs text-slate-500 mt-1 flex flex-col gap-0.5">
                <p>الرقم الضريبي للبائع: <span className="font-mono font-bold text-slate-700">{seller.vatNumber}</span></p>
                <p className="text-[10px] text-slate-400">Seller VAT Registration Number</p>
                {seller.crNumber && (
                  <p>رقم السجل التجاري: <span className="font-mono text-slate-600">{seller.crNumber}</span></p>
                )}
              </div>
            </div>
          </div>

          {/* Compliant ZATCA Main Badge */}
          <div className="text-center md:text-left flex flex-col items-center md:items-end">
            <div className="bg-slate-900 text-white px-6 py-3 rounded-2xl shadow-sm text-center">
              <h1 className="text-lg font-black tracking-wide leading-tight">فاتورة ضريبية</h1>
              <p className="text-[10px] font-bold tracking-[0.16em] uppercase text-slate-300">Tax Invoice</p>
            </div>
            <div className="mt-3 flex gap-2 text-xs text-slate-500 justify-end flex-wrap max-w-xs">
              {seller.address && (
                <span className="flex items-center gap-1"><MapPin size={12} /> {seller.address}</span>
              )}
              {seller.phone && (
                <span className="flex items-center gap-1"><Phone size={12} /> {seller.phone}</span>
              )}
            </div>
          </div>
        </div>

        {/* Invoice Primary Metadata Block */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8 bg-slate-50/70 border border-slate-200/60 rounded-2xl p-6">
          <div className="space-y-3.5">
            <div className="flex justify-between border-b border-dashed border-slate-200 pb-2">
              <div className="text-right">
                <span className="text-xs font-black text-slate-800">رقم الفاتورة</span>
                <span className="block text-[9px] text-slate-400 uppercase font-sans font-bold">Invoice Number</span>
              </div>
              <span className="font-mono font-black text-slate-900 text-lg uppercase">#{invoiceNumber}</span>
            </div>

            <div className="flex justify-between border-b border-dashed border-slate-200 pb-2">
              <div className="text-right">
                <span className="text-xs font-black text-slate-800">تاريخ الإصدار</span>
                <span className="block text-[9px] text-slate-400 uppercase font-sans font-bold">Date of Issue</span>
              </div>
              <span className="font-bold text-slate-800 text-sm" dir="ltr">{invoiceDate.toLocaleString('ar-SA')}</span>
            </div>

            <div className="flex justify-between pb-1">
              <div className="text-right">
                <span className="text-xs font-black text-slate-800">تاريخ التوريد</span>
                <span className="block text-[9px] text-slate-400 uppercase font-sans font-bold">Date of Supply</span>
              </div>
              <span className="font-bold text-slate-800 text-sm" dir="ltr">{new Date(supplyDate || issueDate).toLocaleDateString('ar-SA')}</span>
            </div>
          </div>

          <div className="space-y-3.5">
            <div className="flex justify-between border-b border-dashed border-slate-200 pb-2">
              <div className="text-right">
                <span className="text-xs font-black text-slate-800">طريقة الدفع</span>
                <span className="block text-[9px] text-slate-400 uppercase font-sans font-bold">Payment Method</span>
              </div>
              <span className="font-extrabold text-slate-800 text-sm">{paymentMethod} / {paymentMethodEn}</span>
            </div>

            <div className="flex justify-between pb-1">
              <div className="text-right">
                <span className="text-xs font-black text-slate-800">حالة الفاتورة</span>
                <span className="block text-[9px] text-slate-400 uppercase font-sans font-bold">Invoice Status</span>
              </div>
              <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-lg">خاضعة للضريبة / Taxable</span>
            </div>
          </div>
        </div>

        {/* Client details section (Critical for standard B2B) */}
        <div className="mb-8 border border-slate-200 rounded-2xl overflow-hidden">
          <div className="bg-slate-900 px-5 py-3 text-white flex justify-between items-center">
            <span className="text-sm font-black">بيانات العميل (المشتري)</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Buyer (Customer) Details</span>
          </div>
          <div className="p-6 bg-white grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
            <div className="space-y-3">
              <div className="flex justify-between border-b border-slate-100 pb-1.5">
                <span className="text-slate-500 font-medium">اسم العميل / Customer Name:</span>
                <span className="font-black text-slate-800">{buyer.name} {buyer.nameEn ? `/ ${buyer.nameEn}` : ''}</span>
              </div>
              {buyer.vatNumber ? (
                <div className="flex justify-between border-b border-slate-100 pb-1.5">
                  <span className="text-slate-500 font-medium">الرقم الضريبي / Tax ID (VAT):</span>
                  <span className="font-mono font-bold text-slate-800">{buyer.vatNumber}</span>
                </div>
              ) : (
                <div className="flex justify-between border-b border-slate-100 pb-1.5">
                  <span className="text-slate-500 font-medium font-sans">الرقم الضريبي للعميل / Customer VAT:</span>
                  <span className="text-slate-400 font-medium font-sans italic">غير متوفر / Not Provided</span>
                </div>
              )}
            </div>

            <div className="space-y-3">
              {buyer.address && (
                <div className="flex justify-between border-b border-slate-100 pb-1.5">
                  <span className="text-slate-500 font-medium">العنوان / Address:</span>
                  <span className="font-bold text-slate-700">{buyer.address} {buyer.addressEn ? `/ ${buyer.addressEn}` : ''}</span>
                </div>
              )}
              {buyer.phone && (
                <div className="flex justify-between border-b border-slate-100 pb-1.5">
                  <span className="text-slate-500 font-medium font-sans">الهاتف / Phone:</span>
                  <span className="font-mono font-bold text-slate-700" dir="ltr">{buyer.phone}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Detailed Items Table */}
        <div className="mb-8 border border-slate-200 rounded-2xl overflow-hidden">
          <table className="w-full text-right border-collapse text-sm">
            <thead>
              <tr className="bg-slate-900 text-white text-xs font-black">
                <th className="p-4 leading-tight text-right w-12">#</th>
                <th className="p-4 leading-tight text-right">الصنف والوصف<br/><span className="text-[9px] text-slate-300 uppercase font-sans font-normal">Line Item Description</span></th>
                <th className="p-4 leading-tight text-center w-16">الكمية<br/><span className="text-[9px] text-slate-300 uppercase font-sans font-normal">Qty</span></th>
                <th className="p-4 leading-tight text-right w-28">سعر الوحدة خاضع<br/><span className="text-[9px] text-slate-300 uppercase font-sans font-normal">Unit Price (Exc)</span></th>
                <th className="p-4 leading-tight text-right w-24">المبلغ الخاضع للضريبة<br/><span className="text-[9px] text-slate-300 uppercase font-sans font-normal">Taxable Amt</span></th>
                <th className="p-4 leading-tight text-center w-20">معدل الضريبة<br/><span className="text-[9px] text-slate-300 uppercase font-sans font-normal">VAT Rate</span></th>
                <th className="p-4 leading-tight text-right w-24">مبلغ الضريبة<br/><span className="text-[9px] text-slate-300 uppercase font-sans font-normal">VAT Amount</span></th>
                <th className="p-4 leading-tight text-right w-28 bg-slate-800">المجموع (شامل الضريبة)<br/><span className="text-[9px] text-slate-200 uppercase font-sans font-normal">Subtotal (Inc VAT)</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {items.map((item, index) => {
                const itemTotalInc = item.unitPrice * item.quantity;
                const itemTotalExc = itemTotalInc / 1.15;
                const itemUnitExc = item.unitPrice / 1.15;
                const itemVat = itemTotalInc - itemTotalExc;

                return (
                  <tr key={index} className="hover:bg-slate-50 transition-colors text-slate-700">
                    <td className="p-4 font-mono text-xs text-slate-400 text-center">{index + 1}</td>
                    <td className="p-4">
                      <p className="font-extrabold text-slate-900">{item.name}</p>
                    </td>
                    <td className="p-4 text-center font-bold font-mono text-slate-800">{item.quantity}</td>
                    <td className="p-4 font-mono text-slate-600">{itemUnitExc.toFixed(2)}</td>
                    <td className="p-4 font-mono text-slate-600">{itemTotalExc.toFixed(2)}</td>
                    <td className="p-4 text-center font-bold text-slate-500 font-mono text-xs">15%</td>
                    <td className="p-4 font-mono text-slate-600">{itemVat.toFixed(2)}</td>
                    <td className="p-4 font-mono font-black text-slate-900 bg-slate-50/50">{itemTotalInc.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Totals Breakdown Block + ZATCA QR Code */}
        <div className="flex flex-col md:flex-row justify-between items-start gap-8 mb-8">
          
          <div className="flex gap-4 w-full md:w-auto">
            {/* Compliant ZATCA QR Block (TLV Based) */}
            <div className="flex flex-col items-center p-4 bg-slate-50 border border-slate-200 rounded-2xl shadow-sm text-center">
              <h4 className="text-[10px] font-black text-slate-800 mb-1">هيئة الزكاة والضريبة والجمارك</h4>
              <p className="text-[8px] text-slate-400 font-sans font-bold uppercase mb-3">ZATCA Compliant</p>
              <div className="bg-white p-3 rounded-xl border border-slate-200">
                <QRCodeSVG value={finalQr} size={110} level="M" />
              </div>
            </div>

            {/* Public Digital Invoice QR Code */}
            {orderId && (
              <div className="flex flex-col items-center p-4 bg-slate-50 border border-slate-200 rounded-2xl shadow-sm text-center">
                <h4 className="text-[10px] font-black text-slate-800 mb-1">الوصول الرقمي للفاتورة</h4>
                <p className="text-[8px] text-slate-400 font-sans font-bold uppercase mb-3">Scan to view digital invoice</p>
                <div className="bg-white p-3 rounded-xl border border-slate-200">
                  <QRCodeSVG value={`${window.location.origin}/p/inv/${orderId}`} size={110} level="M" />
                </div>
              </div>
            )}
          </div>

          {/* Bilingual Totals Grid */}
          <div className="w-full md:w-96 border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-sm flex flex-col">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center text-xs font-bold text-slate-500 bg-slate-50/20">
              <div className="text-right leading-tight">
                <span className="font-black text-slate-700">الإجمالي غير شامل ضريبة القيمة المضافة</span>
                <span className="block text-[9px] text-slate-400 uppercase font-sans">Total (Excluding VAT)</span>
              </div>
              <span className="font-mono font-extrabold text-slate-800 text-sm">
                {computedTotals.subtotal.toFixed(2)} ر.س
              </span>
            </div>

            {computedTotals.discount > 0 && (
              <div className="p-4 border-b border-slate-100 flex justify-between items-center text-xs font-bold text-slate-500 bg-red-50/10">
                <div className="text-right leading-tight">
                  <span className="font-black text-red-700">الخصم المستقطع</span>
                  <span className="block text-[9px] text-slate-400 uppercase font-sans">Discount</span>
                </div>
                <span className="font-mono font-extrabold text-red-600 text-sm">
                  -{computedTotals.discount.toFixed(2)} ر.س
                </span>
              </div>
            )}

            <div className="p-4 border-b border-slate-100 flex justify-between items-center text-xs font-bold text-slate-500 bg-slate-50/20">
              <div className="text-right leading-tight">
                <span className="font-black text-slate-700">المبلغ الخاضع للضريبة</span>
                <span className="block text-[9px] text-slate-400 uppercase font-sans">Total Taxable Amount</span>
              </div>
              <span className="font-mono font-extrabold text-slate-800 text-sm">
                {computedTotals.taxableAmount.toFixed(2)} ر.س
              </span>
            </div>

            <div className="p-4 border-b border-slate-100 flex justify-between items-center text-xs font-bold text-slate-500 bg-slate-50/20">
              <div className="text-right leading-tight">
                <span className="font-black text-slate-700">إجمالي ضريبة القيمة المضافة (15%)</span>
                <span className="block text-[9px] text-slate-400 uppercase font-sans">Total VAT (15%)</span>
              </div>
              <span className="font-mono font-extrabold text-slate-800 text-sm">
                {computedTotals.vatAmount.toFixed(2)} ر.س
              </span>
            </div>

            <div className="p-5 bg-slate-900 flex justify-between items-center">
              <div className="text-right text-white leading-tight">
                <span className="font-black text-lg">المجموع المستحق (شامل الضريبة)</span>
                <span className="block text-[10px] text-slate-300 uppercase font-sans font-bold tracking-widest mt-0.5">Grand Total (Inc VAT)</span>
              </div>
              <span className="font-mono text-xl font-black text-white">
                {computedTotals.grandTotal.toFixed(2)} ر.س
              </span>
            </div>
          </div>

        </div>

        {/* Official Compliance Footer */}
        <div className="pt-6 border-t-2 border-slate-900 border-dashed text-center flex flex-col items-center">
          <p className="text-sm font-black text-slate-900 mb-1">شكراً لتعاملكم معنا ونسعد بزيارتكم مجدداً</p>
          <p className="text-xs font-bold text-slate-500 font-sans tracking-wide">Thank you for your business. We look forward to seeing you again.</p>
        </div>

      </div>

      {/* Styled Printable Setup */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          body {
            background: white !important;
            color: black !important;
          }
          #print-area, #standard-tax-invoice-container, #standard-tax-invoice-container * {
            visibility: visible;
          }
          .print\\:hidden, #app-navigation, header, aside, button {
            display: none !important;
          }
          #standard-tax-invoice-container {
            border: none !important;
            padding: 0 !important;
            margin: 0 !important;
            width: 100% !important;
          }
        }
      `}} />
    </div>
  );
}
