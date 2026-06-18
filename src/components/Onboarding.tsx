import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Coins, Globe, MapPin, Store, ArrowLeft, ArrowRight, Loader2, Navigation, Upload, ShieldCheck, CheckCircle, ChevronDown, CheckCircle2, Image as ImageIcon, Check } from 'lucide-react';
import { Controller } from 'react-hook-form';
import { SmartSelect } from './ui/SmartSelect';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icons in Leaflet with Vite
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIconRetina from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

const DefaultIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIconRetina,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;
import { useTranslation } from 'react-i18next';
import { useToast } from '../contexts/ToastContext';
import { auth } from '../lib/firebase';
import { uploadImageToSupabase } from '../lib/supabase/storage';
import { supabase, setSupabaseAuthToken } from '../lib/supabase/client';
import { useNavigate } from 'react-router-dom';
import { hashPin } from '../services/staffService';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { onboardingSchema } from '../lib/validations';
import { cn } from '../lib/utils';
import { analytics, AnalyticsEvent } from '../services/analyticsService';
import { logEmployeeAction } from '../services/employeeAuditService';

type Step = 1 | 2 | 3;

interface OnboardingProps {
  onComplete?: () => void;
}

function MapController({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom());
  }, [center, map]);
  return null;
}

function LocationMarker({ 
  latitude, 
  longitude, 
  onLocationSelect 
}: { 
  latitude: number | undefined, 
  longitude: number | undefined,
  onLocationSelect: (lat: number, lng: number, address: string, city: string) => void
}) {
  const map = useMapEvents({
    async click(e) {
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${e.latlng.lat}&lon=${e.latlng.lng}&accept-language=ar`
        );
        const data = await response.json();
        let address = '';
        let city = '';
        if (data && data.display_name) {
          address = data.display_name;
          if (data.address) {
            city = data.address.city || data.address.town || data.address.village || data.address.state || '';
          }
        }
        onLocationSelect(e.latlng.lat, e.latlng.lng, address, city);
      } catch (error) {
        console.warn('Reverse geocoding failed:', error);
        onLocationSelect(e.latlng.lat, e.latlng.lng, '', '');
      }
    },
  });

  return latitude && longitude ? (
    <Marker position={[latitude, longitude]} />
  ) : null;
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const { t, i18n } = useTranslation();
  const { success: showSuccess, handleError: handleGlobalError, error: showError } = useToast();
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const { 
    register, 
    handleSubmit, 
    trigger, 
    setValue,
    watch,
    control,
    formState: { errors, isValid } 
  } = useForm({
    resolver: zodResolver(onboardingSchema),
    mode: 'onChange',
    defaultValues: {
      customerId: `SN-${Math.floor(100000 + Math.random() * 900000)}`,
      shopName: '',
      category: 'tailor' as const,
      taxNumber: '',
      taxStatus: 'registered' as const,
      address: '',
      city: '',
      country: 'KSA',
      currency: 'SAR',
      language: 'ar' as const,
      inventoryStrategy: 'centralized' as const,
      invoiceDefaults: 'نتطلع لخدمتكم مرة أخرى',
      defaultLayout: 'sidebar' as const,
      logoUrl: '',
      pin: '',
      latitude: 24.7136,
      longitude: 46.6753
    }
  });

  const formData = watch();

  // Trigger map resize when stepping into map step
  useEffect(() => {
    if (currentStep === 2) {
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 500);
    }
  }, [currentStep]);

  const steps = [
    { id: 1 as Step, title: t('onboarding.steps.identity', 'الهوية'), icon: Store, description: t('onboarding.steps.identity_desc', 'بيانات المنشأة') },
    { id: 2 as Step, title: t('onboarding.steps.location', 'الموقع'), icon: MapPin, description: t('onboarding.steps.location_desc', 'تحديد الموقع الجغرافي') },
    { id: 3 as Step, title: t('onboarding.steps.preferences', 'المالية والضريبة'), icon: ShieldCheck, description: t('onboarding.steps.preferences_desc', 'الإعدادات المالية والضريبية') }
  ];

  const checkVatValid = (vat: string | undefined) => vat && vat.length === 15 && /^\d+$/.test(vat);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file size (2MB)
    if (file.size > 2 * 1024 * 1024) {
      showError(t('onboarding.messages.logo_size_error'));
      return;
    }

    setLoading(true);
    try {
      const publicUrl = await uploadImageToSupabase(file, 'logos');

      setValue('logoUrl', publicUrl);
    } catch (error) {
      console.error('Logo upload failed:', error);
      handleGlobalError(error, t('onboarding.messages.logo_upload_error'));
    } finally {
      setLoading(false);
    }
  };

  const handleNext = async () => {
    let fieldsToValidate: any[] = [];
    if (currentStep === 1) fieldsToValidate = ['shopName', 'category', 'taxNumber', 'taxStatus'];
    if (currentStep === 2) fieldsToValidate = ['address', 'city', 'country'];
    
    if (currentStep === 3) {
      setLoading(true);
      handleSubmit(
        async (data) => {
          try {
            await onSubmit(data);
          } finally {
            setLoading(false);
          }
        }, 
        (errs) => {
          console.error("Form Errors:", errs);
          setLoading(false);
          const errorMessages = Object.values(errs).map(e => (e as any).message).join(', ');
          showError(t('onboarding.messages.validation_failed', 'يرجى التأكد من صحة البيانات: '), errorMessages);
        }
      )();
      return;
    }

    setLoading(true);
    try {
      const isStepValid = await trigger(fieldsToValidate);
      if (isStepValid) {
        setCurrentStep((prev) => (prev as number + 1) as Step);
        window.scrollTo(0, 0);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setCurrentStep((prev) => (prev as number - 1) as Step);
  };

  const onSubmit = async (data: any) => {
    console.log("[Onboarding] Starting submission with data:", data);
    try {
      const user = auth?.currentUser;
      if (!user) throw new Error("No authenticated user found. Please login again.");

      // Force refresh token to ensure Supabase doesn't get a "JWT expired" error during the long process
      console.log("[Onboarding] Refreshing token...");
      const token = await user.getIdToken(true);
      setSupabaseAuthToken(token);

      // Ensure user exists in users table to satisfy foreign key constraints
      console.log("[Onboarding] Ensuring user exists...");
      const { error: userError } = await supabase.from('users').upsert({
        id: user.uid,
        email: user.email,
        display_name: user.displayName || 'Owner',
        phone: user.phoneNumber || ''
      });

      if (userError) {
         if (userError.message?.includes('row-level security') || userError.code === '42501') {
            throw new Error(`مشكلة في صلاحيات قاعدة البيانات (RLS). يرجى فتح Supabase SQL Editor وتنفيذ محتوى الملف: allow-all-rls.sql أو fix-rls.sql لتتمكن من إنشاء الحسابات.`);
         }
         throw new Error(`Failed to initialize global user profile: ${userError.message}`);
      }

      // 1. Get Existing Tenant
      console.log("[Onboarding] Fetching existing tenant...");
      const { data: existingTenant, error: fetchTenantError } = await supabase
        .from('tenants')
        .select('id')
        .eq('owner_uid', user.uid)
        .single();
      
      if (fetchTenantError || !existingTenant) {
        throw new Error(`لم يتم العثور على المتجر المرتبط بهذا الحساب`);
      }
      const tenantId = existingTenant.id;

      // 2. Update Tenant
      console.log("[Onboarding] Updating tenant...");
      const { error: tenantError } = await supabase.from('tenants').update({
        name: data.shopName,
        address: data.address,
        phone: user.phoneNumber || '',
        inventory_strategy: data.inventoryStrategy,
        status: 'active',
        vat_number: data.taxNumber || '',
        logo_url: data.logoUrl || '',
        default_layout: data.defaultLayout || 'sidebar'
      }).eq('id', tenantId);

      if (tenantError) throw new Error(`Failed to update tenant: ${tenantError.message}`);

      // 3. Update Default Branch
      console.log("[Onboarding] Updating branch...");
      const { data: existingBranch, error: fetchBranchError } = await supabase
        .from('branches')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('is_main', true)
        .limit(1)
        .single();

      let branchId;
      if (existingBranch && !fetchBranchError) {
        branchId = existingBranch.id;
        await supabase.from('branches').update({
          location: data.address,
          phone: user.phoneNumber || ''
        }).eq('id', branchId);
      } else {
         const { data: branchData, error: branchError } = await supabase.from('branches').insert({
          tenant_id: tenantId,
          name: t('common.branches.main_branch', 'المعرض الرئيسي'),
          location: data.address,
          phone: user.phoneNumber || '',
          type: 'store',
          is_main: true
        }).select('id').single();
        if (branchError) throw new Error(`Failed to create branch: ${branchError.message}`);
        branchId = branchData.id;
      }

      // 4. Update Owner Staff record
      console.log("[Onboarding] Updating owner staff branch...");
      const { error: staffError } = await supabase.from('staff').update({
        name: data.shopName,
        branch_id: branchId,
        must_change_pin: true
      }).eq('tenant_id', tenantId).eq('uid', user.uid);

      if (staffError) throw new Error(`Failed to update staff: ${staffError.message}`);
      console.log("[Onboarding] Staff updated successfully.");

      // Update tailor_requests onboarding_step to 4 to mark completion durably
      try {
        await supabase
          .from('tailor_requests')
          .update({ onboarding_step: 4 })
          .eq('uid', user.uid);
      } catch (err) {
        console.warn("Failed to update tailor_requests onboarding step:", err);
      }

      // 4. Analytics & Logging (Backgrounded)
      try {
        analytics.track(AnalyticsEvent.TENANT_ONBOARDED, {
          tenant_id: tenantId,
          customer_id: data.customerId,
          category: data.category
        });

        logEmployeeAction(
          tenantId,
          user.uid,
          data.shopName,
          'security',
          t('onboarding.messages.audit_log', { shopName: data.shopName, customerId: data.customerId })
        ).catch(e => console.warn('Background log failed:', e));
      } catch (e) {
        console.warn('Analytics fire failed:', e);
      }

      // Force refresh data
      localStorage.setItem('setup_complete', 'true');
      localStorage.setItem('onboarding_completed', 'true');
      localStorage.setItem('tenant_id', tenantId);
      
      showSuccess(t('onboarding.messages.success'));
      
      // Seamless transition: Trigger callback and direct navigation instead of hard reload
      setTimeout(() => {
        if (onComplete) {
          onComplete();
        } else {
          window.location.href = '/';
        }
      }, 1000);
    } catch (error) {
      console.error('Onboarding failed:', error);
      handleGlobalError(error, t('onboarding.messages.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center p-3 sm:p-6 md:p-8 font-sans" dir={i18n.language === 'en' ? 'ltr' : 'rtl'}>
      {/* Container Expansion */}
      <div className="w-full max-w-6xl">
        
        <div className="mb-14 sm:mb-16">
            {/* Logo/Branding Header */}
            <div className="flex items-center justify-center gap-3 mb-8 sm:mb-10">
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-brand rounded-2xl flex items-center justify-center shadow-lg shadow-brand/20">
                <ShieldCheck className="text-white sm:w-7 sm:h-7" size={24} />
              </div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">Seen System</h1>
            </div>
 
            {/* Form Stepper */}
            <div className="flex items-center justify-between relative px-2">
              <div className="absolute top-1/2 left-0 w-full h-0.5 bg-slate-200 -translate-y-1/2 z-0" />
              {steps.map((s, idx) => {
                const Icon = s.icon;
                const isActive = currentStep === s.id;
                const isCompleted = (currentStep as number) > s.id;
 
                return (
                  <div key={s.id} className="relative z-10 flex flex-col items-center group">
                    <div className={cn(
                      "w-10 h-10 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center transition-all duration-500 border-4 border-[#F8FAFC]",
                      isActive ? "bg-brand text-white shadow-xl shadow-brand/30 scale-110" : 
                      isCompleted ? "bg-emerald-500 text-white" : "bg-white text-slate-400"
                    )}>
                      {isCompleted ? <CheckCircle size={18} className="sm:w-6 sm:h-6" /> : <Icon size={18} className="sm:w-6 sm:h-6" />}
                    </div>
                    <div className="absolute -bottom-8 sm:-bottom-10 whitespace-nowrap text-center">
                      <p className={cn(
                        "text-[10px] sm:text-xs font-black uppercase tracking-wider transition-colors",
                        isActive ? "text-brand" : "text-slate-400"
                      )}>{s.title}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
 
        <AnimatePresence mode="wait">
            <motion.div 
              key={currentStep}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-white rounded-[2rem] sm:rounded-[3rem] shadow-2xl shadow-slate-200/50 border border-slate-100 overflow-hidden"
            >
              <div className="p-5 sm:p-8 md:p-14">
                {currentStep === 1 && (
                  <div className="space-y-8 sm:space-y-12 md:space-y-16">
                    <div className="max-w-2xl">
                      <h2 className="text-xl sm:text-2xl md:text-3xl font-black text-slate-900 mb-2">{t('onboarding.titles.identity')}</h2>
                      <p className="text-slate-500 font-medium text-sm sm:text-base md:text-lg leading-relaxed">
                        {t('onboarding.desc.identity')}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-10 bg-slate-50 p-4 sm:p-8 rounded-[1.5rem] sm:rounded-[3rem] border border-slate-100">
                      <div className="md:col-span-2">
                        <h3 className="text-lg sm:text-xl font-black text-slate-900 mb-2 flex items-center gap-3">
                          <Store className="text-brand" /> {t('onboarding.steps.identity')}
                        </h3>
                      </div>

                      <div className="space-y-4 sm:space-y-5">
                        <label className="text-xs sm:text-sm font-black text-slate-700 uppercase tracking-widest flex items-center gap-2">
                          {t('onboarding.fields.shop_name')}
                        </label>
                        <div className={cn(
                          "group flex items-center bg-white border-2 rounded-[1.5rem] sm:rounded-[2.5rem] overflow-hidden focus-within:border-brand transition-all shadow-sm focus-within:shadow-xl focus-within:shadow-brand/5",
                          errors.shopName ? "border-rose-500 bg-rose-50/30" : "border-slate-200"
                        )}>
                          <div className={cn(
                            "flex items-center justify-center p-3.5 sm:p-5 border-e transition-colors shrink-0",
                            errors.shopName ? "text-rose-500 border-rose-500/20" : "text-slate-300 border-slate-100 group-focus-within:border-brand/40 group-focus-within:text-brand"
                          )}>
                            <Store size={20} className="sm:w-6 sm:h-6" />
                          </div>
                          <input 
                            {...register('shopName')}
                            placeholder={t('onboarding.fields.shop_name_placeholder')}
                            className="flex-1 w-full bg-transparent border-none py-3.5 sm:py-5 px-4 sm:px-6 text-base sm:text-lg font-bold outline-none ring-0 placeholder:text-slate-300 text-content"
                          />
                        </div>
                        {errors.shopName && <p className="text-xs text-rose-500 font-bold mt-2 ps-4">{errors.shopName.message as string}</p>}
                      </div>

                      <div className="space-y-4 sm:space-y-5">
                        <label className="text-xs sm:text-sm font-black text-slate-700 uppercase tracking-widest flex items-center gap-2">
                          {t('onboarding.fields.activity_type')}
                        </label>
                        <Controller
                          control={control}
                          name="category"
                          render={({ field }) => (
                            <SmartSelect
                              {...field}
                              className="w-full bg-white border-2 border-slate-200 focus-within:border-brand rounded-[1.5rem] sm:rounded-[2.5rem] py-3.5 sm:py-5 px-5 sm:px-8 text-base sm:text-lg font-bold outline-none transition-all shadow-sm"
                              options={[
                                { value: 'tailor', label: t('onboarding.categories.tailor') },
                                { value: 'tailor-female', label: t('onboarding.categories.tailor_female') },
                                { value: 'uniform', label: t('onboarding.categories.uniform') }
                              ]}
                            />
                          )}
                        />
                      </div>

                      <div className="md:col-span-1 space-y-4 sm:space-y-6">
                        <label className="text-xs sm:text-sm font-black text-slate-700 uppercase tracking-widest block">{t('onboarding.fields.logo')}</label>
                        <input 
                          type="file" 
                          id="logo-upload" 
                          className="hidden" 
                          accept="image/*"
                          onChange={handleLogoUpload}
                        />
                        <label 
                          htmlFor="logo-upload"
                          className="flex items-center gap-4 p-1 bg-white rounded-[1.5rem] sm:rounded-[2.5rem] border-2 border-dashed border-slate-300 hover:border-brand hover:bg-slate-50 transition-all cursor-pointer group"
                        >
                          <div className="w-12 h-12 sm:w-16 sm:h-16 bg-slate-50 rounded-xl sm:rounded-2xl flex items-center justify-center shadow-sm text-slate-300 overflow-hidden group-hover:scale-105 transition-transform border border-slate-100 shrink-0">
                            {formData.logoUrl ? (
                              <img src={formData.logoUrl} alt="Logo Preview" className="w-full h-full object-cover" />
                            ) : (
                              <ImageIcon size={20} className="sm:w-6 sm:h-6" />
                            )}
                          </div>
                          <div className={cn("flex-1 min-w-0", i18n.language === 'en' ? "text-left" : "text-right")}>
                            <h3 className="font-black text-slate-800 text-xs sm:text-sm truncate group-hover:text-brand transition-colors">
                              {formData.logoUrl ? t('onboarding.fields.logo_uploaded') : t('onboarding.fields.logo_upload')}
                            </h3>
                          </div>
                        </label>
                      </div>

                      <div className="md:col-span-2 pt-6 sm:pt-8 border-t border-slate-200 mt-2 sm:mt-4">
                        <h3 className="text-lg sm:text-xl font-black text-slate-900 mb-4 sm:mb-6 flex items-center gap-3">
                          <ShieldCheck className="text-brand" /> {t('onboarding.fields.tax_info', 'البيانات الضريبية')}
                        </h3>
                      </div>

                      <div className="space-y-4 sm:space-y-5">
                        <label className="text-xs sm:text-sm font-black text-slate-700 uppercase tracking-widest flex items-center gap-2">
                          {t('onboarding.fields.tax_number')}
                        </label>
                        <div className={cn(
                          "group flex items-center bg-white border-2 rounded-[1.5rem] sm:rounded-[2.5rem] overflow-hidden transition-all shadow-sm focus-within:shadow-xl focus-within:shadow-brand/5",
                          errors.taxNumber ? "border-rose-500 bg-rose-50/30" : checkVatValid(watch('taxNumber')) ? "border-emerald-500" : "border-slate-200 focus-within:border-brand"
                        )}>
                          <div className={cn(
                            "flex items-center justify-center p-3.5 sm:p-5 border-e transition-colors shrink-0",
                            errors.taxNumber ? "text-rose-500 border-rose-500/20" : checkVatValid(watch('taxNumber')) ? "text-emerald-500 border-emerald-500/20" : "text-slate-300 border-slate-100 group-focus-within:border-brand/40 group-focus-within:text-brand"
                          )}>
                            <ShieldCheck size={20} className="sm:w-6 sm:h-6" />
                          </div>
                          <input 
                            {...register('taxNumber')}
                            placeholder={t('onboarding.fields.tax_number_placeholder')}
                            maxLength={15}
                            className="flex-1 min-w-0 bg-transparent border-none py-3.5 sm:py-5 px-4 sm:px-6 text-base sm:text-lg font-bold outline-none ring-0 placeholder:text-slate-300 text-content"
                          />
                          {checkVatValid(watch('taxNumber')) && (
                            <div className="mx-2 sm:mx-4 bg-emerald-100 text-emerald-600 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full text-[10px] sm:text-xs font-black flex items-center gap-1 shrink-0">
                              <Check size={12} className="sm:w-3.5 sm:h-3.5" /> {t('common.verified', 'موثق')}
                            </div>
                          )}
                        </div>
                        {errors.taxNumber && <p className="text-xs text-rose-500 font-bold mt-2 ps-4">{errors.taxNumber.message as string}</p>}
                      </div>

                      <div className="space-y-4 sm:space-y-5">
                        <label className="text-xs sm:text-sm font-black text-slate-700 uppercase tracking-widest flex items-center gap-2">
                          {t('onboarding.fields.tax_status')}
                        </label>
                        <Controller
                          control={control}
                          name="taxStatus"
                          render={({ field }) => (
                            <SmartSelect
                              {...field}
                              className="w-full bg-white border-2 border-slate-200 focus-within:border-brand rounded-[1.5rem] sm:rounded-[2.5rem] py-3.5 sm:py-5 px-5 sm:px-8 text-base sm:text-lg font-bold outline-none transition-all shadow-sm"
                              options={[
                                { value: 'registered', label: t('onboarding.tax_status_options.registered') },
                                { value: 'unregistered', label: t('onboarding.tax_status_options.unregistered') }
                              ]}
                            />
                          )}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {currentStep === 2 && (
                  <div className="space-y-8 sm:space-y-12 md:space-y-16">
                    <div className="max-w-2xl">
                      <h2 className="text-xl sm:text-2xl md:text-3xl font-black text-slate-900 mb-2">{t('onboarding.titles.location')}</h2>
                      <p className="text-slate-500 font-medium text-sm sm:text-base md:text-lg leading-relaxed">
                        {t('onboarding.desc.location')}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-10 mt-6 sm:mt-12 bg-indigo-50/50 p-4 sm:p-8 rounded-[1.5rem] sm:rounded-[3rem] border border-indigo-100/50">
                      <div className="md:col-span-2">
                        <h3 className="text-lg sm:text-xl font-black text-slate-900 mb-4 sm:mb-6 flex items-center gap-3">
                          <MapPin className="text-indigo-500" /> {t('onboarding.fields.address')}
                        </h3>
                      </div>

                      <div className="md:col-span-2 space-y-4 sm:space-y-5">
                        <label className={cn("text-xs sm:text-sm font-black text-slate-700 uppercase tracking-widest", i18n.language === 'en' ? "ps-2" : "pe-2")}>{t('onboarding.fields.address')}</label>
                        <div className={cn(
                          "group flex items-center bg-white border-2 rounded-[1.5rem] sm:rounded-[2.5rem] overflow-hidden focus-within:border-indigo-500 transition-all shadow-sm focus-within:shadow-xl focus-within:shadow-indigo-500/5",
                          errors.address ? "border-rose-500 bg-rose-50/30" : "border-slate-200"
                        )}>
                          <div className={cn(
                            "flex items-center justify-center p-3.5 sm:p-5 border-e transition-colors shrink-0",
                            errors.address ? "text-rose-500 border-rose-500/20" : "text-slate-300 border-slate-100 group-focus-within:border-indigo-500/40 group-focus-within:text-indigo-500"
                          )}>
                            <MapPin size={20} className="sm:w-6 sm:h-6" />
                          </div>
                          <input 
                            {...register('address')}
                            placeholder={t('onboarding.fields.address_placeholder')}
                            className="flex-1 w-full bg-transparent border-none py-3.5 sm:py-5 px-4 sm:px-6 text-base sm:text-lg font-bold outline-none ring-0 placeholder:text-slate-300 text-content"
                          />
                        </div>
                        {errors.address && <p className="text-xs text-rose-500 font-bold mt-2 ps-4">{errors.address.message as string}</p>}
                      </div>

                      <div className="space-y-4 sm:space-y-5">
                        <label className={cn("text-xs sm:text-sm font-black text-slate-700 uppercase tracking-widest", i18n.language === 'en' ? "ps-2" : "pe-2")}>{t('onboarding.fields.city')}</label>
                        <input 
                          {...register('city')}
                          placeholder={t('onboarding.fields.city_placeholder')}
                          className={cn(
                            "w-full bg-white border-2 border-slate-200 focus:border-indigo-500 rounded-[1.5rem] sm:rounded-[2.5rem] py-3.5 sm:py-5 px-5 sm:px-8 text-base sm:text-lg font-bold outline-none transition-all shadow-sm",
                            errors.city && "border-rose-500 bg-rose-50/30"
                          )}
                        />
                        {errors.city && <p className="text-xs text-rose-500 font-bold mt-2 ps-4">{errors.city.message as string}</p>}
                      </div>

                      <div className="space-y-4 sm:space-y-5">
                        <label className={cn("text-xs sm:text-sm font-black text-slate-700 uppercase tracking-widest", i18n.language === 'en' ? "ps-2" : "pe-2")}>{t('onboarding.fields.country')}</label>
                        <input 
                          {...register('country')}
                          placeholder={t('onboarding.fields.country_placeholder')}
                          className={cn(
                            "w-full bg-white border-2 border-slate-200 focus:border-indigo-500 rounded-[1.5rem] sm:rounded-[2.5rem] py-3.5 sm:py-5 px-5 sm:px-8 text-base sm:text-lg font-bold outline-none transition-all shadow-sm",
                            errors.country && "border-rose-500 bg-rose-50/30"
                          )}
                        />
                        {errors.country && <p className="text-xs text-rose-500 font-bold mt-2 ps-4">{errors.country.message as string}</p>}
                      </div>

                      <div className="md:col-span-2 space-y-4 sm:space-y-6">
                        <div className="h-[280px] sm:h-[400px] w-full rounded-[1.5rem] sm:rounded-[3rem] overflow-hidden border-2 border-white bg-white relative z-0 shadow-lg group">
                          <MapContainer 
                            center={[formData.latitude || 24.7136, formData.longitude || 46.6753]} 
                            zoom={13} 
                            style={{ height: '100%', width: '100%', zIndex: 0 }}
                            scrollWheelZoom={false}
                          >
                            <TileLayer
                              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            />
                            <MapController center={[formData.latitude || 24.7136, formData.longitude || 46.6753]} />
                            <LocationMarker 
                              latitude={formData.latitude} 
                              longitude={formData.longitude}
                              onLocationSelect={(lat, lng, address, city) => {
                                setValue('latitude', lat);
                                setValue('longitude', lng);
                                if (address) setValue('address', address);
                                if (city) setValue('city', city);
                              }} 
                            />
                          </MapContainer>
                          
                          <div className={cn(
                            "absolute bottom-4 left-4 right-4 sm:bottom-6 z-[10] bg-white/90 backdrop-blur-md p-4 sm:p-6 rounded-[1.5rem] sm:rounded-[2.2rem] border border-white shadow-2xl space-y-4 sm:max-w-xs md:min-w-[280px]",
                            i18n.language === 'en' ? "sm:right-6 sm:left-auto" : "sm:left-6 sm:right-auto"
                          )}>
                            <div className="flex items-start gap-4">
                              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-indigo-100 text-indigo-500 rounded-xl sm:rounded-2xl flex items-center justify-center shrink-0">
                                <Navigation size={20} className="sm:w-6 sm:h-6" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">{t('onboarding.fields.location_selected', 'الموقع المحدد')}</p>
                                <p className="text-xs sm:text-sm font-bold text-slate-700 line-clamp-2 leading-snug">
                                  {formData.address || t('onboarding.fields.location_manual', 'تم تحديد الموقع يدوياً')}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {currentStep === 3 && (
                  <div className="space-y-16">
                    <div className="max-w-2xl">
                      <h2 className="text-xl sm:text-2xl md:text-3xl font-black text-slate-900 mb-2">{t('onboarding.titles.financial_tax')}</h2>
                      <p className="text-slate-500 font-medium text-sm sm:text-base md:text-lg leading-relaxed">
                        {t('onboarding.desc.financial_tax')}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-10 bg-slate-50 p-4 sm:p-8 rounded-[1.5rem] sm:rounded-[3rem] border border-slate-100">
                      
                      <div className="md:col-span-2">
                        <h3 className="text-lg sm:text-xl font-black text-slate-900 mb-4 sm:mb-6 flex items-center gap-3">
                          <Coins className="text-amber-500" /> {t('onboarding.titles.preferences')}
                        </h3>
                      </div>

                      <div className="space-y-4 sm:space-y-5">
                        <label className={cn("text-xs sm:text-sm font-black text-slate-700 uppercase tracking-widest", i18n.language === 'en' ? "ps-2" : "pe-2")}>{t('onboarding.fields.currency')}</label>
                        <Controller
                          control={control}
                          name="currency"
                          render={({ field }) => (
                            <SmartSelect
                              {...field}
                              className="w-full bg-white border-2 border-slate-200 focus-within:border-brand rounded-[1.5rem] sm:rounded-[2.5rem] py-3.5 sm:py-5 px-5 sm:px-8 text-base sm:text-lg font-bold outline-none transition-all shadow-sm"
                              options={[
                                { value: 'SAR', label: 'ریال سعودي (SAR)' },
                                { value: 'AED', label: 'درهم إماراتي (AED)' },
                                { value: 'KWD', label: 'دينار كويتي (KWD)' },
                                { value: 'PKR', label: 'روپیہ (PKR)' },
                                { value: 'USD', label: 'Dollar (USD)' }
                              ]}
                            />
                          )}
                        />
                      </div>

                      <div className="space-y-4 sm:space-y-5">
                        <label className={cn("text-xs sm:text-sm font-black text-slate-700 uppercase tracking-widest", i18n.language === 'en' ? "ps-2" : "pe-2")}>{t('onboarding.fields.language')}</label>
                        <Controller
                          control={control}
                          name="language"
                          render={({ field }) => (
                            <SmartSelect
                              {...field}
                              className="w-full bg-white border-2 border-slate-200 focus-within:border-brand rounded-[1.5rem] sm:rounded-[2.5rem] py-3.5 sm:py-5 px-5 sm:px-8 text-base sm:text-lg font-bold outline-none transition-all shadow-sm"
                              options={[
                                { value: 'ar', label: 'العربية' },
                                { value: 'en', label: 'English' },
                                { value: 'ur', label: 'اردو (Urdu)' }
                              ]}
                            />
                          )}
                        />
                      </div>

                      <div className="md:col-span-2 space-y-4 sm:space-y-5">
                         <label className={cn("text-xs sm:text-sm font-black text-slate-700 uppercase tracking-widest", i18n.language === 'en' ? "ps-2" : "pe-2")}>{t('onboarding.fields.invoice_terms')}</label>
                         <textarea 
                           {...register('invoiceDefaults')}
                           placeholder={t('onboarding.fields.invoice_terms_placeholder')}
                           rows={3}
                           className="w-full bg-white border-2 border-slate-200 focus-within:border-brand rounded-[1.5rem] sm:rounded-[2.5rem] py-3.5 sm:py-5 px-5 sm:px-8 text-base sm:text-lg font-bold outline-none transition-all shadow-sm resize-none"
                         />
                      </div>

                      <div className="md:col-span-2 space-y-4 sm:space-y-6 pt-4 border-t border-slate-200">
                        <label className={cn("text-xs sm:text-sm font-black text-slate-700 uppercase tracking-widest", i18n.language === 'en' ? "ps-2" : "pe-2")}>{t('onboarding.fields.inventory_strategy')}</label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
                          <label className={cn(
                            "relative p-5 sm:p-8 rounded-[1.5rem] sm:rounded-[2.5rem] border-2 cursor-pointer transition-all duration-300",
                            formData.inventoryStrategy === 'centralized' ? "border-brand bg-brand/5 shadow-xl shadow-brand/5" : "border-slate-200 bg-white hover:border-slate-300"
                          )}>
                            <input type="radio" value="centralized" {...register('inventoryStrategy')} className="sr-only" />
                            <div className="flex items-center gap-4 sm:gap-5 mb-3 sm:mb-4">
                              <div className={cn("w-6 h-6 sm:w-7 sm:h-7 rounded-full border-2 flex items-center justify-center transition-colors", formData.inventoryStrategy === 'centralized' ? "border-brand" : "border-slate-300")}>
                                {formData.inventoryStrategy === 'centralized' && <div className="w-3 h-3 sm:w-4 sm:h-4 bg-brand rounded-full shadow-sm" />}
                              </div>
                              <span className="text-lg sm:text-xl font-black text-slate-900">{t('onboarding.fields.centralized')}</span>
                            </div>
                            <p className={cn("text-xs sm:text-sm text-slate-500 font-medium leading-relaxed", i18n.language === 'en' ? "ps-0 sm:ps-12" : "pe-0 sm:pe-12")}>{t('onboarding.fields.centralized_desc')}</p>
                          </label>

                          <label className={cn(
                            "relative p-5 sm:p-8 rounded-[1.5rem] sm:rounded-[2.5rem] border-2 cursor-pointer transition-all duration-300",
                            formData.inventoryStrategy === 'decentralized' ? "border-brand bg-brand/5 shadow-xl shadow-brand/5" : "border-slate-200 bg-white hover:border-slate-300"
                          )}>
                            <input type="radio" value="decentralized" {...register('inventoryStrategy')} className="sr-only" />
                            <div className="flex items-center gap-4 sm:gap-5 mb-3 sm:mb-4">
                              <div className={cn("w-6 h-6 sm:w-7 sm:h-7 rounded-full border-2 flex items-center justify-center transition-colors", formData.inventoryStrategy === 'decentralized' ? "border-brand" : "border-slate-300")}>
                                {formData.inventoryStrategy === 'decentralized' && <div className="w-3 h-3 sm:w-4 sm:h-4 bg-brand rounded-full shadow-sm" />}
                              </div>
                              <span className="text-lg sm:text-xl font-black text-slate-900">{t('onboarding.fields.decentralized')}</span>
                            </div>
                            <p className={cn("text-xs sm:text-sm text-slate-500 font-medium leading-relaxed", i18n.language === 'en' ? "ps-0 sm:ps-12" : "pe-0 sm:pe-12")}>{t('onboarding.fields.decentralized_desc')}</p>
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Navigation Footer */}
              <div className="px-5 sm:px-8 md:px-14 py-5 sm:py-8 bg-slate-50 border-t border-slate-100 flex items-center justify-between font-sans">
                <div>
                  {currentStep > 1 && (
                    <button 
                      onClick={handleBack}
                      className="flex items-center gap-2 text-slate-500 font-black hover:text-slate-700 transition-colors text-sm sm:text-base"
                    >
                      {i18n.language === 'en' ? <ArrowLeft size={18} /> : <ArrowRight size={18} />}
                      <span>{t('common.back')}</span>
                    </button>
                  )}
                </div>

                <button 
                  onClick={handleNext}
                  disabled={loading}
                  className="px-6 sm:px-10 py-3.5 sm:py-5 bg-brand text-white rounded-[1.2rem] sm:rounded-[1.8rem] font-black text-base sm:text-lg shadow-xl shadow-brand/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center gap-2 sm:gap-3 disabled:opacity-50 disabled:scale-100"
                >
                  {loading ? (
                    <>
                      <Loader2 size={20} className="animate-spin" />
                      <span>{t('common.saving')}</span>
                    </>
                  ) : (
                    <>
                      <span>{currentStep === 3 ? t('common.finish') : t('common.next')}</span>
                      {i18n.language === 'en' ? <ArrowRight size={18} /> : <ArrowLeft size={18} />}
                    </>
                  )}
                </button>
              </div>
            </motion.div>
        </AnimatePresence>

        {/* Support Microcopy */}
        <div className="mt-10 text-center opacity-40">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500" dir="ltr">
            Powered by Seen System &copy; 2026
          </p>
        </div>
      </div>
    </div>
  );
}
