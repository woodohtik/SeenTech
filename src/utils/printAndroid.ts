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
  /** شرح عربي مختصر يُعرض في إعدادات الطابعة */
  advice: string;
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
      advice:
        'على الأندرويد تعمل الطباعة المباشرة بشكل جيد: إن كانت الطابعة موصولة USB-OTG أو بلوتوث BLE اربطها مباشرة من هذه الصفحة (لا يوجد على الأندرويد حجز تعريف حصري مثل ويندوز). ' +
        'وإن كانت الطابعة موصولة بكمبيوتر ويندوز في المتجر، اقترن مع وسيط سين على ذلك الجهاز.',
    };
  }

  if (isIOS()) {
    return {
      platform: 'ios',
      available: ['relay', 'network', 'dialog'],
      advice:
        'متصفحات iOS لا تدعم الوصول المباشر لأجهزة USB أو البلوتوث. استخدم الاقتران مع وسيط سين على جهاز ويندوز في المتجر، أو طابعة شبكة عبر عنوان IP.',
    };
  }

  if (isWindows()) {
    const available: PlatformPrintAdvice['available'] = ['relay', 'network'];
    if (secure && n.bluetooth) available.push('bluetooth');
    available.push('dialog');

    return {
      platform: 'windows',
      available,
      advice:
        'على ويندوز لا يستطيع أي متصفح فتح طابعة USB لها تعريف رسمي (النظام يحجزها حجزاً حصرياً — وهذا سبب رسالة Access Denied). ' +
        'الحل الصحيح هو الاقتران مع وسيط سين: يطبع صامتاً بنفس التعريف الرسمي.',
    };
  }

  return {
    platform: 'other',
    available: ['relay', 'network', 'dialog'],
    advice: 'استخدم الاقتران مع وسيط سين، أو طابعة شبكة عبر عنوان IP، أو مربع حوار الطباعة.',
  };
}

