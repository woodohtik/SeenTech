import { useCallback, useEffect, useState } from 'react';
import { loadComponentOptions, loadGarmentComponentDefaults } from '../../services/garmentComponentsService';
import type { GarmentComponentDefault } from '../../utils/garmentComponents';

/** The shop's garment-component defaults and the items that can be one (phase 2 item 2). */
export function useGarmentComponents(tenantId: string | null | undefined) {
  const [defaults, setDefaults] = useState<GarmentComponentDefault[]>([]);
  const [options, setOptions] = useState<{ id: string; name: string }[]>([]);

  const reload = useCallback(async () => {
    if (!tenantId) return;
    const [d, o] = await Promise.all([loadGarmentComponentDefaults(tenantId), loadComponentOptions(tenantId)]);
    setDefaults(d);
    setOptions(o);
  }, [tenantId]);

  useEffect(() => { void reload(); }, [reload]);

  return { defaults, options, reload };
}
