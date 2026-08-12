/**
 * printAndroid.ts
 * ============================================================================
 *  مسارات الطباعة الخاصة بأجهزة الأندرويد
 * ============================================================================
 *
 *  الأندرويد يختلف عن ويندوز اختلافاً جوهرياً في الطباعة المباشرة:
 *
 *  ┌──────────────┬────────────────────────┬────────────────────────────────┐
 *  │              │  ويندوز                │  أندرويد                       │
 *  ├──────────────┼────────────────────────┼────────────────────────────────┤
 *  │ USB          │ ✗ النظام يحجز الطابعة  │ ✓ WebUSB يعمل — لا يوجد        │
 *  │              │   حجزاً حصرياً عبر      │   usbprint.sys يحجز الجهاز،    │
 *  │              │   usbprint.sys ⇒       │   فلا تظهر رسالة Access Denied │
 *  │              │   Access Denied        │                                │
 *  ├──────────────┼────────────────────────┼────────────────────────────────┤
 *  │ بلوتوث BLE   │ ✓ Web Bluetooth        │ ✓ Web Bluetooth (Chrome)        │
 *  ├──────────────┼────────────────────────┼────────────────────────────────┤
 *  │ بلوتوث كلاسك │ ✗ غير مدعوم بالمتصفح   │ ✓ عبر تطبيق RawBT              │
 *  ├──────────────┼────────────────────────┼────────────────────────────────┤
 *  │ طابعة مدمجة  │ —                      │ ✓ عبر RawBT (أجهزة Sunmi وشبيهاتها) │
 *  └──────────────┴────────────────────────┴────────────────────────────────┘
 *
 *  الخلاصة العملية: على الأندرويد نحاول WebUSB / Web Bluetooth أولاً لأنهما
 *  لا يحتاجان أي تطبيق إضافي. وإن كانت الطابعة بلوتوث كلاسيك أو مدمجة في
 *  جهاز POS فنستخدم RawBT (تطبيق مجاني من متجر Play).
 * ============================================================================
 */

import i18n from 'i18next';

/* ============================ كشف المنصّة ============================ */

const ua = (): string =>
  typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';

export const isAndroid = (): boolean => /Android/i.test(ua());

export const isIOS = (): boolean =>
  /iPad|iPhone|iPod/i.test(ua()) ||
  // آيباد الحديث يعرّف نفسه كماك، نميّزه بوجود اللمس
  (/Macintosh/i.test(ua()) &&
    typeof navigator !== 'undefined' &&
    (navigator as any).maxTouchPoints > 1);

export const isWindows = (): boolean => /Windows/i.test(ua());

/** المتصفح يدعم واجهات الأجهزة (Chrome/Edge/Opera وما بُني عليها). */
export const supportsDeviceApis = (): boolean => {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const n = navigator as any;
  return window.isSecureContext && (!!n.usb || !!n.bluetooth || !!n.serial);
};

export interface PlatformPrintAdvice {
  platform: 'android' | 'ios' | 'windows' | 'other';
  /** المسارات المتاحة فعلياً على هذا الجهاز، مرتّبة من الأفضل للأسوأ */
  available: Array<'usb' | 'bluetooth' | 'relay' | 'network' | 'dialog'>;
  /** شرح مختصر يُعرض في إعدادات الطابعة (مترجم عند الاستدعاء) */
  advice: string;
  /**
   * مفتاح الترجمة لنفس الشرح — يفضّل استخدامه في الواجهة
   * (`t(adviceKey)`) حتى يتحدّث النص عند تغيير اللغة.
   */
  adviceKey: string;
}

/**
 * ما هي أفضل طريقة طباعة على هذا الجهاز تحديداً؟
 * تُستخدم في واجهة إعدادات الطابعة لإرشاد المستخدم بدل تركه يجرّب عشوائياً.
 */
export function getPlatformPrintAdvice(): PlatformPrintAdvice {
  const n = (typeof navigator !== 'undefined' ? navigator : {}) as any;
  const secure = typeof window !== 'undefined' && window.isSecureContext;

  if (isAndroid()) {
    const available: PlatformPrintAdvice['available'] = [];
    if (secure && n.usb) available.push('usb');
    if (secure && n.bluetooth) available.push('bluetooth');
    available.push('relay', 'network', 'dialog');

    return {
      platform: 'android',
      available,
      advice: i18n.t('printing.platform_advice.android'),
      adviceKey: 'printing.platform_advice.android',
    };
  }

  if (isIOS()) {
    return {
      platform: 'ios',
      available: ['relay', 'network', 'dialog'],
      advice: i18n.t('printing.platform_advice.ios'),
      adviceKey: 'printing.platform_advice.ios',
    };
  }

  if (isWindows()) {
    const available: PlatformPrintAdvice['available'] = ['relay', 'network'];
    if (secure && n.bluetooth) available.push('bluetooth');
    available.push('dialog');

    return {
      platform: 'windows',
      available,
      advice: i18n.t('printing.platform_advice.windows'),
      adviceKey: 'printing.platform_advice.windows',
    };
  }

  return {
    platform: 'other',
    available: ['relay', 'network', 'dialog'],
    advice: i18n.t('printing.platform_advice.other'),
    adviceKey: 'printing.platform_advice.other',
  };
}

