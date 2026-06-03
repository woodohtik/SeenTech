import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase/client';

interface BrandingSettings {
  websiteUrl: string;
  companyName: string;
  storeName?: string;
}

interface BrandingContextType {
  settings: BrandingSettings;
  loading: boolean;
}

const BrandingContext = createContext<BrandingContextType | undefined>(undefined);

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<BrandingSettings>({
    websiteUrl: '#',
    companyName: 'Seen',
    storeName: 'تطبيق سين'
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchBranding = async () => {
      try {
        const { data, error } = await supabase
          .from('saas_settings')
          .select('*')
          .eq('key', 'branding')
          .maybeSingle();
        
        if (data && data.value) {
          setSettings({
            websiteUrl: data.value.websiteUrl || '#',
            companyName: data.value.companyName || 'Seen',
            storeName: data.value.storeName || 'تطبيق سين'
          });
        }
      } catch (error) {
        console.error('Error fetching branding settings:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchBranding();

    const channel = supabase
      .channel('saas_settings_branding')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'saas_settings',
        filter: 'key=eq.branding'
      }, (payload: any) => {
        if (payload.new && payload.new.value) {
          setSettings({
            websiteUrl: payload.new.value.websiteUrl || '#',
            companyName: payload.new.value.companyName || 'Seen',
            storeName: payload.new.value.storeName || 'تطبيق سين'
          });
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <BrandingContext.Provider value={{ settings, loading }}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  const context = useContext(BrandingContext);
  if (context === undefined) {
    throw new Error('useBranding must be used within a BrandingProvider');
  }
  return context;
}
