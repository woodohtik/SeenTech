/**
 * A shop's tax settings, read one way everywhere in the browser and on the
 * server (team review 2026-11-19, item M-8 / action 17). The same rules as
 * the database's public.tenant_tax_rules, which create_tailoring_order uses:
 *  - enabled: the stored flag, else whether the shop has a VAT number (or a
 *    TRN in the settings);
 *  - vatRate: the stored rate; missing or 0 means "not set", i.e. 15;
 *  - tailoringTaxType: the stored type, else exclusive.
 * scripts/check-tax-rules.ts compares this with the database shop by shop.
 *
 * `tenantRow` is a tenants row as the app reads it: `tax_settings` is the
 * column (since migration 20261230000000) or, from an older database, what
 * the fetch layer parsed out of legacy_id.
 */
export type TaxType = 'inclusive' | 'exclusive' | 'exempt';

export interface ResolvedTaxSettings {
  enabled: boolean;
  trn: string;
  legalName: string;
  /** Percentage, e.g. 15. */
  vatRate: number;
  tailoringTaxType: TaxType;
  /** Anything else kept in the settings document (e.g. notificationSettings). */
  [key: string]: unknown;
}

function storedFlag(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
}

export function rawTaxSettings(tenantRow: any): Record<string, any> | null {
  const raw = tenantRow?.tax_settings;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
}

export function resolveTaxSettings(tenantRow: any, fallbackRaw?: Record<string, any> | null): ResolvedTaxSettings {
  const raw = rawTaxSettings(tenantRow) ?? fallbackRaw ?? null;
  const vatNumber = typeof tenantRow?.vat_number === 'string' ? tenantRow.vat_number : '';
  const hasVat = vatNumber.trim().length > 0;
  const name = tenantRow?.name || '';
  if (!raw) {
    return { enabled: hasVat, trn: vatNumber, legalName: name, vatRate: 15, tailoringTaxType: 'exclusive' };
  }
  const rate = Number(raw.vatRate ?? 15);
  return {
    ...raw,
    enabled: storedFlag(raw.enabled) ?? (hasVat || Boolean(raw.trn)),
    trn: raw.trn || vatNumber,
    legalName: raw.legalName || name,
    vatRate: Number.isFinite(rate) && rate !== 0 ? rate : 15,
    tailoringTaxType: (raw.tailoringTaxType || 'exclusive') as TaxType,
  };
}
