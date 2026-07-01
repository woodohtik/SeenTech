import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase/client';
import { Download, ShoppingBag, Loader2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { generateZatcaQR } from '../services/zatcaService';
import html2pdf from 'html2pdf.js';

export default function PublicInvoice() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<any>(null);
  const [tenant, setTenant] = useState<any>(null);
  const [customer, setCustomer] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const fetchInvoice = async () => {
      if (!id) {
        setError('رابط غير صالح');
        setLoading(false);
        return;
      }

      try {
        const { data: orderData, error: orderError } = await supabase
          .from('orders')
          .select('*')
          .eq('id', id)
          .maybeSingle();

        if (orderError || !orderData) {
          setError('لم يتم العثور على الفاتورة');
          setLoading(false);
          return;
        }

        setOrder({
          ...orderData,
          orderNumber: orderData.order_number,
          orderDate: orderData.order_date,
          totalAmount: orderData.total_amount,
          paidAmount: orderData.paid_amount,
          vatAmount: orderData.vat_amount,
          paymentMethod: orderData.payment_method,
          tenantId: orderData.tenant_id,
        });

        // Fetch tenant details
        const { data: tenantData } = await supabase
          .from('tenants')
          .select('*')
          .eq('id', orderData.tenant_id)
          .maybeSingle();

        if (tenantData) {
          setTenant({
            ...tenantData,
            storeName: tenantData.store_name,
            storeNameEn: tenantData.store_name_en,
            vatNumber: tenantData.vat_number,
            address: tenantData.address,
            logoUrl: tenantData.logo_url
          });
        }

        if (orderData.customer_id) {
          const { data: customerData } = await supabase
            .from('customers')
            .select('*')
            .eq('id', orderData.customer_id)
            .maybeSingle();
          if (customerData) {
            setCustomer(customerData);
          }
        }

      } catch (err: any) {
        setError('حدث خطأ أثناء تحميل الفاتورة');
      } finally {
        setLoading(false);
      }
    };

    fetchInvoice();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-brand w-8 h-8" />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6 text-center" dir="rtl">
        <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mb-4">
          <ShoppingBag size={32} />
        </div>
        <h1 className="text-xl font-bold text-slate-900 mb-2">{error || 'الفاتورة غير موجودة'}</h1>
        <p className="text-slate-500">الرابط غير صحيح أو قد تم حذف الفاتورة</p>
      </div>
    );
  }

  const invoiceDate = new Date(order.orderDate || new Date().toISOString());
  
  const zatcaQR = generateZatcaQR(
    tenant?.storeName || 'متجر تفصيل',
    tenant?.vatNumber || '000000000000000',
    invoiceDate.toISOString(),
    Number(order.totalAmount || 0).toFixed(2),
    Number(order.vatAmount || 0).toFixed(2)
  );

  const handleDownloadPdf = async () => {
    setDownloading(true);
    const element = document.getElementById('digital-invoice-content');
    
    if (element) {
      const opt = {
        margin: 0,
        filename: `invoice-${order.orderNumber}.pdf`,
        image: { type: 'jpeg' as const, quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm' as const, format: 'a4' as const, orientation: 'portrait' as const }
      };
      
      try {
        await html2pdf().from(element).set(opt).save();
      } catch (err) {
        console.error('Error generating PDF', err);
      }
    }
    setDownloading(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 font-sans flex flex-col" dir="rtl">
      <div className="max-w-md w-full mx-auto mb-6 flex justify-between items-center">
        <h1 className="text-lg font-bold text-slate-900">الوصول الرقمي للفاتورة</h1>
        <button 
          onClick={handleDownloadPdf}
          disabled={downloading}
          className="flex items-center gap-2 bg-brand text-white px-4 py-2 rounded-xl text-sm font-bold shadow-sm hover:bg-brand/90 transition disabled:opacity-70"
        >
          {downloading ? <Loader2 className="animate-spin w-4 h-4" /> : <Download size={16} />}
          <span>{downloading ? 'جاري التحميل...' : 'تحميل PDF'}</span>
        </button>
      </div>

      <div id="digital-invoice-content" className="max-w-md w-full mx-auto bg-white border border-slate-200 rounded-3xl shadow-sm p-6">
        {/* Header Block */}
        <div className="text-center mb-6 border-b border-dashed border-slate-300 pb-5">
          {tenant?.logoUrl ? (
            <img
              src={tenant.logoUrl}
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
          
          <h2 className="text-base font-black text-slate-900 leading-tight">{tenant?.storeName || 'المتجر'}</h2>
          {tenant?.storeNameEn && <h3 className="text-xs font-semibold text-slate-500 tracking-wide mt-0.5">{tenant.storeNameEn}</h3>}
          
          <div className="text-[11px] text-slate-500 mt-2 space-y-0.5">
            <p>{tenant?.address || ''}</p>
            {tenant?.phone && <p dir="ltr">Tel: {tenant.phone}</p>}
            {tenant?.vatNumber && <p className="mt-1 font-bold">الرقم الضريبي / VAT: <span className="font-mono">{tenant.vatNumber}</span></p>}
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
            <span className="font-mono font-bold text-slate-900 uppercase">#{order.orderNumber}</span>
          </div>

          <div className="flex justify-between">
            <span className="text-slate-500">تاريخ الإصدار / Issue Date:</span>
            <span className="font-bold text-slate-800" dir="ltr">{invoiceDate.toLocaleString('ar-SA')}</span>
          </div>

          <div className="flex justify-between">
            <span className="text-slate-500">العميل / Customer:</span>
            <span className="font-bold text-slate-800">{customer?.name || 'عميل نقدي'}</span>
          </div>
        </div>

        {/* Items Line */}
        <div className="mb-5 border-b border-dashed border-slate-200 pb-4 space-y-1.5">
          <div className="flex justify-between text-[10px] font-black text-slate-400 uppercase tracking-wide border-b pb-1.5">
            <span className="flex-1 text-right">الصنف / Item</span>
            <span className="w-16 text-center">الكمية</span>
            <span className="w-20 text-left">المجموع</span>
          </div>

          {(order.items || []).map((item: any, idx: number) => {
            const qty = item.quantity || 1;
            const price = item.price || 0;
            const total = qty * price;
            return (
              <div key={idx} className="flex justify-between items-start text-xs py-0.5 text-slate-700">
                <span className="flex-1 text-right font-bold text-slate-900">{item.name || item.fabricName || 'منتج'}</span>
                <span className="w-16 text-center font-mono text-slate-500">
                  {qty}
                </span>
                <span className="w-20 text-left font-mono font-bold text-slate-900">
                  {total.toFixed(2)} ر.س
                </span>
              </div>
            );
          })}
        </div>

        {/* Mini Totals Breakdown */}
        <div className="space-y-2 border-b border-dashed border-slate-200 pb-4 mb-5 text-[11px]">
          <div className="flex justify-between text-slate-500">
            <span>المجموع غير شامل الضريبة:</span>
            <span className="font-mono font-bold">{(Number(order.totalAmount) - Number(order.vatAmount || 0)).toFixed(2)} ر.س</span>
          </div>

          <div className="flex justify-between text-slate-500">
            <span>ضريبة القيمة المضافة (15%):</span>
            <span className="font-mono font-bold">{Number(order.vatAmount || 0).toFixed(2)} ر.س</span>
          </div>

          <div className="flex justify-between text-base font-black text-slate-900 pt-1.5 border-t border-dotted border-slate-200">
            <span>الإجمالي المستحق / Total:</span>
            <span className="font-mono">{Number(order.totalAmount || 0).toFixed(2)} ر.س</span>
          </div>
        </div>

        {/* ZATCA QR Code */}
        <div className="flex flex-col items-center justify-center py-2 mb-4">
          <p className="text-[9px] text-slate-400 font-bold mb-2">فاتورة إلكترونية متوافقة / Compliant E-Invoice</p>
          <div className="bg-slate-50 p-2 rounded-xl border border-slate-100">
            <QRCodeSVG value={zatcaQR} size={110} level="M" />
          </div>
        </div>

        <div className="pt-4 border-t border-dashed border-slate-300 text-center">
          <p className="font-black text-slate-900 text-[11px] mb-0.5">تم إصدار هذه الفاتورة رقمياً</p>
          <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider">Digital Invoice</p>
        </div>
      </div>
    </div>
  );
}
