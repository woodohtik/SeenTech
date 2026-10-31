import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { isValidMeasurementUnit, type MeasurementUnit } from '../utils/measurementUnits';

export function useMeasurementUnit(tenantId: string): MeasurementUnit {
  const [unit, setUnit] = useState<MeasurementUnit>('inch');

  useEffect(() => {
    let cancelled = false;

    supabase
      .from('tenants')
      .select('measurement_unit')
      .eq('id', tenantId)
      .maybeSingle()
      .then(({ data, error }: { data: { measurement_unit?: unknown } | null; error: unknown }) => {
        if (cancelled || error) return;
        if (isValidMeasurementUnit(data?.measurement_unit)) {
          setUnit(data.measurement_unit);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  return unit;
}
