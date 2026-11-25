// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import i18n from 'i18next';
import ar from '../i18n/locales/ar.json';
import {
  WHATSAPP_DISABLED_EVENT,
  WHATSAPP_INVALID_PHONE_EVENT,
  fillWhatsAppTemplate,
  getWhatsAppTemplate,
  normalizeWhatsAppPhone,
  openWhatsApp,
  setShopWhatsAppSettings,
  unknownWhatsAppVariables,
  whatsappMessage,
} from './whatsapp';

// seen-whatsapp-templates-task.md

beforeAll(async () => {
  await i18n.init({ lng: 'ar', resources: { ar: { translation: ar } }, interpolation: { escapeValue: false } });
});
afterEach(() => { setShopWhatsAppSettings(null); localStorage.clear(); vi.restoreAllMocks(); });

describe('normalizeWhatsAppPhone: every way a Saudi number is saved, as WhatsApp wants it', () => {
  it.each([
    ['0501234567', '966501234567'],
    ['501234567', '966501234567'],
    ['+966501234567', '966501234567'],
    ['00966501234567', '966501234567'],
    ['966 50 123 4567', '966501234567'],
    ['٠٥٠١٢٣٤٥٦٧', '966501234567'],
  ])('%s -> %s', (raw, expected) => {
    expect(normalizeWhatsAppPhone(raw)).toBe(expected);
  });

  it.each(['', '123', 'abc', '05012'])('%j is not a phone number', (raw) => {
    expect(normalizeWhatsAppPhone(raw)).toBeNull();
  });
});

describe('openWhatsApp', () => {
  it('opens the chat with the number in international form', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    expect(openWhatsApp({ phone: '0501234567', message: 'هلا', kind: 'customer' })).toBe(true);
    expect(open).toHaveBeenCalledWith(`https://wa.me/966501234567?text=${encodeURIComponent('هلا')}`, '_blank');
  });

  it('without a number, lets the person pick the chat', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    openWhatsApp({ message: 'هلا', kind: 'customer' });
    expect(open).toHaveBeenCalledWith(`https://api.whatsapp.com/send?text=${encodeURIComponent('هلا')}`, '_blank');
  });

  it('a number that cannot be one: a clear notice, no broken link', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const notice = vi.fn();
    window.addEventListener(WHATSAPP_INVALID_PHONE_EVENT, notice);
    expect(openWhatsApp({ phone: '123', message: 'x', kind: 'customer' })).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledTimes(1);
    window.removeEventListener(WHATSAPP_INVALID_PHONE_EVENT, notice);
  });

  it('switched off: customer messages stop with a notice; internal and marketing ones still open', () => {
    setShopWhatsAppSettings({ enabled: false });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const notice = vi.fn();
    window.addEventListener(WHATSAPP_DISABLED_EVENT, notice);
    expect(openWhatsApp({ phone: '0501234567', message: 'x', kind: 'customer' })).toBe(false);
    expect(notice).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    openWhatsApp({ phone: '0501234567', message: 'z-report', kind: 'internal' });
    openWhatsApp({ message: 'refer', kind: 'marketing' });
    expect(open).toHaveBeenCalledTimes(2);
    window.removeEventListener(WHATSAPP_DISABLED_EVENT, notice);
  });
});

describe('four templates', () => {
  it('the shop template of each kind; the default in the interface language otherwise', () => {
    setShopWhatsAppSettings({ templates: { tracking_link: 'تتبع {tracking_url}' } });
    expect(getWhatsAppTemplate('tracking_link')).toBe('تتبع {tracking_url}');
    expect(getWhatsAppTemplate('measurements_link')).toContain('{measurements_url}');
  });

  it("a shop's old single template stays its order-received and invoice template (question 2)", () => {
    setShopWhatsAppSettings({ template: 'قالبي {customer_name}' });
    expect(getWhatsAppTemplate('order_received')).toBe('قالبي {customer_name}');
    expect(getWhatsAppTemplate('invoice')).toBe('قالبي {customer_name}');
    expect(getWhatsAppTemplate('tracking_link')).not.toBe('قالبي {customer_name}');
  });

  it('the defaults put each sentence on its own line', () => {
    expect(getWhatsAppTemplate('order_received').split('\n').length).toBeGreaterThan(2);
  });
});

describe('filling a template', () => {
  it('a variable with no value takes its whole line away -- no "من هنا:" left hanging', () => {
    const text = fillWhatsAppTemplate('مرحباً {customer_name}\nتابع طلبك من هنا: {invoice_url}\n{store_name}', {
      customer_name: 'سعد', invoice_url: '', store_name: 'مشغل',
    });
    expect(text).toBe('مرحباً سعد\nمشغل');
  });

  it('a misspelt variable never shows its braces', () => {
    expect(fillWhatsAppTemplate('هلا {custmer_name} {customer_name}', { customer_name: 'سعد' })).toBe('هلا  سعد');
    expect(unknownWhatsAppVariables('هلا {custmer_name} {tracking_url}', 'order_received')).toEqual(['{custmer_name}', '{tracking_url}']);
    expect(unknownWhatsAppVariables('{tracking_url}', 'tracking_link')).toEqual([]);
  });
});

describe('whatsappMessage: one way to fill every message', () => {
  const sale = { customerName: 'سعد', orderNumber: '1042', invoiceNumber: 'INV-2026-00042', total: 287.5, trackingToken: 'tok', storeName: 'مشغل الأناقة' };

  it('the invoice uses the invoice number; the others the full order number; the total to two decimals', () => {
    setShopWhatsAppSettings({ templates: { invoice: '{order_id} {total_amount}', order_received: '{order_id}', tracking_link: '{order_id}' } });
    expect(whatsappMessage('invoice', sale)).toBe('INV-2026-00042 287.50');
    expect(whatsappMessage('order_received', sale)).toBe('1042');
    expect(whatsappMessage('tracking_link', sale)).toBe('1042');
  });

  it('the same store name and links everywhere', () => {
    setShopWhatsAppSettings({ templates: { tracking_link: '{store_name} {tracking_url}', measurements_link: '{measurements_url}' } });
    expect(whatsappMessage('tracking_link', sale)).toBe(`مشغل الأناقة ${window.location.origin}/track/tok`);
    expect(whatsappMessage('measurements_link', { ...sale, measurementsToken: 'm1' })).toBe(`${window.location.origin}/measurements/m1`);
  });

  it('no tracking link: the default order message has no broken sentence', () => {
    const text = whatsappMessage('order_received', { ...sale, trackingToken: undefined });
    expect(text).not.toMatch(/:\s*$/m);
    expect(text).not.toContain('{');
  });
});
