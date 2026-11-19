import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import {
  DEFAULT_FABRIC_ESTIMATE_SETTINGS,
  normalizeFabricEstimateSettings,
  type FabricEstimateSettings,
} from '../utils/fabricEstimate';

/** The shop's fabric-estimate numbers; the app defaults until (or unless) they load. */
export function useFabricEstimateSettings(tenantId: string): FabricEstimateSettings {
  const [settings, setSettings] = useState<FabricEstimateSettings>(DEFAULT_FABRIC_ESTIMATE_SETTINGS);

  useEffect(() => {
    let cancelled = false;
    setSettings(DEFAULT_FABRIC_ESTIMATE_SETTINGS);
    if (!tenantId) return;

    supabase
      .from('tenants')
      .select('fabric_estimate_settings')
      .eq('id', tenantId)
      .maybeSingle()
      .then(({ data, error }: { data: { fabric_estimate_settings?: unknown } | null; error: unknown }) => {
        if (cancelled || error) return;
        setSettings(normalizeFabricEstimateSettings(data?.fabric_estimate_settings));
      });

    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  return settings;
}
