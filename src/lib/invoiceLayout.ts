/**
 * The shop's invoice layout (seen-invoice-layout-settings-task.md): one
 * source for every print -- the sale, the reprint, the preview.
 *
 * The source is tenants.invoice_settings. This browser keeps a copy only as
 * a cache, for printing offline; it is refreshed when the shop is known
 * (login), when the tab comes back (at most once a minute), and when the
 * settings are saved on this device. A template never reads localStorage
 * itself: it takes the layout from useInvoiceLayout() or a prop.
 */
import { useSyncExternalStore } from 'react';
import { readTenantRow } from './tenantRow';
import { calculateItemTax } from '../utils/b2bHelper';
import type { ProductTaxType } from '../types';

export type InvoicePrintSize = 'thermal80' | 'thermal58' | 'a4' | 'a5';
export type InvoiceAlignment = 'right' | 'center' | 'left';

export interface InvoiceLayout {
  printSize: InvoicePrintSize;
  fastThermalMode: boolean;
  header: {
    /** A link to the logo (Storage); an old base64 logo stays readable until re-uploaded. */
    logoUrl: string;
    /** Shown under the shop's name; the official name, VAT number and address come from the shop's own details. */
    contactNumbers: string;
    alignment: InvoiceAlignment;
    logoBorder: boolean;
    /**
     * Kept only as a fallback for a shop whose official details are empty
     * (sellerForInvoice, ZATCA-16); no longer edited on the layout screen.
     */
    facilityName: string;
    address: string;
    taxId: string;
  };
  columns: {
    showUnitPrice: boolean;
    showDiscount: boolean;
    showMeasurements: boolean;
    showBarcode: boolean;
    showCustomerName: boolean;
    showItemSpecs: boolean;
  };
  footer: {
    returnPolicy: string;
    thankYouMessage: string;
  };
}

/** The layout plus the shop's VAT rate (a fraction), for the per-line VAT. */
export type InvoiceLayoutState = InvoiceLayout & { shopVatRate: number };

export const RETURN_POLICY_MAX = 200;
export const THANK_YOU_MAX = 60;
export const DEFAULT_THANK_YOU = 'شكراً لزيارتكم وعودتكم تسعدنا';

export const DEFAULT_INVOICE_LAYOUT: InvoiceLayout = {
  printSize: 'thermal80',
  fastThermalMode: false,
  header: { logoUrl: '', contactNumbers: '', alignment: 'center', logoBorder: true, facilityName: '', address: '', taxId: '' },
  columns: { showUnitPrice: true, showDiscount: true, showMeasurements: false, showBarcode: true, showCustomerName: true, showItemSpecs: true },
  footer: { returnPolicy: '', thankYouMessage: DEFAULT_THANK_YOU },
};

/** Same key the old code used, so a device keeps its copy through the update; a cache only now. */
export const INVOICE_LAYOUT_CACHE_KEY = 'pos_invoice_settings';

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, fallback: string, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

/**
 * Any stored settings as a complete layout: defaults for whatever is missing
 * or broken, the removed options (design template, QR switch) dropped, the
 * texts cut to their limits (question 4).
 */
export function normalizeInvoiceLayout(raw: unknown): InvoiceLayout {
  const r = obj(raw);
  const h = obj(r.header);
  const c = obj(r.columns);
  const f = obj(r.footer);
  const d = DEFAULT_INVOICE_LAYOUT;
  const printSize = (['thermal80', 'thermal58', 'a4', 'a5'] as const).includes(r.printSize as InvoicePrintSize) ? (r.printSize as InvoicePrintSize) : d.printSize;
  const alignment = (['right', 'center', 'left'] as const).includes(h.alignment as InvoiceAlignment) ? (h.alignment as InvoiceAlignment) : d.header.alignment;
  return {
    printSize,
    fastThermalMode: bool(r.fastThermalMode, d.fastThermalMode),
    header: {
      logoUrl: str(h.logoUrl, ''),
      contactNumbers: str(h.contactNumbers, '', 120),
      alignment,
      logoBorder: bool(h.logoBorder, d.header.logoBorder),
      facilityName: str(h.facilityName, '', 200),
      address: str(h.address, '', 300),
      taxId: str(h.taxId, '', 40),
    },
    columns: {
      showUnitPrice: bool(c.showUnitPrice, d.columns.showUnitPrice),
      showDiscount: bool(c.showDiscount, d.columns.showDiscount),
      showMeasurements: bool(c.showMeasurements, d.columns.showMeasurements),
      showBarcode: bool(c.showBarcode, d.columns.showBarcode),
      showCustomerName: bool(c.showCustomerName, d.columns.showCustomerName),
      showItemSpecs: bool(c.showItemSpecs, d.columns.showItemSpecs),
    },
    footer: {
      returnPolicy: str(f.returnPolicy, '', 100000).slice(0, RETURN_POLICY_MAX),
      thankYouMessage: str(f.thankYouMessage, d.footer.thankYouMessage, 100000).slice(0, THANK_YOU_MAX),
    },
  };
}

// ---- the store -------------------------------------------------------------

function readCache(): InvoiceLayout {
  try {
    const raw = localStorage.getItem(INVOICE_LAYOUT_CACHE_KEY);
    return normalizeInvoiceLayout(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeInvoiceLayout(null);
  }
}
function writeCache(layout: InvoiceLayout) {
  try {
    localStorage.setItem(INVOICE_LAYOUT_CACHE_KEY, JSON.stringify(layout));
  } catch { /* full or blocked: the in-memory copy still prints */ }
}

let state: InvoiceLayoutState = { ...readCache(), shopVatRate: 0.15 };
let tenantId: string | null = null;
let lastRefreshAt = 0;
const listeners = new Set<() => void>();
const REFRESH_GAP_MS = 60_000;

function setState(next: InvoiceLayoutState) {
  state = next;
  listeners.forEach((l) => l());
}

export const getInvoiceLayout = (): InvoiceLayoutState => state;

export function subscribeInvoiceLayout(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function vatRateOf(row: Record<string, unknown>): number {
  const tax = obj(row.tax_settings);
  const pct = Number(tax.vatRate ?? row.default_tax_rate ?? 15);
  return Number.isFinite(pct) && pct >= 0 ? pct / 100 : 0.15;
}

/** Reads the shop's row and takes its invoice settings; a failed read keeps what is cached. */
export async function refreshInvoiceLayout(): Promise<void> {
  if (!tenantId) return;
  lastRefreshAt = Date.now();
  try {
    const { data, error } = await readTenantRow(tenantId);
    if (error || !data) return;
    const layout = normalizeInvoiceLayout(data.invoice_settings);
    writeCache(layout);
    setState({ ...layout, shopVatRate: vatRateOf(data) });
  } catch { /* offline: the cached copy stays */ }
}

/** The shop is known (AuthContext): read its settings. */
export function setInvoiceLayoutTenant(id: string | null | undefined): void {
  const next = id && id !== 'saas_management' ? id : null;
  if (next === tenantId) return;
  tenantId = next;
  if (tenantId) void refreshInvoiceLayout();
}

/** Saved on this device: everything here prints with it at once. */
export function applySavedInvoiceLayout(layout: InvoiceLayout): void {
  const normalized = normalizeInvoiceLayout(layout);
  writeCache(normalized);
  setState({ ...normalized, shopVatRate: state.shopVatRate });
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastRefreshAt >= REFRESH_GAP_MS) void refreshInvoiceLayout();
  });
}
if (typeof window !== 'undefined') {
  window.addEventListener('invoice_settings_updated', () => { void refreshInvoiceLayout(); });
}

/** The shop's invoice layout, kept current. */
export function useInvoiceLayout(): InvoiceLayoutState {
  return useSyncExternalStore(subscribeInvoiceLayout, getInvoiceLayout, getInvoiceLayout);
}

// ---- paper -------------------------------------------------------------------

export type PaperSize = '80mm' | '58mm' | 'A4' | 'A5';

/**
 * The one order for the paper of a printed invoice (task file 2.3):
 * 1. a B2B tax invoice is A4, always;
 * 2. the printer's own setting (PrinterSettings) when one is set;
 * 3. the layout's paper size;
 * 4. 80mm.
 */
export function paperSizeFromLayout(input: { isB2B: boolean; printerSize: string | null; layoutSize: InvoicePrintSize | undefined }): PaperSize {
  if (input.isB2B) return 'A4';
  if (input.printerSize && ['80mm', '58mm', 'A4', 'A5'].includes(input.printerSize)) return input.printerSize as PaperSize;
  switch (input.layoutSize) {
    case 'thermal58': return '58mm';
    case 'a4': return 'A4';
    case 'a5': return 'A5';
    default: return '80mm';
  }
}

// ---- VAT per line ------------------------------------------------------------

export interface AllocatedLine {
  /** Before VAT, before the discount. */
  base: number;
  /** This line's share of the invoice discount. */
  discountShare: number;
  /** Before VAT, after the discount. */
  taxable: number;
  vat: number;
  /** taxable + vat. */
  total: number;
  /** 0 for an exempt line. */
  vatRate: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Each line's taxable amount and VAT, with the invoice discount spread over
 * the lines by their amounts -- the way the ZATCA XML carries it
 * (zatcaInvoiceXml.ts: every line has its share of the discount), so the
 * lines add up to the invoice. The rate is the shop's rate, never one
 * derived from the totals (task file phase 3). The VAT left over by
 * rounding goes to the last taxed line, so the lines add up to `vatAmount`.
 */
export function allocateInvoiceLines(
  items: ReadonlyArray<{ unitPrice: number; quantity: number; taxType: ProductTaxType }>,
  totals: { subtotal: number; discount: number; vatAmount: number },
  vatRate: number,
): AllocatedLine[] {
  const raw = items.map((item) => {
    const { basePrice } = calculateItemTax(item.unitPrice, item.taxType, vatRate, item.quantity);
    return { base: basePrice, exempt: item.taxType === 'exempt' };
  });
  const baseSum = raw.reduce((s, l) => s + l.base, 0);
  const discount = Math.max(0, totals.discount || 0);
  let discountLeft = round2(discount);
  const lines: AllocatedLine[] = raw.map((l, i) => {
    const isLast = i === raw.length - 1;
    const share = isLast ? discountLeft : round2(baseSum > 0 ? (discount * l.base) / baseSum : 0);
    discountLeft = round2(discountLeft - share);
    const taxable = round2(l.base - share);
    const rate = l.exempt ? 0 : vatRate;
    const vat = round2(taxable * rate);
    return { base: round2(l.base), discountShare: share, taxable, vat, total: round2(taxable + vat), vatRate: rate };
  });
  // Rounding: the lines' VAT must add up to the invoice's.
  const vatSum = round2(lines.reduce((s, l) => s + l.vat, 0));
  const diff = round2((totals.vatAmount || 0) - vatSum);
  if (diff !== 0 && Math.abs(diff) <= 0.05 * lines.length) {
    const last = [...lines].reverse().find((l) => l.vatRate > 0);
    if (last) {
      last.vat = round2(last.vat + diff);
      last.total = round2(last.taxable + last.vat);
    }
  }
  return lines;
}

/** Tests only. */
export function __resetInvoiceLayoutForTests(): void {
  state = { ...readCache(), shopVatRate: 0.15 };
  tenantId = null;
  lastRefreshAt = 0;
  listeners.clear();
}
