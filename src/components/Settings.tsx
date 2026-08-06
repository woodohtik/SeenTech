import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatSaudiPhone } from '../utils/phoneUtils';
import { Store, MapPin, Phone, Globe, Bell, Shield, CreditCard, MessageSquare, CheckCircle2, AlertCircle, ChevronRight, ExternalLink, Zap, Upload, X as CloseIcon, Database, Trash2, ShieldCheck, Palette, FileText, HelpCircle, Layout, Mail, Printer } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { handleError, OperationType } from '../lib/firebase';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { PriceDisplay } from './PriceDisplay';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { settingsSchema } from '../lib/validations';
import Header from './Header';
import { useStaff } from '../contexts/StaffContext';
import { usePermissions } from '../hooks/usePermissions';
import ThemeSwitcher from './ThemeSwitcher';
import { IconInput } from './ui/IconInput';

import WarehouseManagement from './Inventory/WarehouseManagement';
import Staff from './Staff';
import RolePermissionsSettings from './RolePermissionsSettings';
import InvoiceLayoutSettings from './InvoiceLayoutSettings';
import TenantSupportHistory from './TenantSupportHistory';
import PrinterSettings from './PrinterSettings';
import WhatsAppSettings from './WhatsAppSettings';
import BillingSettings from './BillingSettings';

import Branding from './Branding';

import { deleteTestDataForTenant } from '../services/trialService';

interface SettingsProps {
  tenantId: string;
}

type TabType = 'profile' | 'appearance' | 'invoice' | 'printer' | 'tax' | 'branches' | 'staff' | 'whatsapp' | 'billing' | 'support' | 'notifications' | 'data';

export default function Settings({ tenantId }: SettingsProps) {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar' || i18n.language === 'ur' || !i18n.language;
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') as TabType) || 'profile';
  const setActiveTab = (tab: TabType) => {
    setSearchParams({ tab });
  };
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [isDeletingTestData, setIsDeletingTestData] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [userEmail, setUserEmail] = useState<string>('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const { currentStaff } = useStaff();

  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const [highlightActiveTab, setHighlightActiveTab] = useState(false);

  useEffect(() => {
    const handleSidebarSettingsClicked = () => {
      setHighlightActiveTab(true);
      
      setTimeout(() => {
        tabsContainerRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }, 100);

      const timer = setTimeout(() => {
        setHighlightActiveTab(false);
      }, 2000);

      return () => clearTimeout(timer);
    };

    window.addEventListener('sidebar_settings_clicked', handleSidebarSettingsClicked);
    
    // Smoothly scroll to the tabs when Settings component mounts
    handleSidebarSettingsClicked();

    return () => {
      window.removeEventListener('sidebar_settings_clicked', handleSidebarSettingsClicked);
    };
  }, []);

  useEffect(() => {
    const fetchUserEmail = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.email) {
          setUserEmail(user.email);
        } else if (currentStaff?.email) {
          setUserEmail(currentStaff.email);
        }
      } catch (err) {
        console.error('Failed to fetch user email:', err);
        if (currentStaff?.email) {
          setUserEmail(currentStaff.email);
        }
      }
    };
    fetchUserEmail();
  }, [currentStaff]);
  const { hasPermission } = usePermissions(currentStaff);

  const canEdit = hasPermission('settings.edit');
  const canViewWhatsApp = hasPermission('settings.whatsapp');
  const canViewBilling = hasPermission('settings.billing');
  const canViewNotifications = hasPermission('settings.notifications');

  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(settingsSchema),
    shouldUnregister: false,
    defaultValues: {
      name: '',
      phone: '',
      address: '',
      currencySymbol: 'SR',
      inventoryStrategy: 'decentralized' as const,
      logoUrl: '',
      taxSettings: {
        enabled: false,
        trn: '',
        legalName: '',
        vatRate: 15,
        tailoringTaxType: 'exclusive'
      },
      notificationSettings: {
        lowStock: true,
        newOrder: true,
        dailyClose: true,
        tomorrowDelivery: true
      }
    }
  });

  const currentStrategy = watch('inventoryStrategy');
  const taxEnabled = watch('taxSettings.enabled');
  const tailoringTaxType = watch('taxSettings.tailoringTaxType') || 'exclusive';

  useEffect(() => {
    const fetchTenant = async () => {
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
          const hasVat = Boolean(data.vat_number && data.vat_number.trim().length > 0);
          let rawTax = data.tax_settings as any;
          if (!rawTax) {
            try {
              const fallback = localStorage.getItem(`tenant_tax_settings_${tenantId}`);
              if (fallback) {
                rawTax = JSON.parse(fallback);
              }
            } catch (e) {
              console.error('Failed to load tax_settings from localStorage:', e);
            }
          }
          const loadedTaxSettings = rawTax ? {
            ...rawTax,
            enabled: rawTax.enabled ?? (hasVat || Boolean(rawTax.trn)),
            trn: rawTax.trn || data.vat_number || '',
            legalName: rawTax.legalName || data.name || '',
            vatRate: rawTax.vatRate ?? 15,
            tailoringTaxType: rawTax.tailoringTaxType || 'exclusive'
          } : {
            enabled: hasVat,
            trn: data.vat_number || '',
            legalName: data.name || '',
            vatRate: 15,
            tailoringTaxType: 'exclusive'
          };

          const loadedNotificationSettings = rawTax?.notificationSettings || {
            lowStock: true,
            newOrder: true,
            dailyClose: true,
            tomorrowDelivery: true
          };

          reset({
            name: data.name || '',
            phone: data.phone || '',
            address: data.address || '',
            inventoryStrategy: 'decentralized',
            logoUrl: data.logo_url || '',
            taxSettings: loadedTaxSettings,
            notificationSettings: loadedNotificationSettings
          });
          setLogoPreview(data.logo_url || null);
          if (data.owner_email) {
            setUserEmail(prev => prev || data.owner_email || '');
          }
        }
      } catch (error) {
        handleError(error, OperationType.GET, 'tenants');
      } finally {
        setLoading(false);
      }
    };
    fetchTenant();
  }, [tenantId, reset]);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 1024 * 1024) { // 1MB limit for base64
        alert('حجم الصورة كبير جداً، يرجى اختيار صورة أقل من 1 ميجابايت');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setLogoPreview(base64);
        setValue('logoUrl', base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const onSave = async (data: any) => {
    if (!tenantId || tenantId === 'saas_management') return;
    try {
      const updatePayload: any = {
        name: data.name,
        phone: data.phone ? formatSaudiPhone(data.phone) : '',
        address: data.address,
        inventory_strategy: 'decentralized',
        logo_url: data.logoUrl,
        vat_number: data.taxSettings?.trn || '',
        is_tax_enabled: Boolean(data.taxSettings?.enabled),
        default_tax_rate: data.taxSettings?.vatRate || 15,
        tax_settings: {
          ...data.taxSettings,
          notificationSettings: data.notificationSettings
        }
      };

      let { error } = await supabase
        .from('tenants')
        .update(updatePayload)
        .eq('id', tenantId);

      if (error && (error.code === 'PGRST204' || error.message?.includes('tax_settings'))) {
        console.warn('[Settings] tax_settings column not found in schema. Storing locally and retrying update without it...');
        try {
          localStorage.setItem(`tenant_tax_settings_${tenantId}`, JSON.stringify(updatePayload.tax_settings));
        } catch (e) {
          console.error('Failed to save fallback tax settings to localStorage:', e);
        }
        
        const { tax_settings, ...retryPayload } = updatePayload;
        const retryResult = await supabase
          .from('tenants')
          .update(retryPayload)
          .eq('id', tenantId);
        error = retryResult.error;
      }

      if (error) throw error;

      setSaveSuccess(true);
      window.dispatchEvent(new CustomEvent('tenant_settings_updated'));
      setTimeout(() => setSaveSuccess(false), 4000);
    } catch (error) {
      handleError(error, OperationType.UPDATE, 'tenants');
    }
  };

  const handleDeleteTestData = async () => {
    if (!tenantId) return;
    if (!confirm('هل أنت متأكد من حذف جميع البيانات التجريبية؟ لا يمكن التراجع عن هذه الخطوة.')) return;

    setIsDeletingTestData(true);
    try {
      const result = await deleteTestDataForTenant(tenantId);
      if (result.success) {
        alert(`تم حذف البيانات التجريبية بنجاح (${result.deletedCount} سجل)`);
        window.dispatchEvent(new CustomEvent('data_cleared'));
      } else {
        alert(`حدث خطأ أثناء حذف البيانات التجريبية: ${result.error || ''}`);
      }
    } catch (error) {
      handleError(error, OperationType.DELETE, 'test_data');
      alert('حدث خطأ أثناء حذف البيانات التجريبية');
    } finally {
      setIsDeletingTestData(false);
    }
  };

  const handleExportData = async () => {
    if (!tenantId) return;
    setIsExporting(true);
    try {
      const tables = ['tenants', 'customers', 'orders', 'staff', 'branches', 'products', 'inventory'];
      const exportedData: Record<string, any> = {};

      for (const table of tables) {
        try {
          const { data, error } = await supabase
            .from(table)
            .select('*')
            .eq(table === 'tenants' ? 'id' : 'tenant_id', tenantId);
          
          if (!error && data) {
            exportedData[table] = data;
          } else {
            exportedData[table] = [];
          }
        } catch (tableErr) {
          console.warn(`Could not export table ${table}:`, tableErr);
          exportedData[table] = [];
        }
      }

      try {
        const { data: auditLogsData } = await supabase
          .from('employee_activity_logs')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('occurred_at', { ascending: false })
          .limit(100);
        exportedData['employee_activity_logs'] = auditLogsData || [];
      } catch (auditErr) {
        exportedData['employee_activity_logs'] = [];
      }

      const jsonStr = JSON.stringify(exportedData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `backup_data_${tenantId}_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export error:', err);
      alert('حدث خطأ أثناء تصدير البيانات');
    } finally {
      setIsExporting(false);
    }
  };

  const fetchAuditLogs = async () => {
    if (!tenantId) return;
    setLoadingLogs(true);
    try {
      const { data, error } = await supabase
        .from('employee_activity_logs')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('occurred_at', { ascending: false })
        .limit(100);
      
      if (!error && data) {
        setAuditLogs(data);
      }
    } catch (err) {
      console.error('Error fetching logs:', err);
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    if (showAuditModal) {
      fetchAuditLogs();
    }
  }, [showAuditModal]);

  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand"></div>
      </div>
    );
  }

  const TABS: { id: TabType; label: string; icon: any; visible: boolean; group: string }[] = [
    { id: 'profile', label: t('settings_page.tabs.profile', 'الملف الشخصي'), icon: Store, visible: true, group: 'business' },
    { id: 'tax', label: t('settings_page.tabs.tax', 'الإعدادات الضريبية'), icon: FileText, visible: canEdit, group: 'business' },
    { id: 'branches', label: t('settings_page.tabs.branches', 'الفروع والمواقع'), icon: MapPin, visible: hasPermission('branches.manage'), group: 'business' },
    
    { id: 'appearance', label: t('settings_page.tabs.appearance', 'المظهر والسمات'), icon: Palette, visible: true, group: 'system' },
    { id: 'invoice', label: t('settings_page.tabs.invoice', 'تخطيط الفاتورة'), icon: FileText, visible: true, group: 'system' },
    { id: 'printer', label: t('settings_page.tabs.printer', 'إعدادات الطابعة'), icon: Printer, visible: true, group: 'system' },
    { id: 'notifications', label: t('settings_page.tabs.notifications', 'التنبيهات'), icon: Bell, visible: canViewNotifications, group: 'system' },
    { id: 'whatsapp', label: t('settings_page.tabs.whatsapp', 'تكامل واتساب'), icon: MessageSquare, visible: canViewWhatsApp, group: 'system' },
    
    { id: 'staff', label: t('settings_page.tabs.staff', 'طاقم الموظفين'), icon: Shield, visible: hasPermission('staff.manage'), group: 'admin' },
    { id: 'billing', label: t('settings_page.tabs.billing', 'الاشتراك والمدفوعات'), icon: CreditCard, visible: canViewBilling, group: 'admin' },
    { id: 'data', label: t('settings_page.tabs.data', 'إدارة البيانات'), icon: Database, visible: currentStaff?.role === 'owner' || currentStaff?.role === 'super_admin', group: 'admin' },
  ];

  const groupedTabs = {
    business: { label: t('common.business_activity', 'النشاط التجاري'), tabs: TABS.filter(t => t.group === 'business' && t.visible) },
    system: { label: t('common.system_preferences', 'النظام والتفضيلات'), tabs: TABS.filter(t => t.group === 'system' && t.visible) },
    admin: { label: t('common.admin_subscription', 'الإدارة والاشتراك'), tabs: TABS.filter(t => t.group === 'admin' && t.visible) },
  };

  /*
   * No `overflow-hidden` on the shell below: it silently clipped any panel that
   * was wider than the viewport (instead of letting the panel's own scroller
   * handle it), and it also disabled `position: sticky` on the desktop settings
   * sidebar. `min-w-0` is what actually keeps the flex children in check.
   *
   * pb-20 is repeated per breakpoint because `sm:p-5` / `lg:p-8` reset
   * padding-bottom, which would otherwise drop the bottom breathing room.
   */
  return (
    <div className={cn(
      "p-3 sm:p-5 lg:p-8 pb-20 sm:pb-20 lg:pb-20 max-w-7xl mx-auto space-y-6 lg:space-y-8 w-full min-w-0",
      isRtl ? "text-right" : "text-left"
    )} dir={isRtl ? "rtl" : "ltr"}>
      <Header 
        tenantId={tenantId} 
        title={t('settings_page.title', 'الإعدادات')} 
        subtitle={t('settings_page.subtitle', 'تخصيص تجربة متجرك وإدارة اشتراكك')}
      />

      {/* Horizontal Scrollable Tabs Selector */}
      <div ref={tabsContainerRef} className="flex gap-2 overflow-x-auto pb-3 pt-1 scrollbar-none -mx-3 px-3 sm:mx-0 sm:px-0">
        {TABS.filter(tab => tab.visible).map(tab => {
          const TabIcon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-black whitespace-nowrap transition-all duration-300 border shrink-0 cursor-pointer",
                isActive
                  ? cn(
                      "bg-brand text-white border-brand shadow-md shadow-brand/15",
                      highlightActiveTab && "ring-4 ring-brand/40 scale-105 shadow-xl bg-brand/90"
                    )
                  : "bg-surface text-content-muted border-border hover:bg-surface-muted hover:text-content"
              )}
            >
              <TabIcon size={16} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className="w-full">
        {/* Main Content Area */}
        <main className="w-full">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
              className="w-full"
            >
              {activeTab === 'profile' && (
                <form onSubmit={handleSubmit(onSave)} className="bg-surface p-4 sm:p-6 lg:p-8 rounded-2xl lg:rounded-3xl border border-border shadow-xl shadow-brand/5 space-y-6 lg:space-y-8 w-full">
                  <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 lg:gap-8 border-b border-border pb-6">
                    <div className="relative group shrink-0">
                      <div className="w-28 h-28 sm:w-36 sm:h-36 bg-surface-muted rounded-2xl sm:rounded-3xl border-2 border-dashed border-border flex items-center justify-center overflow-hidden transition-all group-hover:border-brand/40 group-hover:bg-brand/5">
                        {logoPreview ? (
                          <img src={logoPreview} alt="Logo" className="w-full h-full object-cover" />
                        ) : (
                          <Store size={40} className="text-content-muted/30" />
                        )}
                      </div>
                      <label className="absolute -bottom-2 -right-2 p-3 bg-brand text-white rounded-xl shadow-xl cursor-pointer hover:bg-brand/90 transition-all hover:scale-110 active:scale-95">
                        <Upload size={18} />
                        <input type="file" className="hidden" accept="image/*" onChange={handleLogoChange} />
                      </label>
                      {logoPreview && (
                        <button 
                          type="button"
                          onClick={() => { setLogoPreview(null); setValue('logoUrl', ''); }}
                          className="absolute -top-2 -right-2 p-1.5 bg-danger text-white rounded-lg shadow-xl hover:bg-danger/90 transition-all hover:scale-110"
                        >
                          <CloseIcon size={16} />
                        </button>
                      )}
                    </div>
                    <div className={cn("text-center py-1 space-y-1.5 flex-1", isRtl ? "sm:text-right" : "sm:text-left")}>
                      <h3 className="text-xl sm:text-2xl font-black text-content">{t('settings_page.profile.store_identity', 'هوية المتجر')}</h3>
                      <p className="text-xs sm:text-sm text-content-muted font-medium leading-relaxed max-w-sm">
                        {t('settings_page.profile.store_identity_desc', 'قم بتحميل شعار متجرك وتعديل المعلومات الأساسية التي تظهر لعملائك في النظام وعلى الفواتير الضريبية.')}
                      </p>
                      <div className="flex flex-wrap justify-center sm:justify-start gap-2 pt-1">
                         <span className="px-2.5 py-0.5 bg-surface-muted rounded-full text-[10px] font-black text-content-muted uppercase tracking-tighter border border-border">Base64 Support</span>
                         <span className="px-2.5 py-0.5 bg-brand/5 rounded-full text-[10px] font-black text-brand uppercase tracking-tighter border border-brand/10">Bilingual Print</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between px-1">
                        <label className="text-[10px] font-black text-content-muted uppercase tracking-normal sm:tracking-[0.2em]">{t('settings_page.profile.store_name', 'اسم المنشأة التجاري')}</label>
                        <HelpCircle size={14} className="text-content-muted/40 cursor-help" />
                      </div>
                      <IconInput 
                        type="text" 
                        {...register('name')}
                        startIcon={Store}
                        error={errors.name?.message}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between px-1">
                        <label className="text-[10px] font-black text-content-muted uppercase tracking-normal sm:tracking-[0.2em]">{t('settings_page.profile.phone', 'رقم التواصل الموحد')}</label>
                        <HelpCircle size={14} className="text-content-muted/40 cursor-help" />
                      </div>
                      <IconInput 
                        type="text" 
                        {...register('phone')}
                        placeholder="05XXXXXXXX / 9200XXXXX"
                        startIcon={Phone}
                        error={errors.phone?.message}
                      />
                    </div>
                    <div className="sm:col-span-2 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-1 px-1">
                        <label className="text-[10px] font-black text-content-muted uppercase tracking-normal sm:tracking-[0.2em]">{t('settings_page.profile.email_protected', 'البريد الإلكتروني (غير قابل للتعديل)')}</label>
                        <span className="text-[10px] text-slate-400 font-black bg-slate-100 dark:bg-slate-800 rounded px-2 py-0.5 select-none shrink-0" dir={isRtl ? "rtl" : "ltr"}>{t('settings_page.profile.official_protected', 'رسمي ومحمي')}</span>
                      </div>
                      <IconInput 
                        type="email" 
                        value={userEmail || ''}
                        readOnly
                        disabled
                        startIcon={Mail}
                        placeholder={t('settings_page.profile.no_email', 'لا يوجد بريد إلكتروني')}
                      />
                    </div>
                  </div>

                  <div className="pt-5 border-t border-border flex flex-col sm:flex-row justify-end items-stretch sm:items-center gap-3 w-full">
                    {saveSuccess && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className="flex items-center gap-2 px-3.5 py-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-xl text-xs font-bold"
                      >
                        <CheckCircle2 size={16} />
                        <span>{t('settings_page.profile.save_success', 'تم حفظ البيانات بنجاح')}</span>
                      </motion.div>
                    )}
                    <p className={cn("text-[10px] text-content-muted font-bold hidden md:block", isRtl ? "text-right" : "text-left")}>{t('settings_page.profile.save_notice', 'يتم حفظ هذه البيانات تلقائياً وتنعكس على جميع فروع المتجر')}</p>
                    {canEdit && (
                      <button 
                        type="submit"
                        disabled={isSubmitting}
                        className={cn(
                          "px-6 sm:px-8 py-3 rounded-xl font-black transition-all shadow-lg disabled:opacity-50 hover:scale-102 active:scale-98 flex items-center justify-center gap-2 text-white cursor-pointer text-sm",
                          saveSuccess ? "bg-emerald-600 shadow-emerald-500/20" : "bg-brand hover:bg-brand/90 shadow-brand/20"
                        )}
                      >
                        {isSubmitting ? (
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : saveSuccess ? (
                          <CheckCircle2 size={18} />
                        ) : null}
                        <span>{isSubmitting ? t('settings_page.profile.saving', 'جاري الحفظ...') : saveSuccess ? t('settings_page.profile.save_success', 'تم الحفظ بنجاح') : t('settings_page.profile.save_store', 'حفظ إعدادات المنشأة')}</span>
                      </button>
                    )}
                  </div>
                </form>
              )}

              {activeTab === 'branches' && (
                <div className="bg-surface rounded-2xl sm:rounded-[2.5rem] border border-border shadow-sm overflow-hidden">
                  <WarehouseManagement tenantId={tenantId} />
                </div>
              )}

              {activeTab === 'staff' && (
                <div className="space-y-5 sm:space-y-6">
                  <div className={cn("bg-surface-muted/30 p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border border-border flex flex-col sm:flex-row items-center gap-4 sm:gap-6 text-center", isRtl ? "sm:text-right" : "sm:text-left")}>
                    <div className="w-12 h-12 sm:w-14 sm:h-14 bg-brand/10 text-brand rounded-2xl flex items-center justify-center shadow-inner shrink-0">
                      <Shield size={24} />
                    </div>
                    <div className="space-y-1 min-w-0">
                      <h4 className="text-base sm:text-lg font-black text-content">{t('settings_page.staff.title', 'طاقم الموظفين')}</h4>
                      <p className="text-xs sm:text-sm text-content-muted font-medium">{t('settings_page.staff.subtitle', 'قم بإضافة الموظفين وتعيين الفروع والأدوار الوظيفية لهم في النظام.')}</p>
                    </div>
                  </div>
                  {/* No overflow-hidden: the staff view has its own horizontal
                      scrollers, and clipping here cut its tab bar off instead. */}
                  <div className="bg-surface rounded-2xl sm:rounded-[3rem] border border-border shadow-xl shadow-brand/5">
                    <Staff tenantId={tenantId} />
                  </div>
                </div>
              )}

              {activeTab === 'appearance' && (
                <div className="bg-surface p-4 sm:p-6 lg:p-8 rounded-2xl lg:rounded-3xl border border-border shadow-xl shadow-brand/5 space-y-6 sm:space-y-8">
                  <div className="flex items-center gap-4 border-b border-border pb-6">
                    <div className="p-3 bg-brand/10 text-brand rounded-2xl shadow-inner shrink-0">
                      <Palette size={28} />
                    </div>
                    <div>
                      <h3 className="text-xl sm:text-2xl font-black text-content">{t('settings_page.appearance.title', 'هوية النظام البصرية')}</h3>
                      <p className="text-xs sm:text-sm text-content-muted font-medium mt-0.5">{t('settings_page.appearance.subtitle', 'خصص ألوان الواجهة والخطوط لتناسب العلامة التجارية لمتجرك')}</p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                    <div className="bg-surface-muted/30 p-4 sm:p-6 rounded-2xl border border-border space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-brand text-white rounded-lg">
                          <Palette size={18} />
                        </div>
                        <h4 className="font-black text-content uppercase tracking-widest text-xs">{t('settings_page.appearance.theme_title', 'ثيم الواجهة (Themes)')}</h4>
                      </div>
                      <p className="text-xs text-content-muted font-medium px-1">{t('settings_page.appearance.theme_desc', 'اختر الثيم الذي يرتاح له موظفوك أثناء العمل الطويل على النظام.')}</p>
                      <ThemeSwitcher />
                    </div>

                    <div className="bg-surface-muted/30 p-4 sm:p-6 rounded-2xl border border-border space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-brand text-white rounded-lg">
                          <HelpCircle size={18} />
                        </div>
                        <h4 className="font-black text-content uppercase tracking-widest text-xs">{t('settings_page.appearance.tour_title', 'الجولة الإرشادية التفاعلية')}</h4>
                      </div>
                      <p className="text-xs text-content-muted font-medium">{t('settings_page.appearance.tour_desc', 'إذا كنت بحاجة لإعادة استكشاف وظائف النظام وتدريب الموظفين الجدد، يمكنك إعادة تشغيل الجولة الإرشادية في أي وقت.')}</p>
                      <button
                        type="button"
                        onClick={() => window.dispatchEvent(new CustomEvent('start_onboarding_tour'))}
                        className="w-full bg-brand text-white font-black py-3 px-5 rounded-xl shadow-lg shadow-brand/20 hover:bg-brand/90 active:scale-95 transition-all flex items-center justify-center gap-2 text-sm cursor-pointer"
                      >
                        <HelpCircle size={18} />
                        <span>{t('settings_page.appearance.restart_tour', 'إعادة تشغيل الجولة الإرشادية')}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'invoice' && (
                <InvoiceLayoutSettings tenantId={tenantId} />
              )}

              {activeTab === 'tax' && (
                <form onSubmit={handleSubmit(onSave)} className="bg-surface p-4 sm:p-6 lg:p-8 rounded-2xl lg:rounded-3xl border border-border shadow-xl shadow-brand/5 space-y-6 w-full">
                  <div className={cn("flex flex-col sm:flex-row items-center sm:items-start gap-4 border-b border-border pb-6 text-center", isRtl ? "sm:text-right" : "sm:text-left")}>
                    <div className="p-3 bg-brand/10 text-brand rounded-2xl shadow-inner shrink-0">
                      <FileText size={28} />
                    </div>
                    <div>
                      <h3 className="text-xl sm:text-2xl font-black text-content">{t('settings_page.tax.title', 'الامتثال الضريبي')}</h3>
                      <p className="text-xs sm:text-sm text-content-muted font-medium mt-0.5">{t('settings_page.tax.subtitle', 'إدارة معايير هيئة الزكاة والضريبة والجمارك (ZATCA)')}</p>
                    </div>
                  </div>

                  <div className="space-y-6 w-full">
                    <label className={cn(
                      "flex flex-col sm:flex-row items-stretch sm:items-center justify-between p-4 sm:p-6 rounded-2xl border-2 cursor-pointer transition-all gap-4 group",
                      taxEnabled ? "border-brand bg-brand/5 shadow-md shadow-brand/5" : "border-border hover:border-brand/20 bg-surface-muted/30"
                    )}>
                      <div className={cn("max-w-xl", isRtl ? "text-right" : "text-left")}>
                        <h4 className="text-base sm:text-lg font-black text-content flex items-center gap-2 sm:gap-3">
                          {t('settings_page.tax.enabled', 'وضع الفوترة الإلكترونية المتقدمة')}
                          {taxEnabled && (
                            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="bg-success text-white p-1 rounded-full">
                              <ShieldCheck size={14} />
                            </motion.span>
                          )}
                        </h4>
                        <p className="text-xs sm:text-sm text-content-muted mt-1.5 font-medium leading-relaxed">{t('settings_page.tax.enabled_desc', 'تفعيل الضريبة يضمن توافق متجرك مع متطلبات المرحلة الثانية من الفوترة الإلكترونية، بما في ذلك التوقيع الرقمي ورمز الاستجابة السريع المحمي.')}</p>
                      </div>
                      <div className="relative flex justify-end sm:justify-start shrink-0">
                        <input type="checkbox" {...register('taxSettings.enabled')} className="sr-only" />
                        <div className={cn(
                          "w-14 h-7.5 rounded-full transition-all relative overflow-hidden",
                          taxEnabled ? "bg-brand" : "bg-surface-muted"
                        )}>
                          <div className={cn(
                            "absolute top-1 w-5.5 h-5.5 rounded-full bg-white transition-all shadow-md",
                            taxEnabled ? "left-1" : "right-1 text-content-muted flex items-center justify-center text-[8px]"
                          )} />
                        </div>
                      </div>
                    </label>

                    <AnimatePresence>
                      {taxEnabled && (
                        <motion.div 
                          initial={{ opacity: 0, scale: 0.98 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.98 }}
                          className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 bg-surface-muted/30 p-4 sm:p-6 rounded-2xl border border-border/50"
                        >
                          <div className="space-y-2">
                            <label className="text-[10px] font-black text-content-muted uppercase tracking-normal sm:tracking-[0.2em] px-1">{t('settings_page.tax.trn', 'الرقم الضريبي (TRN - 15 خانة)')}</label>
                            <input 
                              type="text" 
                              {...register('taxSettings.trn')}
                              className={cn(
                                "w-full bg-surface border-2 border-transparent focus:border-brand/30 rounded-xl p-3 font-black transition-all outline-none text-content text-left tracking-widest shadow-inner shadow-black/5 text-sm",
                                errors.taxSettings?.trn && "border-red-500"
                              )}
                              dir="ltr"
                            />
                            {errors.taxSettings?.trn && <p className="text-xs text-red-500 font-bold">{errors.taxSettings.trn.message}</p>}
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-black text-content-muted uppercase tracking-normal sm:tracking-[0.2em] px-1">{t('settings_page.tax.legal_name', 'اسم المكلف القانوني')}</label>
                            <input 
                              type="text" 
                              {...register('taxSettings.legalName')}
                              className={cn(
                                "w-full bg-surface border-2 border-transparent focus:border-brand/30 rounded-xl p-3 font-bold transition-all outline-none text-content shadow-inner shadow-black/5 text-sm",
                                errors.taxSettings?.legalName && "border-red-500"
                              )}
                              placeholder={t('settings_page.tax.legal_name_placeholder', 'الاسم المسجل في الشهادة الضريبية')}
                            />
                            {errors.taxSettings?.legalName && <p className="text-xs text-red-500 font-bold">{errors.taxSettings.legalName.message}</p>}
                          </div>
                          <div className="space-y-2 sm:col-span-2">
                             <div className="flex flex-wrap items-center justify-between gap-1.5 px-1">
                                <label className="text-[10px] font-black text-content-muted uppercase tracking-normal sm:tracking-[0.2em]">{t('settings_page.tax.vat_rate', 'نسبة الضريبة القياسية')}</label>
                                <span className="text-[10px] font-black text-brand bg-brand/10 px-2 py-0.5 rounded-full shrink-0">{t('settings_page.tax.saudi_vat_note', 'المملكة العربية السعودية: 15%')}</span>
                             </div>
                            <div className="relative group">
                              <span className="absolute left-4 top-1/2 -translate-y-1/2 font-black text-content-muted">%</span>
                              <input 
                                type="number" 
                                {...register('taxSettings.vatRate')}
                                className={cn(
                                  "w-full bg-surface border-2 border-transparent focus:border-brand/30 rounded-xl p-3 pl-10 font-black transition-all outline-none text-content shadow-inner shadow-black/5 text-sm",
                                  errors.taxSettings?.vatRate && "border-red-500"
                                )}
                                min="0" max="100"
                              />
                            </div>
                            {errors.taxSettings?.vatRate && <p className="text-xs text-red-500 font-bold">{errors.taxSettings.vatRate.message}</p>}
                          </div>

                          <div className="space-y-3 sm:col-span-2 border-t border-border/50 pt-4">
                            <label className="text-[10px] font-black text-content-muted uppercase tracking-normal sm:tracking-[0.2em] px-1">{t('settings_page.tax.calculation_method', 'طريقة احتساب ضريبة التفصيل والقص')}</label>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              {[
                                { id: 'inclusive', label: t('settings_page.tax.inclusive', 'شامل الضريبة'), desc: t('settings_page.tax.inclusive_desc', 'سعر التفصيل شامل لضريبة القيمة المضافة') },
                                { id: 'exclusive', label: t('settings_page.tax.exclusive', 'غير شامل الضريبة'), desc: t('settings_page.tax.exclusive_desc', 'يتم احتساب الضريبة بشكل إضافي فوق سعر التفصيل') },
                                { id: 'exempt', label: t('settings_page.tax.exempt', 'معفي من الضريبة'), desc: t('settings_page.tax.exempt_desc', 'لا يتم احتساب أي ضريبة على التفصيل والقص') }
                              ].map((option) => (
                                <div
                                  key={option.id}
                                  onClick={() => setValue('taxSettings.tailoringTaxType', option.id as any)}
                                  className={cn(
                                    "flex flex-col p-3.5 rounded-xl border-2 cursor-pointer transition-all gap-1",
                                    isRtl ? "text-right" : "text-left",
                                    tailoringTaxType === option.id
                                      ? "border-brand bg-brand/5 shadow-md shadow-brand/5"
                                      : "border-border hover:border-brand/20 bg-surface"
                                  )}
                                >
                                  <span className="text-xs sm:text-sm font-black text-content">{option.label}</span>
                                  <span className="text-[11px] text-content-muted font-medium">{option.desc}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Overall Form Errors */}
                    {Object.keys(errors).length > 0 && (
                      <div className="p-3.5 bg-danger/5 border border-danger/10 rounded-xl flex items-center gap-3 text-danger">
                        <AlertCircle size={18} className="shrink-0" />
                        <div className="text-xs sm:text-sm font-bold">
                          {t('settings_page.tax.form_errors', 'يوجد أخطاء في البيانات المدخلة. يرجى التأكد من ملء جميع الحقول المطلوبة (بما في ذلك الاسم والعنوان في تبويب الملف الشخصي).')}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="pt-5 border-t border-border flex flex-col sm:flex-row justify-end items-stretch sm:items-center gap-3 w-full">
                    {saveSuccess && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className="flex items-center gap-2 px-3.5 py-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-xl text-xs font-bold"
                      >
                        <CheckCircle2 size={16} />
                        <span>{t('settings_page.tax.save_success', 'تم حفظ البيانات الضريبية بنجاح')}</span>
                      </motion.div>
                    )}
                     <p className={cn("text-[10px] text-warning font-bold max-w-xs leading-tight hidden md:block", isRtl ? "text-right" : "text-left")}>
                        {t('settings_page.tax.saudi_trn_warning', 'تأكد من صحة الرقم الضريبي؛ أي خطأ قد يؤدي إلى رفض الفاتورة من قبل منصة فاتورة.')}
                     </p>
                    {canEdit && (
                      <button 
                        type="submit"
                        disabled={isSubmitting}
                        className={cn(
                          "px-6 sm:px-8 py-3 rounded-xl font-black transition-all shadow-lg disabled:opacity-50 hover:scale-102 active:scale-98 flex items-center justify-center gap-2 text-white cursor-pointer text-sm",
                          saveSuccess ? "bg-emerald-600 shadow-emerald-500/20" : "bg-brand hover:bg-brand/90 shadow-brand/20"
                        )}
                      >
                        {isSubmitting ? (
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : saveSuccess ? (
                          <CheckCircle2 size={18} />
                        ) : null}
                        <span>{isSubmitting ? t('settings_page.tax.syncing', 'جاري المزامنة...') : saveSuccess ? t('settings_page.tax.save_success', 'تم الحفظ بنجاح') : t('settings_page.tax.save_tax', 'حفظ بيانات التكليف')}</span>
                      </button>
                    )}
                  </div>
                </form>
              )}

              {activeTab === 'printer' && (
                <PrinterSettings />
              )}

              {activeTab === 'whatsapp' && (
                <WhatsAppSettings />
              )}

              {activeTab === 'billing' && (
                <BillingSettings tenantId={tenantId} />
              )}

              {activeTab === 'notifications' && (
                <form onSubmit={handleSubmit(onSave)} className="bg-surface p-5 sm:p-8 md:p-10 rounded-2xl md:rounded-[3rem] border border-border shadow-xl shadow-brand/5 space-y-6 md:space-y-10 w-full">
                   <div className={cn("flex flex-col sm:flex-row items-center sm:items-start gap-4 border-b border-border pb-6 sm:pb-8 text-center", isRtl ? "sm:text-right" : "sm:text-left")}>
                      <div className="p-4 bg-warning/10 text-warning rounded-[1.5rem] shadow-inner">
                        <Bell size={32} />
                      </div>
                      <div>
                        <h3 className="text-2xl font-black text-content">{t('settings_page.notifications.title', 'إشعارات النظام والبريد')}</h3>
                        <p className="text-sm text-content-muted font-medium mt-1 uppercase tracking-tight">{t('settings_page.notifications.subtitle', 'تحكم في تنبيهات المتصفح وإشعارات الجوال')}</p>
                      </div>
                    </div>

                    <div className="space-y-4 w-full">
                      {[
                        { field: 'notificationSettings.lowStock', title: t('settings_page.notifications.low_stock_title', 'تحذيرات المخزون المنخفض'), desc: t('settings_page.notifications.low_stock_desc', 'سيتم تنبيهك عندما تصل كمية القماش أو الإكسسوارات للحد الأدنى.'), icon: Database, color: 'text-danger' },
                        { field: 'notificationSettings.newOrder', title: t('settings_page.notifications.new_order_title', 'إشعارات الطلبات الجديدة'), desc: t('settings_page.notifications.new_order_desc', 'إشعار فوري عند قيام أي موظف بإنشاء فاتورة بيع جديدة.'), icon: Store, color: 'text-brand' },
                        { field: 'notificationSettings.dailyClose', title: t('settings_page.notifications.daily_close_title', 'تقارير الإغلاق اليومية'), desc: t('settings_page.notifications.daily_close_desc', 'ملخص بالأرباح والخسائر والمبيعات فور إغلاق الوردية.'), icon: FileText, color: 'text-success' },
                        { field: 'notificationSettings.tomorrowDelivery', title: t('settings_page.notifications.tomorrow_delivery_title', 'مواعيد تسليم الغد'), desc: t('settings_page.notifications.tomorrow_delivery_desc', 'تنبيه لقائمة العملاء الذين يجب تسليم طلباتهم في اليوم التالي.'), icon: Bell, color: 'text-warning' },
                      ].map((item) => (
                        <div key={item.title} className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between p-5 sm:p-8 bg-surface-muted/30 hover:bg-surface border-2 border-transparent hover:border-border rounded-2xl sm:rounded-[2.5rem] transition-all group gap-4">
                          <div className={cn("flex flex-col sm:flex-row items-center sm:items-start gap-4 text-center", isRtl ? "sm:text-right" : "sm:text-left")}>
                            <div className={cn("p-4 bg-white rounded-2xl shadow-sm transition-transform group-hover:scale-110 shrink-0", item.color)}>
                              <item.icon size={26} />
                            </div>
                            <div className="space-y-1">
                              <p className="text-lg font-black text-content">{item.title}</p>
                              <p className="text-sm text-content-muted font-medium leading-relaxed max-w-md">{item.desc}</p>
                            </div>
                          </div>
                          <div className="flex justify-end sm:justify-start">
                            <label className="relative inline-flex items-center cursor-pointer">
                              <input type="checkbox" className="sr-only peer" {...register(item.field as any)} />
                              <div className="w-14 h-7 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:bg-white after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand"></div>
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>

                    {canEdit && (
                      <div className="pt-5 border-t border-border flex flex-col sm:flex-row justify-end items-stretch sm:items-center gap-3 w-full">
                        {saveSuccess && (
                          <motion.div
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            className="flex items-center gap-2 px-3.5 py-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-xl text-xs font-bold"
                          >
                            <CheckCircle2 size={16} />
                            <span>{t('settings_page.notifications.save_success', 'تم حفظ إعدادات التنبيهات بنجاح')}</span>
                          </motion.div>
                        )}
                        <button 
                          type="submit"
                          disabled={isSubmitting}
                          className={cn(
                            "px-6 sm:px-8 py-3 rounded-xl font-black transition-all shadow-lg disabled:opacity-50 hover:scale-102 active:scale-98 flex items-center justify-center gap-2 text-white cursor-pointer text-sm",
                            saveSuccess ? "bg-emerald-600 shadow-emerald-500/20" : "bg-brand hover:bg-brand/90 shadow-brand/20"
                          )}
                        >
                          {isSubmitting ? (
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          ) : saveSuccess ? (
                            <CheckCircle2 size={18} />
                          ) : null}
                          <span>{isSubmitting ? t('settings_page.notifications.saving', 'جاري الحفظ...') : saveSuccess ? t('settings_page.notifications.save_success', 'تم الحفظ بنجاح') : t('settings_page.notifications.save_btn', 'حفظ إعدادات التنبيهات')}</span>
                        </button>
                      </div>
                    )}
                </form>
              )}

              {activeTab === 'data' && (
                <div className="bg-surface p-5 sm:p-8 md:p-10 rounded-2xl md:rounded-[3rem] border border-border shadow-xl shadow-brand/5 space-y-6 md:space-y-10 w-full">
                   <div className={cn("flex flex-col sm:flex-row items-center sm:items-start gap-4 border-b border-border pb-6 sm:pb-8 text-center", isRtl ? "sm:text-right" : "sm:text-left")}>
                      <div className="p-4 bg-danger/10 text-danger rounded-[1.5rem] shadow-inner">
                        <Database size={32} />
                      </div>
                      <div>
                        <h3 className="text-2xl font-black text-content">{t('settings_page.data.title', 'إدارة البيانات وسرية المعلومات')}</h3>
                        <p className="text-sm text-content-muted font-medium mt-1 uppercase tracking-tight">{t('settings_page.data.subtitle', 'التحكم في سجلات النظام والبيانات المؤرشفة')}</p>
                      </div>
                    </div>

                    <div className="space-y-6 md:space-y-8 w-full">
                      <div className={cn("p-5 sm:p-10 bg-danger/5 rounded-2xl sm:rounded-[3rem] border-2 border-dashed border-danger/20 space-y-6", isRtl ? "text-right" : "text-left")}>
                        <div className={cn("flex flex-col sm:flex-row items-center gap-4 text-danger text-center", isRtl ? "sm:text-right" : "sm:text-left")}>
                          <div className="p-3 bg-danger text-white rounded-2xl shadow-lg shadow-danger/20">
                            <AlertCircle size={28} />
                          </div>
                          <h4 className="text-lg sm:text-2xl font-black tracking-tight">{t('settings_page.data.critical_zone', 'المنطقة الخطرة (Critical Zone)')}</h4>
                        </div>
                        <p className={cn("text-sm sm:text-base text-danger/80 font-bold leading-relaxed max-w-2xl text-center", isRtl ? "sm:text-right" : "sm:text-left")}>
                          {t('settings_page.data.critical_desc', 'حذف البيانات التجريبية سيمسح جميع السجلات التي تم تمييزها كـ "بيانات اختبار". هذا الإجراء مفيد جداً قبل الانتقال لبيئة التشغيل الفعلية (Go-Live) لتصفير عداد الطلبات والعملاء الوهميين.')}
                        </p>
                        <div className="pt-2 flex justify-center sm:justify-start">
                          <button
                            onClick={handleDeleteTestData}
                            disabled={isDeletingTestData}
                            className="flex items-center justify-center gap-2 sm:gap-3 bg-danger text-white w-full sm:w-auto px-5 sm:px-6 py-3.5 sm:py-4 rounded-xl sm:rounded-[1.5rem] font-black hover:bg-danger/90 transition-all shadow-xl shadow-danger/20 disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98]"
                          >
                            {isDeletingTestData ? (
                              <div className="w-5 h-5 sm:w-6 sm:h-6 border-4 border-white/30 border-t-white rounded-full animate-spin shrink-0" />
                            ) : (
                              <Trash2 size={20} className="shrink-0" />
                            )}
                            <span className="text-sm sm:text-lg">{t('settings_page.data.reset_system', 'تصفير النظام وحذف البيانات التجريبية')}</span>
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-1">
                        <button 
                          onClick={handleExportData}
                          disabled={isExporting}
                          className="flex flex-col items-center justify-center p-6 sm:p-10 bg-surface rounded-2xl sm:rounded-[2.5rem] border-2 border-border border-dashed hover:border-brand/40 hover:bg-brand/5 transition-all group text-center cursor-pointer disabled:opacity-50"
                        >
                          <div className="p-4 bg-surface-muted rounded-2xl mb-4 group-hover:scale-110 transition-transform">
                             {isExporting ? (
                               <div className="w-8 h-8 border-4 border-brand/30 border-t-brand rounded-full animate-spin" />
                             ) : (
                               <Database size={32} className="text-brand" />
                             )}
                          </div>
                          <p className="font-black text-content">{t('settings_page.data.export_db', 'تصدير قاعدة البيانات (JSON)')}</p>
                          <p className="text-[10px] text-content-muted font-bold mt-2 uppercase">
                            {isExporting ? t('settings_page.data.exporting', 'جاري تصدير الملف...') : t('settings_page.data.click_export', 'اضغط للتصدير والتحميل فوراً')}
                          </p>
                        </button>
                        
                        <button 
                          onClick={() => setShowAuditModal(true)}
                          className="flex flex-col items-center justify-center p-6 sm:p-10 bg-surface rounded-2xl sm:rounded-[2.5rem] border-2 border-border border-dashed hover:border-success/40 hover:bg-success/5 transition-all group text-center cursor-pointer"
                        >
                          <div className="p-4 bg-surface-muted rounded-2xl mb-4 group-hover:scale-110 transition-transform">
                             <FileText size={32} className="text-success" />
                          </div>
                          <p className="font-black text-content">{t('settings_page.data.audit_title', 'سجلات تدقيق العمليات (Audit)')}</p>
                          <p className="text-[10px] text-content-muted font-bold mt-2 uppercase">{t('settings_page.data.audit_desc', 'اضغط لفتح وعرض سجلات الموظفين والعمليات الحساسة')}</p>
                        </button>
                      </div>
                    </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      
      <div className="mt-12 opacity-30">
      </div>

      <AnimatePresence>
        {saveSuccess && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.9 }}
            className="fixed bottom-6 left-6 z-50 bg-emerald-600 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 font-black text-sm border border-emerald-400/30"
          >
            <CheckCircle2 size={22} className="text-white" />
            <span>تم حفظ الإعدادات بنجاح</span>
          </motion.div>
        )}

        {showAuditModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-4"
            dir={isRtl ? "rtl" : "ltr"}
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className={cn("bg-surface w-full max-w-4xl h-[80vh] flex flex-col rounded-3xl border border-border shadow-2xl overflow-hidden", isRtl ? "text-right" : "text-left")}
            >
              {/* Modal Header */}
              <div className="p-5 sm:p-6 border-b border-border flex items-center justify-between bg-surface-muted/50">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-success/10 text-success rounded-2xl shrink-0">
                    <FileText size={24} />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-content">{t('settings_page.data.audit_logs_modal_title', 'سجلات تدقيق العمليات (Audit Logs)')}</h3>
                    <p className="text-xs text-content-muted font-bold mt-0.5">{t('settings_page.data.audit_logs_modal_desc', 'تتبع عمليات الموظفين والتغييرات في النظام في الوقت الفعلي')}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowAuditModal(false)}
                  className="p-2 hover:bg-surface-muted rounded-full transition-colors cursor-pointer"
                >
                  <CloseIcon size={24} className="text-content-muted hover:text-content" />
                </button>
              </div>

              {/* Search Bar */}
              <div className="p-4 sm:p-6 border-b border-border bg-surface flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  placeholder={t('settings_page.data.search_placeholder', 'ابحث باسم الموظف، العملية، أو التفاصيل...')}
                  value={searchTerm}
                  className="flex-1 bg-surface-muted border border-border px-4 py-3 rounded-2xl text-sm font-bold text-content focus:outline-none focus:border-brand"
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <button
                  onClick={fetchAuditLogs}
                  disabled={loadingLogs}
                  className="px-5 py-3 bg-brand/5 hover:bg-brand text-brand hover:text-white rounded-2xl text-xs font-black transition-all cursor-pointer border border-brand/10 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loadingLogs ? (
                    <div className="w-4 h-4 border-2 border-brand/30 border-t-brand rounded-full animate-spin" />
                  ) : (
                    <Database size={14} />
                  )}
                  {t('settings_page.data.refresh_logs', 'تحديث السجل')}
                </button>
              </div>

              {/* Logs Content */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 custom-scrollbar">
                {loadingLogs ? (
                  <div className="h-full flex flex-col items-center justify-center space-y-3">
                    <div className="w-12 h-12 border-4 border-brand/30 border-t-brand rounded-full animate-spin" />
                    <p className="text-sm font-bold text-content-muted">{t('settings_page.data.loading_logs', 'جاري تحميل سجلات العمليات...')}</p>
                  </div>
                ) : auditLogs.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8">
                    <FileText size={48} className="text-content-muted mb-3 opacity-40" />
                    <p className="font-black text-content text-lg">{t('settings_page.data.no_logs', 'لا توجد سجلات تدقيق حتى الآن')}</p>
                    <p className="text-sm text-content-muted font-bold mt-1">{t('settings_page.data.no_logs_desc', 'تظهر السجلات هنا فور قيام الموظفين بعمليات الحفظ أو التعديل.')}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {auditLogs
                      .filter(log => {
                        const term = (searchTerm || '').toLowerCase();
                        return (
                          (log.staff_name || '').toLowerCase().includes(term) ||
                          (log.action || '').toLowerCase().includes(term) ||
                          (log.details || '').toLowerCase().includes(term) ||
                          (log.branch_name || '').toLowerCase().includes(term)
                        );
                      })
                      .map((log) => (
                        <div key={log.id} className={cn("p-4 bg-surface-muted/30 border border-border/60 rounded-2xl flex flex-col sm:flex-row sm:items-start justify-between gap-3", isRtl ? "text-right" : "text-left")}>
                          <div className="space-y-1.5 flex-1 min-w-0">
                            <div className="flex items-center gap-2.5 flex-wrap">
                              <span className="font-black text-sm text-content flex items-center gap-1">
                                {log.staff_name}
                              </span>
                              <span className="text-[10px] bg-brand/5 text-brand px-2 py-0.5 rounded-full font-black border border-brand/10">
                                {log.action}
                              </span>
                              {log.branch_name && (
                                <span className="text-[10px] bg-warning/5 text-warning px-2 py-0.5 rounded-full font-black border border-warning/10">
                                  {log.branch_name}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-content font-semibold leading-relaxed break-words">
                              {log.details}
                            </p>
                          </div>
                          <div className={cn("shrink-0 text-[10px] font-bold text-content-muted flex items-center gap-1.5", isRtl ? "justify-end text-right" : "justify-start text-left")}>
                            <span>{new Date(log.occurred_at).toLocaleString(i18n.language === 'ar' ? 'ar-SA' : 'en-US')}</span>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
