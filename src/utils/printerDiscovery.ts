/**
 * printerDiscovery.ts
 * ------------------------------------------------------------------
 * اكتشاف وربط الطابعات الحرارية الحقيقية والإرسال المباشر لها.
 *
 * المتصفح لا يستطيع قراءة قائمة طابعات نظام التشغيل (لا توجد أي واجهة
 * برمجية تسمح بذلك لأسباب أمنية). الطرق المتاحة للوصول لطابعة حقيقية:
 *
 *   - WebUSB        → navigator.usb.requestDevice()
 *   - Web Serial    → navigator.serial.requestPort()
 *   - Web Bluetooth → navigator.bluetooth.requestDevice()
 *   - شبكة LAN      → عبر وسيط في السيرفر: POST /api/print/raw
 *   - طابعة النظام  → عبر مربع حوار الطباعة (أي طابعة، حرارية أو A4)
 *
 * المتطلبات للربط المباشر: سياق آمن (https أو localhost) +
 * Chrome/Edge/Opera. Safari و Firefox لا يدعمان هذه الواجهات.
 * ------------------------------------------------------------------
 */

/* ============================ الأنواع ============================ */

/**
 * أنواع النقل المدعومة.
 *
 *  relay   → الطباعة الصامتة عبر وسيط سين المقترن بالسيرفر. المسار الموصى
 *            به على ويندوز، والوحيد الذي يعمل من الأندرويد على طابعة
 *            موصولة بكمبيوتر المتجر.
 *  agent   → الوسيط المحلي القديم (127.0.0.1). محتفظ به كمسار سريع
 *            اختياري فقط — تحجبه المتصفحات الحديثة في الغالب.
 *  network → طابعة شبكة على منفذ 9100، تُمرَّر عبر الوسيط أو السيرفر.
 */
export type PrinterTransport =
  | 'system'
  | 'usb'
  | 'serial'
  | 'bluetooth'
  | 'network'
  | 'agent'
  | 'relay';
export type PaperSize = '80mm' | '58mm' | 'A4';

export interface DiscoveredPrinter {
  id: string;
  name: string;
  transport: PrinterTransport;
  vendorId?: number;
  productId?: number;
  bluetoothId?: string;
  paired: boolean;
}

export interface SupportInfo {
  secureContext: boolean;
  usb: boolean;
  serial: boolean;
  bluetooth: boolean;
  /** طباعة الشبكة متاحة دائماً لأنها تمر عبر السيرفر */
  network: boolean;
  anyDiscovery: boolean;
  reason: string | null;
}

/** معلومات الاتصال الإضافية اللازمة لبعض أنواع النقل. */
export interface ConnectionOptions {
  ipAddress?: string;
  port?: string | number;
  baudRate?: number;
  /** اسم الطابعة في نظام التشغيل — مطلوب لنوع النقل 'agent' و 'relay' */
  printerName?: string;
  /** عدد النسخ — يُنفّذه الوسيط بنفسه لتقليل عدد الطلبات */
  copies?: number;
  /** اسم المستند كما يظهر في طابور الطباعة */
  docName?: string;
}

/* ===== تعريفات مصغّرة للواجهات غير الموجودة في lib.dom الافتراضية ===== */

interface USBDeviceLike {
  productName?: string;
  manufacturerName?: string;
  serialNumber?: string;
  vendorId: number;
  productId: number;
  opened: boolean;
  configuration: any;
  configurations: any[];
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(n: number): Promise<void>;
  claimInterface(n: number): Promise<void>;
  releaseInterface(n: number): Promise<void>;
  selectAlternateInterface(iface: number, alt: number): Promise<void>;
  transferOut(endpoint: number, data: BufferSource): Promise<{ status: string; bytesWritten: number }>;
}

interface SerialPortLike {
  readable: unknown;
  writable: WritableStream<Uint8Array> | null;
  open(options: {
    baudRate: number;
    dataBits?: number;
    stopBits?: number;
    parity?: string;
    flowControl?: string;
  }): Promise<void>;
  close(): Promise<void>;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
}

interface BluetoothDeviceLike {
  id: string;
  name?: string;
  gatt?: {
    connected: boolean;
    connect(): Promise<any>;
    disconnect(): void;
  };
}

const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as any;

/* ====================== فحص دعم المتصفح ====================== */

export const getSupportInfo = (): SupportInfo => {
  const secureContext =
    typeof window !== 'undefined' &&
    (window.isSecureContext ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1');

  const usb = !!nav?.usb && secureContext;
  const serial = !!nav?.serial && secureContext;
  const bluetooth = !!nav?.bluetooth && secureContext;
  const anyDiscovery = usb || serial || bluetooth;

  let reason: string | null = null;
  if (!anyDiscovery) {
    if (!secureContext) {
      reason =
        'الربط المباشر بالأجهزة يتطلب اتصالاً آمناً (HTTPS). افتح النظام عبر رابط https أو على localhost. يمكنك مع ذلك استخدام "طابعة النظام" أو "طابعة الشبكة" للطباعة بشكل طبيعي.';
    } else {
      reason =
        'متصفحك لا يدعم الربط المباشر بالأجهزة. استخدم Google Chrome أو Microsoft Edge (إصدار حديث)، أو اعتمد على "طابعة النظام" عبر مربع حوار الطباعة، أو "طابعة الشبكة" عبر عنوان IP.';
    }
  }

  return { secureContext, usb, serial, bluetooth, network: true, anyDiscovery, reason };
};

/* ====================== أدوات مساعدة ====================== */

const deviceLabel = (d: {
  manufacturerName?: string;
  productName?: string;
  vendorId: number;
  productId: number;
}) => {
  const parts = [d.manufacturerName, d.productName].filter(Boolean).join(' ').trim();
  if (parts) return parts;
  return `طابعة USB ${d.vendorId.toString(16).padStart(4, '0')}:${d.productId
    .toString(16)
    .padStart(4, '0')}`;
};

/** أخطاء إلغاء المستخدم لنافذة الاختيار — ليست أعطالاً حقيقية */
export const isUserCancellation = (e: any) =>
  e?.name === 'NotFoundError' || /No device selected|cancelled|canceled/i.test(e?.message || '');

/** أخطاء منع سياسة الأمان أو الإطار المضمن (iframe permissions policy) */
export const isPermissionsPolicyError = (e: any) =>
  e?.name === 'SecurityError' ||
  /disallowed by permissions policy|Permission denied|NotAllowedError/i.test(
    e?.message || e?.name || ''
  );

const usbId = (d: { vendorId: number; productId: number; serialNumber?: string }) =>
  `usb-${d.vendorId}-${d.productId}-${d.serialNumber || '0'}`;

const serialId = (info: { usbVendorId?: number; usbProductId?: number }, index: number) =>
  `serial-${info.usbVendorId ?? 'x'}-${info.usbProductId ?? 'x'}-${index}`;

/* ====================== سجلات الاتصال الحيّة ====================== */

const usbDeviceRegistry = new Map<string, USBDeviceLike>();
const serialPortRegistry = new Map<string, SerialPortLike>();
const btDeviceRegistry = new Map<string, BluetoothDeviceLike>();
/** سرعة المنفذ التسلسلي التي نجحت فعلياً — لتفادي إعادة التجربة كل مرة */
const serialBaudRegistry = new Map<string, number>();

/* ====================== الأجهزة المقترنة سابقاً ====================== */

/** إرجاع الأجهزة التي سبق للمستخدم منح الإذن لها (بدون أي تدخل منه). */
export const listPairedPrinters = async (): Promise<DiscoveredPrinter[]> => {
  const found: DiscoveredPrinter[] = [];

  try {
    if (nav?.usb?.getDevices) {
      const devices: USBDeviceLike[] = await nav.usb.getDevices();
      devices.forEach((d) => {
        const id = usbId(d);
        usbDeviceRegistry.set(id, d); // مهم: إعادة تعبئة السجل بعد إعادة تحميل الصفحة
        found.push({
          id,
          name: deviceLabel(d),
          transport: 'usb',
          vendorId: d.vendorId,
          productId: d.productId,
          paired: true,
        });
      });
    }
  } catch (e) {
    console.warn('[printerDiscovery] تعذر قراءة أجهزة USB المقترنة:', e);
  }

  try {
    if (nav?.serial?.getPorts) {
      const ports: SerialPortLike[] = await nav.serial.getPorts();
      ports.forEach((p, i) => {
        const info = p.getInfo();
        const id = serialId(info, i);
        serialPortRegistry.set(id, p);
        found.push({
          id,
          name: info.usbVendorId
            ? `طابعة تسلسلية ${info.usbVendorId.toString(16)}:${(info.usbProductId ?? 0).toString(16)}`
            : `منفذ تسلسلي #${i + 1}`,
          transport: 'serial',
          vendorId: info.usbVendorId,
          productId: info.usbProductId,
          paired: true,
        });
      });
    }
  } catch (e) {
    console.warn('[printerDiscovery] تعذر قراءة المنافذ التسلسلية المقترنة:', e);
  }

  try {
    if (nav?.bluetooth?.getDevices) {
      const devices: BluetoothDeviceLike[] = await nav.bluetooth.getDevices();
      devices.forEach((d) => {
        const id = `bt-${d.id}`;
        btDeviceRegistry.set(id, d); // مهم: استعادة أجهزة البلوتوث بعد إعادة التحميل
        found.push({
          id,
          name: d.name || 'طابعة بلوتوث',
          transport: 'bluetooth',
          bluetoothId: d.id,
          paired: true,
        });
      });
    }
  } catch (e) {
    console.warn('[printerDiscovery] تعذر قراءة أجهزة البلوتوث المقترنة:', e);
  }

  return found;
};

/* ====================== طلب ربط جهاز جديد ====================== */

/** فتح نافذة اختيار أجهزة USB المعرّفة كفئة طابعة (classCode 7). */
export const requestUsbPrinter = async (): Promise<DiscoveredPrinter> => {
  if (!nav?.usb) throw new Error('WebUSB غير مدعوم في هذا المتصفح.');

  const device: USBDeviceLike = await nav.usb.requestDevice({ filters: [{ classCode: 7 }] });
  const id = usbId(device);
  usbDeviceRegistry.set(id, device);

  return {
    id,
    name: deviceLabel(device),
    transport: 'usb',
    vendorId: device.vendorId,
    productId: device.productId,
    paired: true,
  };
};

/** فتح نافذة اختيار أجهزة USB بدون تصفية — لطابعات POS التي تظهر كـ Vendor Specific. */
export const requestAnyUsbDevice = async (): Promise<DiscoveredPrinter> => {
  if (!nav?.usb) throw new Error('WebUSB غير مدعوم في هذا المتصفح.');

  const device: USBDeviceLike = await nav.usb.requestDevice({ filters: [] });
  const id = usbId(device);
  usbDeviceRegistry.set(id, device);

  return {
    id,
    name: deviceLabel(device),
    transport: 'usb',
    vendorId: device.vendorId,
    productId: device.productId,
    paired: true,
  };
};

/** فتح نافذة اختيار المنافذ التسلسلية (COM / RS-232 / USB-Serial). */
export const requestSerialPrinter = async (): Promise<DiscoveredPrinter> => {
  if (!nav?.serial) throw new Error('Web Serial غير مدعوم في هذا المتصفح.');

  const port: SerialPortLike = await nav.serial.requestPort();
  const info = port.getInfo();

  // ترتيب المنفذ الفعلي في القائمة — يضمن إعادة إيجاده بعد تحديث الصفحة
  let index = 0;
  try {
    const ports: SerialPortLike[] = await nav.serial.getPorts();
    const at = ports.indexOf(port);
    index = at >= 0 ? at : Math.max(0, ports.length - 1);
  } catch {
    /* تجاهل */
  }

  const id = serialId(info, index);
  serialPortRegistry.set(id, port);

  return {
    id,
    name: info.usbVendorId
      ? `طابعة تسلسلية ${info.usbVendorId.toString(16)}:${(info.usbProductId ?? 0).toString(16)}`
      : 'طابعة عبر المنفذ التسلسلي',
    transport: 'serial',
    vendorId: info.usbVendorId,
    productId: info.usbProductId,
    paired: true,
  };
};

/** معرّفات خدمات الطباعة الشائعة في طابعات البلوتوث الحرارية. */
const BT_PRINTER_SERVICES: (number | string)[] = [
  0x18f0,
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC / Microchip transparent UART
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
];

/** فتح نافذة اختيار أجهزة البلوتوث القريبة. */
export const requestBluetoothPrinter = async (): Promise<DiscoveredPrinter> => {
  if (!nav?.bluetooth) throw new Error('Web Bluetooth غير مدعوم في هذا المتصفح.');

  const device: BluetoothDeviceLike = await nav.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: BT_PRINTER_SERVICES,
  });

  const id = `bt-${device.id}`;
  btDeviceRegistry.set(id, device);

  return {
    id,
    name: device.name || 'طابعة بلوتوث',
    transport: 'bluetooth',
    bluetoothId: device.id,
    paired: true,
  };
};

/* ====================== إرسال بايتات خام للطابعة ====================== */

/** إرسال بيانات ESC/POS خام إلى جهاز USB مقترن. */
const sendToUsb = async (id: string, data: Uint8Array): Promise<void> => {
  let device = usbDeviceRegistry.get(id);

  if (!device && nav?.usb?.getDevices) {
    const devices: USBDeviceLike[] = await nav.usb.getDevices();
    device = devices.find((d) => usbId(d) === id) || devices[0];
    if (device) usbDeviceRegistry.set(id, device);
  }

  if (!device)
    throw new Error(
      'الطابعة غير مقترنة بالمتصفح. اضغط "تحديث" في إعدادات الطابعة أو أعد ربطها عبر زر "طابعة USB".'
    );

  let claimed = -1;

  try {
    if (!device.opened) await device.open();
    if (!device.configuration) await device.selectConfiguration(1);

    // البحث في كل الإعدادات والواجهات عن نقطة نهاية إخراج (bulk out)
    const configs = device.configurations?.length ? device.configurations : [device.configuration];
    let iface: any = null;
    let endpoint: any = null;

    for (const cfg of configs) {
      // نفضّل الواجهات المعرّفة كفئة طابعة (7)
      const candidates = [...(cfg?.interfaces || [])].sort((a: any, b: any) => {
        const ac = a.alternate?.interfaceClass === 7 ? 0 : 1;
        const bc = b.alternate?.interfaceClass === 7 ? 0 : 1;
        return ac - bc;
      });

      for (const i of candidates) {
        const ep = i.alternate?.endpoints?.find(
          (e: any) => e.direction === 'out' && (e.type === 'bulk' || e.type === 'interrupt')
        );
        if (ep) {
          if (device.configuration?.configurationValue !== cfg.configurationValue) {
            try {
              await device.selectConfiguration(cfg.configurationValue);
            } catch {
              /* تجاهل */
            }
          }
          iface = i;
          endpoint = ep;
          break;
        }
      }
      if (iface) break;
    }

    if (!iface || !endpoint)
      throw new Error('لم يتم العثور على منفذ إخراج (bulk out) في هذه الطابعة.');

    try {
      await device.claimInterface(iface.interfaceNumber);
      claimed = iface.interfaceNumber;
    } catch (claimErr: any) {
      if (/already claimed/i.test(claimErr?.message || '')) {
        claimed = iface.interfaceNumber; // مطالب بها من قبل — نكمل
      } else {
        throw claimErr;
      }
    }

    try {
      await device.selectAlternateInterface(
        iface.interfaceNumber,
        iface.alternate?.alternateSetting ?? 0
      );
    } catch {
      /* اختياري */
    }

    // التقسيم لدفعات صغيرة — كثير من طابعات POS لا تتحمل دفعات كبيرة
    const CHUNK = 4096;
    for (let i = 0; i < data.length; i += CHUNK) {
      const res = await device.transferOut(endpoint.endpointNumber, data.slice(i, i + CHUNK));
      if (res.status !== 'ok') {
        const err: any = new Error(`الطابعة رفضت البيانات (${res.status}).`);
        /*
         * فشل بعد قبول الدفعة الأولى: جزء من الفاتورة خرج على الورق بالفعل.
         * نُعلّم الخطأ حتى لا يُعاد الطبع تلقائياً فيخرج إيصال ثانٍ كامل
         * فوق الجزء المطبوع.
         */
        if (i > 0) err.dispatched = true;
        throw err;
      }
    }
  } catch (err: any) {
    /*
     * الأخطاء المُعلّمة بـ dispatched تعني أن جزءاً من الفاتورة خرج على الورق.
     * نُمرّرها كما هي: الفروع أدناه تبني كائن خطأ جديداً فتفقد العلامة، وفقدانها
     * يسمح بفتح مربع حوار الطباعة فيخرج إيصال ثانٍ فوق الجزء المطبوع.
     */
    if (err?.dispatched) throw err;

    if (
      err?.name === 'SecurityError' ||
      /Access denied|failed to execute 'open'|The device is protected/i.test(err?.message || '')
    ) {
      const onAndroid = /Android/i.test(nav?.userAgent || '');

      // على الأندرويد لا يوجد usbprint.sys يحجز الجهاز، فسبب الفشل مختلف
      if (onAndroid) {
        throw new Error(
          'تم رفض الوصول للطابعة عبر USB. على الأندرويد جرّب: فصل كابل OTG وإعادة توصيله، ثم اختر «سين» عند سؤال النظام عن التطبيق الذي يفتح الجهاز.'
        );
      }

      throw new Error(
        'تم رفض الوصول لجهاز USB (Access Denied). هذا ليس عطلاً — بل سلوك مقصود في ويندوز: عندما يكون للطابعة تعريف رسمي مثبّت يحجزها النظام حجزاً حصرياً عبر usbprint.sys، ولا يستطيع أي متصفح فتحها. لن ينجح WebUSB على ويندوز في هذه الحالة أبداً. ' +
          'الحل الصحيح: «الاقتران مع وسيط سين» من أعلى هذه الصفحة — يطبع صامتاً بنفس التعريف الرسمي، ويعمل من الأندرويد أيضاً. ' +
          'البدائل: «طابعة النظام» عبر مربع حوار الطباعة، أو طابعة شبكة عبر عنوان IP. ' +
          'لا نوصي باستبدال التعريف بـ WinUSB عبر Zadig لأنه يُعطّل الطباعة من كل البرامج الأخرى على الجهاز.'
      );
    }
    throw err;
  } finally {
    if (claimed >= 0) {
      try {
        await device.releaseInterface(claimed);
      } catch {
        /* تجاهل */
      }
    }
  }
};

const SERIAL_BAUD_CANDIDATES = [9600, 19200, 38400, 57600, 115200];

/** إرسال بيانات ESC/POS خام عبر منفذ تسلسلي مقترن. */
const sendToSerial = async (id: string, data: Uint8Array, preferredBaud?: number): Promise<void> => {
  let port = serialPortRegistry.get(id);

  // مطابقة المنفذ الصحيح بالمعرّف (الكود القديم كان يأخذ ports[0] دائماً)
  if (!port && nav?.serial?.getPorts) {
    const ports: SerialPortLike[] = await nav.serial.getPorts();
    port = ports.find((p, i) => serialId(p.getInfo(), i) === id);
    if (!port) {
      const parts = id.split('-');
      const vendorPart = parts[1];
      const productPart = parts[2];
      port = ports.find((p) => {
        const info = p.getInfo();
        return (
          String(info.usbVendorId ?? 'x') === vendorPart &&
          String(info.usbProductId ?? 'x') === productPart
        );
      });
    }
    if (!port) port = ports[0];
    if (port) serialPortRegistry.set(id, port);
  }

  if (!port) throw new Error('المنفذ التسلسلي غير مقترن. أعد ربط الطابعة من زر "منفذ تسلسلي / COM".');

  const known = serialBaudRegistry.get(id);
  const bauds = Array.from(
    new Set([preferredBaud, known, ...SERIAL_BAUD_CANDIDATES].filter(Boolean) as number[])
  );

  let opened = false;
  let usedBaud = bauds[0];
  let lastErr: any = null;

  // المنفذ قد يكون مفتوحاً بالفعل من طباعة سابقة
  if (port.writable) {
    opened = true;
  } else {
    for (const baudRate of bauds) {
      try {
        await port.open({ baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
        opened = true;
        usedBaud = baudRate;
        break;
      } catch (e: any) {
        lastErr = e;
        if (/already open/i.test(e?.message || '')) {
          opened = true;
          usedBaud = baudRate;
          break;
        }
      }
    }
  }

  if (!opened) {
    throw new Error(
      `تعذر فتح المنفذ التسلسلي. ${lastErr?.message || ''} تأكد أن الطابعة مشغّلة وأن المنفذ غير مستخدم من برنامج آخر.`
    );
  }

  serialBaudRegistry.set(id, usedBaud);

  if (!port.writable) throw new Error('المنفذ التسلسلي لا يقبل الكتابة.');

  const writer = port.writable.getWriter();
  try {
    const CHUNK = 2048;
    for (let i = 0; i < data.length; i += CHUNK) {
      await writer.write(data.slice(i, i + CHUNK));
    }
    // ترك وقت كافٍ لتفريغ المخزن المؤقت قبل تحرير القفل
    await new Promise((r) => setTimeout(r, 150));
  } finally {
    try {
      writer.releaseLock();
    } catch {
      /* تجاهل */
    }
  }
};

/** إرسال بيانات ESC/POS خام عبر البلوتوث (GATT). */
const sendToBluetooth = async (id: string, data: Uint8Array): Promise<void> => {
  let device = btDeviceRegistry.get(id);

  // استعادة الجهاز بعد إعادة تحميل الصفحة
  if (!device && nav?.bluetooth?.getDevices) {
    try {
      const devices: BluetoothDeviceLike[] = await nav.bluetooth.getDevices();
      device = devices.find((d) => `bt-${d.id}` === id);
      if (device) btDeviceRegistry.set(id, device);
    } catch {
      /* تجاهل */
    }
  }

  if (!device?.gatt)
    throw new Error(
      'طابعة البلوتوث غير مقترنة. أعد ربطها من زر "طابعة بلوتوث" (يتطلب نقرة من المستخدم).'
    );

  const server = await device.gatt.connect();

  let characteristic: any = null;
  for (const svcId of BT_PRINTER_SERVICES) {
    try {
      const service = await server.getPrimaryService(svcId as any);
      const chars = await service.getCharacteristics();
      characteristic = chars.find((c: any) => c.properties.write || c.properties.writeWithoutResponse);
      if (characteristic) break;
    } catch {
      /* جرّب الخدمة التالية */
    }
  }

  // محاولة أخيرة: البحث في كل الخدمات المتاحة
  if (!characteristic) {
    try {
      const services = await server.getPrimaryServices();
      for (const service of services) {
        const chars = await service.getCharacteristics();
        characteristic = chars.find(
          (c: any) => c.properties.write || c.properties.writeWithoutResponse
        );
        if (characteristic) break;
      }
    } catch {
      /* تجاهل */
    }
  }

  if (!characteristic)
    throw new Error(
      'لم يتم العثور على خدمة طباعة في جهاز البلوتوث. تأكد أن الطابعة تدعم BLE — طابعات Bluetooth Classic لا تظهر في المتصفح، اربطها عبر نظام التشغيل واستخدم "طابعة النظام".'
    );

  // BLE محدود بحزم صغيرة
  const CHUNK = 180;
  for (let i = 0; i < data.length; i += CHUNK) {
    const slice = data.slice(i, i + CHUNK);
    if (characteristic.properties.writeWithoutResponse) {
      await characteristic.writeValueWithoutResponse(slice);
    } else {
      await characteristic.writeValue(slice);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
};

const bytesToBase64 = (data: Uint8Array): string => {
  let binary = '';
  const CHUNK = 8192;
  for (let i = 0; i < data.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(data.subarray(i, i + CHUNK)) as any);
  }
  return btoa(binary);
};

/**
 * إرسال بيانات ESC/POS إلى طابعة شبكة (منفذ 9100) عبر وسيط السيرفر.
 * المتصفح لا يستطيع فتح اتصال TCP خام، لذلك يمرّ الطلب من السيرفر.
 */
const sendToNetwork = async (conn: ConnectionOptions, data: Uint8Array): Promise<void> => {
  const ip = (conn.ipAddress || '').trim();
  if (!ip) throw new Error('لم يتم تحديد عنوان IP لطابعة الشبكة. عدّل الطابعة وأدخل عنوان IP.');

  const port = Number(conn.port || 9100) || 9100;
  const dataBase64 = bytesToBase64(data);

  /*
   * مسار السيرفر لا يعرف `copies` (يرسل الحزمة مرة واحدة)، بخلاف مسار
   * الوسيط الذي ينفّذ النسخ بنفسه. لذلك نكرّر الطلب هنا — وإلا خرجت نسخة
   * واحدة فقط عندما لا يوجد وسيط مقترن.
   */
  const copies = Math.max(1, Number(conn.copies) || 1);

  for (let i = 0; i < copies; i++) {
    let res: Response;
    try {
      res = await fetch('/api/print/raw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: ip, port, dataBase64 }),
      });
    } catch (e: any) {
      const err: any = new Error(
        `تعذر الوصول لوسيط الطباعة في السيرفر (${e?.message || 'خطأ شبكة'}). تأكد أن السيرفر يعمل وأنه على نفس الشبكة المحلية للطابعة.`
      );
      // نجحت نسخة على الأقل قبل هذا الفشل → لا يجوز إعادة الطبع تلقائياً
      if (i > 0) err.dispatched = true;
      throw err;
    }

    let payload: any = null;
    try {
      payload = await res.json();
    } catch {
      /* تجاهل */
    }

    if (!res.ok || payload?.ok === false) {
      const err: any = new Error(
        payload?.error ||
          `فشل الإرسال إلى الطابعة ${ip}:${port}. تحقّق من تشغيل الطابعة وصحة عنوان IP، وأن السيرفر على نفس الشبكة.`
      );
      if (i > 0) err.dispatched = true;
      throw err;
    }
  }
};

/** الموجّه العام لإرسال بايتات خام حسب نوع الاتصال. */
export const sendRawToPrinter = async (
  printerId: string,
  transport: PrinterTransport,
  data: Uint8Array,
  conn: ConnectionOptions = {}
): Promise<void> => {
  switch (transport) {
    case 'usb':
      return sendToUsb(printerId, data);

    case 'serial':
      return sendToSerial(printerId, data, conn.baudRate);

    case 'bluetooth':
      return sendToBluetooth(printerId, data);

    case 'network': {
      /*
       * طابعة شبكة. نُفضّل تمريرها عبر الوسيط المقترن لأنه داخل شبكة
       * المتجر ويصل لعنوان 192.168.x.x. السيرفر السحابي لا يصل لهذه
       * العناوين إطلاقاً — وكان هذا سبب فشل مسار الشبكة في الإنتاج.
       */
      const relay = await import('./printRelayClient');
      if (relay.isRelayPaired()) {
        try {
          return await relay.printViaRelay(data, {
            target: 'tcp',
            host: (conn.ipAddress || '').trim(),
            port: Number(conn.port || 9100) || 9100,
            copies: conn.copies || 1,
            docName: conn.docName,
          });
        } catch (e: any) {
          /*
           * فشل غامض (المهمة سُلّمت للوسيط بالفعل) → لا نُعيد الإرسال عبر
           * السيرفر، وإلا طُبع الإيصال مرتين: مرة من الوسيط ومرة عبر TCP.
           * نُمرّر الخطأ كما هو مع علامته ليتعامل معه محرك الطباعة.
           */
          if (e?.dispatched) throw e;

          // فشل قبل التسليم → آمن أن نُكمل بالمحاولة عبر السيرفر
          console.warn('[printerDiscovery] فشل مسار الوسيط لطابعة الشبكة:', e?.message || e);
        }
      }
      return sendToNetwork(conn, data);
    }

    case 'relay': {
      // الطباعة الصامتة عبر وسيط سين المقترن — يستخدم تعريف الطابعة الرسمي
      const { printViaRelay } = await import('./printRelayClient');
      return printViaRelay(data, {
        target: 'spooler',
        printer: conn.printerName || '',
        copies: conn.copies || 1,
        docName: conn.docName,
      });
    }

    case 'agent': {
      // الوسيط المحلي القديم (127.0.0.1) — تحجبه المتصفحات الحديثة غالباً
      const { sendRawToAgent } = await import('./printAgent');
      return sendRawToAgent(conn.printerName || '', data, conn.docName);
    }

    default:
      throw new Error(
        'طابعة النظام تُطبع عبر مربع حوار الطباعة، ولا تدعم الإرسال المباشر بأوامر ESC/POS.'
      );
  }
};

/** فحص سريع لتوفر طابعة الشبكة قبل إرسال فاتورة كاملة. */
export const probeNetworkPrinter = async (
  ipAddress: string,
  port: string | number = 9100
): Promise<{ ok: boolean; message: string }> => {
  try {
    const res = await fetch('/api/print/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: ipAddress, port: Number(port) || 9100 }),
    });
    const payload = await res.json().catch(() => null);
    if (res.ok && payload?.ok) return { ok: true, message: 'تم الاتصال بالطابعة بنجاح.' };
    return { ok: false, message: payload?.error || 'لم يستجب عنوان الطابعة.' };
  } catch (e: any) {
    return { ok: false, message: e?.message || 'تعذر الوصول لوسيط الطباعة في السيرفر.' };
  }
};

/* ====================== توليد أوامر ESC/POS ====================== */

const ESC = 0x1b;
const GS = 0x1d;

/**
 * تحويل صورة (canvas) إلى أوامر ESC/POS نقطية `GS v 0`.
 * يتم تقسيم الصورة إلى شرائح لأن كثيراً من الطابعات لا تتحمل
 * صورة واحدة طويلة جداً (وكان هذا سبباً لعدم خروج أي ورق).
 */
export const canvasToEscPosRaster = (
  canvas: HTMLCanvasElement,
  threshold = 170,
  sliceHeight = 128
): Uint8Array => {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('تعذر قراءة محتوى الصورة للطباعة.');

  const width = Math.floor(canvas.width / 8) * 8;
  const height = canvas.height;
  if (width < 8 || height < 1) throw new Error('أبعاد الفاتورة غير صالحة للطباعة.');

  const bytesPerRow = width / 8;
  const img = ctx.getImageData(0, 0, width, height).data;

  const chunks: Uint8Array[] = [];
  // تهيئة الطابعة + محاذاة يسار + تصفير تباعد الأسطر
  chunks.push(new Uint8Array([ESC, 0x40, ESC, 0x61, 0x00, ESC, 0x33, 0x00]));

  for (let y0 = 0; y0 < height; y0 += sliceHeight) {
    const h = Math.min(sliceHeight, height - y0);
    const raster = new Uint8Array(bytesPerRow * h);

    for (let y = 0; y < h; y++) {
      const srcY = y0 + y;
      for (let x = 0; x < width; x++) {
        const idx = (srcY * canvas.width + x) * 4;
        const alpha = img[idx + 3];
        const lum =
          alpha === 0 ? 255 : 0.299 * img[idx] + 0.587 * img[idx + 1] + 0.114 * img[idx + 2];
        if (lum < threshold) {
          raster[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
        }
      }
    }

    chunks.push(
      new Uint8Array([
        GS,
        0x76,
        0x30,
        0x00,
        bytesPerRow & 0xff,
        (bytesPerRow >> 8) & 0xff,
        h & 0xff,
        (h >> 8) & 0xff,
      ])
    );
    chunks.push(raster);
  }

  // تغذية ورق + قص جزئي
  chunks.push(new Uint8Array([0x0a, 0x0a, 0x0a, GS, 0x56, 0x42, 0x00]));

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((c) => {
    out.set(c, offset);
    offset += c.length;
  });
  return out;
};

/** أمر فتح درج النقود (متوافق مع أغلب طابعات POS). */
export const openCashDrawerCommand = (): Uint8Array => new Uint8Array([ESC, 0x70, 0x00, 0x19, 0xfa]);

/** إيصال اختبار نصي بسيط (إنجليزي) للتحقق السريع من الاتصال. */
export const buildTestReceipt = (printerName: string): Uint8Array => {
  const text =
    '\n' +
    '   SEEN POS - TEST PRINT\n' +
    '--------------------------------\n' +
    `Printer: ${printerName.replace(/[^\x20-\x7e]/g, '').trim() || 'POS Printer'}\n` +
    `Date: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}\n` +
    '--------------------------------\n' +
    '   CONNECTION OK\n\n\n\n';

  const body = new TextEncoder().encode(text);
  const init = new Uint8Array([ESC, 0x40, ESC, 0x61, 0x01]); // تهيئة + توسيط
  const cut = new Uint8Array([0x0a, 0x0a, GS, 0x56, 0x42, 0x00]);

  const out = new Uint8Array(init.length + body.length + cut.length);
  out.set(init, 0);
  out.set(body, init.length);
  out.set(cut, init.length + body.length);
  return out;
};
