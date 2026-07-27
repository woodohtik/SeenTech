/**
 * whatsapp.ts
 * ------------------------------------------------------------------
 * مساعد رسائل وتكامل الواتساب (WhatsApp Integration Utilities)
 * ------------------------------------------------------------------
 */

export const DEFAULT_WHATSAPP_TEMPLATE =
  'مرحباً {customer_name}، تم استلام طلبك رقم {order_id}. الإجمالي: {total_amount} ر.س. يمكنك متابعة حالة الطلب من هنا: {invoice_url}';

export const WHATSAPP_VARIABLES = [
  { tag: '{customer_name}', label: 'اسم العميل', sample: 'عبدالله علي' },
  { tag: '{order_id}', label: 'رقم الطلب', sample: '#10482' },
  { tag: '{total_amount}', label: 'المبلغ الإجمالي', sample: '250' },
  { tag: '{customer_phone}', label: 'جوال العميل', sample: '0501234567' },
  { tag: '{invoice_url}', label: 'رابط الفاتورة', sample: 'https://seen-pos.app/order/10482' },
  { tag: '{store_name}', label: 'اسم المتجر', sample: 'خياطة الأناقة' },
];

export function getWhatsAppTemplate(): string {
  if (typeof localStorage === 'undefined') return DEFAULT_WHATSAPP_TEMPLATE;
  return localStorage.getItem('seen_whatsapp_template') || DEFAULT_WHATSAPP_TEMPLATE;
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
    '{customer_name}': data.customerName || 'العميل الكريم',
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
