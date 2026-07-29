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
  Eye,
  CheckCircle2
} from 'lucide-react';
import Branding from './Branding';
import { ThermalInvoice, StandardInvoice, InvoiceData, InvoiceLayoutSettingsType } from './printing/InvoiceReceipt';

interface InvoiceLayoutSettingsProps {
  tenantId: string;
}

export default function InvoiceLayoutSettings({ tenantId }: InvoiceLayoutSettingsProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<'controls' | 'preview'>('controls');

  const [settings, setSettings] = useState(() => {
    const defaultSettings = {
      printSize: 'thermal80',
      layoutTemplate: 'classic',
      fastThermalMode: localStorage.getItem('pos_fast_thermal_mode') === 'true',
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
    };
    try {
      const stored = localStorage.getItem('pos_invoice_settings');
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          ...defaultSettings,
          ...parsed,
          header: { ...defaultSettings.header, ...(parsed.header || {}) },
          columns: { ...defaultSettings.columns, ...(parsed.columns || {}) },
          footer: { ...defaultSettings.footer, ...(parsed.footer || {}) },
          fastThermalMode: parsed.fastThermalMode ?? defaultSettings.fastThermalMode
        };
      }
    } catch {
      /* ignore */
    }
    return defaultSettings;
  });

  useEffect(() => {
    const fetchSettings = async () => {
      let activeTenantId = tenantId;
      if (!activeTenantId || activeTenantId === 'saas_management') {
        const storedId = localStorage.getItem('tenant_id') || localStorage.getItem('current_tenant_id');
        if (storedId && storedId !== 'saas_management') {
          activeTenantId = storedId;
        }
      }

      if (!activeTenantId || activeTenantId === 'saas_management') {
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('tenants')
          .select('*')
          .eq('id', activeTenantId)
          .single();

        if (data && !error) {
          if (data.invoice_settings) {
            const mergedSettings = {
              ...data.invoice_settings,
              fastThermalMode: data.invoice_settings.fastThermalMode ?? (localStorage.getItem('pos_fast_thermal_mode') === 'true')
            };
            setSettings(mergedSettings);
            localStorage.setItem('pos_invoice_settings', JSON.stringify(mergedSettings));
            if (data.invoice_settings.header?.logoUrl) {
              setLogoPreview(data.invoice_settings.header.logoUrl);
            }
          } else {
            setSettings(prev => {
              const updated = {
                ...prev,
                header: {
                  ...prev.header,
                  facilityName: prev.header.facilityName || data.name || '',
                  contactNumbers: prev.header.contactNumbers || data.phone || '',
                  address: prev.header.address || data.address || '',
                  logoUrl: prev.header.logoUrl || data.logo_url || ''
                }
              };
              localStorage.setItem('pos_invoice_settings', JSON.stringify(updated));
              return updated;
            });
            if (data.logo_url) setLogoPreview(data.logo_url);
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

  const [saveSuccess, setSaveSuccess] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      // 1. Save locally FIRST so settings update immediately and persist across sessions
      localStorage.setItem('pos_invoice_settings', JSON.stringify(settings));
      localStorage.setItem('pos_fast_thermal_mode', String(settings.fastThermalMode));

      // Dispatch custom events for live listener sync across app
      window.dispatchEvent(new CustomEvent('tenant_settings_updated'));
      window.dispatchEvent(new CustomEvent('invoice_settings_updated', { detail: settings }));
      window.dispatchEvent(new CustomEvent('fast_thermal_mode_changed', { detail: settings.fastThermalMode }));

      // 2. Try to save to Supabase tenant record if valid ID is found
      let activeTenantId = tenantId;
      if (!activeTenantId || activeTenantId === 'saas_management') {
        const storedId = localStorage.getItem('tenant_id') || localStorage.getItem('current_tenant_id');
        if (storedId && storedId !== 'saas_management') {
          activeTenantId = storedId;
        }
      }

      if (activeTenantId && activeTenantId !== 'saas_management') {
        const { error } = await supabase
          .from('tenants')
          .update({
            invoice_settings: settings
          })
          .eq('id', activeTenantId);

        if (error) {
          console.warn('[InvoiceLayoutSettings] Could not sync to Supabase server:', error);
        }
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3500);
    } catch (error) {
      console.error('[InvoiceLayoutSettings] Save error:', error);
      // Still notify success locally
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3500);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const previewInvoiceData: InvoiceData = {
    invoiceNumber: 'INV-2026-00042',
    issueDate: new Date().toISOString(),
    seller: {
      name: settings.header.facilityName || 'متجر التجربة الافتراضي',
      vatNumber: settings.header.taxId || '300012345600003',
      address: settings.header.address || 'شارع العليا العام، الرياض، المملكة العربية السعودية',
      phone: settings.header.contactNumbers || ''
    },
    customer: {
      name: 'سليمان بن عبد العزيز',
      vatNumber: '300011122200003'
    },
    items: [
      {
        id: 'item-1',
        name: 'تفصيل ثوب سعودي ياباني فاخر',
        quantity: 1,
        unitPrice: 350.00
      }
    ],
    subtotal: 350.00,
    discountAmount: settings.columns.showDiscount ? 20.00 : 0,
    vatAmount: (settings.columns.showDiscount ? 330.00 : 350.00) * 0.15,
    grandTotal: (settings.columns.showDiscount ? 330.00 : 350.00) * 1.15,
    qrValue: settings.footer.showZatcaQr ? 'https://zatca.gov.sa' : '',
    invoiceType: settings.layoutTemplate === 'tax' ? 'simplified_tax' : 'standard_b2b',
    paidAmount: (settings.columns.showDiscount ? 330.00 : 350.00) * 1.15,
    remainingAmount: 0.00,
    branchName: 'الفرع الرئيسي',
    sellerName: 'عبد الله محمد'
  };

  return (
    <div className="bg-surface rounded-2xl lg:rounded-3xl border border-border shadow-xl shadow-brand/5 overflow-hidden flex flex-col xl:flex-row min-h-[750px] w-full" dir="rtl">
      {/* Mobile/Tablet Switcher (< xl) */}
      <div className="xl:hidden flex items-center p-1.5 bg-surface-muted rounded-2xl border border-border m-3 sm:m-4 mb-0 sm:mb-0">
        <button
          type="button"
          onClick={() => setMobileTab('controls')}
          className={cn(
            "flex-1 py-2.5 px-3 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer",
            mobileTab === 'controls' ? "bg-brand text-white shadow-md shadow-brand/10" : "text-content-muted hover:text-content"
          )}
        >
          <FileText size={16} />
          <span>خيارات التخطيط</span>
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('preview')}
          className={cn(
            "flex-1 py-2.5 px-3 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer",
            mobileTab === 'preview' ? "bg-brand text-white shadow-md shadow-brand/10" : "text-content-muted hover:text-content"
          )}
        >
          <Eye size={16} />
          <span>المعاينة المباشرة</span>
        </button>
      </div>

      {/* Controls Section */}
      <div className={cn(
        "w-full xl:w-1/2 p-4 sm:p-6 lg:p-8 border-b xl:border-b-0 xl:border-l border-border overflow-y-auto max-h-[850px] space-y-6 sm:space-y-8 custom-scrollbar",
        mobileTab === 'controls' ? "block" : "hidden xl:block"
      )}>
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-center sm:text-right">
            <h2 className="text-xl sm:text-2xl font-black text-content flex items-center justify-center sm:justify-start gap-2.5">
              <div className="p-2 bg-brand/10 text-brand rounded-xl shrink-0">
                <FileText size={22} />
              </div>
              <span>تخطيط الفاتورة الاحترافية</span>
            </h2>
            <p className="text-content-muted text-xs sm:text-sm font-medium mt-1">صمم مظهر فواتيرك بما يتناسب مع هوية متجرك</p>
          </div>
          <button 
            onClick={handleSave}
            disabled={saving}
            className={cn(
              "w-full sm:w-auto text-white px-6 py-3 rounded-xl font-black transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 hover:scale-102 active:scale-98 cursor-pointer text-sm",
              saveSuccess ? "bg-emerald-600 shadow-emerald-500/20" : "bg-brand hover:bg-brand/90 shadow-brand/20"
            )}
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : saveSuccess ? (
              <CheckCircle2 size={18} />
            ) : (
              <Save size={18} />
            )}
            <span>{saving ? 'جاري الحفظ...' : saveSuccess ? 'تم الحفظ بنجاح' : 'اعتماد التصميم'}</span>
          </button>
        </div>

        {/* 1. Hardware & Format */}
        <div className="space-y-6">
          <div className="flex items-center gap-2 group">
             <div className="w-1.5 h-6 bg-brand rounded-full transition-all group-hover:h-8" />
             <h3 className="text-lg font-black text-content uppercase tracking-tight">1. الإخراج والطباعة</h3>
          </div>
          
          <div className="space-y-4 bg-surface-muted/50 p-4 sm:p-6 rounded-2xl md:rounded-[2rem] border border-border">
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
                        ? "border-brand bg-brand/5 text-brand shadow-lg shadow-brand/5" 
                        : "border-border bg-white text-content-muted hover:border-brand/30"
                    )}
                  >
                    <span className="text-sm font-black group-hover:text-brand">{template.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Fast Thermal Print Mode Toggle */}
            <div className="pt-2 border-t border-border/50">
              <label className="flex items-center justify-between p-3 sm:p-4 bg-amber-500/5 rounded-2xl border border-amber-500/20 cursor-pointer hover:bg-amber-500/10 transition-all gap-3 sm:gap-4">
                <div className="flex items-start gap-3 text-right min-w-0">
                  <div className="p-2.5 bg-amber-500 text-white rounded-xl shrink-0 shadow-sm">
                    <Zap size={20} className="animate-pulse" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-black text-content text-xs sm:text-sm">الوضع السريع للطباعة الحرارية (80mm)</p>
                      <span className="text-[9px] bg-amber-500/10 text-amber-700 px-2 py-0.5 rounded-full font-black border border-amber-500/20">
                        توفير الورق
                      </span>
                    </div>
                    <p className="text-[10px] text-content-muted font-medium mt-0.5">
                      يقوم آلياً بضغط فواتير المبيعات وتقليل المسافات لتناسب طابعات الكاشير 80mm بسرعة فائقة
                    </p>
                  </div>
                </div>
                <div className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input 
                    type="checkbox" 
                    className="sr-only peer"
                    checked={settings.fastThermalMode}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setSettings(s => ({ ...s, fastThermalMode: checked }));
                      localStorage.setItem('pos_fast_thermal_mode', String(checked));
                      window.dispatchEvent(new CustomEvent('fast_thermal_mode_changed', { detail: checked }));
                    }}
                  />
                  <div className="w-12 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-600"></div>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* 2. Header and Logo */}
        <div className="space-y-6">
          <div className="flex items-center gap-2 group">
             <div className="w-1.5 h-6 bg-brand rounded-full transition-all group-hover:h-8" />
             <h3 className="text-lg font-black text-content uppercase tracking-tight">2. ترويسة ومحتوى الفاتورة</h3>
          </div>
          
          <div className="space-y-6 bg-surface-muted/50 p-4 sm:p-8 rounded-2xl sm:rounded-[2.5rem] border border-border">
            <div className="flex flex-col sm:flex-row items-center gap-6 sm:gap-8 border-b border-border/50 pb-6 sm:pb-8">
              <div className="relative w-28 h-28 bg-white border-2 border-dashed border-border rounded-3xl flex items-center justify-center overflow-hidden group hover:border-brand transition-all shadow-inner">
                {logoPreview ? (
                  <img src={logoPreview} alt="Logo Preview" className="w-full h-full object-contain p-2" />
                ) : (
                  <div className="text-center p-4">
                    <Upload size={20} className="mx-auto text-content-muted mb-2 group-hover:text-brand transition-all" />
                    <span className="text-[9px] font-black text-content-muted tracking-tighter">شعار المتجر</span>
                  </div>
                )}
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
              
              <div className="flex-1 space-y-4 w-full">
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
                  <label className="text-[10px] font-black text-content-muted uppercase tracking-[0.2em] mb-2 block text-center sm:text-right">اتجاه المحاذاة</label>
                  <div className="flex bg-white rounded-xl border border-border p-1.5 w-fit shadow-inner mx-auto sm:mx-0">
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

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-content-muted uppercase tracking-[0.2em] px-1">اسم المنشأة / المتجر المطبوع</label>
                <input 
                  type="text" 
                  value={settings.header.facilityName}
                  onChange={e => setSettings(s => ({ ...s, header: { ...s.header, facilityName: e.target.value } }))}
                  placeholder="أدخل اسم المتجر أو المنشأة المطبوع بالفاتورة"
                  className="w-full bg-white border border-border/50 rounded-xl p-3.5 text-sm font-bold focus:ring-2 focus:ring-brand outline-none shadow-sm"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-content-muted uppercase tracking-[0.2em] px-1">العنوان المطبوع يدويًا (مُخصص)</label>
                  <input 
                    type="text" 
                    value={settings.header.address}
                    onChange={e => setSettings(s => ({ ...s, header: { ...s.header, address: e.target.value } }))}
                    placeholder="أدخل العنوان المطبوع المختصر لتجنب طول الترويسة"
                    className="w-full bg-white border border-border/50 rounded-xl p-3.5 text-sm font-bold focus:ring-2 focus:ring-brand outline-none shadow-sm"
                  />
                  <p className="text-[11px] text-content-muted px-1">يمكنك إدخال عنوان مختصر هنا لطباعته في الفاتورة بدلاً من العنوان الرئيسي الطويل.</p>
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
          </div>

          {/* Table Columns */}
          <div className="space-y-6 bg-surface-muted/30 p-4 sm:p-8 rounded-2xl sm:rounded-[2.5rem] border border-border">
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
          <div className="space-y-6 bg-surface-muted/30 p-4 sm:p-8 rounded-2xl sm:rounded-[2.5rem] border border-border">
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
                className="w-full bg-white border border-border/50 rounded-2xl p-4 sm:p-6 text-xs font-medium focus:ring-2 focus:ring-brand outline-none resize-none leading-relaxed shadow-inner"
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

            <label className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between p-4 sm:p-6 bg-surface-muted/50 rounded-2xl sm:rounded-[2rem] border border-dashed border-brand/20 cursor-pointer hover:bg-brand/5 transition-all gap-4">
              <div className="flex items-center gap-4 text-right">
                 <div className="p-3 bg-white rounded-2xl shadow-sm text-brand shrink-0">
                    <Zap size={24} className="animate-pulse" />
                 </div>
                 <div>
                    <p className="font-black text-content text-sm">رمز الاستجابة السريع (ZATCA QR)</p>
                    <p className="text-[10px] text-content-muted font-medium">توافق تام مع المرحلة الثانية من الفوترة الإلكترونية</p>
                 </div>
              </div>
              <div className="flex justify-end sm:justify-start">
                <div className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    className="sr-only peer"
                    checked={settings.footer.showZatcaQr}
                    onChange={(e) => setSettings(s => ({ ...s, footer: { ...s.footer, showZatcaQr: e.target.checked } }))}
                  />
                  <div className="w-14 h-7 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand"></div>
                </div>
              </div>
            </label>
          </div>
        </div>
      </div>

      {/* Live Preview Section */}
      <div className={cn(
        "w-full xl:w-1/2 bg-surface-muted/40 p-4 sm:p-8 flex flex-col items-center justify-start overflow-auto max-h-[850px] border-t xl:border-t-0 border-border custom-scrollbar",
        mobileTab === 'preview' ? "flex" : "hidden xl:flex"
      )}>
        <div className="bg-white/80 backdrop-blur-md px-6 py-2 rounded-full border border-border/50 flex items-center gap-2 mb-6 sm:mb-10 text-content-muted font-black uppercase tracking-widest text-[10px] sticky top-0 z-10 shadow-sm shadow-brand/5 whitespace-nowrap">
          <Eye size={12} className="text-brand" />
          <span>محاكاة حية للفاتورة المطبوعة</span>
        </div>

        {/* Invoice Paper Wrapper to handle scaling */}
        <div className={cn(
          "flex justify-center transition-all duration-500 w-full origin-top mb-10 xl:mb-20 overflow-x-auto",
          settings.printSize === 'a4' ? "scale-[0.45] xs:scale-[0.5] sm:scale-[0.6] md:scale-[0.7] lg:scale-[0.45] xl:scale-[0.6] 2xl:scale-[0.7]" : 
          settings.printSize === 'a5' ? "scale-[0.55] xs:scale-[0.6] sm:scale-[0.7] lg:scale-[0.55] xl:scale-[0.7]" : "scale-100"
        )}>
          {['thermal80', 'thermal58'].includes(settings.printSize) ? (
            <ThermalInvoice 
              data={previewInvoiceData} 
              size={settings.printSize === 'thermal58' ? '58mm' : '80mm'} 
              settings={settings as unknown as InvoiceLayoutSettingsType} 
            />
          ) : (
            <StandardInvoice 
              data={previewInvoiceData} 
              size={settings.printSize === 'a5' ? 'A5' : 'A4'} 
              settings={settings as unknown as InvoiceLayoutSettingsType} 
            />
          )}
        </div>
      </div>
    </div>
  );
}
