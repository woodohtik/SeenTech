/**
 * WhatsApp messages (seen-whatsapp-templates-task.md).
 *
 * Seen prepares the message and opens WhatsApp; the person presses send.
 *
 *  - Four templates, the shop's own (tenants.whatsapp_settings.templates):
 *    order received, invoice, tracking link, measurements link. A shop's old
 *    single template stays its order-received and invoice one.
 *  - One way to fill them (whatsappMessage): the same order number, store
 *    name, total and links in every message; a line whose variable has no
 *    value is dropped, a misspelt variable never shows its braces.
 *  - One way to open WhatsApp (openWhatsApp): the number in international
 *    form, the shop's on/off switch for customer messages. No other place
 *    opens a WhatsApp link (whatsappLinks.test.ts checks).
 */

import i18n from 'i18next';
import { formatSaudiPhone } from './phoneUtils';

export type WhatsAppTemplateKind = 'order_received' | 'invoice' | 'tracking_link' | 'measurements_link';
export const WHATSAPP_TEMPLATE_KINDS: readonly WhatsAppTemplateKind[] = ['order_received', 'invoice', 'tracking_link', 'measurements_link'];
export const WHATSAPP_TEMPLATE_MAX = 1000;

/** The variables each template may use (task file 2.3). */
export const TEMPLATE_VARIABLES: Readonly<Record<WhatsAppTemplateKind, readonly string[]>> = {
  order_received: ['{customer_name}', '{order_id}', '{total_amount}', '{customer_phone}', '{invoice_url}', '{store_name}'],
  invoice: ['{customer_name}', '{order_id}', '{total_amount}', '{customer_phone}', '{invoice_url}', '{store_name}'],
  tracking_link: ['{customer_name}', '{order_id}', '{tracking_url}', '{store_name}'],
  measurements_link: ['{customer_name}', '{measurements_url}', '{store_name}'],
};

export const WHATSAPP_VARIABLES = [
  { tag: '{customer_name}', labelKey: 'dashboard.cashier.col_customer_name', sample: 'عبدالله علي' },
  { tag: '{order_id}', labelKey: 'dashboard.cashier.col_order_number', sample: '1042' },
  { tag: '{total_amount}', labelKey: 'whatsapp.var_total_amount', sample: '287.50' },
  { tag: '{customer_phone}', labelKey: 'whatsapp.var_customer_phone', sample: '0501234567' },
  { tag: '{invoice_url}', labelKey: 'whatsapp.var_invoice_url', sample: 'https://www.seentech.io/track/7f3a9c2e' },
  { tag: '{tracking_url}', labelKey: 'whatsapp.var_tracking_url', sample: 'https://www.seentech.io/track/7f3a9c2e' },
  { tag: '{measurements_url}', labelKey: 'whatsapp.var_measurements_url', sample: 'https://www.seentech.io/measurements/4b81d0aa' },
  { tag: '{store_name}', labelKey: 'whatsapp.var_store_name', sample: 'خياطة الأناقة' },
].map((v) => ({
  ...v,
  /** Resolved on every access so the label follows the active language. */
  get label(): string {
    return i18n.t(v.labelKey);
  },
}));

/** A template's default in the interface language (each sentence on its own line). */
export function getDefaultWhatsAppTemplate(kind: WhatsAppTemplateKind = 'order_received'): string {
  return i18n.t(`whatsapp.templates.${kind}`);
}

// ---- the shop's settings ----------------------------------------------------

/* seen-readiness-fixes-task.md P4 (OPERATIONS-13): the templates and the
   switch are the shop's (tenants.whatsapp_settings), shared by every device.
   Layout loads them with the shop row; until then, and for a template never
   saved for the shop, the old per-device value or the default applies. */
export type ShopWhatsApp = { enabled?: boolean; template?: string; templates?: Partial<Record<WhatsAppTemplateKind, string>> };
let shopSettings: ShopWhatsApp | null = null;
let shopName = '';
let loaded = false;
const listeners = new Set<() => void>();

export function setShopWhatsAppSettings(settings: ShopWhatsApp | null | undefined, name?: string): void {
  shopSettings = settings && typeof settings === 'object' ? settings : null;
  if (typeof name === 'string') shopName = name;
  loaded = settings !== null && settings !== undefined;
  listeners.forEach((l) => l());
}

/** Whether the shop's settings have arrived (the settings screen waits for them). */
export const isShopWhatsAppLoaded = (): boolean => loaded;
export function onShopWhatsAppChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const local = (key: string): string | null => {
  try { return typeof localStorage === 'undefined' ? null : localStorage.getItem(key); } catch { return null; }
};

/** The shop's own template of a kind, if it saved one (none: the default applies). */
export function getShopWhatsAppTemplate(kind: WhatsAppTemplateKind): string | null {
  const own = shopSettings?.templates?.[kind];
  if (own) return own;
  // Question 2: the old single template is the order-received and invoice one.
  if (kind === 'order_received' || kind === 'invoice') return shopSettings?.template || local('seen_whatsapp_template') || null;
  return null;
}

export function getWhatsAppTemplate(kind: WhatsAppTemplateKind = 'order_received'): string {
  return getShopWhatsAppTemplate(kind) || getDefaultWhatsAppTemplate(kind);
}

export function isWhatsAppEnabled(): boolean {
  if (typeof shopSettings?.enabled === 'boolean') return shopSettings.enabled;
  const val = local('seen_whatsapp_enabled');
  return val === null ? true : val === 'true';
}

/** Saves for the whole shop (settings.whatsapp); resolves to the saved settings. */
export async function saveShopWhatsAppSettings(next: { enabled?: boolean; templates?: Partial<Record<WhatsAppTemplateKind, string>> }): Promise<ShopWhatsApp> {
  const { supabase } = await import('../lib/supabase/client');
  const { data, error } = await supabase.rpc('save_whatsapp_templates', {
    p_enabled: typeof next.enabled === 'boolean' ? next.enabled : isWhatsAppEnabled(),
    p_templates: next.templates ?? {},
  });
  if (error) throw error;
  setShopWhatsAppSettings(data as ShopWhatsApp);
  return data as ShopWhatsApp;
}

// ---- filling --------------------------------------------------------------------

const TAG = /\{[a-z_]+\}/g;

/** The {tags} in a template that its kind does not know (warned about on save). */
export function unknownWhatsAppVariables(template: string, kind: WhatsAppTemplateKind): string[] {
  const allowed = new Set(TEMPLATE_VARIABLES[kind]);
  return Array.from(new Set((template.match(TAG) || []).filter((tag) => !allowed.has(tag))));
}

/**
 * Fills a template. A line holding a variable with no value is dropped as a
 * whole (no "follow it here:" left hanging); a tag with no entry at all (a
 * typo) is removed, never shown with its braces.
 */
export function fillWhatsAppTemplate(template: string, values: Record<string, string | undefined>): string {
  const lines = template.split('\n').filter((line) => {
    const tags = line.match(TAG) || [];
    return tags.every((tag) => {
      const key = tag.slice(1, -1);
      return !(key in values) || (values[key] ?? '') !== '';
    });
  });
  return lines
    .map((line) => line.replace(TAG, (tag) => values[tag.slice(1, -1)] ?? ''))
    .join('\n')
    .trim();
}

export interface WhatsAppMessageData {
  customerName?: string | null;
  /** The order's number as it prints (the whole of it). */
  orderNumber?: string | number | null;
  /** The invoice's number, for the invoice message. */
  invoiceNumber?: string | null;
  total?: number | string | null;
  customerPhone?: string | null;
  trackingToken?: string | null;
  measurementsToken?: string | null;
  /** The shop's official name; left out, the name loaded with the shop's settings. */
  storeName?: string | null;
  /** For previews: the site's address instead of this tab's. */
  origin?: string;
}

/** One message of a kind, filled the same way from every screen (task file phase 3). */
export function whatsappMessage(kind: WhatsAppTemplateKind, data: WhatsAppMessageData, template: string = getWhatsAppTemplate(kind)): string {
  const origin = data.origin ?? (typeof window !== 'undefined' ? window.location.origin : 'https://www.seentech.io');
  const total = data.total === null || data.total === undefined || data.total === '' ? undefined : Number(data.total);
  const trackingUrl = data.trackingToken ? `${origin}/track/${data.trackingToken}` : '';
  const orderId = kind === 'invoice'
    ? String(data.invoiceNumber || data.orderNumber || '')
    : String(data.orderNumber || '');
  return fillWhatsAppTemplate(template, {
    customer_name: data.customerName || i18n.t('whatsapp.valued_customer'),
    order_id: orderId,
    total_amount: total !== undefined && Number.isFinite(total) ? total.toFixed(2) : '',
    customer_phone: data.customerPhone || '',
    invoice_url: trackingUrl,
    tracking_url: trackingUrl,
    measurements_url: data.measurementsToken ? `${origin}/measurements/${data.measurementsToken}` : '',
    store_name: data.storeName || shopName || i18n.t('pos.store_default'),
  });
}

// ---- opening WhatsApp -------------------------------------------------------------

/** The event the toast stack shows when a send is refused because WhatsApp is off. */
export const WHATSAPP_DISABLED_EVENT = 'seen-whatsapp-disabled';
/** The event the toast stack shows when a number cannot be a WhatsApp number. */
export const WHATSAPP_INVALID_PHONE_EVENT = 'seen-whatsapp-invalid-phone';

/** A phone as WhatsApp wants it: digits with the country code (9665...), or null. */
export function normalizeWhatsAppPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = formatSaudiPhone(String(phone)).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('9660')) digits = `966${digits.slice(4)}`;
  if (/^5\d{8}$/.test(digits)) digits = `966${digits}`;
  return /^\d{11,15}$/.test(digits) ? digits : null;
}

/**
 * Opens WhatsApp with a message. customer: only while the shop has WhatsApp
 * on (its switch is about messages to customers); internal (a Z report, a
 * supplier statement) and marketing (a referral link): always. With a
 * number, that chat; without, WhatsApp asks whom to send it to. Returns
 * whether it opened.
 */
export function openWhatsApp({ phone, message, kind }: { phone?: string | null; message: string; kind: 'customer' | 'internal' | 'marketing' }): boolean {
  if (kind === 'customer' && !isWhatsAppEnabled()) {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(WHATSAPP_DISABLED_EVENT));
    return false;
  }
  const text = encodeURIComponent(message);
  let url = `https://api.whatsapp.com/send?text=${text}`;
  if (phone && String(phone).trim()) {
    const number = normalizeWhatsAppPhone(phone);
    if (!number) {
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(WHATSAPP_INVALID_PHONE_EVENT));
      return false;
    }
    url = `https://wa.me/${number}?text=${text}`;
  }
  window.open(url, '_blank');
  return true;
}
