import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase/client';
import { Tenant } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { useTranslation } from 'react-i18next';
import { Sun, Moon, Globe, Check, ChevronDown, Calendar } from 'lucide-react';
import { cn } from '../lib/utils';

interface HeaderProps {
  tenantId: string;
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}

export default function Header({ tenantId, title, subtitle, children }: HeaderProps) {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [isLanguageDropdownOpen, setIsLanguageDropdownOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const { t, i18n } = useTranslation();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [trialDays, setTrialDays] = useState<number | null>(null);

  const currentLanguageCode = i18n.language || 'ar';
  const isRtl = currentLanguageCode !== 'en';

  useEffect(() => {
    if (tenant && tenant.createdAt) {
      const createdDate = new Date(tenant.createdAt);
      const now = new Date();
      const diffTime = now.getTime() - createdDate.getTime();
      const diffDays = diffTime / (1000 * 60 * 60 * 24);
      setTrialDays(Math.max(0, 14 - Math.floor(diffDays)));
    }
  }, [tenant]);

  useEffect(() => {
    if (!tenantId || tenantId === 'saas_management') return;
    const fetchTenantData = async () => {
      try {
        const { data, error } = await supabase
          .from('tenants')
          .select('*')
          .eq('id', tenantId)
          .maybeSingle();
        
        if (data && !error) {
          setTenant({
            ...data,
            taxSettings: data.tax_settings,
            logoUrl: data.logo_url,
            commercialRegister: data.commercial_register,
            legalName: data.legal_name,
            createdAt: data.created_at,
            updatedAt: data.updated_at
          } as Tenant);
        }
      } catch (error) {
        console.error('Error fetching tenant details:', error);
      }
    };
    fetchTenantData();
  }, [tenantId]);

  // Handle outside clicks to close language dropdown
  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsLanguageDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const handleLanguageSelect = (languageCode: string) => {
    i18n.changeLanguage(languageCode);
    setIsLanguageDropdownOpen(false);
  };

  const handleThemeToggle = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const languages = [
    { code: 'ar', name: 'العربية', flag: '🇸🇦', isRtl: true },
    { code: 'en', name: 'English', flag: '🇺🇸', isRtl: false },
    { code: 'ur', name: 'اردو', flag: '🇵🇰', isRtl: true }
  ];

  const activeLanguage = languages.find(lang => lang.code === currentLanguageCode) || languages[0];

  return (
    <header className={cn(
      "flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 w-full",
      isRtl ? "text-right" : "text-left"
    )} dir={isRtl ? "rtl" : "ltr"}>
      
      {/* Title & Shop Logo */}
      <div className="flex items-center gap-4">
        {tenant?.logoUrl && (
          <img 
            src={tenant.logoUrl} 
            alt={t('common.shop_logo', 'شعار المتجر')} 
            className="w-16 h-16 rounded-2xl object-cover shadow-md border border-border" 
          />
        )}
        <div className="flex flex-col">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-3xl sm:text-4xl font-black text-content tracking-tight">{title}</h2>
            {trialDays !== null && (
              <span className={cn(
                "px-3 py-1.5 rounded-2xl text-xs font-bold tracking-wide flex items-center gap-1.5 shrink-0 select-none border whitespace-nowrap",
                trialDays <= 3 
                  ? "bg-danger/10 text-danger border-danger/20 animate-pulse" 
                  : "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border-indigo-100 dark:border-indigo-900/30"
              )}>
                <Calendar size={13} strokeWidth={2.5} />
                {trialDays === 0 ? "انتهت التجربة" : `تجربة: متبقي ${trialDays} يوم`}
              </span>
            )}
          </div>
          <p className="text-content-muted mt-1 font-medium text-sm sm:text-base">{subtitle}</p>
        </div>
      </div>

      {/* Action Area (Controls) */}
      <div className="flex flex-wrap items-center gap-3 w-full md:w-auto mt-2 md:mt-0 justify-end">
        {children}
      </div>

    </header>
  );
}

