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

export function getWhatsAppTemplate(): string {
  if (typeof localStorage === 'undefined') return getDefaultWhatsAppTemplate();
  return localStorage.getItem('seen_whatsapp_template') || getDefaultWhatsAppTemplate();
}

export function saveWhatsAppTemplate(template: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem('seen_whatsapp_template', template);
}

export function isWhatsAppEnabled(): boolean {
  if (typeof localStorage === 'undefined') return true;
  const val = localStorage.getItem('seen_whatsapp_enabled');
  return val === null ? true : val === 'true';
}

export function setWhatsAppEnabled(enabled: boolean): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem('seen_whatsapp_enabled', String(enabled));
}

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
  const cleanPhone = (phone || '').replace(/\D/g, '');
  const encodedText = encodeURIComponent(message);
  const whatsappUrl = cleanPhone 
    ? `https://wa.me/${cleanPhone}?text=${encodedText}`
    : `https://api.whatsapp.com/send?text=${encodedText}`;
  window.open(whatsappUrl, '_blank');
}
