#!/bin/bash
cat << 'INNER_EOF' > src/components/printing/InvoiceReceipt.tsx
import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Printer } from 'lucide-react';
import { generateZatcaQR } from '../../services/zatcaService';

export type PrintSize = '58mm' | '80mm' | 'A5' | 'A4';

export interface InvoiceData {
  invoiceNumber: string;
  issueDate: string;
  seller: {
    name: string;
    vatNumber: string;
    address?: string;
    phone?: string;
  };
  customer: {
    name: string;
    vatNumber?: string;
  };
  items: Array<{
    id?: string | number;
    name: string;
    quantity: number;
    unitPrice: number;
  }>;
  subtotal: number;
  vatAmount: number;
  discountAmount?: number;
  grandTotal: number;
  qrValue: string;
  invoiceType?: string;
}

const MOCK_INVOICE: InvoiceData = {
  invoiceNumber: 'INV-2023-00123',
  issueDate: '2023-10-25T14:30:00',
  seller: {
    name: 'شركة الفرحان للتجارة',
    vatNumber: '310123456700003',
    address: 'الرياض, حي العليا, شارع التحلية',
    phone: '0501234567'
  },
  customer: {
    name: 'عميل نقدي / Guest Customer',
    vatNumber: '300000000000003'
  },
  items: [
    { id: 1, name: 'لابتوب ديل اكس بي اس 15', quantity: 1, unitPrice: 4500 },
    { id: 2, name: 'ماوس لاسلكي لوجيتك', quantity: 2, unitPrice: 150 },
    { id: 3, name: 'لوحة مفاتيح ميكانيكية', quantity: 1, unitPrice: 350 }
  ],
  subtotal: 5000,
  vatAmount: 750,
  grandTotal: 5750,
  qrValue: 'testqr'
};

export const ThermalInvoice = ({ data, size = '80mm' }: { data: InvoiceData, size?: '58mm' | '80mm' }) => {
    const is58 = size === '58mm';
    const containerClass = is58 ? 'w-[58mm]' : 'w-[80mm]';
    const textBase = is58 ? 'text-[9px]' : 'text-[10px]';
    const textSm = is58 ? 'text-[10px]' : 'text-xs';
    const textLg = is58 ? 'text-xs' : 'text-sm';

    return (
      <div className={`${containerClass} bg-white text-black p-2 mx-auto font-sans print:w-full print:max-w-full print:p-0 print:m-0 shrink-0 shadow-sm border border-gray-200 print:shadow-none print:border-none`} dir="rtl">
        {/* Header */}
        <div className="text-center mb-4 border-b border-dashed border-gray-400 pb-2">
          <h2 className={`${textLg} font-black mb-1`}>{data.seller.name}</h2>
          <p className={`${textBase} font-bold mb-1 font-mono`}>{data.seller.vatNumber} :الرقم الضريبي</p>
          {data.seller.address && <p className={`${textBase} text-gray-700`}>{data.seller.address}</p>}
          {data.seller.phone && <p className={`${textBase} text-gray-700 font-mono`}>Tel: {data.seller.phone}</p>}
          <div className="mt-2 font-bold bg-gray-100 py-1 uppercase border border-gray-200 rounded-sm">
            {data.invoiceType === 'standard_b2b' ? 'فاتورة ضريبية' : 'فاتورة ضريبية مبسطة'}
          </div>
        </div>

        {/* Info */}
        <div className={`mb-3 ${textBase} border-b border-dashed border-gray-400 pb-2 space-y-1`}>
          <div className="flex justify-between">
            <span>رقم الفاتورة:</span>
            <span className="font-mono font-bold">{data.invoiceNumber}</span>
          </div>
          <div className="flex justify-between">
            <span>التاريخ:</span>
            <span className="font-mono">{new Date(data.issueDate).toLocaleString('ar-SA')}</span>
          </div>
          <div className="flex justify-between">
            <span>العميل:</span>
            <span className="font-bold">{data.customer.name}</span>
          </div>
          {data.customer.vatNumber && (
            <div className="flex justify-between">
              <span>الرقم الضريبي للعميل:</span>
              <span className="font-mono font-bold">{data.customer.vatNumber}</span>
            </div>
          )}
        </div>

        {/* Items Table */}
        <div className={`mb-3 ${textBase}`}>
          <div className="flex border-b border-gray-900 pb-1 mb-1 font-bold">
            <div className="flex-1">الصنف</div>
            <div className="w-8 text-center">الكمية</div>
            <div className="w-12 text-center">السعر</div>
            <div className="w-14 text-left">المجموع</div>
          </div>
          
          <div className="space-y-2 mb-2 border-b border-dashed border-gray-400 pb-2">
            {data.items.map((item, index) => {
              const itemTotal = item.quantity * item.unitPrice;
              return (
                <div key={index} className="flex flex-col">
                   <div className="font-bold text-gray-900">{item.name}</div>
                   <div className="flex mt-1 text-gray-700">
                     <div className="flex-1"></div>
                     <div className="w-8 text-center font-mono">{item.quantity}</div>
                     <div className="w-12 text-center font-mono">{item.unitPrice.toFixed(2)}</div>
                     <div className="w-14 text-left font-mono font-bold">{itemTotal.toFixed(2)}</div>
                   </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Totals */}
        <div className={`${textSm} space-y-1 mb-4 border-b border-dashed border-gray-400 pb-3`}>
           <div className="flex justify-between">
             <span>الإجمالي غير شامل الضريبة:</span>
             <span className="font-mono">{data.subtotal.toFixed(2)}</span>
           </div>
           {data.discountAmount ? (
             <div className="flex justify-between text-gray-700">
               <span>الخصم:</span>
               <span className="font-mono">-{data.discountAmount.toFixed(2)}</span>
             </div>
           ) : null}
           <div className="flex justify-between">
             <span>ضريبة القيمة المضافة (15%):</span>
             <span className="font-mono">{data.vatAmount.toFixed(2)}</span>
           </div>
           <div className="flex justify-between font-black text-sm mt-1 pt-1 border-t border-gray-400">
             <span>الإجمالي المستحق:</span>
             <span className="font-mono">{data.grandTotal.toFixed(2)}</span>
           </div>
        </div>

        {/* QR Code */}
        {data.qrValue && (
          <div className="flex flex-col items-center justify-center mb-4">
             <QRCodeSVG value={data.qrValue} size={is58 ? 100 : 120} />
             <p className="text-center mt-2 text-[8px] text-gray-500 font-bold uppercase">ZATCA Approved</p>
          </div>
        )}

        <div className="text-center text-[9px] font-bold text-gray-600 mt-4 mb-2 pb-2">
          شكراً لتسوقكم معنا
        </div>
      </div>
    );
};

export const StandardInvoice = ({ data, size = 'A4' }: { data: InvoiceData, size?: 'A4' | 'A5' }) => {
    const isA5 = size === 'A5';
    const containerClass = isA5 ? 'w-[148mm] min-h-[210mm]' : 'w-[210mm] min-h-[297mm]';
    const textBase = isA5 ? 'text-xs' : 'text-sm';
    const textSm = isA5 ? 'text-[10px]' : 'text-xs';
    
    return (
      <div className={`${containerClass} bg-white text-black p-8 mx-auto font-sans print:w-full print:max-w-full print:m-0 print:border-none shrink-0 shadow-sm border border-gray-200`} dir="rtl">
        {/* Header */}
        <div className="flex justify-between items-start border-b-2 border-gray-900 pb-6 mb-6">
          <div className="flex-1">
            <h1 className="text-2xl font-black mb-2">{data.seller.name}</h1>
            <p className={`${textBase} text-gray-600`}>{data.seller.address}</p>
            <p className={`${textBase} font-bold mt-2 font-mono`}>الرقم الضريبي: {data.seller.vatNumber}</p>
            {data.seller.phone && <p className={`${textBase} font-mono mt-1`}>Tel: {data.seller.phone}</p>}
          </div>
          <div className="flex-1 text-left">
            <div className="inline-block bg-gray-100 p-3 rounded-lg border border-gray-200">
              <h2 className="text-lg font-black text-gray-900 text-center mb-1">
                {data.invoiceType === 'standard_b2b' ? 'فاتورة ضريبية' : 'فاتورة ضريبية مبسطة'}
              </h2>
              <h3 className="text-sm font-bold text-gray-600 text-center uppercase">
                {data.invoiceType === 'standard_b2b' ? 'Tax Invoice' : 'Simplified Tax Invoice'}
              </h3>
            </div>
          </div>
        </div>

        {/* Invoice Info & Customer Info */}
        <div className="grid grid-cols-2 gap-6 mb-6">
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
            <h3 className={`${textBase} font-black text-gray-800 border-b border-gray-200 pb-2 mb-3`}>تفاصيل الفاتورة / Invoice Details</h3>
            <div className="space-y-2">
              <p className={textSm}>
                <span className="font-bold text-gray-500 ml-2">رقم الفاتورة:</span>
                <span className="font-mono font-bold text-gray-900">{data.invoiceNumber}</span>
              </p>
              <p className={textSm}>
                <span className="font-bold text-gray-500 ml-2">التاريخ:</span>
                <span className="font-mono font-bold">{new Date(data.issueDate).toLocaleString('ar-SA')}</span>
              </p>
            </div>
          </div>
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
            <h3 className={`${textBase} font-black text-gray-800 border-b border-gray-200 pb-2 mb-3`}>بيانات العميل / Customer Details</h3>
            <div className="space-y-2">
              <p className={textSm}>
                <span className="font-bold text-gray-500 ml-2">الاسم:</span> 
                <span className="font-bold text-gray-900">{data.customer.name}</span>
              </p>
              {data.customer.vatNumber && (
                <p className={textSm}>
                  <span className="font-bold text-gray-500 ml-2">الرقم الضريبي:</span> 
                  <span className="font-mono font-bold text-gray-900">{data.customer.vatNumber}</span>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-lg border border-gray-300 mb-6">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-100 border-b-2 border-gray-300">
                <th className={`p-3 text-center font-black text-gray-700 ${textSm} border-l border-gray-200 w-12`}>#</th>
                <th className={`p-3 text-right font-black text-gray-700 ${textSm} border-l border-gray-200`}>الصنف / Item</th>
                <th className={`p-3 text-center font-black text-gray-700 ${textSm} border-l border-gray-200`}>سعر الوحدة</th>
                <th className={`p-3 text-center font-black text-gray-700 ${textSm} border-l border-gray-200`}>الكمية</th>
                <th className={`p-3 text-center font-black text-gray-700 ${textSm} border-l border-gray-200`}>الإجمالي</th>
                <th className={`p-3 text-center font-black text-gray-700 ${textSm} border-l border-gray-200`}>الضريبة (15%)</th>
                <th className={`p-3 text-left font-black text-gray-900 ${textSm}`}>المجموع</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item, index) => {
                const itemTotal = item.quantity * item.unitPrice;
                const itemVat = itemTotal * 0.15;
                const itemTotalWithVat = itemTotal + itemVat;
                return (
                  <tr key={item.id || index} className="border-b border-gray-200 last:border-b-0">
                    <td className={`p-3 text-center font-mono text-gray-500 ${textSm} border-l border-gray-200`}>{index + 1}</td>
                    <td className={`p-3 font-bold text-gray-900 ${textSm} border-l border-gray-200`}>{item.name}</td>
                    <td className={`p-3 text-center font-mono text-gray-700 ${textSm} border-l border-gray-200`}>{item.unitPrice.toFixed(2)}</td>
                    <td className={`p-3 text-center font-mono font-bold text-gray-900 ${textSm} border-l border-gray-200`}>{item.quantity}</td>
                    <td className={`p-3 text-center font-mono text-gray-700 ${textSm} border-l border-gray-200`}>{itemTotal.toFixed(2)}</td>
                    <td className={`p-3 text-center font-mono text-gray-700 ${textSm} border-l border-gray-200`}>{itemVat.toFixed(2)}</td>
                    <td className={`p-3 text-left font-mono font-black text-gray-900 ${textSm}`}>{itemTotalWithVat.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Totals & QR */}
        <div className="flex justify-between items-start print:break-inside-avoid mt-8 gap-8">
          <div className="bg-gray-50 p-4 border border-gray-200 rounded-xl flex flex-col items-center justify-center shrink-0">
            {data.qrValue && <QRCodeSVG value={data.qrValue} size={isA5 ? 100 : 130} />}
            <p className="text-center mt-3 text-xs text-gray-500 font-bold tracking-widest uppercase">ZATCA Approved</p>
          </div>
          <div className="flex-1">
            <div className="space-y-3 border-2 border-gray-100 rounded-xl p-5 bg-gray-50">
              <div className={`flex justify-between ${textSm} text-gray-600`}>
                <span className="font-bold">الإجمالي غير شامل الضريبة:</span>
                <span className="font-mono font-bold text-gray-900">{data.subtotal.toFixed(2)} ر.س</span>
              </div>
              {data.discountAmount ? (
                 <div className={`flex justify-between ${textSm} text-gray-600`}>
                   <span className="font-bold">الخصم:</span>
                   <span className="font-mono font-bold text-gray-900">-{data.discountAmount.toFixed(2)} ر.س</span>
                 </div>
              ) : null}
              <div className={`flex justify-between ${textSm} text-gray-600`}>
                <span className="font-bold">مجموع ضريبة القيمة المضافة (15%):</span>
                <span className="font-mono font-bold text-gray-900">{data.vatAmount.toFixed(2)} ر.س</span>
              </div>
              <div className={`flex justify-between ${textBase} font-black text-gray-900 border-t-2 border-gray-300 pt-3 mt-1`}>
                <span>الإجمالي المستحق:</span>
                <span className="font-mono text-xl">{data.grandTotal.toFixed(2)} ر.س</span>
              </div>
            </div>
          </div>
        </div>
        
        {/* Footer Note */}
        <div className="mt-12 pt-4 border-t border-gray-200 text-center print:break-inside-avoid">
            <p className={`${textSm} font-bold text-gray-500`}>هذه الفاتورة مصدّرة إلكترونياً ومتوافقة مع متطلبات هيئة الزكاة والضريبة والجمارك</p>
        </div>
      </div>
    );
};

export default function InvoiceReceipt({ 
  invoiceData, 
  defaultSize = '80mm' 
}: { 
  invoiceData?: InvoiceData, 
  defaultSize?: PrintSize 
}) {
  const [printSize, setPrintSize] = useState<PrintSize>(defaultSize);

  // Use provided data or fallback to mock data
  const data = invoiceData || MOCK_INVOICE;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="flex flex-col items-center bg-gray-100 min-h-screen py-8 print:py-0 print:bg-white overflow-x-auto w-full" dir="rtl">
      
      {/* Print Controls (Hidden on Print) */}
      <div className="mb-8 bg-white p-4 rounded-2xl shadow-md border border-gray-200 flex flex-col sm:flex-row items-center gap-4 print:hidden sticky top-4 z-50">
        <div className="flex items-center gap-3">
          <span className="text-sm font-black text-gray-800">مقاس الطباعة:</span>
          <div className="flex bg-gray-50 rounded-xl p-1 border border-gray-200 shadow-inner">
            {(['58mm', '80mm', 'A5', 'A4'] as PrintSize[]).map((size) => (
              <button
                key={size}
                onClick={() => setPrintSize(size)}
                className={`px-5 py-2 rounded-lg text-sm font-bold transition-all cursor-pointer ${
                  printSize === size 
                    ? 'bg-blue-600 text-white shadow-md transform scale-100' 
                    : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900'
                }`}
              >
                {size}
              </button>
            ))}
          </div>
        </div>
        <div className="w-px h-8 bg-gray-200 hidden sm:block mx-2"></div>
        <button
          onClick={handlePrint}
          className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white px-8 py-2.5 rounded-xl font-bold transition-all shadow-md active:scale-95 cursor-pointer"
        >
          <Printer size={18} />
          <span>طباعة الفاتورة</span>
        </button>
      </div>

      {/* Invoice Container with CSS Print rules for pagination and margins */}
      <style dangerouslySetInnerHTML={{__html: `
        @media print {
          @page {
            size: ${printSize === '58mm' ? '58mm auto' : printSize === '80mm' ? '80mm auto' : printSize};
            margin: ${['58mm', '80mm'].includes(printSize) ? '0' : '10mm'};
          }
          body {
            background-color: white !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            margin: 0 !important;
            padding: 0 !important;
          }
        }
      `}} />

      <div className="w-full flex justify-center pb-12 print:pb-0">
        {['58mm', '80mm'].includes(printSize) 
          ? <ThermalInvoice data={data} size={printSize as '58mm' | '80mm'} />
          : <StandardInvoice data={data} size={printSize as 'A4' | 'A5'} />
        }
      </div>
      
    </div>
  );
}
INNER_EOF
chmod +x update-invoice-receipt.sh
./update-invoice-receipt.sh
