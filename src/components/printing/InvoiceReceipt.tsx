import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';
import Barcode from 'react-barcode';
import { CurrencySymbol } from '../CurrencySymbol';
import SimplifiedTaxInvoice from './SimplifiedTaxInvoice';
import StandardTaxInvoice from './TaxInvoice';
import { useToast } from '../../contexts/ToastContext';

export type PrintSize = '58mm' | '80mm' | 'A5' | 'A4';

export interface InvoiceData {
  invoiceNumber: string;
  issueDate: string;
  invoiceType?: string;
  paymentMethod?: string;
  paymentMethodEn?: string;
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
    id: string | number;
    name: string;
    quantity: number;
    unitPrice: number;
  }>;
  subtotal: number;
  vatAmount: number;
  discountAmount?: number;
  grandTotal: number;
  paidAmount?: number;
  remainingAmount?: number;
  qrValue?: string;
  branchName?: string;
  sellerName?: string;
}

export const formatPaymentMethodLabels = (method?: string) => {
  const m = (method || 'cash').toLowerCase();
  if (m === 'network' || m === 'card' || m === 'mada') return { ar: 'شبكة / بطاقة', en: 'Card / Mada' };
  if (m === 'bank_transfer' || m === 'transfer') return { ar: 'تحويل بنكي', en: 'Bank Transfer' };
  if (m === 'partial' || m === 'credit') return { ar: 'آجل / دفع جزئي', en: 'Credit / Partial' };
  if (m === 'cash_on_delivery' || m === 'cod') return { ar: 'الدفع عند الاستلام', en: 'Cash on Delivery' };
  return { ar: 'نقداً', en: 'Cash' };
};

export interface InvoiceLayoutSettingsType {
  fastThermalMode?: boolean;
  layoutTemplate?: 'tax' | 'standard' | 'detailed';
  header?: {
    logoUrl?: string;
    facilityName?: string;
    taxId?: string;
    address?: string;
    contactNumbers?: string;
    alignment?: 'right' | 'center' | 'left';
  };
  columns?: {
    showUnitPrice?: boolean;
    showDiscount?: boolean;
    showMeasurements?: boolean;
    showBarcode?: boolean;
  };
  footer?: {
    returnPolicy?: string;
    thankYouMessage?: string;
    showZatcaQr?: boolean;
  };
}

const MOCK_INVOICE: InvoiceData = {
  invoiceNumber: 'INV-2026-0001',
  issueDate: new Date().toISOString(),
  seller: {
    name: 'مؤسسة الحلول المتقدمة للتجارة',
    vatNumber: '310123456700003',
    address: 'الرياض - حي العليا - طريق الملك فهد',
    phone: '0112345678'
  },
  customer: {
    name: 'شركة الأمل للمقاولات',
    vatNumber: '300987654300003'
  },
  items: [
    { id: 1, name: 'شاشة حاسوب 27 بوصة - 4K', quantity: 1, unitPrice: 1500 },
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

  const sellerInfo = {
    name: settings?.header?.facilityName || data.seller?.name || 'المنشأة',
    vatNumber: settings?.header?.taxId || data.seller?.vatNumber || '000000000000000',
    address: settings?.header?.address || data.seller?.address || 'المملكة العربية السعودية',
    phone: settings?.header?.contactNumbers || data.seller?.phone || '',
    logoUrl: settings?.header?.logoUrl || '',
  };

  const totals = {
    subtotal: data.subtotal || 0,
    discount: data.discountAmount || 0,
    taxableAmount: (data.subtotal || 0) - (data.discountAmount || 0),
    vatAmount: data.vatAmount || 0,
    grandTotal: data.grandTotal || 0,
    paidAmount: data.paidAmount !== undefined ? data.paidAmount : data.grandTotal,
    remainingAmount: data.remainingAmount !== undefined ? data.remainingAmount : 0,
  };

  const formattedItems = (data.items || []).map((item) => ({
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
  }));

  const payLabels = formatPaymentMethodLabels(data.paymentMethod);

  return (
    <SimplifiedTaxInvoice
      invoiceNumber={data.invoiceNumber}
      issueDate={data.issueDate}
      paymentMethod={data.paymentMethod ? payLabels.ar : 'نقداً'}
      paymentMethodEn={data.paymentMethodEn || payLabels.en}
      seller={sellerInfo}
      customerName={data.customer?.name || 'عميل نقدي / Guest Customer'}
      items={formattedItems}
      totals={totals}
      qrCodeBase64={data.qrValue}
      hidePrintButton={true}
      branchName={data.branchName || 'الفرع الرئيسي'}
      sellerName={data.sellerName || 'النظام'}
    />
  );
};

export const StandardInvoice = ({ 
  data, 
  size = 'A4',
  settings: propSettings
}: { 
  data: InvoiceData; 
  size?: 'A5' | 'A4';
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

  const sellerInfo = {
    name: settings?.header?.facilityName || data.seller?.name || 'المنشأة',
    vatNumber: settings?.header?.taxId || data.seller?.vatNumber || '000000000000000',
    address: settings?.header?.address || data.seller?.address || 'المملكة العربية السعودية',
    phone: settings?.header?.contactNumbers || data.seller?.phone || '',
    logoUrl: settings?.header?.logoUrl || '',
  };

  const totals = {
    subtotal: data.subtotal || 0,
    discount: data.discountAmount || 0,
    taxableAmount: (data.subtotal || 0) - (data.discountAmount || 0),
    vatAmount: data.vatAmount || 0,
    grandTotal: data.grandTotal || 0,
  };

  const formattedItems = (data.items || []).map((item) => ({
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
  }));

  const payLabels = formatPaymentMethodLabels(data.paymentMethod);

  return (
    <StandardTaxInvoice
      invoiceNumber={data.invoiceNumber}
      issueDate={data.issueDate}
      supplyDate={data.issueDate}
      paymentMethod={data.paymentMethod ? payLabels.ar : 'نقداً'}
      paymentMethodEn={data.paymentMethodEn || payLabels.en}
      seller={sellerInfo}
      buyer={{
        name: data.customer?.name || 'عميل نقدي / Guest Customer',
        vatNumber: data.customer?.vatNumber || '',
      }}
      items={formattedItems}
      totals={totals}
      qrCodeBase64={data.qrValue}
      hidePrintButton={true}
    />
  );
};

export default function InvoiceReceipt({ 
  invoiceData, 
  defaultSize = '80mm' 
}: { 
  invoiceData?: InvoiceData; 
  defaultSize?: PrintSize;
}) {
  const { t } = useTranslation();
  const { error: toastError } = useToast();
  const [printSize, setPrintSize] = useState<PrintSize>(defaultSize);

  // Use provided data or fallback to mock data
  const data = invoiceData || MOCK_INVOICE;

  const handlePrint = async () => {
    try {
      const { printElementDetailed } = await import('../../utils/printManager');
      const res = await printElementDetailed('receipt-printable-content', {
        paperSize: printSize,
        title: t('printing.tax_invoice_receipt_title'),
      });
      if (!res.ok) {
        console.error('[InvoiceReceipt] فشل الطباعة:', res.message);
        toastError(t('printing.print_failed_with_reason', { message: res.message }));
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
          <span className="text-sm font-black text-gray-800">{t('printing.paper_size')}</span>
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
          <span>{t('printing.print_invoice')}</span>
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
