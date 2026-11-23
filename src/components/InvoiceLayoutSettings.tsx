import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useVerticalConfig } from '../hooks/useVerticalConfig';
import { supabase } from '../lib/supabase/client';
import { handleError, OperationType } from '../lib/appErrors';
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

import { isRtlLang } from '../lib/direction';
import { useToast } from '../contexts/ToastContext';

interface InvoiceLayoutSettingsProps {
  tenantId: string;
}

// tsconfig `strict` (seen-cto-sprint4-design-quality-task.md item 2):
// the settings useState initializer below spreads JSON.parse's `any`
// result into its returned object, which widened the whole state's
// inferred type to `any` -- every setSettings(prev => ...)/setSettings(s
// => ...) callback below then had an implicit-any `prev`/`s` parameter.
// Matches this component's actual field set/enums, not the narrower
// InvoiceLayoutSettingsType shared with InvoiceReceipt.tsx (missing
// printSize, and a different layoutTemplate union there).
interface InvoiceSettings {
  printSize: 'thermal80' | 'thermal58' | 'a4' | 'a5';
  layoutTemplate: 'classic' | 'detailed' | 'tax';
  fastThermalMode: boolean;
  header: {
    logoUrl: string;
    facilityName: string;
    contactNumbers: string;
    address: string;
    taxId: string;
    alignment: 'right' | 'left' | 'center';
    logoBorder: boolean;
  };
  columns: {
    showUnitPrice: boolean;
    showDiscount: boolean;
    showMeasurements: boolean;
    showBarcode: boolean;
    showCustomerName: boolean;
    /** Each line's specs in the shop's own fields (Phase 3); on by default. */
    showItemSpecs?: boolean;
  };
  footer: {
    returnPolicy: string;
    thankYouMessage: string;
    showZatcaQr: boolean;
  };
}

export default function InvoiceLayoutSettings({ tenantId }: InvoiceLayoutSettingsProps) {
  const { t, i18n } = useTranslation();
  const { isLegacyVertical, orderItemFields } = useVerticalConfig();
  const { error: toastError } = useToast();
  const isRtl = isRtlLang(i18n.language);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<'controls' | 'preview'>('controls');

  const [settings, setSettings] = useState<InvoiceSettings>(() => {
    const defaultSettings: InvoiceSettings = {
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
        logoBorder: true,
      },
      columns: {
        showUnitPrice: true,
        showDiscount: true,
        showMeasurements: false,
        showBarcode: true,
        showCustomerName: true,
        showItemSpecs: true,
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
        toastError(t('settings_page.invoice.logo_too_large_error'));
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
      name: settings.header.facilityName || t('settings_page.invoice.preview_store_name'),
      vatNumber: settings.header.taxId || '300012345600003',
      address: settings.header.address || t('settings_page.invoice.preview_address'),
      phone: settings.header.contactNumbers || ''
    },
    customer: {
      name: t('settings_page.invoice.preview_customer_name'),
      vatNumber: '300011122200003'
    },
    items: [
      {
        id: 'item-1',
        name: t('settings_page.invoice.preview_item_name'),
        quantity: 1,
        unitPrice: 350.00,
        measurements: [
          { label: t('measurements.length'), value: 145 },
          { label: t('measurements.chest'), value: 52 },
          { label: t('measurements.shoulder'), value: 46 },
          { label: t('measurements.sleeve'), value: 62 },
        ]
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
    branchName: t('branches.master'),
    sellerName: t('settings_page.invoice.preview_seller_name')
  };

  return (
    <div className="bg-surface rounded-2xl main-900:rounded-3xl border border-border shadow-xl shadow-brand/5 overflow-hidden flex flex-col main-1280:flex-row min-h-[750px] w-full" dir={isRtl ? "rtl" : "ltr"}>
      {/* Mobile/Tablet Switcher (< 2xl) */}
      <div className="main-1280:hidden flex items-center p-1.5 bg-surface-muted rounded-2xl border border-border m-3 main-640:m-4 mb-0 main-640:mb-0">
        <button
          type="button"
          onClick={() => setMobileTab('controls')}
          className={cn(
            "flex-1 py-2.5 px-3 rounded-xl text-sm font-black transition-all flex items-center justify-center gap-2 cursor-pointer",
            mobileTab === 'controls' ? "bg-brand text-white shadow-md shadow-brand/10" : "text-content-muted hover:text-content"
          )}
        >
          <FileText size={16} />
          <span>{t('settings_page.invoice.layout_options')}</span>
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('preview')}
          className={cn(
            "flex-1 py-2.5 px-3 rounded-xl text-sm font-black transition-all flex items-center justify-center gap-2 cursor-pointer",
            mobileTab === 'preview' ? "bg-brand text-white shadow-md shadow-brand/10" : "text-content-muted hover:text-content"
          )}
        >
          <Eye size={16} />
          <span>{t('settings_page.invoice.live_preview')}</span>
        </button>
      </div>

      {/* Controls Section */}
      <div className={cn(
        "w-full main-1280:w-1/2 p-4 main-640:p-6 main-900:p-8 border-b main-1280:border-b-0 main-1280:border-l border-border overflow-y-auto max-h-[850px] space-y-6 main-640:space-y-8 custom-scrollbar",
        mobileTab === 'controls' ? "block" : "hidden main-1280:block"
      )}>
        <div className="flex flex-col main-640:flex-row items-center justify-between gap-4">
          <div className={cn("text-center", isRtl ? "main-640:text-right" : "main-640:text-left")}>
            <h2 className="text-xl main-640:text-2xl font-black text-content flex items-center justify-center main-640:justify-start gap-2.5">
              <div className="p-2 bg-brand/10 text-brand rounded-xl shrink-0">
                <FileText size={22} />
              </div>
              <span>{t('settings_page.invoice.title')}</span>
            </h2>
            <p className="text-content-muted text-sm font-medium mt-1">{t('settings_page.invoice.subtitle')}</p>
          </div>
          <button 
            onClick={handleSave}
            disabled={saving}
            className={cn(
              "w-full main-640:w-auto text-white px-6 py-3 rounded-xl font-black transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 hover:scale-102 active:scale-98 cursor-pointer text-sm",
              saveSuccess ? "bg-success shadow-success/20" : "bg-brand hover:bg-brand/90 shadow-brand/20"
            )}
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : saveSuccess ? (
              <CheckCircle2 size={18} />
            ) : (
              <Save size={18} />
            )}
            <span>{saving ? t('settings_page.invoice.saving') : saveSuccess ? t('settings_page.invoice.save_success') : t('settings_page.invoice.apply_design')}</span>
          </button>
        </div>

        {/* 1. Hardware & Format */}
        <div className="space-y-6">
          <div className="flex items-center gap-2 group">
             <div className="w-1.5 h-6 bg-brand rounded-full transition-all group-hover:h-8" />
             <h3 className="text-lg font-black text-content uppercase">{t('settings_page.invoice.section1_title')}</h3>
          </div>
          
          <div className="space-y-4 bg-surface-muted/50 p-4 main-640:p-6 rounded-2xl border border-border">
            <div className="space-y-3">
              <label className="text-sm font-black text-content-muted px-1">{t('settings_page.invoice.paper_size')}</label>
              <div className="grid grid-cols-2 main-640:grid-cols-4 gap-3">
                {[
                  { id: 'thermal80' as const, label: t('settings_page.invoice.thermal80') },
                  { id: 'thermal58' as const, label: t('settings_page.invoice.thermal58') },
                  { id: 'a4' as const, label: 'A4' },
                  { id: 'a5' as const, label: 'A5' },
                ].map(size => (
                  <button
                    key={size.id}
                    onClick={() => setSettings(s => ({ ...s, printSize: size.id }))}
                    className={cn(
                      "py-3 px-3 rounded-xl text-sm font-black transition-all border-2",
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
              <label className="text-sm font-black text-content-muted px-1">{t('settings_page.invoice.layout_template')}</label>
              <div className="grid grid-cols-1 main-640:grid-cols-3 gap-4">
                {[
                  { id: 'classic' as const, label: t('settings_page.invoice.classic') },
                  { id: 'detailed' as const, label: t('settings_page.invoice.detailed') },
                  { id: 'tax' as const, label: t('settings_page.invoice.tax') },
                ].map(template => (
                  <button
                    key={template.id}
                    onClick={() => setSettings(s => ({ ...s, layoutTemplate: template.id }))}
                    className={cn(
                      "group py-4 px-4 rounded-xl text-sm font-black transition-all border-2 flex flex-col items-center gap-3",
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
              <label className="flex items-center justify-between p-3 main-640:p-4 bg-warning/5 rounded-2xl border border-warning/20 cursor-pointer hover:bg-warning/10 transition-all gap-3 main-640:gap-4">
                <div className={cn("flex items-start gap-3 min-w-0", isRtl ? "text-right" : "text-left")}>
                  <div className="p-2.5 bg-warning text-white rounded-xl shrink-0 shadow-sm">
                    <Zap size={20} className="animate-pulse" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-black text-content text-sm">{t('settings_page.invoice.fast_thermal')}</p>
                      <span className="text-sm bg-[var(--seen-warning-bg)] text-warning peer peer-checked:after:translate-x-full peer-checked:after:border-white px-2 py-0.5 rounded-full font-black border border-warning/20">
                        {t('settings_page.invoice.paper_saving')}
                      </span>
                    </div>
                    <p className="text-sm text-content-muted font-medium mt-0.5">
                      {t('settings_page.invoice.fast_thermal_desc')}
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
                  <div className="w-12 h-6 bg-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[3px] after:start-[3px] after:bg-white after:border-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-warning"></div>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* 2. Header and Logo */}
        <div className="space-y-6">
          <div className="flex items-center gap-2 group">
             <div className="w-1.5 h-6 bg-brand rounded-full transition-all group-hover:h-8" />
             <h3 className="text-lg font-black text-content uppercase">{t('settings_page.invoice.section2_title')}</h3>
          </div>
          
          <div className="space-y-6 bg-surface-muted/50 p-4 main-640:p-8 rounded-2xl border border-border">
            <div className="flex flex-col main-640:flex-row items-center gap-6 main-640:gap-8 border-b border-border/50 pb-6 main-640:pb-8">
              <div className="relative w-28 h-28 bg-white border-2 border-dashed border-border rounded-3xl flex items-center justify-center overflow-hidden group hover:border-brand transition-all shadow-inner">
                {logoPreview ? (
                  <img src={logoPreview} alt="Logo Preview" className="w-full h-full object-contain p-2" />
                ) : (
                  <div className="text-center p-4">
                    <Upload size={20} className="mx-auto text-content-muted mb-2 group-hover:text-brand transition-all" />
                    <span className="text-sm font-black text-content-muted">{t('settings_page.invoice.store_logo')}</span>
                  </div>
                )}
                <label className="absolute -bottom-2 -right-2 p-2 bg-brand text-white rounded-xl shadow-lg cursor-pointer hover:bg-brand/90 transition-all hover:scale-110">
                  <Upload size={14} />
                  <input type="file" className="hidden" accept="image/*" onChange={handleLogoChange} />
                </label>
                {logoPreview && (
                  <button 
                    onClick={() => { setLogoPreview(null); setSettings(s => ({ ...s, header: { ...s.header, logoUrl: '' } })); }}
                    className="absolute -top-2 -right-2 p-1.5 bg-danger text-white rounded-lg shadow-lg hover:bg-danger/90 transition-all"
                  >
                    <CloseIcon size={14} />
                  </button>
                )}
              </div>
              
              <div className="flex-1 space-y-4 w-full">
                <div>
                  <label className="text-sm font-black text-content-muted mb-2 block">{t('settings_page.invoice.whatsapp_number')}</label>
                  <input 
                    type="text" 
                    value={settings.header.contactNumbers}
                    onChange={e => setSettings(s => ({ ...s, header: { ...s.header, contactNumbers: e.target.value } }))}
                    className="w-full bg-white border border-border rounded-xl p-3 text-sm font-bold outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand shadow-sm"
                    placeholder="9665XXXXXXXX"
                  />
                </div>
                <div>
                  <label className={cn("text-sm font-black text-content-muted mb-2 block text-center", isRtl ? "main-640:text-right" : "main-640:text-left")}>{t('settings_page.invoice.alignment_dir')}</label>
                  <div className="flex bg-white rounded-xl border border-border p-1.5 w-fit shadow-inner mx-auto main-640:mx-0">
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
                <label className="flex items-center justify-between p-3 bg-white rounded-xl border border-border/50 cursor-pointer hover:border-brand/30 shadow-sm transition-all gap-3">
                  <span className="text-sm font-bold text-content">{t('settings_page.invoice.logo_border')}</span>
                  <div className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={settings.header.logoBorder}
                      onChange={(e) => setSettings(s => ({ ...s, header: { ...s.header, logoBorder: e.target.checked } }))}
                    />
                    <div className="w-12 h-6 bg-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:start-[4px] after:bg-white after:border-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand"></div>
                  </div>
                </label>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-black text-content-muted px-1">{t('settings_page.invoice.facility_name')}</label>
                <input 
                  type="text" 
                  value={settings.header.facilityName}
                  onChange={e => setSettings(s => ({ ...s, header: { ...s.header, facilityName: e.target.value } }))}
                  placeholder={t('settings_page.invoice.facility_name_placeholder')}
                  className="w-full bg-white border border-border rounded-xl p-3.5 text-sm font-bold outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand shadow-sm"
                />
              </div>

              <div className="grid grid-cols-1 main-720:grid-cols-2 gap-4 main-720:gap-6">
                <div className="space-y-1.5">
                  <label className="text-sm font-black text-content-muted px-1">{t('settings_page.invoice.custom_address')}</label>
                  <input 
                    type="text" 
                    value={settings.header.address}
                    onChange={e => setSettings(s => ({ ...s, header: { ...s.header, address: e.target.value } }))}
                    placeholder={t('settings_page.invoice.custom_address_placeholder')}
                    className="w-full bg-white border border-border rounded-xl p-3.5 text-sm font-bold outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand shadow-sm"
                  />
                  <p className="text-sm text-content-muted px-1">{t('settings_page.invoice.custom_address_help')}</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-black text-content-muted px-1">{t('settings_page.invoice.tax_id')}</label>
                  <input 
                    type="text" 
                    value={settings.header.taxId}
                    onChange={e => setSettings(s => ({ ...s, header: { ...s.header, taxId: e.target.value } }))}
                    className="w-full bg-white border border-border rounded-xl p-3.5 text-sm font-black outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand shadow-sm text-left"
                    dir="ltr"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Table Columns */}
          <div className="space-y-6 bg-surface-muted/30 p-4 main-640:p-8 rounded-2xl border border-border">
            <div className="flex items-center gap-3">
               <div className="p-2 bg-white rounded-lg shadow-sm text-brand">
                  <Layout size={18} />
               </div>
               <h4 className="font-black text-content uppercase text-sm">{t('settings_page.invoice.columns_title')}</h4>
            </div>
            <div className="grid grid-cols-1 main-720:grid-cols-2 gap-4">
              {[
                { id: 'showUnitPrice', label: t('settings_page.invoice.col_unit_price') },
                { id: 'showDiscount', label: t('settings_page.invoice.col_discount') },
                { id: 'showMeasurements', label: t('settings_page.invoice.col_measurements') },
                { id: 'showBarcode', label: t('settings_page.invoice.col_barcode') },
                { id: 'showCustomerName', label: t('settings_page.invoice.col_customer_name') },
                // Only a vertical with its own line fields has specs to print
                // (seen-verticals-readiness-task.md Phase 3) -- men's tailoring
                // keeps exactly its current options.
                ...(!isLegacyVertical && orderItemFields.length > 0
                  ? [{ id: 'showItemSpecs', label: t('settings_page.invoice.col_item_specs', 'إظهار مواصفات الصنف') }]
                  : []),
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
                    <div className="w-12 h-6 bg-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:start-[4px] after:bg-white after:border-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand"></div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="space-y-6 bg-surface-muted/30 p-4 main-640:p-8 rounded-2xl border border-border">
            <div className="flex items-center gap-3">
               <div className="p-2 bg-white rounded-lg shadow-sm text-brand">
                  <FileText size={18} />
               </div>
               <h4 className="font-black text-content uppercase text-sm">{t('settings_page.invoice.footer_title')}</h4>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-black text-content-muted px-1">{t('settings_page.invoice.return_policy')}</label>
              <textarea 
                rows={4}
                value={settings.footer.returnPolicy}
                onChange={e => setSettings(s => ({ ...s, footer: { ...s.footer, returnPolicy: e.target.value } }))}
                className="w-full bg-white border border-border rounded-2xl p-4 main-640:p-6 text-sm font-medium outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand resize-none leading-relaxed shadow-inner"
                placeholder={t('settings_page.invoice.return_policy_placeholder')}
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-black text-content-muted px-1">{t('settings_page.invoice.thank_you_message')}</label>
              <input 
                type="text" 
                value={settings.footer.thankYouMessage}
                onChange={e => setSettings(s => ({ ...s, footer: { ...s.footer, thankYouMessage: e.target.value } }))}
                className="w-full bg-white border border-border rounded-xl p-3.5 text-sm font-bold outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand shadow-sm"
              />
            </div>

            <label className="flex flex-col main-640:flex-row items-stretch main-640:items-center justify-between p-4 main-640:p-6 bg-surface-muted/50 rounded-2xl border border-dashed border-brand/20 cursor-pointer hover:bg-brand/5 transition-all gap-4">
              <div className={cn("flex items-center gap-4", isRtl ? "text-right" : "text-left")}>
                 <div className="p-3 bg-white rounded-2xl shadow-sm text-brand shrink-0">
                    <Zap size={24} className="animate-pulse" />
                 </div>
                 <div>
                    <p className="font-black text-content text-sm">{t('settings_page.invoice.zatca_qr')}</p>
                    <p className="text-sm text-content-muted font-medium">{t('settings_page.invoice.zatca_compatibility')}</p>
                 </div>
              </div>
              <div className="flex justify-end main-640:justify-start">
                <div className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    className="sr-only peer"
                    checked={settings.footer.showZatcaQr}
                    onChange={(e) => setSettings(s => ({ ...s, footer: { ...s.footer, showZatcaQr: e.target.checked } }))}
                  />
                  <div className="w-14 h-7 bg-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:start-[4px] after:bg-white after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand"></div>
                </div>
              </div>
            </label>
          </div>
        </div>
      </div>

      {/* Live Preview Section */}
      <div className={cn(
        "w-full main-1280:w-1/2 bg-surface-muted/40 p-4 main-640:p-8 flex flex-col items-center justify-start overflow-auto max-h-[850px] border-t main-1280:border-t-0 border-border custom-scrollbar",
        mobileTab === 'preview' ? "flex" : "hidden main-1280:flex"
      )}>
        <div className="bg-white/80 backdrop-blur-md px-6 py-2 rounded-full border border-border/50 flex items-center gap-2 mb-6 main-640:mb-10 text-content-muted font-black uppercase text-sm sticky top-0 z-10 shadow-sm shadow-brand/5 whitespace-nowrap">
          <Eye size={12} className="text-brand" />
          <span>{t('settings_page.invoice.live_simulation')}</span>
        </div>

        {/* Invoice Paper Wrapper to handle scaling */}
        <div className={cn(
          "flex justify-center transition-all duration-500 w-full origin-top mb-10 main-1280:mb-20 overflow-x-auto",
          settings.printSize === 'a4' ? "scale-[0.45] xs:scale-[0.5] main-640:scale-[0.6] main-720:scale-[0.7] main-900:scale-[0.45] main-1024:scale-[0.6] main-1280:scale-[0.7]" : 
          settings.printSize === 'a5' ? "scale-[0.55] xs:scale-[0.6] main-640:scale-[0.7] main-900:scale-[0.55] main-1024:scale-[0.7]" : "scale-100"
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
