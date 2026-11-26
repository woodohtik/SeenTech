import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase/client';
import { STYLE_PREF_KEYS, mergeStylePrefs, stylePrefsOf, type StylePrefs } from '../../utils/customerStylePrefs';

/**
 * seen-merchant-trial-test-2026-11-26.md, phase 2 item 3 (question 4's
 * default): choosing a customer fills the order's lines with their saved
 * preferences (new lines too), and says so; after the order, its choices
 * become the customer's preferences.
 */
export function useCustomerStylePrefill(opts: {
  customer: { id: string; name: string; measurements?: Record<string, unknown> | null } | undefined;
  lineCount: number;
  setLineValue: (index: number, key: string, value: string) => void;
}) {
  const { customer, lineCount, setLineValue } = opts;
  const prefsRef = useRef<StylePrefs>({});
  const [filledFor, setFilledFor] = useState<string | null>(null);

  useEffect(() => {
    const prefs = stylePrefsOf(customer?.measurements as Record<string, unknown> | null);
    prefsRef.current = prefs;
    if (!customer || Object.keys(prefs).length === 0) { setFilledFor(null); return; }
    for (let i = 0; i < lineCount; i++) {
      for (const key of STYLE_PREF_KEYS) if (prefs[key]) setLineValue(i, key, prefs[key]!);
    }
    setFilledFor(customer.name);
    // Only a new customer choice fills the lines; editing a line keeps the edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.id]);

  return {
    /** The preferences of the chosen customer, for a line added afterwards. */
    prefs: () => prefsRef.current,
    /** "Faisal's preferences were filled in" -- the customer's name, or null. */
    filledFor,
  };
}

/** After a saved order: its first line's style choices become the customer's preferences (best effort). */
export async function rememberCustomerStylePrefs(tenantId: string, customerId: string, line: Record<string, unknown>): Promise<void> {
  const { data } = await supabase.from('customers').select('measurements').eq('tenant_id', tenantId).eq('id', customerId).maybeSingle();
  const current = ((data as { measurements?: Record<string, unknown> } | null)?.measurements) || {};
  const merged = mergeStylePrefs(current, line);
  if (JSON.stringify(merged) === JSON.stringify(current)) return;
  await supabase.from('customers').update({ measurements: merged }).eq('tenant_id', tenantId).eq('id', customerId);
}
