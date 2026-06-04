import React, { useState, useEffect } from 'react';
import { Store, MapPin, Phone, Globe, Bell, Shield, CreditCard, MessageSquare, CheckCircle2, AlertCircle, ChevronRight, ExternalLink, Zap, Upload, X as CloseIcon, Database, Trash2, ShieldCheck, Palette, FileText, HelpCircle, Layout, Mail } from 'lucide-react';
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
import InvoiceLayoutSettings from './InvoiceLayoutSettings';

import Branding from './Branding';

interface SettingsProps {
  tenantId: string;
}

type TabType = 'profile' | 'appearance' | 'invoice' | 'tax' | 'branches' | 'staff' | 'whatsapp' | 'billing' | 'notifications' | 'data';

export default function Settings({ tenantId }: SettingsProps) {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('profile');
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [isDeletingTestData, setIsDeletingTestData] = useState(false);
  const [userEmail, setUserEmail] = useState<string>('');
  const { currentStaff } = useStaff();

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
      inventoryStrategy: 'centralized' as const,
      logoUrl: '',
      taxSettings: {
        enabled: false,
        trn: '',
        legalName: '',
        vatRate: 15
      }
    }
  });

  const currentStrategy = watch('inventoryStrategy');
  const taxEnabled = watch('taxSettings.enabled');

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
          reset({
            name: data.name || '',
            phone: data.phone || '',
            address: data.address || '',
            currencySymbol: data.currency_symbol || '',
            inventoryStrategy: data.inventory_strategy || 'centralized',
            logoUrl: data.logo_url || '',
            taxSettings: data.tax_settings || {
              enabled: false,
              trn: '',
              legalName: '',
              vatRate: 15
            }
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
      const { error } = await supabase
        .from('tenants')
        .update({
          name: data.name,
          phone: data.phone,
          address: data.address,
          currency_symbol: data.currencySymbol,
          inventory_strategy: data.inventoryStrategy,
          logo_url: data.logoUrl,
          tax_settings: data.taxSettings
        })
        .eq('id', tenantId);

      if (error) throw error;

      alert('تم حفظ الإعدادات بنجاح');
      window.location.reload(); // Refresh to update logo in layout
    } catch (error) {
      handleError(error, OperationType.UPDATE, 'tenants');
    }
  };

  const handleDeleteTestData = async () => {
    if (!tenantId) return;
    if (!confirm('هل أنت متأكد من حذف جميع البيانات التجريبية؟ لا يمكن التراجع عن هذه الخطوة.')) return;

    setIsDeletingTestData(true);
    try {
      const tables = ['orders', 'customers', 'inventory_items', 'staff', 'notifications'];
      
      for (const tableName of tables) {
        const { error } = await supabase
          .from(tableName)
          .delete()
          .eq('tenant_id', tenantId)
          .eq('is_test', true);
        
        if (error) throw error;
      }

      alert(`تم حذف البيانات التجريبية بنجاح`);
      window.location.reload();
    } catch (error) {
      handleError(error, OperationType.DELETE, 'test_data');
      alert('حدث خطأ أثناء حذف البيانات التجريبية');
    } finally {
      setIsDeletingTestData(false);
    }
  };

  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand"></div>
      </div>
    );
  }

  const TABS: { id: TabType; label: string; icon: any; visible: boolean; group: string }[] = [
    { id: 'profile', label: 'الملف الشخصي', icon: Store, visible: true, group: 'business' },
    { id: 'tax', label: 'الإعدادات الضريبية', icon: FileText, visible: canEdit, group: 'business' },
    { id: 'branches', label: 'الفروع والمواقع', icon: MapPin, visible: hasPermission('branches.manage'), group: 'business' },
    
    { id: 'appearance', label: 'المظهر والسمات', icon: Palette, visible: true, group: 'system' },
    { id: 'invoice', label: 'تخطيط الفاتورة', icon: FileText, visible: true, group: 'system' },
    { id: 'notifications', label: 'التنبيهات', icon: Bell, visible: canViewNotifications, group: 'system' },
    { id: 'whatsapp', label: 'تكامل واتساب', icon: MessageSquare, visible: canViewWhatsApp, group: 'system' },
    
    { id: 'staff', label: 'الموظفين والصلاحيات', icon: Shield, visible: hasPermission('staff.manage'), group: 'admin' },
    { id: 'billing', label: 'الاشتراك والمدفوعات', icon: CreditCard, visible: canViewBilling, group: 'admin' },
    { id: 'data', label: 'إدارة البيانات', icon: Database, visible: currentStaff?.role === 'owner' || currentStaff?.role === 'super_admin', group: 'admin' },
  ];

  const groupedTabs = {
    business: { label: 'النشاط التجاري', tabs: TABS.filter(t => t.group === 'business' && t.visible) },
    system: { label: 'النظام والتفضيلات', tabs: TABS.filter(t => t.group === 'system' && t.visible) },
    admin: { label: 'الإدارة والاشتراك', tabs: TABS.filter(t => t.group === 'admin' && t.visible) },
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 text-right pb-20" dir="rtl">
      <Header 
        tenantId={tenantId} 
        title="الإعدادات" 
        subtitle="تخصيص تجربة متجرك وإدارة اشتراكك"
      />

      <div className="flex flex-col lg:flex-row gap-8 items-start">
        {/* Navigation Sidebar */}
        <aside className="w-full lg:w-72 shrink-0 space-y-8 sticky top-8">
          {Object.entries(groupedTabs).map(([key, group], gIdx) => group.tabs.length > 0 && (
            <div key={key} className="space-y-3">
              <h4 className="px-6 text-[10px] font-black text-content-muted uppercase tracking-widest">{group.label}</h4>
              <div className="space-y-1">
                {group.tabs.map((tab, tIdx) => (
                  <motion.button 
                    key={tab.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: (gIdx * 0.1) + (tIdx * 0.05) }}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-6 py-3.5 rounded-2xl text-sm font-bold transition-all group relative",
                      activeTab === tab.id 
                        ? "bg-brand text-white shadow-lg shadow-brand/10" 
                        : "text-content-muted hover:bg-surface-muted hover:text-brand"
                    )}
                  >
                    <tab.icon size={18} className={cn("transition-transform group-hover:scale-110", activeTab === tab.id ? "text-white" : "text-content-muted")} />
                    <span>{tab.label}</span>
                    {activeTab === tab.id && (
                      <motion.div layoutId="activeTabIndicator" className="absolute -left-1 top-1/2 -translate-y-1/2 w-1.5 h-6 bg-white rounded-full" />
                    )}
                  </motion.button>
                ))}
              </div>
            </div>
          ))}
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 min-w-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            >
              {activeTab === 'profile' && (
                <form onSubmit={handleSubmit(onSave)} className="bg-surface p-10 rounded-[3rem] border border-border shadow-xl shadow-brand/5 space-y-10">
                  <div className="flex flex-col md:flex-row items-center md:items-start gap-10 border-b border-border pb-10">
                    <div className="relative group">
                      <div className="w-40 h-40 bg-surface-muted rounded-[2.5rem] border-2 border-dashed border-border flex items-center justify-center overflow-hidden transition-all group-hover:border-brand/40 group-hover:bg-brand/5">
                        {logoPreview ? (
                          <img src={logoPreview} alt="Logo" className="w-full h-full object-cover" />
                        ) : (
                          <Store size={48} className="text-content-muted/30" />
                        )}
                      </div>
                      <label className="absolute -bottom-3 -right-3 p-3.5 bg-brand text-white rounded-2xl shadow-xl cursor-pointer hover:bg-brand/90 transition-all hover:scale-110 active:scale-95 group-hover:rotate-6">
                        <Upload size={22} />
                        <input type="file" className="hidden" accept="image/*" onChange={handleLogoChange} />
                      </label>
                      {logoPreview && (
                        <button 
                          type="button"
                          onClick={() => { setLogoPreview(null); setValue('logoUrl', ''); }}
                          className="absolute -top-3 -right-3 p-2 bg-danger text-white rounded-xl shadow-xl hover:bg-danger/90 transition-all hover:scale-110"
                        >
                          <CloseIcon size={18} />
                        </button>
                      )}
                    </div>
                    <div className="text-center md:text-right py-4 space-y-2">
                      <h3 className="text-2xl font-black text-content">هوية المتجر</h3>
                      <p className="text-sm text-content-muted font-medium leading-relaxed max-w-sm">
                        قم بتحميل شعار متجرك وتعديل المعلومات الأساسية التي تظهر لعملائك في النظام وعلى الفواتير الضريبية.
                      </p>
                      <div className="flex flex-wrap justify-center md:justify-start gap-2 pt-2">
                         <span className="px-3 py-1 bg-surface-muted rounded-full text-[10px] font-black text-content-muted uppercase tracking-tighter border border-border">Base64 Support</span>
                         <span className="px-3 py-1 bg-brand/5 rounded-full text-[10px] font-black text-brand uppercase tracking-tighter border border-brand/10">Bilingual Print</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between px-1">
                        <label className="text-[10px] font-black text-content-muted uppercase tracking-[0.2em]">اسم المنشأة التجاري</label>
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
                        <label className="text-[10px] font-black text-content-muted uppercase tracking-[0.2em]">رقم التواصل الموحد</label>
                        <HelpCircle size={14} className="text-content-muted/40 cursor-help" />
                      </div>
                      <IconInput 
                        type="text" 
                        {...register('phone')}
                        startIcon={Phone}
                        error={errors.phone?.message}
                      />
                    </div>
                    <div className="md:col-span-2 space-y-1.5">
                      <div className="flex items-center justify-between px-1">
                        <label className="text-[10px] font-black text-content-muted uppercase tracking-[0.2em]">البريد الإلكتروني (غير قابل للتعديل)</label>
                        <span className="text-[10px] text-slate-400 font-black bg-slate-100 dark:bg-slate-800 rounded px-2 py-0.5 select-none" dir="rtl">رسمي ومحمي</span>
                      </div>
                      <IconInput 
                        type="email" 
                        value={userEmail || ''}
                        readOnly
                        disabled
                        startIcon={Mail}
                        placeholder="لا يوجد بريد إلكتروني مسجل"
                      />
                    </div>
                    <div className="md:col-span-2 space-y-1.5">
                      <label className="text-[10px] font-black text-content-muted uppercase tracking-[0.2em] px-1">العنوان الجغرافي للمقر الرئيسي</label>
                      <IconInput 
                        type="text" 
                        {...register('address')}
                        startIcon={MapPin}
                        error={errors.address?.message}
                      />
                    </div>

                    <div className="md:col-span-2 space-y-3 p-6 bg-surface-muted/50 rounded-3xl border border-border/50">
                      <label className="text-[10px] font-black text-content-muted uppercase tracking-[0.2em] px-1">رمز العملة الرسمي</label>
                      <div className="max-w-xs">
                        <IconInput 
                          type="text" 
                          placeholder="SR أو ﷼"
                          {...register('currencySymbol')}
                          startIcon={CheckCircle2}
                          error={errors.currencySymbol?.message}
                        />
                      </div>
                      <p className="text-[10px] text-content-muted font-bold mt-1 px-1 opacity-60">سيتم استخدامه في جميع شاشات البيع والتقارير المالية.</p>
                    </div>

                    <div className="md:col-span-2 space-y-4">
                      <div className="flex items-center gap-2 px-1">
                        <Database size={14} className="text-brand" />
                        <label className="text-[10px] font-black text-content-muted uppercase tracking-[0.2em]">هندسة إدارة المخزون</label>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {[
                          { val: 'centralized', label: 'مخزون مركزي', sub: 'Centralized Strategy', desc: 'يتم السحب من مستودع موحد لجميع الفروع.', icon: Store },
                          { val: 'decentralized', label: 'مخزون فرعي', sub: 'Point-of-Sale Strategy', desc: 'كل فرع يتحكم في رصيده الخاص بشكل مستقل.', icon: MapPin },
                        ].map((strat) => (
                          <label key={strat.val} className={cn(
                            "relative flex flex-col p-6 rounded-[2rem] border-2 cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98] group",
                            currentStrategy === strat.val ? "border-brand bg-brand/5 ring-4 ring-brand/5 shadow-lg shadow-brand/5" : "border-border bg-surface hover:border-brand/30 hover:bg-surface-muted/30"
                          )}>
                            <input type="radio" value={strat.val} {...register('inventoryStrategy')} className="sr-only" />
                            <div className="flex items-center justify-between mb-4">
                              <div className={cn(
                                "p-3 rounded-2xl transition-colors",
                                currentStrategy === strat.val ? "bg-brand text-white" : "bg-surface-muted text-content-muted"
                              )}>
                                <strat.icon size={24} />
                              </div>
                              <div className={cn(
                                "w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all",
                                currentStrategy === strat.val ? "border-brand bg-brand" : "border-border group-hover:border-brand/30"
                              )}>
                                {currentStrategy === strat.val && <div className="w-2 h-2 bg-white rounded-full" />}
                              </div>
                            </div>
                            <p className="font-black text-content text-lg mb-1">{strat.label}</p>
                            <p className="text-[10px] text-brand/80 font-black uppercase tracking-wider mb-2" dir="ltr">{strat.sub}</p>
                            <p className="text-xs text-content-muted font-medium leading-relaxed">{strat.desc}</p>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="pt-8 border-t border-border flex justify-end items-center gap-4">
                    <p className="text-[10px] text-content-muted font-bold text-left hidden md:block">يتم حفظ هذه البيانات تلقائياً وتنعكس على جميع فروع المتجر</p>
                    {canEdit && (
                      <button 
                        type="submit"
                        disabled={isSubmitting}
                        className="bg-brand text-white px-10 py-4 rounded-[1.5rem] font-black hover:bg-brand/90 transition-all shadow-xl shadow-brand/20 disabled:opacity-50 hover:scale-105 active:scale-95 flex items-center gap-2"
                      >
                        {isSubmitting && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                        <span>حفظ إعدادات المنشأة</span>
                      </button>
                    )}
                  </div>
                </form>
              )}

              {activeTab === 'branches' && (
                <div className="bg-surface rounded-[2.5rem] border border-border shadow-sm overflow-hidden">
                  <WarehouseManagement tenantId={tenantId} />
                </div>
              )}

              {activeTab === 'staff' && (
                <div className="space-y-6">
                  <div className="bg-surface-muted/30 p-6 rounded-[2rem] border border-border flex items-center gap-6">
                    <div className="w-14 h-14 bg-brand/10 text-brand rounded-2xl flex items-center justify-center shadow-inner">
                      <Shield size={28} />
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-lg font-black text-content">إدارة الطاقم والصلاحيات</h4>
                      <p className="text-sm text-content-muted font-medium">قم بإضافة الموظفين وتعيين الأدوار الوظيفية لهم للتحكم في ما يمكنهم رؤيته أو تعديله في النظام.</p>
                    </div>
                  </div>
                  <div className="bg-surface rounded-[3rem] border border-border shadow-xl shadow-brand/5 overflow-hidden">
                    <Staff tenantId={tenantId} />
                  </div>
                </div>
              )}

              {activeTab === 'appearance' && (
                <div className="bg-surface p-10 rounded-[3rem] border border-border shadow-xl shadow-brand/5 space-y-10">
                  <div className="flex items-center gap-5 border-b border-border pb-8">
                    <div className="p-4 bg-brand/10 text-brand rounded-[1.5rem] shadow-inner">
                      <Palette size={32} />
                    </div>
                    <div>
                      <h3 className="text-2xl font-black text-content">هوية النظام البصرية</h3>
                      <p className="text-sm text-content-muted font-medium mt-1 uppercase tracking-tight">خصص ألوان الواجهة والخطوط لتناسب العلامة التجارية لمتجرك</p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="bg-surface-muted/30 p-6 rounded-[2rem] border border-border space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-brand text-white rounded-lg">
                          <Palette size={18} />
                        </div>
                        <h4 className="font-black text-content uppercase tracking-widest text-xs">ثيم الواجهة (Themes)</h4>
                      </div>
                      <p className="text-xs text-content-muted font-medium px-2">اختر الثيم الذي يرتاح له موظفوك أثناء العمل الطويل على النظام.</p>
                      <ThemeSwitcher />
                    </div>

                    <div className="bg-surface-muted/30 p-6 rounded-[2rem] border border-border flex items-center justify-center">
                       <div className="text-center space-y-2 opacity-50">
                          <Layout size={40} className="mx-auto text-content-muted" />
                          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-content-muted">قريباً: تخصيص الخطوط والرموز</p>
                       </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'invoice' && (
                <InvoiceLayoutSettings tenantId={tenantId} />
              )}

              {activeTab === 'tax' && (
                <form onSubmit={handleSubmit(onSave)} className="bg-surface p-10 rounded-[3rem] border border-border shadow-xl shadow-brand/5 space-y-10">
                  <div className="flex items-center gap-5 border-b border-border pb-8">
                    <div className="p-4 bg-brand/10 text-brand rounded-[1.5rem] shadow-inner">
                      <FileText size={32} />
                    </div>
                    <div>
                      <h3 className="text-2xl font-black text-content">الامتثال الضريبي</h3>
                      <p className="text-sm text-content-muted font-medium mt-1 uppercase tracking-tight">إدارة معايير هيئة الزكاة والضريبة والجمارك (ZATCA)</p>
                    </div>
                  </div>

                  <div className="space-y-8">
                    <label className={cn(
                      "flex items-center justify-between p-8 rounded-[2.5rem] border-2 cursor-pointer transition-all group",
                      taxEnabled ? "border-brand bg-brand/5 shadow-lg shadow-brand/5" : "border-border hover:border-brand/20 bg-surface-muted/30"
                    )}>
                      <div className="max-w-xl">
                        <h4 className="text-lg font-black text-content flex items-center gap-3">
                          وضع الفوترة الإلكترونية المتقدمة
                          {taxEnabled && (
                            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="bg-success text-white p-1 rounded-full">
                              <ShieldCheck size={14} />
                            </motion.span>
                          )}
                        </h4>
                        <p className="text-sm text-content-muted mt-2 font-medium leading-relaxed">تفعيل الضريبة يضمن توافق متجرك مع متطلبات المرحلة الثانية من الفوترة الإلكترونية، بما في ذلك التوقيع الرقمي ورمز الاستجابة السريع المحمي.</p>
                      </div>
                      <div className="relative">
                        <input type="checkbox" {...register('taxSettings.enabled')} className="sr-only" />
                        <div className={cn(
                          "w-16 h-8 rounded-full transition-all relative overflow-hidden",
                          taxEnabled ? "bg-brand" : "bg-surface-muted"
                        )}>
                          <div className={cn(
                            "absolute top-1 w-6 h-6 rounded-full bg-white transition-all shadow-md",
                            taxEnabled ? "left-1" : "right-1 text-content-muted flex items-center justify-center text-[8px]"
                          )} />
                        </div>
                      </div>
                    </label>

                    <AnimatePresence>
                      {taxEnabled && (
                        <motion.div 
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className="grid grid-cols-1 md:grid-cols-2 gap-10 bg-surface-muted/30 p-10 rounded-[2.5rem] border border-border/50"
                        >
                          <div className="space-y-3">
                            <label className="text-[10px] font-black text-content-muted uppercase tracking-[0.2em] px-1">الرقم الضريبي (TRN - 15 خانة)</label>
                            <input 
                              type="text" 
                              {...register('taxSettings.trn')}
                              className={cn(
                                "w-full bg-surface border-2 border-transparent focus:border-brand/30 rounded-2xl p-4 font-black transition-all outline-none text-content text-left tracking-widest shadow-inner shadow-black/5",
                                errors.taxSettings?.trn && "border-red-500"
                              )}
                              dir="ltr"
                            />
                            {errors.taxSettings?.trn && <p className="text-xs text-red-500 font-bold">{errors.taxSettings.trn.message}</p>}
                          </div>
                          <div className="space-y-3">
                            <label className="text-[10px] font-black text-content-muted uppercase tracking-[0.2em] px-1">اسم المكلف القانوني</label>
                            <input 
                              type="text" 
                              {...register('taxSettings.legalName')}
                              className={cn(
                                "w-full bg-surface border-2 border-transparent focus:border-brand/30 rounded-2xl p-4 font-bold transition-all outline-none text-content shadow-inner shadow-black/5",
                                errors.taxSettings?.legalName && "border-red-500"
                              )}
                              placeholder="الاسم المسجل في الشهادة الضريبية"
                            />
                            {errors.taxSettings?.legalName && <p className="text-xs text-red-500 font-bold">{errors.taxSettings.legalName.message}</p>}
                          </div>
                          <div className="space-y-3 md:col-span-2">
                             <div className="flex items-center justify-between px-1">
                                <label className="text-[10px] font-black text-content-muted uppercase tracking-[0.2em]">نسبة الضريبة القياسية</label>
                                <span className="text-[10px] font-black text-brand bg-brand/10 px-2 py-0.5 rounded-full">المملكة العربية السعودية: 15%</span>
                             </div>
                            <div className="relative group">
                              <span className="absolute left-6 top-1/2 -translate-y-1/2 font-black text-content-muted">%</span>
                              <input 
                                type="number" 
                                {...register('taxSettings.vatRate')}
                                className={cn(
                                  "w-full bg-surface border-2 border-transparent focus:border-brand/30 rounded-2xl p-4 pl-12 font-black transition-all outline-none text-content shadow-inner shadow-black/5",
                                  errors.taxSettings?.vatRate && "border-red-500"
                                )}
                                min="0" max="100"
                              />
                            </div>
                            {errors.taxSettings?.vatRate && <p className="text-xs text-red-500 font-bold">{errors.taxSettings.vatRate.message}</p>}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Overall Form Errors (Helpful if errors are in other tabs) */}
                    {Object.keys(errors).length > 0 && (
                      <div className="p-4 bg-danger/5 border border-danger/10 rounded-2xl flex items-center gap-3 text-danger">
                        <AlertCircle size={20} />
                        <div className="text-sm font-bold">
                          يوجد أخطاء في البيانات المدخلة. يرجى التأكد من ملء جميع الحقول المطلوبة (بماه في ذلك الاسم والعنوان في تبويب الملف الشخصي).
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="pt-8 border-t border-border flex justify-end items-center gap-5">
                     <p className="text-[10px] text-warning font-bold max-w-xs text-left leading-tight hidden md:block">
                        تأكد من صحة الرقم الضريبي؛ أي خطأ قد يؤدي إلى رفض الفاتورة من قبل منصة فاتورة.
                     </p>
                    {canEdit && (
                      <button 
                        type="submit"
                        disabled={isSubmitting}
                        className="bg-brand text-white px-10 py-4 rounded-[1.5rem] font-black hover:bg-brand/90 transition-all shadow-xl shadow-brand/20 disabled:opacity-50 hover:scale-105 active:scale-95"
                      >
                        {isSubmitting ? 'جاري المزامنة...' : 'حفظ بيانات التكليف'}
                      </button>
                    )}
                  </div>
                </form>
              )}

              {activeTab === 'whatsapp' && (
                <div className="bg-surface p-10 rounded-[3rem] border border-border shadow-xl shadow-brand/5 space-y-10">
                  <div className="flex items-center gap-5 border-b border-border pb-8">
                    <div className="p-4 bg-success/10 text-success rounded-[1.5rem] shadow-inner">
                      <MessageSquare size={32} />
                    </div>
                    <div>
                      <h3 className="text-2xl font-black text-content">محرك واتساب (WhatsApp)</h3>
                      <p className="text-sm text-content-muted font-medium mt-1 uppercase tracking-tight">إرسال الفواتير والتنبيهات للعملاء آلياً</p>
                    </div>
                  </div>

                  <div className="space-y-8">
                    <div className="flex flex-col md:flex-row items-center justify-between p-8 bg-success/5 rounded-[2.5rem] border border-success/10 gap-6">
                      <div className="flex items-start gap-5 flex-1">
                        <div className="p-4 bg-white rounded-2xl shadow-sm shrink-0">
                          <Zap size={28} className="text-success animate-pulse" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-lg font-black text-content">الفواتير الذكية</p>
                          <p className="text-sm text-content-muted font-medium leading-relaxed">بمجرد الضغط على "الدفع"، سيتم إرسال نسخة من الفاتورة إلى رقم واتساب الخاص بالعميل بشكل فوري.</p>
                        </div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer shrink-0">
                        <input type="checkbox" className="sr-only peer" defaultChecked />
                        <div className="w-16 h-8 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-success"></div>
                      </label>
                    </div>

                    <div className="space-y-4">
                       <div className="flex items-center justify-between px-2">
                          <label className="text-[10px] font-black text-content-muted uppercase tracking-[0.2em]">قالب الرسالة المخصص</label>
                          <span className="text-[10px] font-black text-success bg-success/10 px-2 py-0.5 rounded-full">دعم المتغيرات الذكية</span>
                       </div>
                       <div className="relative group">
                          <textarea 
                            defaultValue="مرحباً {customer_name}، تم استلام طلبك رقم {order_id}. يمكنك متابعة حالة الطلب من هنا: {invoice_url}"
                            className="w-full bg-surface-muted border-2 border-transparent focus:border-brand/20 focus:bg-surface rounded-3xl p-8 font-bold transition-all outline-none h-48 resize-none text-sm leading-relaxed text-content shadow-inner"
                          />
                          <div className="absolute left-4 bottom-4 flex gap-2">
                            {['{customer_name}', '{order_id}', '{invoice_url}'].map(tag => (
                              <button key={tag} className="text-[8px] bg-brand/10 text-brand px-2 py-1 rounded-md font-black hover:bg-brand hover:text-white transition-colors uppercase tracking-tight">{tag}</button>
                            ))}
                          </div>
                       </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'billing' && (
                <div className="space-y-8 max-w-5xl mx-auto">
                  {/* Premium Plan Dashboard */}
                  <div className="bg-brand text-white p-12 rounded-[3.5rem] shadow-2xl shadow-brand/20 relative overflow-hidden group">
                    <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_top_left,_var(--tw-gradient-stops))] from-white/10 via-transparent to-transparent opacity-50" />
                    <div className="relative z-10 flex flex-col md:flex-row justify-between items-center gap-10">
                      <div className="space-y-5 text-center md:text-right">
                        <div className="inline-flex items-center gap-2 bg-white/20 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest text-white border border-white/10 backdrop-blur-md">
                          <Zap size={14} className="fill-white" />
                          خطة التشغيل الفعالة
                        </div>
                        <h3 className="text-5xl font-black tracking-tighter">سين برو <span className="text-white/40 text-2xl">SEEN PRO</span></h3>
                        <p className="text-white/80 font-medium max-w-md text-lg leading-relaxed">أنت تستخدم أعلى باقة متوفرة؛ صلاحيات كاملة، تخزين غير محدود، ودعم فني مباشر عبر الواتساب.</p>
                      </div>
                      <div className="bg-white/10 backdrop-blur-xl p-8 rounded-[2.5rem] border border-white/20 text-center min-w-[240px]">
                        <p className="text-white/60 font-black uppercase tracking-[0.2em] text-[10px] mb-2">تاريخ الفوترة القادم</p>
                        <p className="text-3xl font-black text-white mb-6">15 أبريل 2026</p>
                        <button className="w-full bg-white text-brand px-8 py-4 rounded-2xl font-black transition-all hover:scale-105 active:scale-95 shadow-xl shadow-brand/20">
                          إدارة الاشتراك
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Billing Table */}
                  <div className="bg-surface p-10 rounded-[3rem] border border-border shadow-xl shadow-brand/5">
                    <div className="flex items-center justify-between mb-8 px-2">
                       <h4 className="text-sm font-black text-content-muted uppercase tracking-[0.2em] flex items-center gap-3">
                        <CreditCard size={18} className="text-brand" />
                        سجل العمليات المالية والرسوم
                      </h4>
                      <button className="text-[10px] font-black text-brand bg-brand/10 px-4 py-2 rounded-xl hover:bg-brand hover:text-white transition-all uppercase">تحميل السجل بالكامل</button>
                    </div>

                    <div className="space-y-4">
                      {[
                        { date: '15 مارس 2026', amount: 299, desc: 'اشتراك شهري SEEN PRO' },
                        { date: '15 فبراير 2026', amount: 299, desc: 'اشتراك شهري SEEN PRO' },
                        { date: '15 يناير 2026', amount: 299, desc: 'اشتراك شهري SEEN PRO' },
                      ].map((inv, idx) => (
                        <div key={inv.date} className="flex justify-between items-center p-6 bg-surface-muted/30 hover:bg-surface border-2 border-transparent hover:border-brand/10 hover:shadow-lg hover:shadow-brand/5 rounded-[2rem] transition-all group">
                          <div className="flex items-center gap-5">
                            <div className="w-12 h-12 bg-success/10 text-success rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                              <CheckCircle2 size={24} />
                            </div>
                            <div>
                              <p className="font-black text-content text-lg">{inv.desc}</p>
                              <p className="text-[10px] text-content-muted font-bold uppercase tracking-widest mt-0.5">{inv.date} • رقم مرجعي #{idx + 8921}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-8">
                            <span className="text-xl font-black text-content"><PriceDisplay amount={inv.amount} /></span>
                            <button className="p-3 bg-white text-content-muted hover:text-brand hover:bg-brand/5 transition-all rounded-xl shadow-sm">
                              <FileText size={20} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'notifications' && (
                <div className="bg-surface p-10 rounded-[3rem] border border-border shadow-xl shadow-brand/5 space-y-10">
                   <div className="flex items-center gap-5 border-b border-border pb-8">
                      <div className="p-4 bg-warning/10 text-warning rounded-[1.5rem] shadow-inner">
                        <Bell size={32} />
                      </div>
                      <div>
                        <h3 className="text-2xl font-black text-content">إشعارات النظام والبريد</h3>
                        <p className="text-sm text-content-muted font-medium mt-1 uppercase tracking-tight">تحكم في تنبيهات المتصفح وإشعارات الجوال</p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {[
                        { title: 'تحذيرات المخزون المنخفض', desc: 'سيتم تنبيهك عندما تصل كمية القماش أو الإكسسوارات للحد الأدنى.', icon: Database, color: 'text-danger' },
                        { title: 'إشعارات الطلبات الجديدة', desc: 'إشعار فوري عند قيام أي موظف بإنشاء فاتورة بيع جديدة.', icon: Store, color: 'text-brand' },
                        { title: 'تقارير الإغلاق اليومية', desc: 'ملخص بالأرباح والخسائر والمبيعات فور إغلاق الوردية.', icon: FileText, color: 'text-success' },
                        { title: 'مواعيد تسليم الغد', desc: 'تنبيه لقائمة العملاء الذين يجب تسليم طلباتهم في اليوم التالي.', icon: Bell, color: 'text-warning' },
                      ].map((item) => (
                        <div key={item.title} className="flex items-center justify-between p-8 bg-surface-muted/30 hover:bg-surface border-2 border-transparent hover:border-border rounded-[2.5rem] transition-all group">
                          <div className="flex items-start gap-5">
                            <div className={cn("p-4 bg-white rounded-2xl shadow-sm transition-transform group-hover:scale-110", item.color)}>
                              <item.icon size={26} />
                            </div>
                            <div className="space-y-1">
                              <p className="text-lg font-black text-content">{item.title}</p>
                              <p className="text-sm text-content-muted font-medium leading-relaxed max-w-md">{item.desc}</p>
                            </div>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" className="sr-only peer" defaultChecked />
                            <div className="w-14 h-7 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:bg-white after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand"></div>
                          </label>
                        </div>
                      ))}
                    </div>
                </div>
              )}

              {activeTab === 'data' && (
                <div className="bg-surface p-10 rounded-[3rem] border border-border shadow-xl shadow-brand/5 space-y-10">
                   <div className="flex items-center gap-5 border-b border-border pb-8">
                      <div className="p-4 bg-danger/10 text-danger rounded-[1.5rem] shadow-inner">
                        <Database size={32} />
                      </div>
                      <div>
                        <h3 className="text-2xl font-black text-content">إدارة البيانات وسرية المعلومات</h3>
                        <p className="text-sm text-content-muted font-medium mt-1 uppercase tracking-tight">التحكم في سجلات النظام والبيانات المؤرشفة</p>
                      </div>
                    </div>

                    <div className="space-y-8">
                      <div className="p-10 bg-danger/5 rounded-[3rem] border-2 border-dashed border-danger/20 space-y-6">
                        <div className="flex items-center gap-4 text-danger">
                          <div className="p-3 bg-danger text-white rounded-2xl shadow-lg shadow-danger/20">
                            <AlertCircle size={28} />
                          </div>
                          <h4 className="text-2xl font-black tracking-tight">المنطقة الخطرة (Critical Zone)</h4>
                        </div>
                        <p className="text-base text-danger/80 font-bold leading-relaxed max-w-2xl">
                          حذف البيانات التجريبية سيمسح جميع السجلات التي تم تمييزها كـ "بيانات اختبار". 
                          هذا الإجراء مفيد جداً قبل الانتقال لبيئة التشغيل الفعلية (Go-Live) لتصفير عداد الطلبات والعملاء الوهميين.
                        </p>
                        <div className="pt-4">
                          <button
                            onClick={handleDeleteTestData}
                            disabled={isDeletingTestData}
                            className="flex items-center gap-3 bg-danger text-white px-10 py-5 rounded-[1.5rem] font-black hover:bg-danger/90 transition-all shadow-xl shadow-danger/20 disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98]"
                          >
                            {isDeletingTestData ? (
                              <div className="w-6 h-6 border-4 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                              <Trash2 size={24} />
                            )}
                            <span className="text-lg">تصفير النظام وحذف البيانات التجريبية</span>
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 p-1">
                        <button className="flex flex-col items-center justify-center p-10 bg-surface rounded-[2.5rem] border-2 border-border border-dashed hover:border-brand/40 hover:bg-brand/5 transition-all group">
                          <div className="p-4 bg-surface-muted rounded-2xl mb-4 group-hover:scale-110 transition-transform">
                             <Database size={32} className="text-content-muted" />
                          </div>
                          <p className="font-black text-content">تصدير قاعدة البيانات (JSON)</p>
                          <p className="text-[10px] text-content-muted font-bold mt-2 uppercase">آخر نسخة تم تصديرها: لم تُجرى بعد</p>
                        </button>
                        <button className="flex flex-col items-center justify-center p-10 bg-surface rounded-[2.5rem] border-2 border-border border-dashed hover:border-success/40 hover:bg-success/5 transition-all group">
                          <div className="p-4 bg-surface-muted rounded-2xl mb-4 group-hover:scale-110 transition-transform">
                             <FileText size={32} className="text-content-muted" />
                          </div>
                          <p className="font-black text-content">سجلات تدقيق العمليات (Audit)</p>
                          <p className="text-[10px] text-content-muted font-bold mt-2 uppercase">مفعل لجميع مديري النظام والملاك</p>
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
    </div>
  );
}
