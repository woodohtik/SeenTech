import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase/client';
import { handleError, OperationType } from '../lib/firebase';
import { cn } from '../lib/utils';
import { PriceDisplay } from './PriceDisplay';
import { 
  FileText, 
  Layout, 
  AlignRight, 
  AlignCenter, 
  AlignLeft, 
  Upload,
  Zap,
  X as CloseIcon,
  Save,
  Eye
} from 'lucide-react';
import Branding from './Branding';

interface InvoiceLayoutSettingsProps {
  tenantId: string;
}

export default function InvoiceLayoutSettings({ tenantId }: InvoiceLayoutSettingsProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const [settings, setSettings] = useState({
    printSize: 'thermal80',
    layoutTemplate: 'classic',
    header: {
      logoUrl: '',
      facilityName: '',
      contactNumbers: '',
      address: '',
      taxId: '',
      alignment: 'center' as 'right' | 'left' | 'center',
    },
    columns: {
      showUnitPrice: true,
      showDiscount: true,
      showMeasurements: false,
      showBarcode: true,
    },
    footer: {
      returnPolicy: '',
      thankYouMessage: 'شكراً لتسوقكم معنا',
      showZatcaQr: true,
    }
  });

  useEffect(() => {
    const fetchSettings = async () => {
      if (!tenantId || tenantId === 'saas_management') {
        setLoading(false);
        return;
      }
      try {
        const { data, error } = await supabase
          .from('tenants')
          .select('*')
          .eq('id', tenantId)
          .single();

        if (data && !error) {
          if (data.invoice_settings) {
            setSettings(data.invoice_settings);
            setLogoPreview(data.invoice_settings.header.logoUrl || null);
          } else {
            setSettings(prev => ({
              ...prev,
              header: {
                ...prev.header,
                facilityName: data.name || '',
                contactNumbers: data.phone || '',
                address: data.address || '',
                logoUrl: data.logo_url || ''
              }
            }));
            setLogoPreview(data.logo_url || null);
          }
        }
      } catch (error) {
        handleError(error, OperationType.GET, 'tenants');
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, [tenantId]);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 1024 * 1024) {
        alert('حجم الصورة كبير جداً، يرجى اختيار صورة أقل من 1 ميجابايت');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setLogoPreview(base64);
        setSettings(prev => ({
          ...prev,
          header: { ...prev.header, logoUrl: base64 }
        }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    if (!tenantId || tenantId === 'saas_management') return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('tenants')
        .update({
          invoice_settings: settings
        })
        .eq('id', tenantId);

      if (error) throw error;
      // Success feedback could be improved later
    } catch (error) {
      handleError(error, OperationType.UPDATE, 'tenants');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="h-96 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand"></div>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-[3rem] border border-border shadow-xl shadow-brand/5 overflow-hidden flex flex-col lg:flex-row min-h-[900px]" dir="rtl">
      {/* Controls Section */}
      <div className="w-full lg:w-1/2 p-10 border-l border-border overflow-y-auto max-h-[900px] space-y-10 custom-scrollbar">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="text-center md:text-right">
            <h2 className="text-2xl font-black text-content flex items-center justify-center md:justify-start gap-3">
              <div className="p-2 bg-brand/10 text-brand rounded-xl">
                <FileText size={24} />
              </div>
              تخطيط الفاتورة الاحترافية
            </h2>
            <p className="text-content-muted text-sm font-medium mt-1">صمم مظهر فواتيرك بما يتناسب مع هوية متجرك</p>
          </div>
          <button 
            onClick={handleSave}
            disabled={saving}
            className="w-full md:w-auto bg-brand text-white px-8 py-3.5 rounded-2xl font-black hover:bg-brand/90 transition-all shadow-xl shadow-brand/20 flex items-center justify-center gap-2 disabled:opacity-50 hover:scale-105 active:scale-95"
          >
            {saving ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={20} />}
            {saving ? 'جاري الحفظ...' : 'اعتماد التصميم'}
          </button>
        </div>

        {/* 1. Hardware & Format */}
        <div className="space-y-6">
          <div className="flex items-center gap-2 group">
             <div className="w-1.5 h-6 bg-brand rounded-full transition-all group-hover:h-8" />
             <h3 className="text-lg font-black text-content uppercase tracking-tight">1. الإخراج والطباعة</h3>
          </div>
          
          <div className="space-y-4 bg-surface-muted/50 p-6 rounded-[2rem] border border-border">
            <div className="space-y-3">
              <label className="text-[10px] font-black text-content-muted uppercase tracking-[0.2em] px-1">قياس الورق المفضل</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { id: 'thermal80', label: 'حراري 80mm' },
                  { id: 'thermal58', label: 'حراري 58mm' },
                  { id: 'a4', label: 'A4' },
                  { id: 'a5', label: 'A5' },
                ].map(size => (
                  <button
                    key={size.id}
                    onClick={() => setSettings(s => ({ ...s, printSize: size.id }))}
                    className={cn(
                      "py-3 px-3 rounded-xl text-xs font-black transition-all border-2",
                      settings.printSize === size.id 
                        ? "border-brand bg-brand/5 text-brand shadow-lg shadow-brand/5" 
                        : "border-border bg-white text-content-muted hover:border-brand/30"
                    )}
                  >
                    {size.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-[10px] font-black text-content-muted uppercase tracking-[0.2em] px-1">نمط توزيع العناصر</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { id: 'classic', label: 'كلاسيكي' },
                  { id: 'detailed', label: 'نموذج مفصل' },
                  { id: 'tax', label: 'فاتورة ضريبية' },
                ].map(template => (
                  <button
                    key={template.id}
                    onClick={() => setSettings(s => ({ ...s, layoutTemplate: template.id }))}
                    className={cn(
                      "group py-4 px-4 rounded-xl text-xs font-black transition-all border-2 flex flex-col items-center gap-3",
                      settings.layoutTemplate === template.id 
                        ? "border-brand bg-brand text-white shadow-xl shadow-brand/20" 
                        : "border-border bg-white text-content-muted hover:border-brand/30 hover:bg-surface-muted"
                    )}
                  >
                    <Layout size={24} className={cn("transition-transform group-hover:scale-110", settings.layoutTemplate === template.id ? "text-white" : "text-brand")} />
                    {template.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 2. Content Customization */}
        <div className="space-y-10">
          <div className="flex items-center gap-2 group">
             <div className="w-1.5 h-6 bg-brand rounded-full transition-all group-hover:h-8" />
             <h3 className="text-lg font-black text-content uppercase tracking-tight">2. صياغة المحتوى</h3>
          </div>
          
          {/* Header */}
          <div className="space-y-6 bg-surface-muted/30 p-8 rounded-[2.5rem] border border-border">
            <div className="flex items-center gap-3">
               <div className="p-2 bg-white rounded-lg shadow-sm">
                  <AlignRight size={18} className="text-brand" />
               </div>
               <h4 className="font-black text-content uppercase tracking-widest text-xs">ترويسة الفاتورة</h4>
            </div>
            
            <div className="flex flex-col md:flex-row items-center gap-8 border-b border-border/50 pb-8">
              <div className="relative group">
                <div className="w-28 h-28 bg-white rounded-[1.5rem] border-2 border-dashed border-border flex items-center justify-center overflow-hidden transition-all group-hover:border-brand/40 group-hover:bg-brand/5 shadow-inner">
                  {logoPreview ? (
                    <img src={logoPreview} alt="Logo" className="w-full h-full object-contain p-4 transition-transform group-hover:scale-105" />
                  ) : (
                    <div className="text-center space-y-2 opacity-30">
                       <Upload size={24} className="mx-auto" />
                       <span className="text-[10px] font-black uppercase">Logo</span>
                    </div>
                  )}
                </div>
                <label className="absolute -bottom-2 -right-2 p-2 bg-brand text-white rounded-xl shadow-lg cursor-pointer hover:bg-brand/90 transition-all hover:scale-110">
                  <Upload size={14} />
                  <input type="file" className="hidden" accept="image/*" onChange={handleLogoChange} />
                </label>
                {logoPreview && (
                  <button 
                    onClick={() => { setLogoPreview(null); setSettings(s => ({ ...s, header: { ...s.header, logoUrl: '' } })); }}
                    className="absolute -top-2 -right-2 p-1.5 bg-red-500 text-white rounded-lg shadow-lg hover:bg-red-600 transition-all"
                  >
                    <CloseIcon size={14} />
                  </button>
                )}
              </div>
              
              <div className="flex-1 space-y-4">
                <div>
                  <label className="text-[10px] font-black text-content-muted uppercase tracking-[0.2em] mb-2 block">رقم واتساب المبيعات</label>
                  <input 
                    type="text" 
                    value={settings.header.contactNumbers}
                    onChange={e => setSettings(s => ({ ...s, header: { ...s.header, contactNumbers: e.target.value } }))}
                    className="w-full bg-white border border-border/50 rounded-xl p-3 text-sm font-bold focus:ring-2 focus:ring-brand outline-none shadow-sm"
                    placeholder="9665XXXXXXXX"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-content-muted uppercase tracking-[0.2em] mb-2 block">اتجاه المحاذاة</label>
                  <div className="flex bg-white rounded-xl border border-border p-1.5 w-fit shadow-inner">
                    {[
                      { id: 'right', icon: AlignRight },
                      { id: 'center', icon: AlignCenter },
                      { id: 'left', icon: AlignLeft },
                    ].map(align => (
                      <button
                        key={align.id}
                        onClick={() => setSettings(s => ({ ...s, header: { ...s.header, alignment: align.id as any } }))}
                        className={cn(
                          "p-2.5 rounded-lg transition-all",
                          settings.header.alignment === align.id ? "bg-brand text-white shadow-lg shadow-brand/20" : "text-content-muted hover:bg-surface-muted"
                        )}
                      >
                        <align.icon size={20} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-content-muted uppercase tracking-[0.2em] px-1">العنوان المطبوع</label>
                <input 
                  type="text" 
                  value={settings.header.address}
                  onChange={e => setSettings(s => ({ ...s, header: { ...s.header, address: e.target.value } }))}
                  className="w-full bg-white border border-border/50 rounded-xl p-3.5 text-sm font-bold focus:ring-2 focus:ring-brand outline-none shadow-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-content-muted uppercase tracking-[0.2em] px-1">الرقم الضريبي للمنشأة</label>
                <input 
                  type="text" 
                  value={settings.header.taxId}
                  onChange={e => setSettings(s => ({ ...s, header: { ...s.header, taxId: e.target.value } }))}
                  className="w-full bg-white border border-border/50 rounded-xl p-3.5 text-sm font-black focus:ring-2 focus:ring-brand outline-none shadow-sm text-left tracking-widest"
                  dir="ltr"
                />
              </div>
            </div>
          </div>

          {/* Table Columns */}
          <div className="space-y-6 bg-surface-muted/30 p-8 rounded-[2.5rem] border border-border">
            <div className="flex items-center gap-3">
               <div className="p-2 bg-white rounded-lg shadow-sm text-brand">
                  <Layout size={18} />
               </div>
               <h4 className="font-black text-content uppercase tracking-widest text-xs">أعمدة وبنود الفاتورة</h4>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { id: 'showUnitPrice', label: 'عرض سعر الوحدة' },
                { id: 'showDiscount', label: 'إدراج عمود الخصم' },
                { id: 'showMeasurements', label: 'تفاصيل الخياطة المخصصة' },
                { id: 'showBarcode', label: 'باركود الطلب (تتبع)' },
              ].map(col => (
                <label key={col.id} className="flex items-center justify-between p-4 bg-white rounded-2xl border border-border/50 cursor-pointer hover:border-brand/30 hover:bg-brand/5 shadow-sm transition-all group">
                  <span className="text-sm font-bold text-content group-hover:text-brand">{col.label}</span>
                  <div className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="sr-only peer"
                      checked={(settings.columns as any)[col.id]}
                      onChange={(e) => setSettings(s => ({ ...s, columns: { ...s.columns, [col.id]: e.target.checked } }))}
                    />
                    <div className="w-12 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand"></div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="space-y-6 bg-surface-muted/30 p-8 rounded-[2.5rem] border border-border">
            <div className="flex items-center gap-3">
               <div className="p-2 bg-white rounded-lg shadow-sm text-brand">
                  <FileText size={18} />
               </div>
               <h4 className="font-black text-content uppercase tracking-widest text-xs">تذييل الفاتورة والسياسات</h4>
            </div>
            
            <div className="space-y-2">
              <label className="text-[10px] font-black text-content-muted uppercase tracking-[0.2em] px-1">سياسة الاستبدال والضمان</label>
              <textarea 
                rows={4}
                value={settings.footer.returnPolicy}
                onChange={e => setSettings(s => ({ ...s, footer: { ...s.footer, returnPolicy: e.target.value } }))}
                className="w-full bg-white border border-border/50 rounded-2xl p-6 text-xs font-medium focus:ring-2 focus:ring-brand outline-none resize-none leading-relaxed shadow-inner"
                placeholder="أدخل نص السياسة القانونية للفاتورة..."
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-[10px] font-black text-content-muted uppercase tracking-[0.2em] px-1">رسالة الختام</label>
              <input 
                type="text" 
                value={settings.footer.thankYouMessage}
                onChange={e => setSettings(s => ({ ...s, footer: { ...s.footer, thankYouMessage: e.target.value } }))}
                className="w-full bg-white border border-border/50 rounded-xl p-3.5 text-sm font-bold focus:ring-2 focus:ring-brand outline-none shadow-sm"
              />
            </div>

            <label className="flex items-center justify-between p-6 bg-surface-muted/50 rounded-[2rem] border border-dashed border-brand/20 cursor-pointer hover:bg-brand/5 transition-all">
              <div className="flex items-center gap-4">
                 <div className="p-3 bg-white rounded-2xl shadow-sm text-brand">
                    <Zap size={24} className="animate-pulse" />
                 </div>
                 <div>
                    <p className="font-black text-content text-sm">رمز الاستجابة السريع (ZATCA QR)</p>
                    <p className="text-[10px] text-content-muted font-medium">توافق تام مع المرحلة الثانية من الفوترة الإلكترونية</p>
                 </div>
              </div>
              <div className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  className="sr-only peer"
                  checked={settings.footer.showZatcaQr}
                  onChange={(e) => setSettings(s => ({ ...s, footer: { ...s.footer, showZatcaQr: e.target.checked } }))}
                />
                <div className="w-14 h-7 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand"></div>
              </div>
            </label>
          </div>
        </div>
      </div>

      {/* Live Preview Section */}
      <div className="w-full lg:w-1/2 bg-surface-muted/40 p-4 sm:p-10 flex flex-col items-center justify-start overflow-auto max-h-[900px] border-r border-border custom-scrollbar">
        <div className="bg-white/80 backdrop-blur-md px-6 py-2 rounded-full border border-border/50 flex items-center gap-2 mb-10 text-content-muted font-black uppercase tracking-widest text-[10px] sticky top-0 z-10 shadow-sm shadow-brand/5 whitespace-nowrap">
          <Eye size={12} className="text-brand" />
          <span>محاكاة حية للفاتورة المطبوعة</span>
        </div>

        {/* Invoice Paper Wrapper to handle scaling */}
        <div className={cn(
          "flex justify-center transition-all duration-500 w-full origin-top",
          settings.printSize === 'a4' ? "scale-[0.6] sm:scale-[0.75] md:scale-[0.8] lg:scale-[0.65] xl:scale-[0.75] 2xl:scale-90" : 
          settings.printSize === 'a5' ? "scale-[0.8] sm:scale-90 lg:scale-[0.8] xl:scale-95" : "scale-100"
        )}>
          {/* Invoice Paper */}
          <div 
            className={cn(
              "bg-white shadow-[0_35px_60px_-15px_rgba(0,0,0,0.1)] transition-all duration-500 relative border border-border/30 rounded-sm origin-top mb-10 xl:mb-20 flex-shrink-0",
              settings.printSize === 'thermal80' ? "w-[320px] p-6 text-[11px]" :
              settings.printSize === 'thermal58' ? "w-[240px] p-4 text-[9px]" :
              settings.printSize === 'a4' ? "w-[595px] min-h-[842px] p-12 text-sm" :
              "w-[420px] min-h-[595px] p-10 text-xs" // A5
            )}
            style={{ fontFamily: 'Inter, sans-serif' }}
          >
          {/* Header */}
          <div className={cn(
            "flex flex-col mb-10 border-b border-dashed border-gray-200 pb-8",
            settings.header.alignment === 'center' ? "items-center text-center" :
            settings.header.alignment === 'left' ? "items-end text-left" : "items-start text-right"
          )}>
            {settings.header.logoUrl && (
              <img src={settings.header.logoUrl} alt="Logo" className="w-20 h-20 object-contain mb-4 filter drop-shadow-sm" />
            )}
            <h1 className="font-black text-xl text-gray-900 tracking-tight">{settings.header.facilityName || 'اسم المتجر الافتراضي'}</h1>
            {settings.header.address && <p className="text-gray-500 mt-2 font-medium">{settings.header.address}</p>}
            {settings.header.contactNumbers && <p className="text-gray-500 font-medium">واتساب: {settings.header.contactNumbers}</p>}
            {settings.header.taxId && settings.layoutTemplate === 'tax' && (
              <p className="text-gray-800 font-black mt-2 bg-gray-50 px-2 py-0.5 rounded">الرقم الضريبي: {settings.header.taxId}</p>
            )}
            
            {settings.layoutTemplate === 'tax' && (
              <div className="mt-6 text-[10px] text-gray-900 font-black border-2 border-gray-900 px-4 py-1.5 rounded uppercase tracking-tighter">
                فاتورة ضريبية مبسطة
              </div>
            )}
          </div>

          {/* Items Table */}
          <div className="overflow-x-auto whitespace-nowrap scrollbar-hide mb-8">
            <table className="w-full border-collapse min-w-max">
            <thead>
              <tr className="border-b-2 border-gray-900">
                <th className="text-right py-3 font-black text-gray-900 uppercase tracking-tighter text-[10px]">الوصف</th>
                <th className="text-center py-3 font-black text-gray-900 uppercase tracking-tighter text-[10px]">الكمية</th>
                {settings.columns.showUnitPrice && <th className="text-center py-3 font-black text-gray-900 uppercase tracking-tighter text-[10px]">السعر</th>}
                <th className="text-left py-3 font-black text-gray-900 uppercase tracking-tighter text-[10px]">المجموع</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-100 pb-2">
                <td className="py-4">
                  <div className="font-black text-gray-900 text-sm">تفصيل قماش ياباني</div>
                  {settings.columns.showMeasurements && settings.layoutTemplate === 'detailed' && (
                    <div className="text-gray-400 mt-1 font-medium italic">
                      طول: 155, كتف: 48, صدر: 58
                    </div>
                  )}
                </td>
                <td className="text-center py-4 font-bold">1</td>
                {settings.columns.showUnitPrice && <td className="text-center py-4 text-gray-600">350.00</td>}
                <td className="text-left py-4 font-black">350.00</td>
              </tr>
            </tbody>
          </table>
          </div>

          {/* Totals */}
          <div className="border-t-2 border-gray-900 pt-6 mb-10 space-y-3">
            <div className="flex justify-between text-gray-600 font-medium">
              <span>المجموع الفرعي:</span>
              <span>350.00 ر.س</span>
            </div>
            {settings.layoutTemplate === 'tax' && (
              <div className="flex justify-between text-gray-600 font-medium border-b border-dashed border-gray-100 pb-2">
                <span>الضريبة (15%):</span>
                <span>52.50 ر.س</span>
              </div>
            )}
            <div className="flex justify-between text-xl font-black text-gray-900 py-2 bg-gray-50 px-4 rounded-xl">
              <span>الإجمالي العام:</span>
              <span>402.50 ر.س</span>
            </div>
          </div>

          {/* Footer */}
          <div className="text-center space-y-6">
            {settings.footer.returnPolicy && (
              <div className="text-gray-400 text-[10px] leading-relaxed border-t border-gray-100 pt-6">
                <p className="font-black text-gray-600 mb-2 uppercase tracking-widest">ملاحظات وشروط:</p>
                <p className="whitespace-pre-wrap px-4">{settings.footer.returnPolicy}</p>
              </div>
            )}
            
            {settings.footer.thankYouMessage && (
              <p className="font-black text-gray-900 text-base italic tracking-tight">{settings.footer.thankYouMessage}</p>
            )}

            <div className="flex flex-col items-center gap-6 mt-8">
              {settings.columns.showBarcode && (
                <div className="w-full flex flex-col items-center gap-1 opacity-60">
                   <div className="w-4/5 h-10 bg-gray-100 flex items-center justify-center font-barcode text-3xl">
                    10042-2024
                   </div>
                   <span className="text-[8px] font-black tracking-[0.5em]">#ORD-10042</span>
                </div>
              )}

              {settings.footer.showZatcaQr && (
                <div className="p-2 border-2 border-gray-100 rounded-2xl group transition-transform hover:scale-110">
                   <div className="w-28 h-28 bg-gray-100 flex items-center justify-center text-gray-300 text-[10px] font-black uppercase tracking-tighter shadow-inner">
                    QR SECURE
                  </div>
                </div>
              )}
            </div>

            <div className="pt-8 mt-10 border-t border-gray-100">
              <Branding className="scale-75 opacity-20 grayscale brightness-0" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);
}
