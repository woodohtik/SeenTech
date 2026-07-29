import React, { useState, useEffect, useCallback } from 'react';
import {
  Printer,
  Plus,
  Trash2,
  Bluetooth,
  Usb,
  RefreshCw,
  X,
  Zap,
  AlertTriangle,
  Wrench,
  Sliders,
  CheckCircle2,
  Search,
  Cable,
  Monitor,
  Loader2,
  Info,
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  getSupportInfo,
  listPairedPrinters,
  requestUsbPrinter,
  requestAnyUsbDevice,
  requestSerialPrinter,
  requestBluetoothPrinter,
  sendRawToPrinter,
  buildTestReceipt,
  canvasToEscPosRaster,
  probeNetworkPrinter,
  isUserCancellation,
  isPermissionsPolicyError,
  type PrinterTransport,
  type SupportInfo,
} from '../utils/printerDiscovery';
import {
  detectPrintAgent,
  listAgentPrinters,
  testPrintViaAgent,
  sendRawToAgent,
  getAgentToken,
  setAgentToken,
  type AgentInfo,
  type AgentPrinter,
} from '../utils/printAgent';
import {
  pairWithStation,
  unpairStation,
  getStationStatus,
  getRelayBinding,
  isRelayPaired,
  printViaRelay,
  type RelayStation,
  type RelayPrinter,
} from '../utils/printRelayClient';
import {
  getPlatformPrintAdvice,
  canUseRawBT,
  sendBytesToRawBT,
  RAWBT_STORE_URL,
} from '../utils/printAndroid';

export interface PrinterDevice {
  id: string;
  name: string;
  /** 'system' = طابعة نظام التشغيل عبر مربع حوار الطباعة */
  type: PrinterTransport;
  size: '80mm' | '58mm' | 'A4';
  status: 'online' | 'offline';
  ipAddress?: string;
  port?: string;
  vendorId?: number;
  productId?: number;
  /** سرعة المنفذ التسلسلي (baud) — تُترك فارغة للكشف التلقائي */
  baudRate?: number;
  /** اسم الطابعة في نظام التشغيل — لطابعات الوسيط (type = 'agent') */
  printerName?: string;
  isDefault: boolean;
  /** true إذا تم ربطه فعلياً عبر نافذة اختيار أجهزة المتصفح */
  isRealDevice?: boolean;
}

type Feedback = { kind: 'success' | 'error' | 'info'; text: string } | null;

const STORAGE_KEY = 'linked_printers';

/** الطابعة الافتراضية الوحيدة: طابعة النظام. لا نخترع أجهزة وهمية. */
const SYSTEM_PRINTER: PrinterDevice = {
  id: 'system-default',
  name: 'طابعة النظام الافتراضية (مربع حوار الطباعة)',
  type: 'system',
  size: '80mm',
  status: 'online',
  isDefault: true,
  isRealDevice: false,
};

export default function PrinterSettings() {
  const [printers, setPrinters] = useState<PrinterDevice[]>([SYSTEM_PRINTER]);
  const [support, setSupport] = useState<SupportInfo | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [testingPrinter, setTestingPrinter] = useState<PrinterDevice | null>(null);
  const [scanning, setScanning] = useState<PrinterTransport | null>(null);

  const [autoPrint, setAutoPrint] = useState(true);
  const [fastThermalMode, setFastThermalMode] = useState(true);
  /** الطباعة الصامتة: إرسال الفاتورة للطابعة بلا أي نافذة طباعة. */
  const [silentPrint, setSilentPrint] = useState(true);
  const [showHelpGuide, setShowHelpGuide] = useState(false);

  // وسيط سين المقترن بالسيرفر — المسار الأساسي للطباعة الصامتة
  const [station, setStation] = useState<RelayStation | null>(null);
  const [relayBusy, setRelayBusy] = useState(false);
  const [relayError, setRelayError] = useState<string | null>(null);
  const [pairCodeInput, setPairCodeInput] = useState('');
  const [showRelayGuide, setShowRelayGuide] = useState(false);
  const paired = !!station || isRelayPaired();

  // الوسيط المحلي القديم (127.0.0.1) — مسار سريع اختياري فقط
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [agentPrinters, setAgentPrinters] = useState<AgentPrinter[]>([]);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentTokenInput, setAgentTokenInput] = useState(getAgentToken());
  const [showLegacyAgent, setShowLegacyAgent] = useState(false);

  // إرشاد خاص بالمنصّة الحالية (أندرويد / ويندوز / iOS)
  const platformAdvice = React.useMemo(() => getPlatformPrintAdvice(), []);

  // نموذج الإضافة اليدوية (طابعة شبكة / طابعة نظام مسمّاة)
  const [printerName, setPrinterName] = useState('');
  const [printerType, setPrinterType] = useState<'system' | 'network'>('system');
  const [printerSize, setPrinterSize] = useState<'80mm' | '58mm' | 'A4'>('80mm');
  const [ipAddress, setIpAddress] = useState('');
  const [port, setPort] = useState('9100');

  /* ----------------------------- التخزين ----------------------------- */

  const persist = useCallback((updated: PrinterDevice[]) => {
    setPrinters(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));

    const active = updated.find((p) => p.isDefault) || updated[0];
    if (active) {
      localStorage.setItem('active_printer_id', active.id);
      localStorage.setItem('active_printer_name', active.name);
      localStorage.setItem('remembered_printer_name', active.name);
      localStorage.setItem('active_printer_size', active.size);
      localStorage.setItem('active_printer_type', active.type);
    }

    /*
     * تغيّرت إعدادات الطابعة → نُصفّر قاطع دائرة الطباعة الصامتة.
     * بدون هذا، لو فشلت الطباعة الصامتة مرتين ثم أصلح المستخدم الطابعة،
     * لظلّ النظام يفتح مربع الحوار لبقية الجلسة بلا سبب.
     */
    void import('../utils/printManager').then((m) => m.resetSilentPrintCircuit());
  }, []);

  /* --------------------- التحميل الأولي والمزامنة --------------------- */

  const syncPairedDevices = useCallback(
    async (base: PrinterDevice[], announce = false) => {
      let discovered: Awaited<ReturnType<typeof listPairedPrinters>> = [];
      try {
        discovered = await listPairedPrinters();
      } catch (e) {
        console.warn('فشل جلب الأجهزة المقترنة', e);
      }

      const merged = [...base];
      let added = 0;

      discovered.forEach((d) => {
        const existing = merged.find((p) => p.id === d.id);
        if (existing) {
          existing.status = 'online';
          existing.isRealDevice = true;
          return;
        }
        merged.push({
          id: d.id,
          name: d.name,
          type: d.transport,
          size: '80mm',
          status: 'online',
          vendorId: d.vendorId,
          productId: d.productId,
          isDefault: false,
          isRealDevice: true,
        });
        added++;
      });

      // أجهزة المتصفح الحقيقية التي لم تعد مقترنة → offline.
      // طابعات الوسيط والشبكة لا تمر بواجهات المتصفح، فلا نحكم عليها هنا.
      merged.forEach((p) => {
        const viaBrowser = p.type === 'usb' || p.type === 'serial' || p.type === 'bluetooth';
        if (viaBrowser && p.isRealDevice && !discovered.some((d) => d.id === p.id)) {
          p.status = 'offline';
        }
      });

      if (!merged.some((p) => p.isDefault) && merged.length) merged[0].isDefault = true;
      persist(merged);

      if (announce) {
        setFeedback(
          added > 0
            ? { kind: 'success', text: `تم العثور على ${added} جهاز مقترن وإضافته للقائمة.` }
            : {
                kind: 'info',
                text: 'لا توجد أجهزة مقترنة مسبقاً. استخدم أزرار الربط أدناه لاختيار طابعتك من نافذة المتصفح.',
              }
        );
      }
    },
    [persist]
  );

  /* ============================================================
     وسيط سين المقترن — المسار الأساسي للطباعة الصامتة
     ------------------------------------------------------------
     يعمل من أي جهاز (ويندوز، أندرويد، iOS) لأن الوسيط هو الذي يتصل
     بالسيرفر خارجاً. لا اتصال بـ 127.0.0.1 ⇒ لا يحجبه المتصفح.
     ============================================================ */

  const refreshRelay = useCallback(async (announce = false) => {
    if (!isRelayPaired()) {
      setStation(null);
      return;
    }

    setRelayBusy(true);
    setRelayError(null);
    try {
      const s = await getStationStatus();
      setStation(s);

      if (announce) {
        if (!s) {
          setFeedback({ kind: 'info', text: 'لا توجد محطة طباعة مقترنة على هذا الجهاز.' });
        } else if (s.online) {
          setFeedback({
            kind: 'success',
            text: `وسيط الطباعة على "${s.hostname}" متصل ✓ — ${s.printers.length} طابعة متاحة.`,
          });
        } else {
          setFeedback({
            kind: 'error',
            text: `الوسيط على "${s.hostname}" غير متصل حالياً. تأكد أن نافذة الوسيط مفتوحة على جهاز الكاشير وأن الجهاز متصل بالإنترنت.`,
          });
        }
      }
    } catch (e: any) {
      const msg = e?.message || 'تعذر قراءة حالة محطة الطباعة.';
      setRelayError(msg);
      setStation(null);
      if (announce) setFeedback({ kind: 'error', text: msg });
    } finally {
      setRelayBusy(false);
    }
  }, []);

  const handlePair = async () => {
    const code = pairCodeInput.trim();
    if (!code) {
      setFeedback({ kind: 'error', text: 'أدخل رمز الاقتران الظاهر في نافذة وسيط الطباعة.' });
      return;
    }

    setRelayBusy(true);
    setRelayError(null);
    try {
      const s = await pairWithStation(code);
      setStation(s);
      setPairCodeInput('');
      setFeedback({
        kind: 'success',
        text: `تم الاقتران بجهاز "${s.hostname}" ✓ — اختر طابعتك من القائمة بالأسفل واضغط "ربط للطباعة الصامتة".`,
      });
    } catch (e: any) {
      const msg = e?.message || 'فشل الاقتران.';
      setRelayError(msg);
      setFeedback({ kind: 'error', text: msg });
    } finally {
      setRelayBusy(false);
    }
  };

  const handleUnpair = () => {
    unpairStation();
    setStation(null);
    setRelayError(null);
    // إزالة طابعات الوسيط من القائمة لأنها لم تعد قابلة للاستخدام
    const filtered = printers.filter((p) => p.type !== 'relay');
    if (!filtered.length) persist([{ ...SYSTEM_PRINTER }]);
    else {
      if (!filtered.some((p) => p.isDefault)) filtered[0] = { ...filtered[0], isDefault: true };
      persist(filtered);
    }
    setFeedback({ kind: 'info', text: 'تم إلغاء الاقتران على هذا الجهاز فقط. الأجهزة الأخرى لم تتأثر.' });
  };

  /** ربط طابعة من محطة الوسيط وتعيينها افتراضية للطباعة الصامتة. */
  const handleLinkRelayPrinter = (p: RelayPrinter) => {
    const id = `relay-${p.name}`;
    const updated = printers.map((x) => ({ ...x, isDefault: false }));
    const idx = updated.findIndex((x) => x.id === id);

    const entry: PrinterDevice = {
      id,
      name: p.name,
      printerName: p.name,
      type: 'relay',
      size: idx !== -1 ? updated[idx].size : '80mm',
      status: 'online',
      isDefault: true,
      isRealDevice: true,
    };

    if (idx !== -1) updated[idx] = entry;
    else updated.unshift(entry);

    persist(updated);
    setFeedback({
      kind: 'success',
      text: `تم ربط "${p.name}" للطباعة الصامتة وتعيينها كطابعة افتراضية. اضغط "اختبار" للتأكد.`,
    });
  };

  /** ربط مسار RawBT على الأندرويد (للطابعات البلوتوث الكلاسيك والمدمجة). */
  const handleLinkRawBT = () => {
    const id = 'rawbt-android';
    const updated = printers.map((x) => ({ ...x, isDefault: false }));
    const idx = updated.findIndex((x) => x.id === id);

    const entry: PrinterDevice = {
      id,
      name: 'طابعة الأندرويد عبر RawBT',
      type: 'rawbt',
      size: idx !== -1 ? updated[idx].size : '80mm',
      status: 'online',
      isDefault: true,
      isRealDevice: true,
    };

    if (idx !== -1) updated[idx] = entry;
    else updated.unshift(entry);

    persist(updated);
    setFeedback({
      kind: 'info',
      text: 'تم تعيين RawBT كمسار الطباعة. تأكد أن تطبيق RawBT مثبّت ومضبوط على طابعتك، ثم اضغط "اختبار".',
    });
  };

  /* ------------------- الوسيط المحلي القديم (اختياري) ------------------- */

  const refreshAgent = useCallback(async (announce = false) => {
    setAgentBusy(true);
    try {
      const info = await detectPrintAgent();
      setAgent(info);

      if (!info.online) {
        setAgentPrinters([]);
        if (announce) setFeedback({ kind: 'info', text: info.error || 'وسيط الطباعة غير مُشغَّل.' });
        return;
      }

      try {
        const list = await listAgentPrinters();
        setAgentPrinters(list);
        if (announce) {
          setFeedback({
            kind: 'success',
            text: `وسيط الطباعة متصل ✓ — تم العثور على ${list.length} طابعة مثبتة في نظام التشغيل.`,
          });
        }
      } catch (e: any) {
        setAgentPrinters([]);
        setFeedback({ kind: 'error', text: e?.message || 'تعذر قراءة الطابعات من الوسيط.' });
      }
    } finally {
      setAgentBusy(false);
    }
  }, []);

  /** ربط طابعة نظام حقيقية (عبر الوسيط) وتعيينها افتراضية للطباعة الصامتة. */
  const handleLinkAgentPrinter = (p: AgentPrinter) => {
    const id = `agent-${p.name}`;
    const updated = printers.map((x) => ({ ...x, isDefault: false }));
    const idx = updated.findIndex((x) => x.id === id);

    const entry: PrinterDevice = {
      id,
      name: p.name,
      printerName: p.name,
      type: 'agent',
      size: idx !== -1 ? updated[idx].size : '80mm',
      status: 'online',
      isDefault: true,
      isRealDevice: true,
    };

    if (idx !== -1) updated[idx] = entry;
    else updated.unshift(entry);

    persist(updated);
    setFeedback({
      kind: 'success',
      text: `تم ربط "${p.name}" للطباعة الصامتة وتعيينها كطابعة افتراضية. اضغط "اختبار" للتأكد.`,
    });
  };

  useEffect(() => {
    setSupport(getSupportInfo());

    // المسار الأساسي أولاً. الوسيط المحلي القديم يُفحص فقط عند طلب المستخدم
    // صراحةً — لأن فحصه على ويندوز الحديث يفشل غالباً بسبب حجب المتصفح،
    // وكان ظهور «الوسيط غير مُشغَّل» تلقائياً يُربك المستخدم بلا داعٍ.
    void refreshRelay();

    let base: PrinterDevice[] = [SYSTEM_PRINTER];
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // تنظيف الطابعات الوهمية القديمة التي كانت مضمّنة في الإصدار السابق
          const cleaned: PrinterDevice[] = parsed.filter(
            (p: PrinterDevice) =>
              p.isRealDevice ||
              p.type === 'system' ||
              p.type === 'network' ||
              p.type === 'agent' ||
              p.type === 'relay' ||
              p.type === 'rawbt'
          );
          base = cleaned.length ? cleaned : [SYSTEM_PRINTER];
        }
      } catch (e) {
        console.error('تعذر قراءة الطابعات المحفوظة', e);
      }
    }

    if (!base.some((p) => p.isDefault)) base[0].isDefault = true;
    void syncPairedDevices(base);

    const auto = localStorage.getItem('pos_auto_print');
    if (auto !== null) setAutoPrint(auto === 'true');
    const fast = localStorage.getItem('pos_fast_thermal_mode');
    if (fast !== null) setFastThermalMode(fast === 'true');
    /*
     * نقرأ الحالة الفعلية من printManager لا من المفتاح الخام: الطباعة
     * الصامتة تكون معطّلة فعلياً إن لم تكن هناك طابعة مربوطة، فلا يصح أن
     * يظهر المفتاح مُفعّلاً والميزة غير عاملة.
     */
    void import('../utils/printManager').then(({ isSilentPrintEnabled }) => {
      setSilentPrint(isSilentPrintEnabled());
    });
  }, [syncPairedDevices, refreshRelay]);

  /*
   * تحديث حالة المحطة كل 20 ثانية أثناء وجود المستخدم في هذه الصفحة، حتى
   * يرى فوراً إن أُغلقت نافذة الوسيط على جهاز الكاشير بدل أن يكتشف ذلك
   * عند أول فاتورة.
   */
  useEffect(() => {
    if (!isRelayPaired()) return;
    const timer = setInterval(() => void refreshRelay(), 20_000);
    return () => clearInterval(timer);
  }, [refreshRelay, station?.stationId]);

  /* ------------------------- ربط جهاز حقيقي ------------------------- */

  const addDiscovered = (
    d: { id: string; name: string; transport: PrinterTransport; vendorId?: number; productId?: number }
  ) => {
    const updated = printers.map((p) => ({ ...p, isDefault: false }));
    const idx = updated.findIndex((p) => p.id === d.id);

    if (idx !== -1) {
      updated[idx] = { ...updated[idx], status: 'online', isDefault: true, isRealDevice: true };
    } else {
      updated.unshift({
        id: d.id,
        name: d.name,
        type: d.transport,
        size: '80mm',
        status: 'online',
        vendorId: d.vendorId,
        productId: d.productId,
        isDefault: true,
        isRealDevice: true,
      });
    }

    persist(updated);
    setFeedback({ kind: 'success', text: `تم ربط "${d.name}" بنجاح وتعيينها كطابعة افتراضية.` });
  };

  const handleConnect = async (transport: 'usb' | 'usb-any' | 'serial' | 'bluetooth') => {
    setFeedback(null);
    setScanning(transport === 'usb-any' ? 'usb' : (transport as PrinterTransport));

    try {
      const device =
        transport === 'usb'
          ? await requestUsbPrinter()
          : transport === 'usb-any'
          ? await requestAnyUsbDevice()
          : transport === 'serial'
          ? await requestSerialPrinter()
          : await requestBluetoothPrinter();

      addDiscovered(device);
    } catch (e: any) {
      if (isUserCancellation(e)) {
        setFeedback({
          kind: 'info',
          text:
            transport === 'usb'
              ? 'لم يتم اختيار أي جهاز. إذا كانت قائمة المتصفح فارغة، جرّب "بحث موسّع (كل أجهزة USB)" — كثير من طابعات POS لا تعرّف نفسها كطابعة.'
              : 'لم يتم اختيار أي جهاز من نافذة المتصفح.',
        });
      } else if (isPermissionsPolicyError(e)) {
        setFeedback({
          kind: 'error',
          text:
            'المتصفح يمنع الوصول لأجهزة USB / البلوتوث / المنفذ التسلسلي داخل نافذة المعاينة المضمنة (iframe) بسبب سياسة الأمان. يرجى فتح التطبيق في **نافذة جديدة مستقلة** (عبر زر "فتح في نافذة جديدة" بأعلى الشاشة) للربط المباشر بالأجهزة، أو استخدام "طابعة النظام" عبر مربع حوار الطباعة.',
        });
      } else {
        setFeedback({ kind: 'error', text: e?.message || 'تعذر ربط الجهاز.' });
      }
    } finally {
      setScanning(null);
    }
  };

  /* --------------------------- إدارة القائمة --------------------------- */

  const handleSetDefault = (id: string) => {
    const updated = printers.map((p) => ({ ...p, isDefault: p.id === id }));
    persist(updated);
    const selected = updated.find((p) => p.id === id);
    if (selected) setFeedback({ kind: 'success', text: `تم تعيين "${selected.name}" كطابعة افتراضية.` });
  };

  const handleDeletePrinter = (id: string) => {
    if (id === SYSTEM_PRINTER.id) {
      setFeedback({ kind: 'error', text: 'لا يمكن حذف طابعة النظام الافتراضية.' });
      return;
    }
    const filtered = printers.filter((p) => p.id !== id);
    if (!filtered.length) {
      persist([{ ...SYSTEM_PRINTER }]);
      return;
    }
    if (!filtered.some((p) => p.isDefault)) filtered[0] = { ...filtered[0], isDefault: true };
    persist(filtered);
  };

  const handleChangeSize = (id: string, size: '80mm' | '58mm' | 'A4') => {
    persist(printers.map((p) => (p.id === id ? { ...p, size } : p)));
  };

  const handleAddPrinterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!printerName.trim()) return;

    if (printerType === 'network' && !ipAddress.trim()) {
      setFeedback({ kind: 'error', text: 'أدخل عنوان IP للطابعة الشبكية (مثال: 192.168.1.199).' });
      return;
    }

    const newPrinter: PrinterDevice = {
      id: `manual-${Date.now()}`,
      name: printerName.trim(),
      type: printerType,
      size: printerSize,
      status: 'online',
      ipAddress: printerType === 'network' ? ipAddress.trim() : undefined,
      port: printerType === 'network' ? port.trim() || '9100' : undefined,
      isDefault: false,
      // طابعة الشبكة تُطبع فعلياً عبر وسيط السيرفر، فهي جهاز حقيقي
      isRealDevice: printerType === 'network',
    };

    persist([...printers, newPrinter]);
    setShowAddModal(false);
    setPrinterName('');
    setIpAddress('');

    // فحص فوري لطابعة الشبكة حتى يعرف المستخدم إن كان العنوان صحيحاً
    if (newPrinter.type === 'network' && newPrinter.ipAddress) {
      setFeedback({ kind: 'info', text: `جاري فحص الاتصال بـ ${newPrinter.ipAddress}...` });
      const probe = await probeNetworkPrinter(newPrinter.ipAddress, newPrinter.port || '9100');
      setFeedback(
        probe.ok
          ? { kind: 'success', text: `تمت إضافة "${newPrinter.name}" والاتصال بها ناجح. اضغط "تعيين كافتراضية" لبدء الطباعة عليها.` }
          : { kind: 'error', text: `تمت الإضافة، لكن تعذر الاتصال: ${probe.message}` }
      );
      return;
    }

    setFeedback({ kind: 'success', text: `تمت إضافة "${newPrinter.name}" إلى القائمة.` });
  };

  /* ---------------------------- اختبار الطباعة ---------------------------- */

  const handleTestPrint = async (printer: PrinterDevice) => {
    setTestingPrinter(printer);
    setBusyId(printer.id);
    setFeedback(null);

    // المستخدم يختبر الطابعة الآن → أعطِ الطباعة الصامتة فرصة جديدة
    void import('../utils/printManager').then((m) => m.resetSilentPrintCircuit());

    const conn = {
      ipAddress: printer.ipAddress,
      port: printer.port,
      baudRate: printer.baudRate,
      printerName: printer.printerName || printer.name,
    };
    const isRawTransport = [
      'usb',
      'serial',
      'bluetooth',
      'network',
      'agent',
      'relay',
      'rawbt',
    ].includes(printer.type);
    const thermal = printer.size === '80mm' || printer.size === '58mm';

    try {
      const { printElementDetailed, rasterizeElement } = await import('../utils/printManager');

      /* --- 0أ) الوسيط المقترن: المسار الأساسي للطباعة الصامتة --- */
      if (printer.type === 'relay') {
        const name = printer.printerName || printer.name;

        if (!paired) {
          setFeedback({
            kind: 'error',
            text: 'لا يوجد اقتران على هذا الجهاز. أدخل رمز الاقتران الظاهر في نافذة الوسيط بالأعلى.',
          });
          return;
        }

        // نتحقق من حالة المحطة أولاً — رسالة أوضح من فشل غامض بعد الإرسال
        const current = await getStationStatus().catch(() => null);
        if (!current?.online) {
          setFeedback({
            kind: 'error',
            text: `وسيط الطباعة على "${
              current?.hostname || getRelayBinding()?.hostname || 'جهاز الكاشير'
            }" غير متصل. تأكد أن نافذة الوسيط مفتوحة وأن الجهاز متصل بالإنترنت.`,
          });
          void refreshRelay();
          return;
        }

        if (!thermal) {
          // ورق عادي A4 لا يقبل أوامر ESC/POS → مربع حوار الطباعة
          const res = await printElementDetailed('print-area', {
            paperSize: printer.size,
            title: `اختبار طباعة - ${printer.name}`,
            skipRawDevice: true,
          });
          setFeedback({
            kind: res.ok ? 'info' : 'error',
            text: res.ok
              ? 'الورق العادي (A4) لا يقبل أوامر الطابعات الحرارية، لذلك تم استخدام مربع حوار الطباعة. للطباعة الصامتة اضبط حجم الورق على 80mm أو 58mm.'
              : `فشل الاختبار: ${res.message}`,
          });
          return;
        }

        // (أ) إيصال نصي سريع للتحقق من المسار كاملاً
        await printViaRelay(buildTestReceipt(printer.name), {
          target: 'spooler',
          printer: name,
          docName: 'SEEN POS Test',
        });

        // (ب) فاتورة عربية كصورة نقطية للتحقق من التنسيق والخط
        let arabicOk = true;
        let arabicError = '';
        try {
          const el = document.getElementById('print-area');
          if (!el) throw new Error('لم يتم العثور على قالب الاختبار.');
          const canvas = await rasterizeElement(el, printer.size === '58mm' ? 384 : 576);
          await printViaRelay(canvasToEscPosRaster(canvas), {
            target: 'spooler',
            printer: name,
            docName: 'SEEN POS Test Invoice',
          });
        } catch (rasterErr: any) {
          arabicOk = false;
          arabicError = rasterErr?.message || 'خطأ غير معروف';
          console.warn('[PrinterSettings] فشل اختبار الفاتورة العربية عبر الوسيط:', rasterErr);
        }

        setFeedback({
          kind: arabicOk ? 'success' : 'info',
          text: arabicOk
            ? `طباعة صامتة ناجحة على "${name}" بدون أي مربع حوار — خرج إيصالان: اختبار اتصال وفاتورة عربية.`
            : `تمت الطباعة الصامتة لإيصال الاختبار، لكن فشلت الفاتورة العربية (${arabicError}).`,
        });
        return;
      }

      /* --- 0ب) RawBT على الأندرويد --- */
      if (printer.type === 'rawbt') {
        if (!canUseRawBT()) {
          setFeedback({
            kind: 'error',
            text: 'تطبيق RawBT متاح على أجهزة الأندرويد فقط. على الويندوز استخدم الاقتران مع وسيط سين.',
          });
          return;
        }

        try {
          const el = document.getElementById('print-area');
          if (!el) throw new Error('لم يتم العثور على قالب الاختبار.');
          const canvas = await rasterizeElement(el, printer.size === '58mm' ? 384 : 576);
          sendBytesToRawBT(canvasToEscPosRaster(canvas));

          /*
           * RawBT يعمل عبر Intent وليس طلب شبكة، فلا يمكن معرفة النتيجة
           * برمجياً. نُبلّغ المستخدم بذلك صراحةً بدل الإيحاء بنجاح مؤكد.
           */
          setFeedback({
            kind: 'info',
            text: 'تم تحويل الفاتورة إلى تطبيق RawBT. إن لم يفتح التطبيق أو لم يخرج ورق، فتأكد من تنصيب RawBT ومن اختيار الطابعة الصحيحة داخل إعداداته.',
          });
        } catch (e: any) {
          setFeedback({ kind: 'error', text: e?.message || 'تعذر تجهيز الفاتورة لتطبيق RawBT.' });
        }
        return;
      }

      /* --- 0ج) الوسيط المحلي القديم (127.0.0.1) --- */
      if (printer.type === 'agent') {
        const info = agent?.online ? agent : await detectPrintAgent();
        if (!info.online) {
          setFeedback({ kind: 'error', text: info.error || 'وسيط الطباعة غير مُشغَّل على هذا الجهاز.' });
          return;
        }

        const name = printer.printerName || printer.name;

        if (!thermal) {
          // ورق عادي A4 لا يقبل أوامر ESC/POS → مربع حوار الطباعة
          const res = await printElementDetailed('print-area', {
            paperSize: printer.size,
            title: `اختبار طباعة - ${printer.name}`,
            skipRawDevice: true,
          });
          setFeedback({
            kind: res.ok ? 'info' : 'error',
            text: res.ok
              ? 'الورق العادي (A4) لا يقبل أوامر الطابعات الحرارية، لذلك تم استخدام مربع حوار الطباعة. للطباعة الصامتة اضبط حجم الورق على 80mm أو 58mm.'
              : `فشل الاختبار: ${res.message}`,
          });
          return;
        }

        // (أ) إيصال نصي سريع للتحقق من المسار كاملاً
        await testPrintViaAgent(name);

        // (ب) فاتورة عربية كصورة نقطية للتحقق من التنسيق والخط
        let arabicOk = true;
        let arabicError = '';
        try {
          const el = document.getElementById('print-area');
          if (!el) throw new Error('لم يتم العثور على قالب الاختبار.');
          const canvas = await rasterizeElement(el, printer.size === '58mm' ? 384 : 576);
          await sendRawToAgent(name, canvasToEscPosRaster(canvas), 'SEEN POS Test Invoice');
        } catch (rasterErr: any) {
          arabicOk = false;
          arabicError = rasterErr?.message || 'خطأ غير معروف';
          console.warn('[PrinterSettings] فشل اختبار الفاتورة العربية عبر الوسيط:', rasterErr);
        }

        setFeedback({
          kind: arabicOk ? 'success' : 'info',
          text: arabicOk
            ? `طباعة صامتة ناجحة على "${name}" بدون أي مربع حوار — خرج إيصالان: اختبار اتصال وفاتورة عربية.`
            : `تمت الطباعة الصامتة لإيصال الاختبار، لكن فشلت الفاتورة العربية (${arabicError}).`,
        });
        return;
      }

      /* --- 1) طابعة شبكة: نفحص الاتصال قبل إرسال أي بيانات --- */
      if (printer.type === 'network') {
        if (!printer.ipAddress) {
          setFeedback({
            kind: 'error',
            text: 'لم يتم إدخال عنوان IP لهذه الطابعة. احذفها وأعد إضافتها مع عنوان IP الصحيح (مثال: 192.168.1.199).',
          });
          return;
        }
        const probe = await probeNetworkPrinter(printer.ipAddress, printer.port || '9100');
        if (!probe.ok) {
          setFeedback({
            kind: 'error',
            text: `تعذر الوصول للطابعة على ${printer.ipAddress}:${printer.port || 9100} — ${probe.message} تأكد من تشغيل الطابعة، وأن السيرفر والطابعة على نفس الشبكة، وأن منفذ الطباعة الخام (9100) مفعّل في إعدادات الطابعة.`,
          });
          return;
        }
      }

      /* --- 2) طابعة حرارية مربوطة مباشرة → إرسال ESC/POS بدون مربع حوار --- */
      if (isRawTransport && thermal) {
        // (أ) إيصال نصي إنجليزي سريع: يتحقق من الاتصال الفيزيائي
        await sendRawToPrinter(printer.id, printer.type, buildTestReceipt(printer.name), conn);

        // (ب) فاتورة عربية كصورة نقطية: يتحقق من التنسيق والخط العربي
        let arabicOk = true;
        let arabicError = '';
        try {
          const el = document.getElementById('print-area');
          if (!el) throw new Error('لم يتم العثور على قالب الاختبار.');
          const canvas = await rasterizeElement(el, printer.size === '58mm' ? 384 : 576);
          await sendRawToPrinter(printer.id, printer.type, canvasToEscPosRaster(canvas), conn);
        } catch (rasterErr: any) {
          arabicOk = false;
          arabicError = rasterErr?.message || 'خطأ غير معروف';
          console.warn('[PrinterSettings] فشل اختبار الفاتورة العربية:', rasterErr);
        }

        setFeedback({
          kind: arabicOk ? 'success' : 'info',
          text: arabicOk
            ? `تم إرسال إيصالين إلى "${printer.name}": إيصال اتصال بالإنجليزية وفاتورة عربية كصورة. تحقق من خروج الورق.`
            : `تم إرسال إيصال الاتصال بنجاح، لكن فشل إرسال الفاتورة العربية (${arabicError}). الاتصال بالطابعة سليم.`,
        });
        return;
      }

      /* --- 3) طابعة النظام أو ورق عادي (A4) → مربع حوار الطباعة --- */
      const res = await printElementDetailed('print-area', {
        paperSize: printer.size,
        title: `اختبار طباعة - ${printer.name}`,
        skipRawDevice: true,
      });

      if (res.ok) {
        setFeedback({
          kind: 'success',
          text:
            printer.type === 'system'
              ? 'تم فتح مربع حوار الطباعة. اختر طابعتك من القائمة، واضبط حجم الورق على الرول الحراري إن كانت حرارية، ثم اضغط طباعة.'
              : `تم إرسال المستند إلى مربع حوار الطباعة (${res.method}).`,
        });
      } else {
        setFeedback({
          kind: 'error',
          text: `فشل الاختبار: ${res.message}`,
        });
      }
    } catch (e: any) {
      console.error('Test print failed:', e);
      setFeedback({
        kind: 'error',
        text: `فشل الاختبار: ${e?.message || 'خطأ غير معروف'}`,
      });
    } finally {
      setBusyId(null);
      setTestingPrinter(null);
    }
  };

  const activePrinter = printers.find((p) => p.isDefault) || printers[0];
  const currentTestPrinter = testingPrinter || activePrinter;
  const realCount = printers.filter((p) => p.isRealDevice && p.status === 'online').length;
  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;

  /*
   * نوع السجل هنا مقصود: Record<PrinterTransport, string> يجعل المُصرِّف
   * يرفض الكود إن أُضيف نوع نقل جديد بدون تسمية عربية له — بدل أن تظهر
   * خانة فارغة للمستخدم كما حدث سابقاً.
   */
  const TRANSPORT_LABELS: Record<PrinterTransport, string> = {
    system: 'طابعة النظام (مربع حوار)',
    usb: 'USB مباشر',
    serial: 'منفذ تسلسلي',
    bluetooth: 'بلوتوث',
    network: 'شبكة LAN مباشر',
    relay: 'طباعة صامتة (وسيط سين)',
    rawbt: 'RawBT (أندرويد)',
    agent: 'وسيط محلي قديم (127.0.0.1)',
  };

  const transportLabel = (t: PrinterTransport) => TRANSPORT_LABELS[t] ?? t;

  /* ------------------------------- العرض ------------------------------- */

  // No padding on phones below: Settings already pads the panel, and a third
  // layer of padding was leaving only ~220px of usable width.
  return (
    <div className="max-w-6xl mx-auto p-0 sm:p-6 lg:p-8 space-y-6 sm:space-y-8 text-right" dir="rtl">
      {/* منطقة الاختبار المخفية القابلة للطباعة */}
      <div
        id="print-area"
        data-paper={currentTestPrinter?.size || '80mm'}
        className="hidden print:block printable-area text-black bg-white p-4 font-mono text-xs text-right"
        dir="rtl"
      >
        <div className="text-center pb-2 border-b border-black mb-3">
          <h2 className="text-base font-bold">تجربة طباعة الفاتورة الحرارية</h2>
          <p className="text-[10px]">نظام سين (Seen POS) لنقاط البيع</p>
          <p className="text-[10px] mt-1">{new Date().toLocaleString('ar-SA-u-nu-latn')}</p>
        </div>
        <div className="space-y-1 mb-3">
          <p><strong>اسم الطابعة:</strong> {currentTestPrinter?.name || 'طابعة النظام'}</p>
          <p><strong>حجم الورق:</strong> {currentTestPrinter?.size || '80mm'}</p>
          <p><strong>نوع الاتصال:</strong> {currentTestPrinter ? transportLabel(currentTestPrinter.type) : '-'}</p>
        </div>
        <div className="border-t border-b border-black py-2 my-2 text-center font-bold">
          اختبار طباعة إيصال كاشير ناجح
        </div>
        <div className="text-center pt-2 text-[10px]">شكراً لاستخدامك نظام سين POS</div>
      </div>

      {/* الترويسة */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-surface p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border border-border shadow-xs">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <div className="p-3 sm:p-3.5 bg-brand/10 text-brand rounded-2xl shrink-0">
            <Printer size={24} />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-2xl font-black text-content">إعدادات طابعة الفواتير</h1>
            <p className="text-xs text-content-muted mt-1 font-medium">
              ربط الطابعات الحرارية (80mm / 58mm) عبر USB أو المنفذ التسلسلي أو البلوتوث
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void refreshAgent(true);
              void syncPairedDevices(printers, false);
            }}
            className="bg-surface-hover hover:bg-brand/10 text-content hover:text-brand border border-border px-4 py-3 rounded-2xl text-xs font-black transition-all flex items-center justify-center gap-2"
          >
            <RefreshCw size={16} />
            <span>تحديث</span>
          </button>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="bg-brand hover:bg-brand-hover text-white px-5 py-3 rounded-2xl text-xs font-black transition-all shadow-md flex items-center justify-center gap-2"
          >
            <Plus size={18} />
            <span>إضافة يدوية</span>
          </button>
        </div>
      </div>

      {/* ============ الطباعة الصامتة عبر وسيط سين المقترن ============ */}
      <div
        className={cn(
          'p-6 rounded-[2rem] border-2 shadow-xs space-y-4 transition-all',
          station?.online
            ? 'bg-emerald-500/5 border-emerald-500/40'
            : 'bg-brand/5 border-brand/30'
        )}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'p-3 rounded-2xl text-white shadow-md',
                station?.online ? 'bg-emerald-600' : 'bg-brand'
              )}
            >
              <Zap size={22} />
            </div>
            <div>
              <h3 className="text-base font-black text-content flex items-center gap-2 flex-wrap">
                الطباعة الصامتة (بدون مربع حوار)
                <span
                  className={cn(
                    'text-[10px] font-black px-2.5 py-1 rounded-full text-white',
                    station?.online ? 'bg-emerald-600' : paired ? 'bg-red-600' : 'bg-amber-600'
                  )}
                >
                  {relayBusy
                    ? 'جاري الفحص...'
                    : station?.online
                    ? 'متصل'
                    : paired
                    ? 'الوسيط غير متصل'
                    : 'غير مقترن'}
                </span>
              </h3>
              <p className="text-xs text-content-muted font-medium mt-1 leading-relaxed">
                {station?.online
                  ? `مقترن بجهاز ${station.hostname} — الطباعة تمر عبر تعريف الطابعة الرسمي، فتخرج الفاتورة فوراً بدون أي نقرة، من هذا الجهاز أو أي جهاز آخر.`
                  : 'يعمل على ويندوز والأندرويد معاً. الوسيط يتصل بالسيرفر من جهاز الكاشير، فلا يحتاج أي إذن من المتصفح ولا يتأثر بحجب الشبكة المحلية.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {paired && (
              <button
                type="button"
                onClick={() => void refreshRelay(true)}
                disabled={relayBusy}
                className="bg-surface hover:bg-brand/10 text-content hover:text-brand border border-border px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {relayBusy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                <span>تحديث</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowRelayGuide(!showRelayGuide)}
              className="bg-surface hover:bg-brand/10 text-content hover:text-brand border border-border px-4 py-2.5 rounded-xl text-xs font-black transition-all"
            >
              {showRelayGuide ? 'إخفاء' : 'كيف أشغّله؟'}
            </button>
          </div>
        </div>

        {/* إرشاد خاص بنوع الجهاز الحالي */}
        <div className="p-3.5 bg-surface border border-border rounded-2xl flex items-start gap-2.5">
          <Info size={16} className="text-brand shrink-0 mt-0.5" />
          <p className="text-[11px] text-content-muted font-medium leading-relaxed">
            <strong className="text-content">
              {platformAdvice.platform === 'android'
                ? 'أنت على جهاز أندرويد: '
                : platformAdvice.platform === 'ios'
                ? 'أنت على جهاز iOS: '
                : platformAdvice.platform === 'windows'
                ? 'أنت على ويندوز: '
                : ''}
            </strong>
            {platformAdvice.advice}
          </p>
        </div>

        {/* دليل التشغيل */}
        {showRelayGuide && (
          <div className="pt-4 border-t border-border space-y-3 text-xs text-content-muted font-medium leading-relaxed">
            <p className="text-content font-black">
              على جهاز الكاشير (ويندوز) — مرة واحدة، بدون تنصيب أي برنامج:
            </p>
            <ol className="space-y-2 pr-4 list-decimal">
              <li>
                انسخ مجلد <strong className="text-content">print-agent</strong> إلى جهاز الكاشير (مثلاً{' '}
                <span dir="ltr" className="font-mono">C:\SeenPrintAgent</span>).
              </li>
              <li>
                اضغط مزدوجاً على <strong className="text-content">تشغيل-وسيط-الطباعة.bat</strong>. لن يطلب
                Node.js ولا أي تنصيب — PowerShell موجود في كل نسخ ويندوز.
              </li>
              <li>
                عند أول تشغيل سيسألك عن رابط النظام. أدخل{' '}
                <span dir="ltr" className="font-mono bg-surface-hover px-1.5 py-0.5 rounded">
                  {typeof window !== 'undefined' ? window.location.origin : ''}
                </span>{' '}
                ثم Enter.
              </li>
              <li>
                ستظهر نافذة تعرض <strong className="text-content">رمز اقتران من 6 أحرف</strong> وقائمة طابعاتك.
                اتركها مفتوحة أثناء العمل.
              </li>
              <li>
                أدخل الرمز في الحقل بالأسفل واضغط <strong className="text-content">اقتران</strong>. الاقتران يبقى
                محفوظاً — لا تحتاج تكراره كل يوم.
              </li>
              <li>
                للتشغيل التلقائي مع ويندوز: اضغط مزدوجاً على{' '}
                <strong className="text-content">تنصيب-تشغيل-تلقائي.bat</strong>.
              </li>
            </ol>
            <p className="pt-2 border-t border-border">
              <strong className="text-content">من جهاز أندرويد:</strong> لا تحتاج تنصيب أي شيء على التابلت. شغّل
              الوسيط على كمبيوتر المتجر وأدخل نفس رمز الاقتران هنا — ستُطبع الفواتير على طابعة المتجر.
            </p>
          </div>
        )}

        {/* نموذج الاقتران */}
        {!paired && (
          <div className="p-4 bg-surface border border-border rounded-2xl space-y-2.5">
            <label className="block text-xs font-black text-content">
              رمز الاقتران الظاهر في نافذة وسيط الطباعة
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={pairCodeInput}
                onChange={(e) => setPairCodeInput(e.target.value.toUpperCase().slice(0, 8))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handlePair();
                }}
                placeholder="K7M2QX"
                maxLength={8}
                autoComplete="off"
                spellCheck={false}
                className="flex-1 px-4 py-3 bg-surface-hover border border-border rounded-xl text-lg font-black text-content tracking-[0.3em] text-center focus:outline-none focus:border-brand uppercase"
                dir="ltr"
              />
              <button
                type="button"
                onClick={() => void handlePair()}
                disabled={relayBusy || pairCodeInput.trim().length < 4}
                className="px-6 py-3 bg-brand hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-black transition-all flex items-center justify-center gap-2"
              >
                {relayBusy ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                <span>اقتران</span>
              </button>
            </div>
            {relayError && (
              <p className="text-[11px] text-red-600 dark:text-red-400 font-bold leading-relaxed">
                {relayError}
              </p>
            )}
          </div>
        )}

        {/* المحطة مقترنة لكن غير متصلة */}
        {paired && station && !station.online && (
          <div className="p-4 bg-red-500/10 border border-red-500/40 rounded-2xl flex items-start gap-2.5">
            <AlertTriangle size={17} className="text-red-600 shrink-0 mt-0.5" />
            <div className="space-y-1.5 text-xs text-content-muted font-medium leading-relaxed">
              <p>
                <strong className="text-content">الوسيط على "{station.hostname}" غير متصل.</strong> تأكد أن نافذة
                وسيط الطباعة مفتوحة على جهاز الكاشير، وأن الجهاز متصل بالإنترنت.
              </p>
              <p>ستُستخدم مؤقتاً الطباعة عبر مربع حوار المتصفح حتى يعود الوسيط.</p>
            </div>
          </div>
        )}

        {/* خطأ في الاقتران المحفوظ */}
        {paired && !station && relayError && (
          <div className="p-4 bg-amber-500/10 border border-amber-500/40 rounded-2xl flex items-start gap-2.5">
            <AlertTriangle size={17} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-content-muted font-medium leading-relaxed">{relayError}</p>
          </div>
        )}

        {/* قائمة طابعات المحطة */}
        {station && (
          <div className="space-y-2.5 pt-2 border-t border-border">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs font-black text-content">
                طابعات جهاز "{station.hostname}" ({station.printers.length})
              </p>
              <button
                type="button"
                onClick={handleUnpair}
                className="text-[11px] font-black text-red-600 hover:text-red-700 hover:underline"
              >
                إلغاء الاقتران على هذا الجهاز
              </button>
            </div>

            {station.printers.length === 0 && (
              <p className="text-xs text-content-muted font-medium">
                لا توجد طابعات مثبتة على جهاز الكاشير. ثبّت تعريف الطابعة في ويندوز، وتأكد أنها تطبع صفحة اختبار،
                ثم اضغط "تحديث".
              </p>
            )}

            {station.printers.map((p) => {
              const linked = printers.some((x) => x.id === `relay-${p.name}`);
              return (
                <div
                  key={p.name}
                  className="p-3.5 bg-surface border border-border rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2.5 bg-surface-hover text-content-muted rounded-xl shrink-0">
                      <Printer size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-black text-sm text-content truncate">{p.name}</h4>
                        {p.isDefault && (
                          <span className="text-[10px] bg-brand/15 text-brand font-black px-2 py-0.5 rounded-full">
                            افتراضية النظام
                          </span>
                        )}
                        {p.isVirtual && (
                          <span className="text-[10px] bg-amber-600/15 text-amber-700 dark:text-amber-400 font-black px-2 py-0.5 rounded-full">
                            وهمية — لا تُخرج ورقاً
                          </span>
                        )}
                        {p.status === 'Offline' && (
                          <span className="text-[10px] bg-red-600/15 text-red-700 dark:text-red-400 font-black px-2 py-0.5 rounded-full">
                            غير متصلة بالنظام
                          </span>
                        )}
                        {linked && (
                          <span className="text-[10px] bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 font-black px-2 py-0.5 rounded-full">
                            مربوطة ✓
                          </span>
                        )}
                      </div>
                      {(p.driver || p.port) && (
                        <p className="text-[11px] text-content-muted font-medium mt-0.5 truncate" dir="ltr">
                          {[p.driver, p.port].filter(Boolean).join(' • ')}
                        </p>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleLinkRelayPrinter(p)}
                    disabled={p.isVirtual}
                    title={p.isVirtual ? 'هذه طابعة وهمية ولا تُخرج ورقاً' : undefined}
                    className={cn(
                      'px-4 py-2 rounded-xl text-xs font-black transition-all shrink-0',
                      p.isVirtual
                        ? 'bg-surface-hover text-content-muted opacity-50 cursor-not-allowed'
                        : linked
                        ? 'bg-emerald-600/10 text-emerald-700 hover:bg-emerald-600 hover:text-white'
                        : 'bg-brand hover:bg-brand-hover text-white shadow-md'
                    )}
                  >
                    {linked ? 'إعادة التعيين كافتراضية' : 'ربط للطباعة الصامتة'}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* ---- مسار الأندرويد: RawBT ---- */}
        {canUseRawBT() && (
          <div className="pt-3 border-t border-border space-y-2.5">
            <p className="text-xs font-black text-content">طابعة موصولة بهذا الجهاز (أندرويد)</p>
            <div className="p-3.5 bg-surface border border-border rounded-2xl space-y-3">
              <p className="text-[11px] text-content-muted font-medium leading-relaxed">
                إن كانت الطابعة بلوتوث <strong className="text-content">كلاسيك</strong> أو مدمجة في جهاز POS
                (Sunmi وشبيهاتها)، فلا يستطيع المتصفح مخاطبتها مباشرة — استخدم تطبيق RawBT المجاني. أما طابعات
                USB-OTG و بلوتوث BLE فاربطها مباشرة من أزرار الربط بالأسفل.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={handleLinkRawBT}
                  className="flex-1 px-4 py-2.5 bg-brand hover:bg-brand-hover text-white rounded-xl text-xs font-black transition-all"
                >
                  استخدام RawBT للطباعة
                </button>
                <a
                  href={RAWBT_STORE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 px-4 py-2.5 bg-surface-hover hover:bg-brand/10 text-content hover:text-brand border border-border rounded-xl text-xs font-black transition-all text-center"
                >
                  تنصيب RawBT من متجر Play
                </a>
              </div>
            </div>
          </div>
        )}

        {/* ---- الوسيط المحلي القديم (مطوي — للحالات الخاصة) ---- */}
        <div className="pt-3 border-t border-border">
          <button
            type="button"
            onClick={() => {
              setShowLegacyAgent(!showLegacyAgent);
              if (!showLegacyAgent && !agent) void refreshAgent();
            }}
            className="text-[11px] font-black text-content-muted hover:text-brand transition-colors"
          >
            {showLegacyAgent ? '▲ إخفاء' : '▼ خيار متقدم:'} الوسيط المحلي القديم (127.0.0.1)
          </button>

          {showLegacyAgent && (
            <div className="mt-3 space-y-3">
              <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-start gap-2.5">
                <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                <p className="text-[11px] text-content-muted font-medium leading-relaxed">
                  <strong className="text-content">لا نوصي بهذا المسار.</strong> Chrome الحديث يحجب اتصال الصفحات
                  بـ 127.0.0.1 (سياسة Local Network Access)، و Firefox و Safari يحجبانه كـ Mixed Content، ولا يعمل
                  على الأندرويد إطلاقاً. هذا هو السبب الحقيقي لرسالة «الوسيط غير مُشغَّل» التي ظهرت سابقاً رغم أن
                  الوسيط كان يعمل. استخدم الاقتران بالأعلى.
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => void refreshAgent(true)}
                  disabled={agentBusy}
                  className="bg-surface hover:bg-brand/10 text-content hover:text-brand border border-border px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {agentBusy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                  <span>فحص الوسيط المحلي</span>
                </button>
                {agent && (
                  <span
                    className={cn(
                      'text-[10px] font-black px-2.5 py-1 rounded-full text-white',
                      agent.online ? 'bg-emerald-600' : 'bg-amber-600'
                    )}
                  >
                    {agent.online ? 'متصل' : 'غير متاح'}
                  </span>
                )}
              </div>

              {agent && !agent.online && agent.error && (
                <p className="text-[11px] text-content-muted font-medium leading-relaxed">{agent.error}</p>
              )}

              {agent?.tokenRequired && (
                <div className="p-3.5 bg-surface border border-border rounded-2xl space-y-2">
                  <label className="block text-[11px] font-black text-content">
                    رمز الوصول للوسيط المحلي (خيار --token)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={agentTokenInput}
                      onChange={(e) => setAgentTokenInput(e.target.value)}
                      placeholder="الرمز الظاهر في نافذة الوسيط"
                      className="flex-1 px-4 py-2 bg-surface-hover border border-border rounded-xl text-xs font-bold text-content focus:outline-none focus:border-brand"
                      dir="ltr"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setAgentToken(agentTokenInput.trim());
                        void refreshAgent(true);
                      }}
                      className="px-5 py-2 bg-brand hover:bg-brand-hover text-white rounded-xl text-xs font-black transition-all"
                    >
                      حفظ
                    </button>
                  </div>
                </div>
              )}

              {agent?.online &&
                agentPrinters.map((p) => {
                  const linked = printers.some((x) => x.id === `agent-${p.name}`);
                  return (
                    <div
                      key={p.name}
                      className="p-3 bg-surface border border-border rounded-2xl flex items-center justify-between gap-3"
                    >
                      <h4 className="font-black text-xs text-content truncate">{p.name}</h4>
                      <button
                        type="button"
                        onClick={() => handleLinkAgentPrinter(p)}
                        disabled={p.isVirtual}
                        className={cn(
                          'px-3 py-1.5 rounded-lg text-[11px] font-black transition-all shrink-0',
                          p.isVirtual
                            ? 'bg-surface-hover text-content-muted opacity-50 cursor-not-allowed'
                            : linked
                            ? 'bg-emerald-600/10 text-emerald-700'
                            : 'bg-brand hover:bg-brand-hover text-white'
                        )}
                      >
                        {linked ? 'مربوطة ✓' : 'ربط'}
                      </button>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>

      {/* تنبيه المعاينة المضمنة (Iframe) */}
      {isInIframe && (
        <div className="p-5 bg-brand/10 border border-brand/30 rounded-2xl flex items-start gap-3 text-right">
          <Info size={20} className="text-brand shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-black text-brand">ملاحظة المعاينة المضمنة (Iframe)</p>
            <p className="text-xs text-content-muted font-medium leading-relaxed">
              لربط طابعة حرارية حقيقية عبر USB أو البلوتوث المباشر من المتصفح، يُفضّل فتح التطبيق في <strong>نافذة جديدة مستقلة</strong> (عبر زر "فتح في نافذة جديدة" بأعلى الشاشة)، لأن متصفحات الويب تفرض سياسات أمان أحياناً تمنع الوصول لأجهزة الهاردوير داخل الإطارات المضمنة.
            </p>
            <p className="text-xs text-content-muted font-medium leading-relaxed">
              تستطيع أيضاً استخدام <strong>طابعة النظام الافتراضية</strong> للطباعة المباشرة من أي مكان وفي أي متصفح.
            </p>
          </div>
        </div>
      )}

      {/* تنبيه دعم المتصفح */}
      {support && !support.anyDiscovery && (
        <div className="p-5 bg-amber-500/10 border border-amber-500/40 rounded-2xl flex items-start gap-3">
          <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-black text-content">الربط المباشر بالأجهزة غير متاح هنا</p>
            <p className="text-xs text-content-muted font-medium leading-relaxed">{support.reason}</p>
            <p className="text-xs text-content-muted font-medium leading-relaxed">
              يمكنك مواصلة الطباعة عبر "طابعة النظام" — سيفتح مربع حوار الطباعة وتختار طابعتك منه.
            </p>
          </div>
        </div>
      )}

      {/* أزرار الربط الحقيقي */}
      <div className="bg-surface p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border border-border shadow-xs space-y-4">
        <div className="flex items-center gap-2">
          <Search size={20} className="text-brand" />
          <h3 className="text-base font-black text-content">ربط طابعة حقيقية</h3>
        </div>
        <p className="text-xs text-content-muted font-medium leading-relaxed">
          سيفتح المتصفح نافذة اختيار أجهزة تعرض الطابعات المتصلة فعلياً بجهازك. اختر طابعتك من تلك النافذة ثم اضغط
          "اتصال".
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <ConnectButton
            icon={Usb}
            label="طابعة USB"
            hint="الطابعات المعرّفة كفئة طابعة"
            disabled={!support?.usb}
            loading={scanning === 'usb'}
            onClick={() => void handleConnect('usb')}
          />
          <ConnectButton
            icon={Search}
            label="بحث موسّع (كل أجهزة USB)"
            hint="لطابعات POS غير القياسية"
            disabled={!support?.usb}
            loading={false}
            onClick={() => void handleConnect('usb-any')}
          />
          <ConnectButton
            icon={Cable}
            label="منفذ تسلسلي / COM"
            hint="RS-232 أو USB-Serial"
            disabled={!support?.serial}
            loading={scanning === 'serial'}
            onClick={() => void handleConnect('serial')}
          />
          <ConnectButton
            icon={Bluetooth}
            label="طابعة بلوتوث"
            hint="طابعات ESC/POS اللاسلكية"
            disabled={!support?.bluetooth}
            loading={scanning === 'bluetooth'}
            onClick={() => void handleConnect('bluetooth')}
          />
        </div>

        <div className="flex items-start gap-2 pt-2 border-t border-border text-[11px] text-content-muted font-medium leading-relaxed">
          <Info size={14} className="shrink-0 mt-0.5" />
          <span>
            إذا ظهرت نافذة المتصفح فارغة: تأكد أن الطابعة موصولة ومشغّلة، وأنها ليست مفتوحة في برنامج آخر. على
            ويندوز قد تحتاج لتثبيت تعريف WinUSB عبر أداة Zadig لتظهر الطابعة في WebUSB.
          </span>
        </div>
      </div>

      {/* بطاقة الطابعة النشطة */}
      {activePrinter && (
        <div
          className={cn(
            'p-6 sm:p-8 rounded-[2.5rem] border-2 transition-all space-y-4 shadow-lg text-right relative overflow-hidden',
            activePrinter.status === 'online'
              ? 'bg-emerald-500/10 border-emerald-500/40'
              : 'bg-amber-500/15 border-amber-500/50'
          )}
        >
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
            <div className="flex items-start gap-4 flex-1">
              <div
                className={cn(
                  'p-4 rounded-2xl shrink-0 flex items-center justify-center shadow-md text-white',
                  activePrinter.status === 'online' ? 'bg-emerald-600' : 'bg-amber-500'
                )}
              >
                {activePrinter.status === 'online' ? <Printer size={32} /> : <AlertTriangle size={32} />}
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-content-muted">الطابعة الافتراضية:</span>
                  <h3 className="text-lg font-black text-content bg-surface px-3 py-1 rounded-xl border border-border shadow-xs">
                    {activePrinter.name}
                  </h3>
                  <span
                    className={cn(
                      'text-[11px] font-black px-3 py-1 rounded-full flex items-center gap-1.5 shadow-xs text-white',
                      activePrinter.status === 'online' ? 'bg-emerald-600' : 'bg-amber-600'
                    )}
                  >
                    <span className="w-2 h-2 rounded-full bg-white" />
                    {activePrinter.status === 'online' ? 'جاهزة' : 'غير متصلة'}
                  </span>
                  {activePrinter.isRealDevice && (
                    <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-brand text-white">
                      جهاز مربوط مباشرة
                    </span>
                  )}
                </div>

                <p className="text-xs text-content-muted font-medium">
                  حجم الورق: <strong className="text-content">{activePrinter.size}</strong> | الاتصال:{' '}
                  <strong className="text-content">{transportLabel(activePrinter.type)}</strong>
                  {activePrinter.ipAddress && ` | IP: ${activePrinter.ipAddress}`}
                </p>

                {activePrinter.status === 'offline' && (
                  <p className="text-xs text-amber-700 dark:text-amber-300 font-bold">
                    الجهاز لم يعد مقترناً. تأكد من توصيله ثم اضغط "تحديث"، أو أعد ربطه من الأزرار أعلاه.
                  </p>
                )}
                {activePrinter.type === 'system' && (
                  <p className="text-xs text-content-muted font-medium">
                    ستفتح نافذة الطباعة القياسية عند كل إيصال. للطباعة الصامتة اربط الطابعة عبر USB أو البلوتوث.
                  </p>
                )}
              </div>
            </div>

            <div className="shrink-0">
              <button
                type="button"
                onClick={() => void handleTestPrint(activePrinter)}
                disabled={busyId === activePrinter.id}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black transition-all shadow-md flex items-center gap-2 disabled:opacity-50"
              >
                {busyId === activePrinter.id ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                <span>{busyId === activePrinter.id ? 'جاري الاختبار...' : 'طباعة فاتورة تجريبية'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* رسالة الحالة */}
      {feedback && (
        <div
          className={cn(
            'p-4 border rounded-2xl text-xs font-bold flex items-start justify-between gap-3',
            feedback.kind === 'success' && 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300',
            feedback.kind === 'error' && 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300',
            feedback.kind === 'info' && 'bg-brand/10 border-brand/30 text-brand'
          )}
        >
          <div className="flex items-start gap-2">
            {feedback.kind === 'success' ? (
              <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
            ) : feedback.kind === 'error' ? (
              <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            ) : (
              <Info size={18} className="shrink-0 mt-0.5" />
            )}
            <span className="leading-relaxed">{feedback.text}</span>
          </div>
          <button type="button" onClick={() => setFeedback(null)} className="opacity-60 hover:opacity-100 shrink-0">
            <X size={16} />
          </button>
        </div>
      )}

      {/* قائمة الطابعات */}
      <div className="bg-surface p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border border-border shadow-xs space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-base font-black text-content">الطابعات ({printers.length})</h3>
          <span className="text-xs text-content-muted font-bold">
            {realCount > 0 ? `${realCount} جهاز مربوط مباشرة` : 'لا توجد أجهزة مربوطة مباشرة بعد'}
          </span>
        </div>

        <div className="space-y-3">
          {printers.map((p) => (
            <div
              key={p.id}
              className={cn(
                'p-4 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4',
                p.isDefault ? 'bg-brand/5 border-brand/40 shadow-xs' : 'bg-surface border-border'
              )}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={cn('p-3 rounded-xl shrink-0', p.isDefault ? 'bg-brand text-white' : 'bg-surface-hover text-content-muted')}>
                  {p.type === 'bluetooth' ? <Bluetooth size={20} /> : p.type === 'system' ? <Monitor size={20} /> : p.type === 'serial' ? <Cable size={20} /> : <Printer size={20} />}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-black text-sm text-content truncate">{p.name}</h4>
                    {p.isDefault && (
                      <span className="text-[10px] bg-brand text-white font-black px-2 py-0.5 rounded-full">الافتراضية</span>
                    )}
                    <span
                      className={cn(
                        'text-[10px] font-black px-2 py-0.5 rounded-full',
                        p.status === 'online' ? 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-400' : 'bg-amber-600/15 text-amber-700 dark:text-amber-400'
                      )}
                    >
                      {p.status === 'online' ? 'متصلة' : 'غير متصلة'}
                    </span>
                  </div>
                  <p className="text-xs text-content-muted font-medium mt-0.5">
                    {transportLabel(p.type)}
                    {p.vendorId !== undefined && ` • ${p.vendorId.toString(16).padStart(4, '0')}:${(p.productId ?? 0).toString(16).padStart(4, '0')}`}
                    {p.ipAddress && ` • ${p.ipAddress}:${p.port}`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <select
                  value={p.size}
                  onChange={(e) => handleChangeSize(p.id, e.target.value as '80mm' | '58mm' | 'A4')}
                  className="px-3 py-2 bg-surface-hover border border-border rounded-xl text-xs font-black text-content focus:outline-none focus:border-brand"
                >
                  <option value="80mm">80mm</option>
                  <option value="58mm">58mm</option>
                  <option value="A4">A4</option>
                </select>

                {!p.isDefault && (
                  <button
                    type="button"
                    onClick={() => handleSetDefault(p.id)}
                    className="px-3.5 py-2 bg-surface hover:bg-brand/10 text-content hover:text-brand border border-border hover:border-brand/30 rounded-xl text-xs font-black transition-all"
                  >
                    تعيين كافتراضية
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => void handleTestPrint(p)}
                  disabled={busyId === p.id}
                  className="px-3.5 py-2 bg-emerald-600/10 text-emerald-700 hover:bg-emerald-600 hover:text-white rounded-xl text-xs font-black transition-all disabled:opacity-50 flex items-center gap-1.5"
                >
                  {busyId === p.id && <Loader2 size={13} className="animate-spin" />}
                  <span>اختبار</span>
                </button>

                {p.id !== SYSTEM_PRINTER.id && (
                  <button
                    type="button"
                    onClick={() => handleDeletePrinter(p.id)}
                    className="p-2 text-danger hover:bg-danger/10 rounded-xl transition-all"
                    title="حذف"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* خيارات الطباعة */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        <ToggleCard
          icon={Sliders}
          title="الطباعة التلقائية عند إتمام البيع"
          desc="إرسال الفاتورة للطابعة فور إضافة الطلب"
          value={autoPrint}
          onChange={(v) => {
            setAutoPrint(v);
            localStorage.setItem('pos_auto_print', String(v));
          }}
        />
        <ToggleCard
          icon={Zap}
          title="وضع الطباعة السريعة (Fast Thermal)"
          desc="تنسيق مضغوط مخصص للرول الحراري 80mm"
          value={fastThermalMode}
          onChange={(v) => {
            setFastThermalMode(v);
            localStorage.setItem('pos_fast_thermal_mode', String(v));
          }}
        />
        <ToggleCard
          icon={Printer}
          title="الطباعة الصامتة (بلا نافذة طباعة)"
          desc="إرسال الفاتورة مباشرةً للطابعة الحرارية المربوطة بلا أي نافذة. إن فشلت تُفتح نافذة الطباعة تلقائياً."
          value={silentPrint}
          onChange={async (v) => {
            setSilentPrint(v);
            const { setSilentPrintEnabled } = await import('../utils/printManager');
            setSilentPrintEnabled(v);
          }}
        />
      </div>

      {/* شرح الطباعة بلا نافذة */}
      <div className="bg-brand/5 p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border border-brand/15 space-y-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="p-2.5 bg-brand text-white rounded-xl shrink-0 shadow-sm">
            <Zap size={18} />
          </div>
          <div className="min-w-0 space-y-1">
            <h3 className="text-sm sm:text-base font-black text-content">كيف تختفي نافذة الطباعة تماماً؟</h3>
            <p className="text-[11px] sm:text-xs text-content-muted font-medium leading-relaxed">
              المتصفح لا يسمح لأي موقع بإغلاق نافذة الطباعة تلقائياً (قيد أمني)، لذلك الحل أن
              لا تظهر من الأصل — وذلك بطريقين:
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="bg-surface p-3.5 rounded-xl border border-border space-y-1.5">
            <p className="text-xs font-black text-content flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-brand text-white text-[10px] flex items-center justify-center shrink-0">1</span>
              <span>الطباعة الصامتة (بالأعلى)</span>
            </p>
            <p className="text-[10px] sm:text-[11px] text-content-muted font-medium leading-relaxed">
              اربط طابعة حرارية 80mm أو 58mm واجعلها الافتراضية. تعمل على الويندوز
              والأندرويد والتابلت. لا تدعم الورق العادي A4.
            </p>
          </div>

          <div className="bg-surface p-3.5 rounded-xl border border-border space-y-1.5">
            <p className="text-xs font-black text-content flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-brand text-white text-[10px] flex items-center justify-center shrink-0">2</span>
              <span>وضع الطباعة الفورية (ويندوز)</span>
            </p>
            <p className="text-[10px] sm:text-[11px] text-content-muted font-medium leading-relaxed">
              افتح النظام من ملف <span className="font-mono font-bold" dir="ltr">kiosk-print/طباعة-فورية-بدون-نافذة.bat</span>{' '}
              فتُطبع كل الفواتير فوراً بلا نافذة — ويشمل A4.
            </p>
          </div>
        </div>
      </div>

      {/* إرشادات حل المشاكل */}
      <div className="bg-surface p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border border-border shadow-xs space-y-4">
        <button
          type="button"
          onClick={() => setShowHelpGuide(!showHelpGuide)}
          className="w-full flex items-center justify-between text-right"
        >
          <div className="flex items-center gap-2">
            <Wrench size={20} className="text-brand" />
            <h3 className="text-base font-black text-content">لماذا لا تظهر طابعتي؟</h3>
          </div>
          <span className="text-xs text-brand font-black">{showHelpGuide ? 'إخفاء' : 'عرض التفاصيل'}</span>
        </button>

        {showHelpGuide && (
          <div className="pt-3 border-t border-border space-y-3 text-xs text-content-muted leading-relaxed font-medium">
            <p>
              <strong className="text-content">1. المتصفح لا يرى طابعات النظام:</strong> لأسباب أمنية لا يستطيع أي
              موقع قراءة قائمة الطابعات المثبتة في ويندوز/ماك. الطريقة الوحيدة هي أن تختار الجهاز بنفسك من نافذة
              المتصفح عبر أزرار الربط أعلاه، أو أن تستخدم "طابعة النظام" وتختار الطابعة من مربع حوار الطباعة.
            </p>
            <p>
              <strong className="text-content">2. رسالة "Access Denied" أو نافذة USB فارغة:</strong> هذا سلوك ويندوز
              الطبيعي — التعريف الرسمي للطابعة يحجزها حجزاً حصرياً فلا يستطيع المتصفح فتحها. لا تستخدم أداة Zadig لأنها
              تُعطّل الطباعة من بقية البرامج. الحل الصحيح هو{' '}
              <strong className="text-content">"الطباعة الصامتة عبر وسيط سين"</strong> في أعلى الصفحة: يطبع فوراً بدون
              مربع حوار وبنفس التعريف الرسمي.
            </p>
            <p>
              <strong className="text-content">3. أزرار الربط معطّلة (رمادية):</strong> إما أن الموقع مفتوح عبر http
              بدلاً من https، أو أن المتصفح لا يدعم هذه الواجهات. استخدم Chrome أو Edge على الكمبيوتر عبر رابط https.
            </p>
            <p>
              <strong className="text-content">4. طابعة الشبكة (LAN / منفذ 9100):</strong> مدعومة الآن. أضفها من
              "إضافة يدوية" واختر "شبكة LAN" وأدخل عنوان IP والمنفذ (9100 افتراضياً). المتصفح لا يفتح اتصال TCP خام،
              لذلك يمرّ الإرسال عبر سيرفر النظام — يجب أن يكون السيرفر على نفس الشبكة المحلية للطابعة، وأن يكون منفذ
              الطباعة الخام (RAW / JetDirect 9100) مفعّلاً في إعدادات الطابعة.
            </p>
            <p>
              <strong className="text-content">6. تظهر رسالة نجاح لكن لا يخرج ورق:</strong> إن كانت الطابعة من نوع
              "طابعة النظام" فتأكد أنك اخترتها فعلاً في مربع حوار الطباعة وأن حجم الورق مضبوط على الرول (80mm) وليس
              A4، وأن خيار "الطباعة إلى ملف / PDF" غير محدد. وإن كانت مربوطة عبر USB/بلوتوث تأكد من وجود الورق وأن
              غطاء الطابعة مغلق تماماً.
            </p>
            <p>
              <strong className="text-content">5. البلوتوث:</strong> يجب أن تكون الطابعة تدعم BLE (وليس Bluetooth
              Classic فقط). طابعات BT Classic لا تظهر في Web Bluetooth — اربطها عبر نظام التشغيل واستخدم "طابعة
              النظام".
            </p>
          </div>
        )}
      </div>

      {/* نافذة الإضافة اليدوية */}
      {showAddModal && (
        // items-start + overflow-y-auto on the backdrop, and max-h on the panel:
        // the network form is taller than a phone viewport, so without these the
        // save/cancel buttons end up off-screen with no way to reach them.
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-surface border border-border rounded-2xl sm:rounded-[2.5rem] p-5 sm:p-8 w-full max-w-lg max-h-[92dvh] overflow-y-auto space-y-5 sm:space-y-6 shadow-2xl text-right my-auto" dir="rtl">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-black text-content">إضافة طابعة يدوياً</h3>
              <button type="button" onClick={() => setShowAddModal(false)} className="p-2 text-content-muted hover:text-content rounded-xl">
                <X size={20} />
              </button>
            </div>

            <p className="text-xs text-content-muted font-medium leading-relaxed">
              اختر <strong>"شبكة LAN"</strong> للطباعة المباشرة الصامتة على طابعة حرارية لها عنوان IP (سيتم فحص
              الاتصال فوراً). أما <strong>"طابعة النظام"</strong> فتُنشئ ملفاً تعريفياً يُطبع عبر مربع حوار الطباعة —
              مناسب للطابعات العادية A4.
            </p>

            <form onSubmit={handleAddPrinterSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-black text-content mb-1">اسم الطابعة</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: كاشير الفرع الرئيسي"
                  value={printerName}
                  onChange={(e) => setPrinterName(e.target.value)}
                  className="w-full px-4 py-3 bg-surface-hover border border-border rounded-xl text-xs font-bold text-content focus:outline-none focus:border-brand"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-black text-content mb-1">نوع الاتصال</label>
                  <select
                    value={printerType}
                    onChange={(e) => setPrinterType(e.target.value as 'system' | 'network')}
                    className="w-full px-4 py-3 bg-surface-hover border border-border rounded-xl text-xs font-bold text-content focus:outline-none focus:border-brand"
                  >
                    <option value="system">طابعة النظام (مربع حوار الطباعة)</option>
                    <option value="network">شبكة LAN (طباعة مباشرة عبر IP:9100)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-black text-content mb-1">حجم الورق</label>
                  <select
                    value={printerSize}
                    onChange={(e) => setPrinterSize(e.target.value as '80mm' | '58mm' | 'A4')}
                    className="w-full px-4 py-3 bg-surface-hover border border-border rounded-xl text-xs font-bold text-content focus:outline-none focus:border-brand"
                  >
                    <option value="80mm">80mm (ورق حراري قياسي)</option>
                    <option value="58mm">58mm (ورق حراري صغير)</option>
                    <option value="A4">A4 (ورق عادي)</option>
                  </select>
                </div>
              </div>

              {printerType === 'network' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-black text-content mb-1">عنوان IP</label>
                    <input
                      type="text"
                      placeholder="192.168.1.199"
                      value={ipAddress}
                      onChange={(e) => setIpAddress(e.target.value)}
                      className="w-full px-4 py-3 bg-surface-hover border border-border rounded-xl text-xs font-bold text-content focus:outline-none focus:border-brand"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-black text-content mb-1">المنفذ Port</label>
                    <input
                      type="text"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      className="w-full px-4 py-3 bg-surface-hover border border-border rounded-xl text-xs font-bold text-content focus:outline-none focus:border-brand"
                      dir="ltr"
                    />
                  </div>
                </div>
              )}

              <div className="pt-4 flex items-center justify-end gap-3">
                <button type="button" onClick={() => setShowAddModal(false)} className="px-5 py-3 bg-surface-hover text-content-muted rounded-xl text-xs font-black">
                  إلغاء
                </button>
                <button type="submit" className="px-6 py-3 bg-brand hover:bg-brand-hover text-white rounded-xl text-xs font-black transition-all shadow-md">
                  حفظ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================ مكوّنات فرعية ============================ */

function ConnectButton({
  icon: Icon,
  label,
  hint,
  disabled,
  loading,
  onClick,
}: {
  icon: any;
  label: string;
  hint: string;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      title={disabled ? 'غير مدعوم في هذا المتصفح أو يتطلب HTTPS' : undefined}
      className={cn(
        'p-4 border rounded-2xl transition-all text-right space-y-1.5 group',
        disabled
          ? 'bg-surface-hover/50 border-border opacity-50 cursor-not-allowed'
          : 'bg-surface-hover hover:bg-brand/10 border-border hover:border-brand/40'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-black text-xs text-content group-hover:text-brand">{label}</span>
        {loading ? <Loader2 size={16} className="animate-spin text-brand" /> : <Icon size={16} className="text-content-muted" />}
      </div>
      <p className="text-[11px] text-content-muted font-medium">{hint}</p>
    </button>
  );
}

function ToggleCard({
  icon: Icon,
  title,
  desc,
  value,
  onChange,
}: {
  icon: any;
  title: string;
  desc: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="bg-surface p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border border-border shadow-xs">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-3 bg-brand/10 text-brand rounded-2xl shrink-0">
            <Icon size={20} />
          </div>
          <div className="min-w-0">
            <h4 className="font-black text-sm text-content">{title}</h4>
            <p className="text-xs text-content-muted font-medium mt-0.5">{desc}</p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={value}
          onClick={() => onChange(!value)}
          className={cn(
            'w-12 h-6 rounded-full transition-colors relative shrink-0 flex items-center px-1',
            value ? 'bg-brand justify-end' : 'bg-border justify-start'
          )}
        >
          <span className="w-4 h-4 rounded-full bg-white shadow-sm" />
        </button>
      </div>
    </div>
  );
}
