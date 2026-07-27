/**
 * printManager.ts
 * ------------------------------------------------------------------
 * محرك الطباعة الموحّد لنظام سين POS.
 *
 * يدعم مسارين:
 *
 *  1) الطباعة المباشرة (صامتة) على طابعة حرارية مربوطة فعلياً:
 *     USB (WebUSB) / منفذ تسلسلي (Web Serial) / بلوتوث (Web Bluetooth) /
 *     شبكة LAN عبر وسيط السيرفر (منفذ 9100). يتم تحويل الفاتورة إلى صورة
 *     نقطية ثم إرسالها كأوامر ESC/POS — وهي الطريقة الوحيدة الموثوقة
 *     لطباعة العربية لأن أغلب الطابعات لا تحتوي خطاً عربياً مدمجاً.
 *
 *  2) الطباعة عبر مربع حوار المتصفح (طابعة النظام / طابعة عادية A4):
 *     يتم بناء مستند طباعة معزول داخل iframe مع نسخ كامل تنسيقات
 *     التطبيق (CSS) وتحويل عناصر canvas (الباركود / QR) إلى صور،
 *     وانتظار تحميل الصور والخطوط قبل إطلاق أمر الطباعة.
 *
 * ------------------------------------------------------------------
 * أهم الأعطال التي كانت تمنع الطباعة وتم إصلاحها هنا:
 *   • كان الـ iframe بأبعاد 0×0 و visibility:hidden → المتصفح يطبع
 *     صفحة فارغة أو يتجاهل الأمر تماماً.
 *   • لم يكن يتم نسخ تنسيقات التطبيق (Tailwind) إلى مستند الطباعة
 *     → المحتوى يخرج بلا تنسيق أو مخفي بقواعد @media print.
 *   • نسخ innerHTML يُفقد محتوى عناصر <canvas> (QR والباركود).
 *   • كان يُطبع بعد 300ms ثابتة قبل تحميل الصور والخطوط.
 *   • كان يُرجع "نجاح" دائماً حتى لو لم تتم الطباعة إطلاقاً.
 *   • مسار الرسم النقطي كان يصوّر عنصراً بـ opacity:0 → صورة بيضاء.
 * ------------------------------------------------------------------
 */

export type PrintPaperSize = '80mm' | '58mm' | 'A4' | 'A5';

export interface PrintOptions {
  paperSize?: PrintPaperSize;
  title?: string;
  autoCloseDelay?: number;
  /** تخطي محاولة الإرسال المباشر للجهاز المربوط (USB/Serial/Bluetooth/Network) */
  skipRawDevice?: boolean;
  /** عدد النسخ (للطباعة المباشرة فقط) */
  copies?: number;
  /** فتح درج النقود بعد الطباعة (للطباعة المباشرة فقط) */
  openCashDrawer?: boolean;
}

export type PrintMethod =
  | 'raw-usb'
  | 'raw-serial'
  | 'raw-bluetooth'
  | 'raw-network'
  | 'raw-relay'
  | 'raw-rawbt'
  | 'raw-agent'
  | 'dialog-iframe'
  | 'dialog-popup'
  | 'dialog-window'
  | 'none';

export interface PrintResult {
  ok: boolean;
  method: PrintMethod;
  /** رسالة عربية جاهزة للعرض للمستخدم */
  message: string;
  /** تفاصيل الخطأ الفني إن وُجد */
  error?: string;
}

/* ================================================================
   1) أدوات مساعدة عامة
   ================================================================ */

const DOT_WIDTH: Record<string, number> = {
  '58mm': 384, // 203dpi
  '80mm': 576,
  A4: 1240,
  A5: 874,
};

const CSS_WIDTH: Record<string, string> = {
  '58mm': '58mm',
  '80mm': '80mm',
  A4: '210mm',
  A5: '148mm',
};

const isThermal = (size: string) => size === '58mm' || size === '80mm';

/** انتظار ظهور العنصر في DOM (قد يتأخر بسبب دورة رسم React). */
const waitForElement = async (elementId: string, timeoutMs = 1500): Promise<HTMLElement | null> => {
  const started = Date.now();
  let el = document.getElementById(elementId);
  while (!el && Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 50));
    el = document.getElementById(elementId);
  }
  return el;
};

/** الأصناف (classes) التي تُخفي العنصر في الشاشة ويجب إزالتها من النسخة المطبوعة. */
const HIDING_CLASS_RE =
  /^(hidden|invisible|opacity-0|pointer-events-none|sr-only|fixed|absolute|z-\[?\d+\]?|max-h-\S+|overflow-\S+|-?(left|top|right|bottom)-\S+)$/;

const stripHidingClasses = (el: HTMLElement) => {
  if (!el.classList || !el.classList.length) return;
  Array.from(el.classList).forEach((c) => {
    if (HIDING_CLASS_RE.test(c)) el.classList.remove(c);
  });
  const s = el.style;
  if (s.display === 'none') s.display = 'block';
  if (s.visibility === 'hidden') s.visibility = 'visible';
  if (s.opacity && Number(s.opacity) === 0) s.opacity = '1';
  s.removeProperty('max-height');
};

/**
 * تجميع كل تنسيقات الصفحة (CSS) لإدراجها في مستند الطباعة.
 * بدون هذه الخطوة تخرج الفاتورة بلا أي تنسيق (كان هذا أحد أسباب الورق الفارغ).
 */
let cachedAppCss: string | null = null;
const collectAppCss = (): { css: string; links: string[] } => {
  const links: string[] = [];

  if (cachedAppCss !== null) {
    document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]').forEach((l) => {
      if (l.href && new URL(l.href, location.href).origin !== location.origin) links.push(l.href);
    });
    return { css: cachedAppCss, links };
  }

  let css = '';
  Array.from(document.styleSheets).forEach((sheet) => {
    const href = (sheet as CSSStyleSheet).href;
    try {
      if (href && new URL(href, location.href).origin !== location.origin) {
        links.push(href);
        return;
      }
      const rules = (sheet as CSSStyleSheet).cssRules;
      for (let i = 0; i < rules.length; i++) css += rules[i].cssText + '\n';
    } catch {
      // ورقة أنماط محجوبة (CORS) → نضيفها كرابط
      if (href) links.push(href);
    }
  });

  cachedAppCss = css;
  return { css, links };
};

/**
 * بناء نسخة قابلة للطباعة من العنصر:
 *  - إزالة أصناف الإخفاء
 *  - تحويل <canvas> (الباركود / QR) إلى <img> لأن innerHTML يفقد محتواها
 *  - تحويل مسارات الصور إلى مسارات مطلقة
 *  - نقل قيم الحقول (inputs) إلى نص ظاهر
 */
const buildPrintableClone = (element: HTMLElement): HTMLElement => {
  const clone = element.cloneNode(true) as HTMLElement;

  // 1) canvas → img (innerHTML/cloneNode لا ينقل بكسلات الرسم)
  const srcCanvases = element.querySelectorAll('canvas');
  const cloneCanvases = clone.querySelectorAll('canvas');
  srcCanvases.forEach((srcC, i) => {
    const target = cloneCanvases[i];
    if (!target) return;
    try {
      const c = srcC as HTMLCanvasElement;
      if (!c.width || !c.height) return;
      const img = document.createElement('img');
      img.src = c.toDataURL('image/png');
      const rect = c.getBoundingClientRect();
      img.style.width = `${Math.round(rect.width || c.width)}px`;
      img.style.height = 'auto';
      img.setAttribute('alt', '');
      target.replaceWith(img);
    } catch (e) {
      console.warn('[printManager] تعذر تحويل canvas إلى صورة:', e);
    }
  });

  // 2) SVG (بعض مكتبات الباركود تُخرج SVG) — تثبيت الأبعاد
  const srcSvgs = element.querySelectorAll('svg');
  const cloneSvgs = clone.querySelectorAll('svg');
  srcSvgs.forEach((s, i) => {
    const target = cloneSvgs[i] as SVGElement | undefined;
    if (!target) return;
    const rect = (s as SVGElement).getBoundingClientRect();
    if (rect.width && rect.height) {
      target.setAttribute('width', String(Math.round(rect.width)));
      target.setAttribute('height', String(Math.round(rect.height)));
    }
  });

  // 3) الصور → مسارات مطلقة
  clone.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src');
    if (src && !/^(data:|blob:|https?:)/i.test(src)) {
      try {
        img.setAttribute('src', new URL(src, location.href).href);
      } catch {
        /* تجاهل */
      }
    }
    img.setAttribute('loading', 'eager');
    img.removeAttribute('srcset');
  });

  // 4) الحقول → نص ثابت
  const srcFields = element.querySelectorAll('input, textarea, select');
  const cloneFields = clone.querySelectorAll('input, textarea, select');
  srcFields.forEach((f, i) => {
    const target = cloneFields[i];
    if (!target) return;
    if (f instanceof HTMLInputElement && (f.type === 'checkbox' || f.type === 'radio')) return;
    const value =
      f instanceof HTMLSelectElement
        ? f.options[f.selectedIndex]?.text || ''
        : (f as HTMLInputElement | HTMLTextAreaElement).value || '';
    const span = document.createElement('span');
    span.textContent = value;
    span.className = (target as HTMLElement).className || '';
    target.replaceWith(span);
  });

  // 5) إزالة العناصر غير المرغوبة
  clone.querySelectorAll('script, .no-print, [data-no-print]').forEach((n) => n.remove());

  // 6) إبطال الإخفاء على الجذر وعلى الأبناء المخفيين
  stripHidingClasses(clone);
  clone.querySelectorAll<HTMLElement>('*').forEach((child) => {
    const cls = child.className;
    if (typeof cls === 'string' && /(^|\s)(opacity-0|invisible|hidden)(\s|$)/.test(cls)) {
      stripHidingClasses(child);
    }
  });

  return clone;
};

/** بناء مستند HTML كامل ومستقل للطباعة. */
const buildPrintDocument = (bodyHtml: string, options: PrintOptions): string => {
  const paperSize = options.paperSize || '80mm';
  const widthCss = CSS_WIDTH[paperSize] || '80mm';
  const thermal = isThermal(paperSize);
  const pageSize = thermal ? `${widthCss} auto` : paperSize === 'A5' ? 'A5' : 'A4';
  const pageMargin = thermal ? '0' : '8mm';
  const { css, links } = collectAppCss();

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${(options.title || 'فاتورة').replace(/[<>&"]/g, '')}</title>
${links.map((h) => `<link rel="stylesheet" href="${h}">`).join('\n')}
<style>
/* ===== تنسيقات التطبيق المنسوخة ===== */
${css}
</style>
<style>
/* ===== تجاوزات خاصة بمستند الطباعة (تأتي بعد تنسيقات التطبيق) ===== */
@page { size: ${pageSize}; margin: ${pageMargin}; }

html, body {
  margin: 0 !important;
  padding: 0 !important;
  background: #ffffff !important;
  color: #000000 !important;
  width: ${thermal ? widthCss : 'auto'} !important;
  min-width: 0 !important;
  overflow: visible !important;
  visibility: visible !important;
  display: block !important;
  direction: rtl;
}

*, *::before, *::after {
  box-sizing: border-box;
  visibility: visible !important;
  animation: none !important;
  transition: none !important;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
  box-shadow: none !important;
  text-shadow: none !important;
  backdrop-filter: none !important;
}

/* إبطال أي قاعدة إخفاء ورثناها من تنسيقات التطبيق */
#seen-print-root,
#seen-print-root *,
#print-area, #print-area *,
#pos-invoice-print-area, #pos-invoice-print-area *,
#receipt-printable-content, #receipt-printable-content *,
.printable-area, .printable-area * {
  visibility: visible !important;
  opacity: 1 !important;
}

#seen-print-root,
#print-area,
#pos-invoice-print-area,
#receipt-printable-content,
.printable-area {
  display: block !important;
  position: static !important;
  inset: auto !important;
  transform: none !important;
  width: 100% !important;
  max-width: 100% !important;
  max-height: none !important;
  height: auto !important;
  overflow: visible !important;
  margin: 0 !important;
  border: none !important;
  border-radius: 0 !important;
  background: #ffffff !important;
  color: #000000 !important;
  pointer-events: auto !important;
}

#seen-print-root {
  width: ${thermal ? widthCss : '100%'} !important;
  max-width: ${thermal ? widthCss : '100%'} !important;
  padding: ${thermal ? '2mm 1.5mm' : '0'} !important;
  font-family: 'Tajawal', 'Segoe UI', system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif;
  ${thermal ? 'font-size: 11.5px; line-height: 1.45;' : ''}
  color: #000000 !important;
}

#seen-print-root * { color: #000000 !important; }

img, svg { max-width: 100% !important; height: auto !important; }
table { width: 100% !important; border-collapse: collapse !important; }
th, td { padding: 1px 2px !important; }

/* لا نطبع عناصر التحكم */
#seen-print-root button,
#seen-print-root [role="button"],
#seen-print-root .no-print { display: none !important; }

${
  thermal
    ? `#seen-print-root, #seen-print-root * { font-weight: 600 !important; }
       #seen-print-root h1 { font-size: 15px !important; }
       #seen-print-root h2 { font-size: 13.5px !important; }
       #seen-print-root h3 { font-size: 12.5px !important; }`
    : ''
}
</style>
</head>
<body>
<div id="seen-print-root" class="printable-area" dir="rtl">
${bodyHtml}
</div>
</body>
</html>`;
};

/** انتظار جاهزية مستند الطباعة: الصور + الخطوط + إطارين للرسم. */
const waitForDocumentReady = async (doc: Document, win: Window): Promise<void> => {
  const imgs = Array.from(doc.images || []);
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) return resolve();
          let settled = false;
          const done = () => {
            if (!settled) {
              settled = true;
              resolve();
            }
          };
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
          setTimeout(done, 5000);
        })
    )
  );

  try {
    const fonts = (doc as any).fonts;
    if (fonts?.ready) {
      await Promise.race([fonts.ready, new Promise((r) => setTimeout(r, 2500))]);
    }
  } catch {
    /* تجاهل */
  }

  await new Promise<void>((resolve) => {
    const raf = win.requestAnimationFrame?.bind(win) || ((cb: any) => setTimeout(cb, 16));
    raf(() => raf(() => resolve()));
  });
};

/** إطلاق أمر الطباعة للنافذة دون تعطيل واجهة المستخدم أو حجز الـ Promise. */
const triggerPrintAndWait = async (win: Window): Promise<void> => {
  return new Promise<void>((resolve) => {
    try {
      win.focus();
    } catch {
      /* تجاهل */
    }

    // إطلاق أمر الطباعة بشكل غير متزامن لتجنب إيقاف تنفيذ جافاسكربت وتجميد الواجهة
    setTimeout(() => {
      try {
        win.focus();
        win.print();
      } catch (e) {
        console.warn('[printManager] تعذر استدعاء win.print():', e);
      }
    }, 50);

    // حسم الوعد فوراً حتى تعود الواجهة وتظهر الرسالة وتتوقف عجلة الدوران
    setTimeout(() => resolve(), 150);
  });
};

/* ================================================================
   2) الطباعة المباشرة (ESC/POS) على جهاز مربوط
   ================================================================ */

export interface ActivePrinterConfig {
  id: string;
  transport:
    | 'usb'
    | 'serial'
    | 'bluetooth'
    | 'network'
    | 'agent'
    | 'relay'
    | 'rawbt'
    | 'system';
  size: PrintPaperSize;
  ipAddress?: string;
  port?: string;
  baudRate?: number;
  /** اسم الطابعة في نظام التشغيل — لنوع النقل 'agent' و 'relay' */
  printerName?: string;
}

/** أنواع النقل التي تدعم الإرسال المباشر بأوامر ESC/POS (طباعة صامتة). */
const RAW_TRANSPORTS = ['usb', 'serial', 'bluetooth', 'network', 'agent', 'relay', 'rawbt'];

/** قراءة الطابعة النشطة من التخزين المحلي. */
export const getActivePrinterConfig = (): ActivePrinterConfig | null => {
  try {
    const id = localStorage.getItem('active_printer_id');
    const transport = localStorage.getItem('active_printer_type') as ActivePrinterConfig['transport'] | null;
    if (!id || !transport) return null;

    const size = (localStorage.getItem('active_printer_size') as PrintPaperSize) || '80mm';
    let ipAddress: string | undefined;
    let port: string | undefined;
    let baudRate: number | undefined;
    let printerName: string | undefined;

    try {
      const list = JSON.parse(localStorage.getItem('linked_printers') || '[]');
      const found = Array.isArray(list) ? list.find((p: any) => p.id === id) : null;
      if (found) {
        ipAddress = found.ipAddress;
        port = found.port;
        baudRate = found.baudRate;
        printerName = found.printerName || found.name;
      }
    } catch {
      /* تجاهل */
    }

    return { id, transport, size, ipAddress, port, baudRate, printerName };
  } catch {
    return null;
  }
};

/** حجم الورق المضبوط للطابعة الافتراضية (يُستخدم كقيمة افتراضية في كل مكان). */
export const getConfiguredPaperSize = (fallback: PrintPaperSize = '80mm'): PrintPaperSize => {
  try {
    const size = localStorage.getItem('active_printer_size') as PrintPaperSize | null;
    return size && ['80mm', '58mm', 'A4', 'A5'].includes(size) ? size : fallback;
  } catch {
    return fallback;
  }
};

/**
 * تحويل عنصر HTML إلى صورة نقطية بعرض الطابعة الحرارية.
 * يتم العمل على نسخة معزولة خارج الشاشة — لا نلمس DOM الحقيقي لـ React.
 */
export const rasterizeElement = async (
  element: HTMLElement,
  pixelWidth: number
): Promise<HTMLCanvasElement> => {
  const { toCanvas } = await import('html-to-image');

  const holder = document.createElement('div');
  holder.setAttribute('data-seen-print-holder', 'true');
  holder.style.cssText = [
    'position:fixed',
    'left:-20000px',
    'top:0',
    `width:${pixelWidth}px`,
    'padding:0',
    'margin:0',
    'background:#ffffff',
    'color:#000000',
    'z-index:-1',
    'opacity:1',
    'visibility:visible',
    'display:block',
    'pointer-events:none',
    'overflow:visible',
  ].join(';');

  const clone = buildPrintableClone(element);
  clone.style.width = '100%';
  clone.style.maxWidth = '100%';
  clone.style.background = '#ffffff';
  clone.style.color = '#000000';
  holder.appendChild(clone);
  document.body.appendChild(holder);

  try {
    await waitForDocumentReady(document, window);

    const height = Math.max(holder.scrollHeight, clone.scrollHeight);
    if (height < 4) throw new Error('محتوى الفاتورة فارغ — لا يوجد ما يُطبع.');

    return await toCanvas(clone, {
      backgroundColor: '#ffffff',
      pixelRatio: 1,
      width: pixelWidth,
      canvasWidth: pixelWidth,
      height,
      canvasHeight: height,
    });
  } finally {
    holder.remove();
  }
};

/**
 * بناء ترتيب المحاولات للطباعة الصامتة.
 *
 * الطابعة المختارة أولاً دائماً، ثم مسارات احتياطية **متوافقة مع الجهاز
 * الحالي** فقط. الفكرة أن نظام سين يُستخدم من ويندوز ومن أندرويد على نفس
 * الحساب، ولا يصح أن تتوقف الطباعة لمجرد أن الطابعة المحفوظة تخص الجهاز
 * الآخر.
 *
 * مثال: كاشير حفظ طابعة USB من جهاز ويندوز، ثم فتح النظام من تابلت أندرويد.
 * بدون هذا الترتيب ستفشل الطباعة نهائياً. مع الترتيب: يُجرَّب الوسيط
 * المقترن، فتُطبع الفاتورة على طابعة المتجر نفسها.
 */
/**
 * اسم طابعة نظام التشغيل الصالح للاستخدام مع الوسيط.
 *
 * ⚠️ نقطة دقيقة: لا يصح استخدام `cfg.printerName` لهذا الغرض، لأن
 * `getActivePrinterConfig` تحسبه بـ `found.printerName || found.name`. طابعات
 * USB/بلوتوث/تسلسلي ليس لها `printerName`، فيصبح الاسم هو عنوان الجهاز في
 * المتصفح — مثل "طابعة USB 0416:5011" — وهذا اسم لا وجود له في سبولر
 * ويندوز، فتفشل المهمة. نقرأ الاسم من سجل طابعة نوعها 'relay' فقط، لأن
 * اسمها مأخوذ أصلاً من قائمة طابعات نظام التشغيل.
 */
const getRelayPrinterName = (cfg: ActivePrinterConfig): string | null => {
  if (cfg.transport === 'relay' && cfg.printerName) return cfg.printerName;

  try {
    const list = JSON.parse(localStorage.getItem('linked_printers') || '[]');
    if (!Array.isArray(list)) return null;
    const entry = list.find((p: any) => p?.type === 'relay' && (p.printerName || p.name));
    return entry ? String(entry.printerName || entry.name) : null;
  } catch {
    return null;
  }
};

const buildTransportChain = async (
  cfg: ActivePrinterConfig
): Promise<{ chain: ActivePrinterConfig['transport'][]; relayPrinterName: string | null }> => {
  const chain: ActivePrinterConfig['transport'][] = [];
  const push = (t: ActivePrinterConfig['transport']) => {
    if (!chain.includes(t) && RAW_TRANSPORTS.includes(t)) chain.push(t);
  };

  // 1) ما اختاره المستخدم
  push(cfg.transport);

  const platform = await import('./printAndroid');
  const relay = await import('./printRelayClient');

  // 2) الوسيط المقترن — يعمل من أي جهاز، وهو الأكثر موثوقية.
  //    نشترط وجود اسم طابعة حقيقي في نظام التشغيل، لا مجرد عنوان جهاز.
  const relayPrinterName = getRelayPrinterName(cfg);
  if (relay.isRelayPaired() && relayPrinterName) push('relay');

  // 3) طابعة شبكة إن كان عنوانها محفوظاً
  if (cfg.ipAddress) push('network');

  // 4) مسار الأندرويد الأصلي
  if (platform.isAndroid()) push('rawbt');

  /*
   * لا نضيف 'agent' (الوسيط المحلي على 127.0.0.1) تلقائياً. الوسيط الحالي
   * لم يعد يفتح خادماً محلياً إطلاقاً، فمحاولته تعني انتظار مهلة 2.5 ثانية
   * ثم الفشل — تأخير محسوس في كل فاتورة بلا أي فائدة. يبقى متاحاً فقط إن
   * اختاره المستخدم صراحةً (يدخل عبر push(cfg.transport) أعلاه).
   */

  return { chain, relayPrinterName };
};

/**
 * محاولة الطباعة الصامتة على الجهاز المربوط.
 * ترجع null إذا لم تكن هناك طابعة مربوطة (ليس خطأ — ننتقل لمسار المتصفح).
 */
export const printElementViaRawDevice = async (
  elementId: string,
  options: PrintOptions = {}
): Promise<PrintResult | null> => {
  const cfg = getActivePrinterConfig();
  if (!cfg) return null;
  if (!RAW_TRANSPORTS.includes(cfg.transport)) return null;

  const element = await waitForElement(elementId);
  if (!element) return null;

  const paperSize = options.paperSize || cfg.size || '80mm';

  // أوامر ESC/POS مخصّصة للطابعات الحرارية فقط.
  // الورق العادي (A4/A5) يجب أن يمر عبر مربع حوار الطباعة / تعريف النظام.
  if (!isThermal(paperSize)) return null;

  const pixelWidth = DOT_WIDTH[paperSize] || 576;
  const copies = Math.max(1, options.copies || 1);

  // الرسم النقطي مرة واحدة فقط — هو أثقل خطوة، ونُعيد استخدامه في كل المحاولات
  let bytes: Uint8Array;
  let discovery: typeof import('./printerDiscovery');

  try {
    discovery = await import('./printerDiscovery');
    const canvas = await rasterizeElement(element, pixelWidth);
    bytes = discovery.canvasToEscPosRaster(canvas);
  } catch (e: any) {
    console.warn('[printManager] فشل تحويل الفاتورة إلى صورة للطباعة:', e);
    return {
      ok: false,
      method: 'none',
      message: e?.message || 'تعذر تجهيز الفاتورة للطباعة المباشرة.',
      error: String(e?.message || e),
    };
  }

  const { chain, relayPrinterName } = await buildTransportChain(cfg);
  const failures: string[] = [];

  for (const transport of chain) {
    // كل هذه المسارات تتولى تكرار النسخ داخلياً في نداء واحد
    const handlesCopies = transport === 'relay' || transport === 'network' || transport === 'rawbt';

    const conn = {
      ipAddress: cfg.ipAddress,
      port: cfg.port,
      baudRate: cfg.baudRate,
      // مسار الوسيط يحتاج اسم طابعة حقيقياً في نظام التشغيل
      printerName: transport === 'relay' ? relayPrinterName || cfg.printerName : cfg.printerName,
      copies: handlesCopies ? copies : 1,
      docName: options.title || 'SEEN POS Receipt',
    };

    try {
      if (handlesCopies) {
        await discovery.sendRawToPrinter(cfg.id, transport, bytes, conn);
      } else {
        for (let i = 0; i < copies; i++) {
          await discovery.sendRawToPrinter(cfg.id, transport, bytes, conn);
        }
      }

      if (options.openCashDrawer) {
        try {
          /*
           * RawBT يعمل عبر Intent (تغيير window.location)، والنداءان
           * المتتاليان بلا فاصل يُلغي أحدهما الآخر فتُفقد إحدى المهمتين.
           * ننتظر قبل أمر الدرج تماماً كما نفعل بين النسخ.
           */
          if (transport === 'rawbt') await new Promise((r) => setTimeout(r, 1200));

          await discovery.sendRawToPrinter(cfg.id, transport, discovery.openCashDrawerCommand(), {
            ...conn,
            copies: 1,
          });
        } catch {
          /* درج النقود اختياري — لا نُفشل الطباعة بسببه */
        }
      }

      if (failures.length) {
        console.info(`[printManager] نجحت الطباعة عبر "${transport}" بعد فشل: ${failures.join(' | ')}`);
      }

      return {
        ok: true,
        method: `raw-${transport}` as PrintMethod,
        message:
          transport === 'relay'
            ? 'تم إرسال الفاتورة للطابعة عبر وسيط سين.'
            : 'تم إرسال الفاتورة مباشرة إلى الطابعة.',
      };
    } catch (e: any) {
      const msg = e?.message || String(e);
      failures.push(`${transport}: ${msg}`);
      console.warn(`[printManager] فشل المسار "${transport}":`, msg);
    }
  }

  // فشلت كل المسارات الصامتة → نُرجع أوضح رسالة (الأولى = مسار المستخدم المختار)
  return {
    ok: false,
    method: `raw-${cfg.transport}` as PrintMethod,
    message:
      failures[0]?.replace(/^[a-z]+:\s*/, '') ||
      'تعذر الإرسال المباشر للطابعة. سيتم فتح مربع حوار الطباعة.',
    error: failures.join(' | '),
  };
};

/* ================================================================
   3) الطباعة عبر مربع حوار المتصفح
   ================================================================ */

const printViaIframe = async (html: string): Promise<PrintResult> => {
  // إزالة أي إطار طباعة سابق (إعادة استخدام الإطار القديم كانت تسبب صفحات فارغة)
  document.querySelectorAll('iframe[data-seen-print="1"]').forEach((n) => n.remove());

  const iframe = document.createElement('iframe');
  iframe.setAttribute('data-seen-print', '1');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('title', 'مستند الطباعة');
  // مهم: أبعاد حقيقية وبدون visibility:hidden — وإلا يطبع المتصفح صفحة فارغة
  iframe.style.cssText = [
    'position:fixed',
    'left:-20000px',
    'top:0',
    'width:260mm',
    'height:100vh',
    'border:0',
    'padding:0',
    'margin:0',
    'background:#ffffff',
    'z-index:-1',
  ].join(';');

  document.body.appendChild(iframe);

  const cleanup = () => {
    setTimeout(() => {
      try {
        iframe.remove();
      } catch {
        /* تجاهل */
      }
    }, 60000);
  };

  try {
    const loaded = new Promise<void>((resolve) => {
      iframe.addEventListener('load', () => resolve(), { once: true });
      setTimeout(() => resolve(), 6000);
    });

    // srcdoc أكثر موثوقية من document.write ويطلق حدث load بشكل صحيح
    let usedSrcdoc = true;
    try {
      iframe.srcdoc = html;
    } catch {
      usedSrcdoc = false;
    }
    if (usedSrcdoc) await loaded;

    let doc: Document | null = iframe.contentDocument || iframe.contentWindow?.document || null;

    // مسار بديل إذا لم يعمل srcdoc
    if (!doc || !doc.body || doc.body.innerHTML.trim().length === 0) {
      doc = iframe.contentWindow?.document || iframe.contentDocument || null;
      if (doc) {
        doc.open();
        doc.write(html);
        doc.close();
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    const win = iframe.contentWindow;
    if (!doc || !win) throw new Error('تعذر إنشاء مستند الطباعة داخل الإطار.');

    await waitForDocumentReady(doc, win);

    const root = doc.getElementById('seen-print-root');
    const hasContent =
      !!root &&
      (root.scrollHeight > 4 || (root.textContent || '').trim().length > 0 || doc.images.length > 0);

    if (!hasContent) {
      throw new Error('مستند الطباعة فارغ — تأكد من ظهور الفاتورة على الشاشة قبل الطباعة.');
    }

    await triggerPrintAndWait(win);
    cleanup();

    return { ok: true, method: 'dialog-iframe', message: 'تم إرسال المستند إلى مربع حوار الطباعة.' };
  } catch (e: any) {
    cleanup();
    console.warn('[printManager] فشل مسار الإطار المضمن:', e);
    return {
      ok: false,
      method: 'dialog-iframe',
      message: e?.message || 'فشل مسار الطباعة عبر الإطار.',
      error: String(e?.message || e),
    };
  }
};

const printViaPopup = async (html: string): Promise<PrintResult> => {
  let win: Window | null = null;
  try {
    win = window.open('', '_blank', 'width=560,height=760,top=80,left=80');
  } catch {
    win = null;
  }

  if (!win) {
    return {
      ok: false,
      method: 'dialog-popup',
      message: 'المتصفح حجب النافذة المنبثقة. اسمح بالنوافذ المنبثقة لهذا الموقع ثم أعد المحاولة.',
    };
  }

  const autoClose = () => {
    try {
      if (win && !win.closed) {
        win.close();
      }
    } catch {
      /* تجاهل */
    }
  };

  try {
    win.document.open();
    win.document.write(html);
    win.document.close();

    await waitForDocumentReady(win.document, win);

    try {
      win.addEventListener('afterprint', autoClose, { once: true });
      win.onafterprint = autoClose;
    } catch {
      /* تجاهل */
    }

    await triggerPrintAndWait(win);

    autoClose();
    setTimeout(autoClose, 100);

    return { ok: true, method: 'dialog-popup', message: 'تم إرسال المستند إلى مربع حوار الطباعة وإغلاق النافذة تلقائياً.' };
  } catch (e: any) {
    autoClose();
    return {
      ok: false,
      method: 'dialog-popup',
      message: e?.message || 'فشل مسار النافذة المنبثقة.',
      error: String(e?.message || e),
    };
  }
};

/** طباعة سلسلة HTML خام (متوافق مع التوقيع القديم: يرجع boolean). */
export const printHtmlContent = async (
  htmlContent: string,
  options: PrintOptions = {}
): Promise<boolean> => {
  const res = await printHtmlContentDetailed(htmlContent, options);
  return res.ok;
};

export const printHtmlContentDetailed = async (
  htmlContent: string,
  options: PrintOptions = {}
): Promise<PrintResult> => {
  const doc = buildPrintDocument(htmlContent, options);

  const viaIframe = await printViaIframe(doc);
  if (viaIframe.ok) return viaIframe;

  const viaPopup = await printViaPopup(doc);
  if (viaPopup.ok) return viaPopup;

  // الملاذ الأخير: طباعة النافذة الحالية (تعتمد على قواعد @media print في index.css)
  try {
    window.print();
    return { ok: true, method: 'dialog-window', message: 'تم استخدام طباعة النافذة الحالية كحل بديل.' };
  } catch (e: any) {
    return {
      ok: false,
      method: 'none',
      message: `فشلت جميع مسارات الطباعة. ${viaIframe.message}`,
      error: String(e?.message || e),
    };
  }
};

/* ================================================================
   4) الواجهة العامة
   ================================================================ */

/** الطباعة الكاملة لعنصر: الجهاز المربوط أولاً ثم مربع الحوار. */
export const printElementDetailed = async (
  elementId: string,
  options: PrintOptions = {}
): Promise<PrintResult> => {
  // 1) طابعة مربوطة مباشرة → طباعة صامتة بأوامر ESC/POS
  if (!options.skipRawDevice) {
    const raw = await printElementViaRawDevice(elementId, options);
    if (raw?.ok) return raw;
    if (raw && !raw.ok) {
      console.warn('[printManager] سيتم التحويل إلى مربع حوار الطباعة:', raw.message);
    }
  }

  // 2) مربع حوار المتصفح
  const element = await waitForElement(elementId);
  if (!element) {
    console.warn(`[printManager] العنصر #${elementId} غير موجود. سيتم استخدام طباعة النافذة.`);
    try {
      window.print();
      return { ok: true, method: 'dialog-window', message: 'تمت طباعة النافذة الحالية.' };
    } catch (e: any) {
      return {
        ok: false,
        method: 'none',
        message: `لم يتم العثور على محتوى الفاتورة (#${elementId}).`,
        error: String(e?.message || e),
      };
    }
  }

  const clone = buildPrintableClone(element);
  return printHtmlContentDetailed(clone.outerHTML, options);
};

/** التوقيع القديم — متوافق مع كل الاستدعاءات الحالية. */
export const printElementDirectly = async (
  elementId: string,
  options: PrintOptions = {}
): Promise<boolean> => {
  const res = await printElementDetailed(elementId, options);
  return res.ok;
};

/**
 * تشغيل بروتوكول RawBT لأجهزة أندرويد POS المتصلة بـ USB أو البلوتوث.
 *
 * كان في هذه الدالة عيبان أصلحناهما:
 *   • اسم الحزمة كان خطأ (`ru.a404m` بدل `ru.a402d`) فلا يفتح التطبيق أصلاً.
 *   • كانت ترسل نصاً فقط، والعربية تخرج رموزاً مشوّشة لأن أغلب الطابعات
 *     الحرارية لا تحتوي خطاً عربياً مدمجاً.
 *
 * للفواتير العربية استخدم `printElementDetailed` مع طابعة من نوع 'rawbt' —
 * فتُرسل الفاتورة كصورة نقطية وتخرج العربية سليمة.
 */
export const printViaRawBT = async (textData: string): Promise<void> => {
  const { sendTextToRawBT } = await import('./printAndroid');
  sendTextToRawBT(textData);
};

/** إرسال بايتات ESC/POS خام إلى RawBT (المسار الصحيح للعربية). */
export const printBytesViaRawBT = async (data: Uint8Array): Promise<void> => {
  const { sendBytesToRawBT } = await import('./printAndroid');
  sendBytesToRawBT(data);
};

/**
 * فتح درج النقود على الطابعة النشطة (إن كانت مربوطة مباشرة).
 * نجرّب نفس سلسلة المسارات المستخدمة في الطباعة حتى يعمل الدرج من
 * الأندرويد أيضاً عبر الوسيط المقترن.
 */
export const openCashDrawer = async (): Promise<boolean> => {
  const cfg = getActivePrinterConfig();
  if (!cfg || !RAW_TRANSPORTS.includes(cfg.transport)) return false;

  const discovery = await import('./printerDiscovery');
  const command = discovery.openCashDrawerCommand();
  const { chain, relayPrinterName } = await buildTransportChain(cfg);

  for (const transport of chain) {
    try {
      await discovery.sendRawToPrinter(cfg.id, transport, command, {
        ipAddress: cfg.ipAddress,
        port: cfg.port,
        baudRate: cfg.baudRate,
        printerName: transport === 'relay' ? relayPrinterName || cfg.printerName : cfg.printerName,
        copies: 1,
        docName: 'SEEN POS Cash Drawer',
      });
      return true;
    } catch (e) {
      console.warn(`[printManager] تعذر فتح درج النقود عبر "${transport}":`, e);
    }
  }
  return false;
};
