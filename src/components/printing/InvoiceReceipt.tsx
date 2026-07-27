import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Printer } from 'lucide-react';
import Barcode from 'react-barcode';
import { CurrencySymbol } from '../CurrencySymbol';

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
  paidAmount?: number;
  remainingAmount?: number;
  branchName?: string;
  sellerName?: string;
}

export interface InvoiceLayoutSettingsType {
  printSize: string;
  layoutTemplate: string;
  fastThermalMode?: boolean;
  header: {
    logoUrl: string;
    facilityName: string;
    contactNumbers: string;
    address: string;
    taxId: string;
    alignment: 'right' | 'left' | 'center';
  };
  columns: {
    showUnitPrice: boolean;
    showDiscount: boolean;
    showMeasurements: boolean;
    showBarcode: boolean;
  };
  footer: {
    returnPolicy: string;
    thankYouMessage: string;
    showZatcaQr: boolean;
  };
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

export const ThermalInvoice = ({ 
  data, 
  size = '80mm',
  settings: propSettings
}: { 
  data: InvoiceData; 
  size?: '58mm' | '80mm';
  settings?: InvoiceLayoutSettingsType;
}) => {
  const [localSettings, setLocalSettings] = React.useState<InvoiceLayoutSettingsType | null>(() => {
    try {
      const stored = localStorage.getItem('pos_invoice_settings');
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });

  React.useEffect(() => {
    const handleUpdate = () => {
      try {
        const stored = localStorage.getItem('pos_invoice_settings');
        if (stored) setLocalSettings(JSON.parse(stored));
      } catch { /* ignore */ }
    };
    window.addEventListener('invoice_settings_updated', handleUpdate);
    window.addEventListener('tenant_settings_updated', handleUpdate);
    return () => {
      window.removeEventListener('invoice_settings_updated', handleUpdate);
      window.removeEventListener('tenant_settings_updated', handleUpdate);
    };
  }, []);

  const settings = propSettings || localSettings;

  const is58 = size === '58mm';
  const isFastThermal = settings?.fastThermalMode ?? (localStorage.getItem('pos_fast_thermal_mode') === 'true');

  const containerClass = is58 ? 'w-[58mm]' : 'w-[80mm]';
  const textBase = is58 ? 'text-[8px]' : (isFastThermal ? 'text-[8.5px]' : 'text-[9px]');
  const textSm = is58 ? 'text-[9px]' : (isFastThermal ? 'text-[9px]' : 'text-[10px]');
  const textLg = is58 ? 'text-[10px]' : (isFastThermal ? 'text-[11px] font-black' : 'text-xs');

  // Apply customizable settings if provided
  const logoUrl = settings?.header?.logoUrl || '';
  const facilityName = settings?.header?.facilityName || data.seller.name;
  const vatNumber = settings?.header?.taxId || data.seller.vatNumber;
  const address = settings?.header?.address || data.seller.address;
  const phone = settings?.header?.contactNumbers || data.seller.phone;
  const alignment = settings?.header?.alignment || 'center';

  const showUnitPrice = settings?.columns?.showUnitPrice ?? true;
  const showDiscount = settings?.columns?.showDiscount ?? true;
  const showMeasurements = settings?.columns?.showMeasurements ?? false;
  const showBarcode = settings?.columns?.showBarcode ?? true;

  const returnPolicy = settings?.footer?.returnPolicy || '';
  const thankYouMessage = settings?.footer?.thankYouMessage || 'شكراً لتسوقكم معنا';
  const showZatcaQr = settings?.footer?.showZatcaQr ?? true;

  // Alignment classes
  const alignmentClass = 
    alignment === 'center' ? 'items-center text-center' :
    alignment === 'left' ? 'items-end text-left' : 'items-start text-right';

  // Helper calculations
  const totalPieces = data.items.reduce((sum, item) => sum + (item.quantity || 1), 0);
  const paidAmount = data.paidAmount !== undefined ? data.paidAmount : data.grandTotal;
  const remainingAmount = data.remainingAmount !== undefined ? data.remainingAmount : 0;
  const branchName = data.branchName || 'الفرع الرئيسي';
  const sellerName = data.sellerName || 'النظام';

  const paddingClass = isFastThermal ? 'px-2 py-1.5' : 'px-3.5 py-3 sm:px-4 sm:py-4';
  const marginHeader = isFastThermal ? 'mb-2 pb-1.5' : 'mb-3 pb-2.5';
  const marginInfo = isFastThermal ? 'mb-2 pb-1.5 space-y-0.5' : 'mb-3 pb-2 space-y-1';
  const marginTable = isFastThermal ? 'mb-2' : 'mb-3';
  const spaceItems = isFastThermal ? 'space-y-1 mb-1 pb-1' : 'space-y-1.5 mb-2 pb-2';
  const marginTotals = isFastThermal ? 'space-y-0.5 mb-2 pb-1.5' : 'space-y-1 mb-3 pb-2.5';
  const marginPayment = isFastThermal ? 'mb-2 pb-1.5 space-y-0.5' : 'mb-3 pb-2 space-y-1';
  const qrSize = isFastThermal ? (is58 ? 75 : 85) : (is58 ? 95 : 110);
  const barcodeHeight = isFastThermal ? 22 : 32;

  return (
    <div className={`${containerClass} ${isFastThermal ? 'fast-thermal-print' : ''} bg-white text-black ${paddingClass} mx-auto font-sans print:w-full print:max-w-full print:p-0 print:m-0 shrink-0 shadow-sm border border-gray-200 print:shadow-none print:border-none`} dir="rtl">
      {isFastThermal && (
        <div className="print:hidden text-[8px] bg-amber-50 text-amber-900 font-bold py-0.5 px-1.5 rounded mb-1 text-center border border-amber-200 flex items-center justify-center gap-1">
          <span>⚡ الوضع السريع المضغوط (80mm)</span>
        </div>
      )}

      {/* Header */}
      <div className={`${marginHeader} border-b border-dashed border-gray-400 flex flex-col ${alignmentClass}`}>
        {logoUrl && (
          <img src={logoUrl} alt="Logo" className={`${isFastThermal ? 'w-10 h-10 mb-1' : 'w-12 h-12 mb-2'} object-contain filter drop-shadow-sm`} />
        )}
        <h2 className={`${textLg} font-black mb-0.5`}>{facilityName}</h2>
        <p className={`${textBase} font-bold mb-0.5 font-mono`}>الرقم الضريبي: {vatNumber}</p>
        {address && <p className={`${textBase} text-gray-700 leading-tight mb-0.5`}>{address}</p>}
        {phone && <p className={`${textBase} text-gray-700 font-mono`}>Tel: {phone}</p>}
        
        <div className={`${isFastThermal ? 'mt-1 py-0.5 px-2 text-[8px]' : 'mt-2 py-0.5 px-3 text-[8.5px]'} font-bold bg-gray-100 uppercase border border-gray-200 rounded-md`}>
          {settings?.layoutTemplate === 'tax' ? 'فاتورة ضريبية مبسطة' : 
           settings?.layoutTemplate === 'detailed' ? 'فاتورة مبيعات مفصلة' : 'فاتورة ضريبية مبسطة'}
        </div>
      </div>

      {/* Info */}
      <div className={`${marginInfo} ${textBase} border-b border-dashed border-gray-400`}>
        {address && (
          <div className="flex justify-between items-center">
            <div>
              <span className="text-gray-500">العنوان: </span>
              <span className="font-bold">{address}</span>
            </div>
            <span className="text-gray-400 font-sans text-[7.5px]">Address</span>
          </div>
        )}
        {phone && (
          <div className="flex justify-between items-center">
            <div>
              <span className="text-gray-500">رقم الهاتف: </span>
              <span className="font-mono font-bold" dir="ltr">{phone}</span>
            </div>
            <span className="text-gray-400 font-sans text-[7.5px]">Phone No.</span>
          </div>
        )}
        <div className="flex justify-between items-center">
          <div>
            <span className="text-gray-500">التاريخ والوقت: </span>
            <span className="font-bold">{new Date(data.issueDate).toLocaleString('ar-SA-u-nu-latn')}</span>
          </div>
          <span className="text-gray-400 font-sans text-[7.5px]">Issue Date</span>
        </div>
        <div className="flex justify-between items-center">
          <div>
            <span className="text-gray-500">رقم الفاتورة: </span>
            <span className="font-mono font-bold uppercase">#{data.invoiceNumber}</span>
          </div>
          <span className="text-gray-400 font-sans text-[7.5px]">Invoice No.</span>
        </div>
        <div className="flex justify-between items-center">
          <div>
            <span className="text-gray-500">الفرع: </span>
            <span className="font-bold">{branchName}</span>
          </div>
          <span className="text-gray-400 font-sans text-[7.5px]">Branch</span>
        </div>
        <div className="flex justify-between items-center">
          <div>
            <span className="text-gray-500">البائع: </span>
            <span className="font-bold">{sellerName}</span>
          </div>
          <span className="text-gray-400 font-sans text-[7.5px]">Seller</span>
        </div>
        <div className="flex justify-between items-center">
          <div>
            <span className="text-gray-500">العميل: </span>
            <span className="font-bold">{data.customer.name}</span>
          </div>
          <span className="text-gray-400 font-sans text-[7.5px]">Customer</span>
        </div>
        {data.customer.vatNumber && (
          <div className="flex justify-between items-center">
            <div>
              <span className="text-gray-500">الرقم الضريبي للعميل: </span>
              <span className="font-mono font-bold">{data.customer.vatNumber}</span>
            </div>
            <span className="text-gray-400 font-sans text-[7.5px]">Customer VAT</span>
          </div>
        )}
      </div>

      {/* Items Table */}
      <div className={`${marginTable} ${textBase}`}>
        <div className="flex border-b border-gray-900 pb-1 mb-1 font-bold">
          <div className="flex-1 text-right">الصنف</div>
          <div className="w-8 text-center">الكمية</div>
          {showUnitPrice && <div className="w-12 text-center">السعر</div>}
          <div className="w-14 text-left">المجموع</div>
        </div>
        
        <div className={`${spaceItems} border-b border-dashed border-gray-400`}>
          {data.items.map((item, index) => {
            const itemTotal = item.quantity * item.unitPrice;
            return (
              <div key={index} className="flex flex-col">
                 <div className="font-bold text-gray-900 leading-tight">
                   {item.name}
                   {showMeasurements && (
                     <span className="block text-[7.5px] text-gray-500 font-semibold font-sans mt-0.5">
                       (طول: 155 | كتف: 48 | صدر: 58 | كم: 62)
                     </span>
                   )}
                 </div>
                 <div className="flex mt-0.5 text-gray-700 items-center">
                   <div className="flex-1"></div>
                   <div className="w-8 text-center font-mono">{item.quantity}</div>
                   {showUnitPrice && <div className="w-12 text-center font-mono">{item.unitPrice.toFixed(2)}</div>}
                   <div className="w-14 text-left font-mono font-bold">{itemTotal.toFixed(2)}</div>
                 </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Totals */}
      <div className={`${textSm} ${marginTotals} border-b border-dashed border-gray-400`}>
         <div className="flex justify-between">
           <span>الإجمالي غير شامل الضريبة:</span>
           <span className="font-mono">{data.subtotal.toFixed(2)}</span>
         </div>
         {showDiscount && data.discountAmount ? (
           <div className="flex justify-between text-gray-700">
             <span>الخصم:</span>
             <span className="font-mono">-{data.discountAmount.toFixed(2)}</span>
           </div>
         ) : null}
         <div className="flex justify-between">
           <span>ضريبة القيمة المضافة (15%):</span>
           <span className="font-mono">{data.vatAmount.toFixed(2)}</span>
         </div>
         <div className={`flex justify-between font-black text-xs ${isFastThermal ? 'mt-1 pt-1' : 'mt-1.5 pt-1.5'} border-t border-gray-400`}>
           <span>الإجمالي شامل الضريبة:</span>
           <span className="font-mono flex items-center gap-1">{data.grandTotal.toFixed(2)} <CurrencySymbol className="h-[1.1em] w-auto inline-block" /></span>
         </div>
      </div>

      {/* Payment & Pieces Details */}
      <div className={`${marginPayment} ${textBase} border-b border-dashed border-gray-400`}>
        <div className="flex justify-between">
          <span>المدفوع / Paid Amount:</span>
          <span className="font-mono font-bold flex items-center gap-1">{paidAmount.toFixed(2)} <CurrencySymbol className="h-[1.1em] w-auto inline-block" /></span>
        </div>
        <div className="flex justify-between">
          <span>المتبقي / Remaining Amount:</span>
          <span className="font-mono font-bold flex items-center gap-1">{remainingAmount.toFixed(2)} <CurrencySymbol className="h-[1.1em] w-auto inline-block" /></span>
        </div>
        <div className="flex justify-between">
          <span>عدد القطع / Total Pieces:</span>
          <span className="font-mono font-bold">{totalPieces}</span>
        </div>
        <div className="flex justify-between">
          <span>طريقة الدفع / Payment Method:</span>
          <span className="font-bold">نقدي / Cash</span>
        </div>
      </div>

      {/* QR Code (ONLY QR Code, no text) */}
      {showZatcaQr && data.qrValue && (
        <div className={`flex flex-col items-center justify-center ${isFastThermal ? 'mb-2' : 'mb-3'}`}>
           <QRCodeSVG value={data.qrValue} size={qrSize} />
        </div>
      )}

      {/* Barcode */}
      {showBarcode && (
        <div className={`flex flex-col items-center justify-center ${isFastThermal ? 'py-1 mt-1' : 'py-2 mt-2'} border-t border-dashed border-gray-200`}>
          <Barcode value={data.invoiceNumber} width={1.1} height={barcodeHeight} fontSize={8} margin={0} />
        </div>
      )}

      {/* Return Policy and Policies */}
      {returnPolicy && (
        <div className={`text-gray-400 text-[8px] leading-relaxed border-t border-dashed border-gray-200 ${isFastThermal ? 'pt-1.5 mt-1.5' : 'pt-3 mt-3'} text-center`}>
          <p className="font-bold text-gray-600 mb-0.5">شروط الاستبدال والضمان:</p>
          <p className="whitespace-pre-wrap px-1">{returnPolicy}</p>
        </div>
      )}

      <div className={`text-center text-[9px] font-black text-gray-800 ${isFastThermal ? 'mt-2 mb-0.5' : 'mt-3 mb-1'} italic`}>
        {thankYouMessage}
      </div>
    </div>
  );
};

export const StandardInvoice = ({ 
  data, 
  size = 'A4',
  settings
}: { 
  data: InvoiceData; 
  size?: 'A4' | 'A5';
  settings?: InvoiceLayoutSettingsType;
}) => {
  const isA5 = size === 'A5';
  const containerClass = isA5 ? 'w-[148mm] min-h-[210mm]' : 'w-[210mm] min-h-[297mm]';
  const textBase = isA5 ? 'text-xs' : 'text-sm';
  const textSm = isA5 ? 'text-[10px]' : 'text-xs';

  // Apply customizable settings if provided
  const logoUrl = settings?.header?.logoUrl || '';
  const facilityName = settings?.header?.facilityName || data.seller.name;
  const vatNumber = settings?.header?.taxId || data.seller.vatNumber;
  const address = settings?.header?.address || data.seller.address;
  const phone = settings?.header?.contactNumbers || data.seller.phone;
  const alignment = settings?.header?.alignment || 'center';

  const showUnitPrice = settings?.columns?.showUnitPrice ?? true;
  const showDiscount = settings?.columns?.showDiscount ?? true;
  const showMeasurements = settings?.columns?.showMeasurements ?? false;
  const showBarcode = settings?.columns?.showBarcode ?? true;

  const returnPolicy = settings?.footer?.returnPolicy || '';
  const thankYouMessage = settings?.footer?.thankYouMessage || 'شكراً لتسوقكم معنا';
  const showZatcaQr = settings?.footer?.showZatcaQr ?? true;

  // Alignment classes for Seller details
  const alignmentClass = 
    alignment === 'center' ? 'items-center text-center' :
    alignment === 'left' ? 'items-end text-left' : 'items-start text-right';

  // Helper calculations
  const totalPieces = data.items.reduce((sum, item) => sum + (item.quantity || 1), 0);
  const paidAmount = data.paidAmount !== undefined ? data.paidAmount : data.grandTotal;
  const remainingAmount = data.remainingAmount !== undefined ? data.remainingAmount : 0;
  const branchName = data.branchName || 'الفرع الرئيسي';
  const sellerName = data.sellerName || 'النظام';

  return (
    <div className={`${containerClass} bg-white text-black p-8 mx-auto font-sans print:w-full print:max-w-full print:m-0 print:border-none shrink-0 shadow-sm border border-gray-200`} dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-center sm:items-start border-b-2 border-gray-900 pb-6 mb-6 gap-6">
        <div className={`flex flex-col flex-1 ${alignmentClass}`}>
          {logoUrl && (
            <img src={logoUrl} alt="Logo" className="w-20 h-20 object-contain mb-3 filter drop-shadow-sm" />
          )}
          <h1 className="text-2xl font-black mb-2">{facilityName}</h1>
          {address && <p className={`${textBase} text-gray-600`}>{address}</p>}
          <p className={`${textBase} font-bold mt-2 font-mono`}>الرقم الضريبي: {vatNumber}</p>
          {phone && <p className={`${textBase} font-mono mt-1`}>Tel: {phone}</p>}
        </div>
        <div className="flex-1 text-left self-center sm:self-start">
          <div className="inline-block bg-gray-100 p-4 rounded-xl border border-gray-200">
            <h2 className="text-lg font-black text-gray-900 text-center mb-1">
              {settings?.layoutTemplate === 'tax' ? 'فاتورة ضريبية مبسطة' : 
               settings?.layoutTemplate === 'detailed' ? 'فاتورة ضريبية مفصلة' : 'فاتورة ضريبية مبسطة'}
            </h2>
            <h3 className="text-xs font-bold text-gray-600 text-center uppercase tracking-wider font-sans">
              {settings?.layoutTemplate === 'tax' ? 'Simplified Tax Invoice' : 
               settings?.layoutTemplate === 'detailed' ? 'Detailed Tax Invoice' : 'Simplified Tax Invoice'}
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
              <span className="font-bold text-gray-500 ml-2">رقم الفاتورة / Invoice No.:</span>
              <span className="font-mono font-bold text-gray-900">#{data.invoiceNumber}</span>
            </p>
            <p className={textSm}>
              <span className="font-bold text-gray-500 ml-2">التاريخ والوقت / Issue Date:</span>
              <span className="font-mono font-bold">{new Date(data.issueDate).toLocaleString('ar-SA-u-nu-latn')}</span>
            </p>
            <p className={textSm}>
              <span className="font-bold text-gray-500 ml-2">الفرع / Branch:</span>
              <span className="font-bold text-gray-900">{branchName}</span>
            </p>
            <p className={textSm}>
              <span className="font-bold text-gray-500 ml-2">البائع / Seller:</span>
              <span className="font-bold text-gray-900">{sellerName}</span>
            </p>
            {phone && (
              <p className={textSm}>
                <span className="font-bold text-gray-500 ml-2">رقم الهاتف / Phone:</span>
                <span className="font-mono font-bold text-gray-900" dir="ltr">{phone}</span>
              </p>
            )}
            {address && (
              <p className={textSm}>
                <span className="font-bold text-gray-500 ml-2">العنوان / Address:</span>
                <span className="font-bold text-gray-900">{address}</span>
              </p>
            )}
          </div>
        </div>
        <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
          <h3 className={`${textBase} font-black text-gray-800 border-b border-gray-200 pb-2 mb-3`}>بيانات العميل / Customer Details</h3>
          <div className="space-y-2">
            <p className={textSm}>
              <span className="font-bold text-gray-500 ml-2">الاسم / Name:</span> 
              <span className="font-bold text-gray-900">{data.customer.name}</span>
            </p>
            {data.customer.vatNumber && (
              <p className={textSm}>
                <span className="font-bold text-gray-500 ml-2">الرقم الضريبي / VAT:</span> 
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
              {showUnitPrice && <th className={`p-3 text-center font-black text-gray-700 ${textSm} border-l border-gray-200`}>سعر الوحدة</th>}
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
                  <td className={`p-3 font-bold text-gray-900 ${textSm} border-l border-gray-200`}>
                    <div>{item.name}</div>
                    {showMeasurements && (
                      <div className="text-[10px] text-gray-500 font-medium italic font-sans mt-1">
                        طول: 155 | كتف: 48 | صدر: 58 | كم: 62 | رقبة: 42
                      </div>
                    )}
                  </td>
                  {showUnitPrice && <td className={`p-3 text-center font-mono text-gray-700 ${textSm} border-l border-gray-200`}>{item.unitPrice.toFixed(2)}</td>}
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
      <div className="flex flex-col sm:flex-row justify-between items-center sm:items-start print:break-inside-avoid mt-8 gap-8">
        <div className="flex flex-col items-center gap-4 shrink-0">
          {showZatcaQr && data.qrValue && (
            <div className="bg-gray-50 p-4 border border-gray-200 rounded-xl flex flex-col items-center justify-center">
              <QRCodeSVG value={data.qrValue} size={isA5 ? 100 : 130} />
            </div>
          )}

          {showBarcode && (
            <div className="flex flex-col items-center justify-center py-2">
              <Barcode value={data.invoiceNumber} width={1.2} height={40} fontSize={10} margin={0} />
            </div>
          )}
        </div>
        <div className="flex-1 w-full">
          <div className="space-y-3 border-2 border-gray-100 rounded-xl p-5 bg-gray-50">
            <div className={`flex justify-between ${textSm} text-gray-600`}>
              <span className="font-bold">الإجمالي غير شامل الضريبة:</span>
              <span className="font-mono font-bold text-gray-900 flex items-center gap-1">{data.subtotal.toFixed(2)} <CurrencySymbol className="h-[1.1em] w-auto inline-block" /></span>
            </div>
            {showDiscount && data.discountAmount ? (
               <div className={`flex justify-between ${textSm} text-gray-600`}>
                 <span className="font-bold">الخصم:</span>
                 <span className="font-mono font-bold text-gray-900 flex items-center gap-1">-{data.discountAmount.toFixed(2)} <CurrencySymbol className="h-[1.1em] w-auto inline-block" /></span>
               </div>
            ) : null}
            <div className={`flex justify-between ${textSm} text-gray-600`}>
              <span className="font-bold">مجموع ضريبة القيمة المضافة (15%):</span>
              <span className="font-mono font-bold text-gray-900 flex items-center gap-1">{data.vatAmount.toFixed(2)} <CurrencySymbol className="h-[1.1em] w-auto inline-block" /></span>
            </div>
            <div className={`flex justify-between ${textBase} font-black text-gray-900 border-t-2 border-gray-300 pt-3 mt-1`}>
              <span>الإجمالي شامل الضريبة:</span>
              <span className="font-mono text-xl flex items-center gap-1">{data.grandTotal.toFixed(2)} <CurrencySymbol className="h-[1.1em] w-auto inline-block" /></span>
            </div>
            
            {/* Added details for paid, remaining, pieces and payment method */}
            <div className={`flex justify-between ${textSm} text-gray-600 border-t border-dashed border-gray-200 pt-2 mt-2`}>
              <span className="font-bold">المدفوع / Paid Amount:</span>
              <span className="font-mono font-bold text-gray-900 flex items-center gap-1">{paidAmount.toFixed(2)} <CurrencySymbol className="h-[1.1em] w-auto inline-block" /></span>
            </div>
            <div className={`flex justify-between ${textSm} text-gray-600`}>
              <span className="font-bold">المتبقي / Remaining Amount:</span>
              <span className="font-mono font-bold text-gray-900 flex items-center gap-1">{remainingAmount.toFixed(2)} <CurrencySymbol className="h-[1.1em] w-auto inline-block" /></span>
            </div>
            <div className={`flex justify-between ${textSm} text-gray-600`}>
              <span className="font-bold">عدد القطع / Total Pieces:</span>
              <span className="font-mono font-bold text-gray-900">{totalPieces}</span>
            </div>
            <div className={`flex justify-between ${textSm} text-gray-600`}>
              <span className="font-bold">طريقة الدفع / Payment Method:</span>
              <span className="font-bold text-gray-900">نقدي / Cash</span>
            </div>
          </div>
        </div>
      </div>
      
      {/* Footer Note */}
      <div className="mt-12 pt-4 border-t border-gray-200 text-center print:break-inside-avoid space-y-4">
          {returnPolicy && (
            <div className="text-gray-400 text-xs leading-relaxed max-w-xl mx-auto pb-4 border-b border-gray-100 text-right">
              <p className="font-black text-gray-600 mb-1">شروط الاستبدال والضمان:</p>
              <p className="whitespace-pre-wrap">{returnPolicy}</p>
            </div>
          )}
          <p className={`${textSm} font-black text-gray-900 text-base italic tracking-tight`}>{thankYouMessage}</p>
      </div>
    </div>
  );
};

export default function InvoiceReceipt({ 
  invoiceData, 
  defaultSize = '80mm' 
}: { 
  invoiceData?: InvoiceData; 
  defaultSize?: PrintSize;
}) {
  const [printSize, setPrintSize] = useState<PrintSize>(defaultSize);

  // Use provided data or fallback to mock data
  const data = invoiceData || MOCK_INVOICE;

  const handlePrint = async () => {
    try {
      const { printElementDetailed } = await import('../../utils/printManager');
      const res = await printElementDetailed('receipt-printable-content', {
        paperSize: printSize,
        title: 'إيصال فاتورة ضريبية',
      });
      if (!res.ok) {
        console.error('[InvoiceReceipt] فشل الطباعة:', res.message);
        alert(`تعذّرت الطباعة: ${res.message}`);
      }
    } catch (e) {
      console.error('[InvoiceReceipt] خطأ الطباعة:', e);
      window.print();
    }
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

      <div id="receipt-printable-content" data-paper={printSize} className="w-full flex justify-center pb-12 print:pb-0">
        {['58mm', '80mm'].includes(printSize) 
          ? <ThermalInvoice data={data} size={printSize as '58mm' | '80mm'} />
          : <StandardInvoice data={data} size={printSize as 'A4' | 'A5'} />
        }
      </div>
      
    </div>
  );
}
