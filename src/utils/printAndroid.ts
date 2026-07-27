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
  available: Array<'usb' | 'bluetooth' | 'rawbt' | 'relay' | 'network' | 'dialog'>;
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
    available.push('rawbt', 'relay', 'network', 'dialog');

    return {
      platform: 'android',
      available,
      advice:
        'على الأندرويد تعمل الطباعة المباشرة بشكل جيد: إن كانت الطابعة موصولة USB-OTG أو بلوتوث BLE اربطها مباشرة من هذه الصفحة (لا يوجد على الأندرويد حجز تعريف حصري مثل ويندوز). ' +
        'إن كانت الطابعة بلوتوث كلاسيك أو مدمجة في جهاز POS، ثبّت تطبيق RawBT المجاني. ' +
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

/* ============================================================================
   RawBT  —  الطباعة عبر تطبيق أندرويد مجاني
   ----------------------------------------------------------------------------
   RawBT يستقبل أوامر ESC/POS عبر Intent بنظام URL، ويوصلها لأي طابعة
   مقترنة بالنظام: بلوتوث (كلاسيك أو BLE)، USB-OTG، شبكة، أو الطابعة
   المدمجة في جهاز POS.

   هذا هو المسار الوحيد الذي يصل لطابعات **Bluetooth Classic** لأن
   Web Bluetooth يدعم BLE فقط — وأغلب الطابعات الحرارية الرخيصة في السوق
   كلاسيك وليست BLE.
   ============================================================================ */

/** أسماء حزمة RawBT — نجرّب الحزمة الرسمية ثم الاسم البديل. */
const RAWBT_PACKAGES = ['ru.a402d.rawbtprinter', 'ru.a402d.rawbtprinter.free'];

/** هل نحن على جهاز يمكن أن يملك RawBT إطلاقاً؟ */
export const canUseRawBT = (): boolean => isAndroid();

/**
 * إرسال بايتات ESC/POS خام إلى RawBT.
 *
 * ملاحظة مهمة: الدالة القديمة كانت ترسل **نصاً** فقط
 * (`printViaRawBT(textData)`)، وهذا يجعل العربية تخرج رموزاً مشوّشة لأن
 * أغلب الطابعات لا تحتوي خطاً عربياً مدمجاً. الحل الصحيح هو إرسال الفاتورة
 * كصورة نقطية بأوامر ESC/POS — وهو ما تفعله هذه الدالة عبر base64.
 */
export function sendBytesToRawBT(data: Uint8Array): void {
  if (!data?.length) throw new Error('بيانات الطباعة فارغة.');
  if (typeof window === 'undefined') throw new Error('غير متاح في هذه البيئة.');

  let binary = '';
  const CHUNK = 8192;
  for (let i = 0; i < data.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(data.subarray(i, i + CHUNK)) as any);
  }
  const b64 = btoa(binary);

  // RawBT يفهم البادئة "base64," كبيانات خام لا كنص
  const payload = encodeURIComponent(`base64,${b64}`);
  const pkg = RAWBT_PACKAGES[0];

  // صيغة Intent URL الخاصة بأندرويد — تفتح RawBT وتمرر له البيانات
  window.location.href = `intent:${payload}#Intent;scheme=rawbt;package=${pkg};end;`;
}

/**
 * إرسال نص عادي إلى RawBT.
 * مناسب للاختبار السريع بالإنجليزية فقط. للفواتير العربية استخدم
 * `sendBytesToRawBT` مع الرسم النقطي.
 */
export function sendTextToRawBT(text: string): void {
  if (typeof window === 'undefined') throw new Error('غير متاح في هذه البيئة.');
  const payload = encodeURIComponent(String(text || ''));
  window.location.href = `intent:${payload}#Intent;scheme=rawbt;package=${RAWBT_PACKAGES[0]};end;`;
}

/** رابط تنصيب RawBT من متجر Play — يُعرض للمستخدم عند اختيار هذا المسار. */
export const RAWBT_STORE_URL = `https://play.google.com/store/apps/details?id=${RAWBT_PACKAGES[0]}`;

/**
 * توجيه المستخدم لتنصيب RawBT.
 * لا توجد طريقة موثوقة لاكتشاف وجود التطبيق من المتصفح (الأندرويد لا يسمح
 * بذلك لأسباب خصوصية)، لذلك نعرض الرابط عند فشل الطباعة بدل التخمين.
 */
export function openRawBTStore(): void {
  if (typeof window === 'undefined') return;
  window.open(RAWBT_STORE_URL, '_blank', 'noopener,noreferrer');
}
