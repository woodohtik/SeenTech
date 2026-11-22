// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

// seen-readiness-fixes-task.md P4 (OPERATIONS-13): the shop's WhatsApp
// settings, not one browser's, decide what is sent.
vi.mock('i18next', () => ({ default: { t: (k: string) => k } }));
import { getWhatsAppTemplate, isWhatsAppEnabled, sendWhatsAppMessage, setShopWhatsAppSettings, WHATSAPP_DISABLED_EVENT } from './whatsapp';

afterEach(() => { setShopWhatsAppSettings(null); localStorage.clear(); vi.restoreAllMocks(); });

describe('the shop WhatsApp settings', () => {
  it("the shop's template and switch win over this browser's old ones", () => {
    localStorage.setItem('seen_whatsapp_template', 'old {customer_name}');
    localStorage.setItem('seen_whatsapp_enabled', 'true');
    setShopWhatsAppSettings({ enabled: false, template: 'shop {customer_name}' });
    expect(getWhatsAppTemplate()).toBe('shop {customer_name}');
    expect(isWhatsAppEnabled()).toBe(false);
  });

  it('turned off: nothing opens, and the notice is raised', () => {
    setShopWhatsAppSettings({ enabled: false });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const notice = vi.fn();
    window.addEventListener(WHATSAPP_DISABLED_EVENT, notice);
    sendWhatsAppMessage('0500000000', 'hi');
    expect(open).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledTimes(1);
    window.removeEventListener(WHATSAPP_DISABLED_EVENT, notice);
  });

  it('on (or never set): WhatsApp opens with the message', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    sendWhatsAppMessage('0500000000', 'hi');
    expect(open).toHaveBeenCalledWith(expect.stringContaining('wa.me/0500000000?text=hi'), '_blank');
  });
});
