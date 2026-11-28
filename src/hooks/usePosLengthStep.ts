import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { LENGTH_STEP_METERS, normalizeLengthStep } from '../utils/lengthSale';

/**
 * The shop's POS ± step for lengths (tenants.pos_length_step,
 * seen-open-verticals-task.md wave 1); a quarter metre until it is set or
 * while it loads.
 */
export function usePosLengthStep(tenantId: string | null | undefined): [number, (step: number) => void] {
  const [step, setStep] = useState<number>(LENGTH_STEP_METERS);
  useEffect(() => {
    if (!tenantId) return;
    let alive = true;
    supabase.from('tenants').select('pos_length_step').eq('id', tenantId).maybeSingle()
      .then(({ data }: { data: { pos_length_step?: unknown } | null }) => {
        if (alive) setStep(normalizeLengthStep(data?.pos_length_step));
      }, () => { /* offline: the default step */ });
    return () => { alive = false; };
  }, [tenantId]);
  return [step, setStep];
}
