/**
 * The shop's own words (seen-verticals-readiness-task.md Phase 6): a furniture
 * workshop has «فني», not «خياط»; a women's or furniture order has «قطعة»,
 * not «ثوب». tv(key) reads `<key>__technician` when the activity's
 * workshop_term is technician, else `<key>__piece` when its item_term is
 * piece -- only when that key exists; otherwise the key itself. Men's
 * tailoring (tailor + thobe) always reads the key itself, so nothing changes
 * there. No existing key is removed.
 */
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useVerticalConfig } from './useVerticalConfig';
import type { VerticalCapabilities } from '../types/expansion';

export function verticalTermKey(
  key: string,
  capabilities: Pick<VerticalCapabilities, 'workshop_term' | 'item_term'>,
  exists: (k: string) => boolean,
): string {
  if (capabilities.workshop_term === 'technician' && exists(`${key}__technician`)) return `${key}__technician`;
  if (capabilities.item_term === 'piece' && exists(`${key}__piece`)) return `${key}__piece`;
  return key;
}

export function useVerticalTerms() {
  const { t, i18n } = useTranslation();
  const { capabilities } = useVerticalConfig();
  return useCallback(
    (key: string, defaultValue?: string): string =>
      t(verticalTermKey(key, capabilities, (k) => i18n.exists(k)), defaultValue as any) as string,
    [t, i18n, capabilities],
  );
}
