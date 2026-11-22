/**
 * whatsapp.ts
 * ------------------------------------------------------------------
 * مساعد رسائل وتكامل الواتساب (WhatsApp Integration Utilities)
 * ------------------------------------------------------------------
 */

import i18n from 'i18next';

/** Default outbound template in the active UI language. */
export function getDefaultWhatsAppTemplate(): string {
  return i18n.t('whatsapp.default_template');
}

/**
 * @deprecated Evaluated once at module load, so it never follows a language
 * change. Use {@link getDefaultWhatsAppTemplate} instead.
 */
export const DEFAULT_WHATSAPP_TEMPLATE =
  'مرحباً {customer_name}، تم استلام طلبك رقم {order_id}. الإجمالي: {total_amount} ر.س. يمكنك متابعة حالة الطلب من هنا: {invoice_url}';

export const WHATSAPP_VARIABLES = [
  { tag: '{customer_name}', labelKey: 'dashboard.cashier.col_customer_name', sample: 'عبدالله علي' },
  { tag: '{order_id}', labelKey: 'dashboard.cashier.col_order_number', sample: '#10482' },
  { tag: '{total_amount}', labelKey: 'whatsapp.var_total_amount', sample: '250' },
  { tag: '{customer_phone}', labelKey: 'whatsapp.var_customer_phone', sample: '0501234567' },
  { tag: '{invoice_url}', labelKey: 'whatsapp.var_invoice_url', sample: 'https://seen-pos.app/order/10482' },
  { tag: '{store_name}', labelKey: 'whatsapp.var_store_name', sample: 'خياطة الأناقة' },
].map((v) => ({
  ...v,
  /** Resolved on every access so the label follows the active language. */
  get label(): string {
    return i18n.t(v.labelKey);
  },
}));

/* seen-readiness-fixes-task.md P4 (OPERATIONS-13): the template and the
   switch are the shop's (tenants.whatsapp_settings), shared by every device.
   Layout loads them with the shop row (useShopWhatsAppSettings); until then,
   and for a value never saved for the shop, the old per-device value or the
   default applies. */
type ShopWhatsApp = { enabled?: boolean; template?: string };
let shopSettings: ShopWhatsApp | null = null;

export function setShopWhatsAppSettings(settings: ShopWhatsApp | null | undefined): void {
  shopSettings = settings && typeof settings === 'object' ? settings : null;
}

const local = (key: string): string | null => {
  try { return typeof localStorage === 'undefined' ? null : localStorage.getItem(key); } catch { return null; }
};

export function getWhatsAppTemplate(): string {
  return shopSettings?.template || local('seen_whatsapp_template') || getDefaultWhatsAppTemplate();
}

export function isWhatsAppEnabled(): boolean {
  if (typeof shopSettings?.enabled === 'boolean') return shopSettings.enabled;
  const val = local('seen_whatsapp_enabled');
  return val === null ? true : val === 'true';
}

/** Saves for the whole shop; resolves to the saved settings. */
export async function saveShopWhatsAppSettings(next: ShopWhatsApp): Promise<ShopWhatsApp> {
  const { supabase } = await import('../lib/supabase/client');
  const merged = { enabled: isWhatsAppEnabled(), template: getWhatsAppTemplate(), ...next };
  const { data, error } = await supabase.rpc('save_whatsapp_settings', { p_enabled: merged.enabled, p_template: merged.template });
  if (error) throw error;
  setShopWhatsAppSettings(data as ShopWhatsApp);
  return data as ShopWhatsApp;
}

/** The event the toast stack shows when a send is refused because WhatsApp is off. */
export const WHATSAPP_DISABLED_EVENT = 'seen-whatsapp-disabled';

/**
 * استبدال المتغيرات في القالب بقيم حقيقية
 */
export function buildWhatsAppMessage(
  template: string,
  data: {
    customerName?: string;
    orderId?: string;
    totalAmount?: string | number;
    customerPhone?: string;
    invoiceUrl?: string;
    storeName?: string;
    [key: string]: any;
  }
): string {
  let message = template || getWhatsAppTemplate();

  const replacements: Record<string, string> = {
    '{customer_name}': data.customerName || i18n.t('whatsapp.valued_customer'),
    '{order_id}': data.orderId ? String(data.orderId) : '#10001',
    '{total_amount}': data.totalAmount !== undefined ? String(data.totalAmount) : '0',
    '{customer_phone}': data.customerPhone || '',
    '{invoice_url}': data.invoiceUrl || '',
    '{store_name}': data.storeName || '',
  };

  for (const [tag, val] of Object.entries(replacements)) {
    message = message.split(tag).join(val);
  }

  return message;
}

export function sendWhatsAppMessage(phone: string, message: string): void {
  // P4 (OPERATIONS-13): the shop turned WhatsApp off -- say so, open nothing.
  if (!isWhatsAppEnabled()) {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(WHATSAPP_DISABLED_EVENT));
    return;
  }
  const cleanPhone = (phone || '').replace(/\D/g, '');
  const encodedText = encodeURIComponent(message);
  const whatsappUrl = cleanPhone 
    ? `https://wa.me/${cleanPhone}?text=${encodedText}`
    : `https://api.whatsapp.com/send?text=${encodedText}`;
  window.open(whatsappUrl, '_blank');
}
