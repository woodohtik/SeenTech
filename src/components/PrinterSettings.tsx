import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
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
import { isRtlLang } from '../lib/direction';

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
  const { t, i18n } = useTranslation();
  const isRtl = isRtlLang(i18n.language);

  /*
   * اسم طابعة النظام يُخزَّن كبيانات في localStorage، فلا نترجمه في الكائن نفسه.
   * الترجمة تحدث عند العرض فقط.
   */
  const printerDisplayName = (p: PrinterDevice) =>
    p.id === SYSTEM_PRINTER.id ? t('settings_page.printer.system_printer_name') : p.name;
  const [printers, setPrinters] = useState<PrinterDevice[]>([SYSTEM_PRINTER]);
  const [support, setSupport] = useState<SupportInfo | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [testingPrinter, setTestingPrinter] = useState<PrinterDevice | null>(null);
  const [scanning, setScanning] = useState<PrinterTransport | null>(null);

  const [autoPrint, setAutoPrint] = useState(true);
  const [fastThermalMode, setFastThermalMode] = useState(true);
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
            ? { kind: 'success', text: t('settings_page.printer.paired_devices_found', { count: added }) }
            : {
                kind: 'info',
                text: t('settings_page.printer.no_paired_devices'),
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
          setFeedback({ kind: 'info', text: t('settings_page.printer.no_station_paired') });
        } else if (s.online) {
          setFeedback({
            kind: 'success',
            text: t('settings_page.printer.relay_connected', { hostname: s.hostname, count: s.printers.length }),
          });
        } else {
          setFeedback({
            kind: 'error',
            text: t('settings_page.printer.relay_offline', { hostname: s.hostname }),
          });
        }
      }
    } catch (e: any) {
      const msg = e?.message || t('settings_page.printer.station_status_failed');
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
      setFeedback({ kind: 'error', text: t('settings_page.printer.enter_pair_code') });
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
        text: t('settings_page.printer.pair_success', { hostname: s.hostname }),
      });
    } catch (e: any) {
      const msg = e?.message || t('settings_page.printer.pair_failed');
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
    setFeedback({ kind: 'info', text: t('settings_page.printer.unpaired') });
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
      text: t('settings_page.printer.linked_for_silent_print', { name: p.name }),
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
        if (announce) setFeedback({ kind: 'info', text: info.error || t('settings_page.printer.agent_not_running') });
        return;
      }

      try {
        const list = await listAgentPrinters();
        setAgentPrinters(list);
        if (announce) {
          setFeedback({
            kind: 'success',
            text: t('settings_page.printer.agent_connected', { count: list.length }),
          });
        }
      } catch (e: any) {
        setAgentPrinters([]);
        setFeedback({ kind: 'error', text: e?.message || t('settings_page.printer.agent_read_failed') });
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
      text: t('settings_page.printer.linked_for_silent_print', { name: p.name }),
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
              p.type === 'relay'
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
    setFeedback({ kind: 'success', text: t('settings_page.printer.device_linked', { name: d.name }) });
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
              ? t('settings_page.printer.no_device_selected_usb')
              : t('settings_page.printer.no_device_selected'),
        });
      } else if (isPermissionsPolicyError(e)) {
        setFeedback({
          kind: 'error',
          text: t('settings_page.printer.permissions_policy_blocked'),
        });
      } else {
        setFeedback({ kind: 'error', text: e?.message || t('settings_page.printer.link_device_failed') });
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
    if (selected) setFeedback({ kind: 'success', text: t('settings_page.printer.set_default_success', { name: printerDisplayName(selected) }) });
  };

  const handleDeletePrinter = (id: string) => {
    if (id === SYSTEM_PRINTER.id) {
      setFeedback({ kind: 'error', text: t('settings_page.printer.cannot_delete_system') });
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
      setFeedback({ kind: 'error', text: t('settings_page.printer.enter_network_ip') });
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
      setFeedback({ kind: 'info', text: t('settings_page.printer.probing_connection', { ip: newPrinter.ipAddress }) });
      const probe = await probeNetworkPrinter(newPrinter.ipAddress, newPrinter.port || '9100');
      setFeedback(
        probe.ok
          ? { kind: 'success', text: t('settings_page.printer.added_and_reachable', { name: newPrinter.name }) }
          : { kind: 'error', text: t('settings_page.printer.added_but_unreachable', { message: probe.message }) }
      );
      return;
    }

    setFeedback({ kind: 'success', text: t('settings_page.printer.added_to_list', { name: newPrinter.name }) });
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
            text: t('settings_page.printer.no_pairing_on_device'),
          });
          return;
        }

        // نتحقق من حالة المحطة أولاً — رسالة أوضح من فشل غامض بعد الإرسال
        const current = await getStationStatus().catch(() => null);
        if (!current?.online) {
          setFeedback({
            kind: 'error',
            text: t('settings_page.printer.relay_offline_short', {
              hostname:
                current?.hostname ||
                getRelayBinding()?.hostname ||
                t('settings_page.printer.cashier_device'),
            }),
          });
          void refreshRelay();
          return;
        }

        if (!thermal) {
          // ورق عادي A4 لا يقبل أوامر ESC/POS → مربع حوار الطباعة
          const res = await printElementDetailed('print-area', {
            paperSize: printer.size,
            title: t('settings_page.printer.test_print_doc_title', { name: printerDisplayName(printer) }),
            skipRawDevice: true,
          });
          setFeedback({
            kind: res.ok ? 'info' : 'error',
            text: res.ok
              ? t('settings_page.printer.a4_no_escpos')
              : t('settings_page.printer.test_failed', { message: res.message }),
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
          if (!el) throw new Error(t('settings_page.printer.test_template_missing'));
          const canvas = await rasterizeElement(el, printer.size === '58mm' ? 384 : 576);
          await printViaRelay(canvasToEscPosRaster(canvas), {
            target: 'spooler',
            printer: name,
            docName: 'SEEN POS Test Invoice',
          });
        } catch (rasterErr: any) {
          arabicOk = false;
          arabicError = rasterErr?.message || t('orders.unknown_error');
          console.warn('[PrinterSettings] فشل اختبار الفاتورة العربية عبر الوسيط:', rasterErr);
        }

        setFeedback({
          kind: arabicOk ? 'success' : 'info',
          text: arabicOk
            ? t('settings_page.printer.silent_print_ok', { name })
            : t('settings_page.printer.silent_print_partial', { error: arabicError }),
        });
        return;
      }

      /* --- 0ج) الوسيط المحلي القديم (127.0.0.1) --- */
      if (printer.type === 'agent') {
        const info = agent?.online ? agent : await detectPrintAgent();
        if (!info.online) {
          setFeedback({ kind: 'error', text: info.error || t('settings_page.printer.agent_not_running_here') });
          return;
        }

        const name = printer.printerName || printer.name;

        if (!thermal) {
          // ورق عادي A4 لا يقبل أوامر ESC/POS → مربع حوار الطباعة
          const res = await printElementDetailed('print-area', {
            paperSize: printer.size,
            title: t('settings_page.printer.test_print_doc_title', { name: printerDisplayName(printer) }),
            skipRawDevice: true,
          });
          setFeedback({
            kind: res.ok ? 'info' : 'error',
            text: res.ok
              ? t('settings_page.printer.a4_no_escpos')
              : t('settings_page.printer.test_failed', { message: res.message }),
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
          if (!el) throw new Error(t('settings_page.printer.test_template_missing'));
          const canvas = await rasterizeElement(el, printer.size === '58mm' ? 384 : 576);
          await sendRawToAgent(name, canvasToEscPosRaster(canvas), 'SEEN POS Test Invoice');
        } catch (rasterErr: any) {
          arabicOk = false;
          arabicError = rasterErr?.message || t('orders.unknown_error');
          console.warn('[PrinterSettings] فشل اختبار الفاتورة العربية عبر الوسيط:', rasterErr);
        }

        setFeedback({
          kind: arabicOk ? 'success' : 'info',
          text: arabicOk
            ? t('settings_page.printer.silent_print_ok', { name })
            : t('settings_page.printer.silent_print_partial', { error: arabicError }),
        });
        return;
      }

      /* --- 1) طابعة شبكة: نفحص الاتصال قبل إرسال أي بيانات --- */
      if (printer.type === 'network') {
        if (!printer.ipAddress) {
          setFeedback({
            kind: 'error',
            text: t('settings_page.printer.network_missing_ip'),
          });
          return;
        }
        const probe = await probeNetworkPrinter(printer.ipAddress, printer.port || '9100');
        if (!probe.ok) {
          setFeedback({
            kind: 'error',
            text: t('settings_page.printer.network_unreachable', { ip: printer.ipAddress, port: printer.port || 9100, message: probe.message }),
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
          if (!el) throw new Error(t('settings_page.printer.test_template_missing'));
          const canvas = await rasterizeElement(el, printer.size === '58mm' ? 384 : 576);
          await sendRawToPrinter(printer.id, printer.type, canvasToEscPosRaster(canvas), conn);
        } catch (rasterErr: any) {
          arabicOk = false;
          arabicError = rasterErr?.message || t('orders.unknown_error');
          console.warn('[PrinterSettings] فشل اختبار الفاتورة العربية:', rasterErr);
        }

        setFeedback({
          kind: arabicOk ? 'success' : 'info',
          text: arabicOk
            ? t('settings_page.printer.two_receipts_sent', { name: printerDisplayName(printer) })
            : t('settings_page.printer.arabic_receipt_failed', { error: arabicError }),
        });
        return;
      }

      /* --- 3) طابعة النظام أو ورق عادي (A4) → مربع حوار الطباعة --- */
      const res = await printElementDetailed('print-area', {
        paperSize: printer.size,
        title: t('settings_page.printer.test_print_doc_title', { name: printerDisplayName(printer) }),
        skipRawDevice: true,
      });

      if (res.ok) {
        setFeedback({
          kind: 'success',
          text:
            printer.type === 'system'
              ? t('settings_page.printer.dialog_opened')
              : t('settings_page.printer.sent_to_dialog', { method: res.method }),
        });
      } else {
        setFeedback({
          kind: 'error',
          text: t('settings_page.printer.test_failed', { message: res.message }),
        });
      }
    } catch (e: any) {
      console.error('Test print failed:', e);
      setFeedback({
        kind: 'error',
        text: t('settings_page.printer.test_failed', { message: e?.message || t('orders.unknown_error') }),
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

  const TRANSPORT_LABELS: Record<PrinterTransport, string> = {
    system: t('settings_page.printer.transport.system'),
    usb: t('settings_page.printer.transport.usb'),
    serial: t('settings_page.printer.transport.serial'),
    bluetooth: t('settings_page.printer.transport.bluetooth'),
    network: t('settings_page.printer.transport.network'),
    relay: t('settings_page.printer.transport.relay'),
    agent: t('settings_page.printer.transport.agent'),
  };

  const transportLabel = (transport: PrinterTransport) => TRANSPORT_LABELS[transport] ?? transport;

  /* ------------------------------- العرض ------------------------------- */

  // No padding on phones below: Settings already pads the panel, and a third
  // layer of padding was leaving only ~220px of usable width.
  return (
    <div className={cn("max-w-6xl mx-auto p-0 sm:p-6 lg:p-8 space-y-6 sm:space-y-8", isRtl ? "text-right" : "text-left")} dir={isRtl ? "rtl" : "ltr"}>
      {/* منطقة الاختبار المخفية القابلة للطباعة */}
      <div
        id="print-area"
        data-paper={currentTestPrinter?.size || '80mm'}
        className={cn("hidden print:block printable-area text-black bg-white p-4 font-mono text-xs", isRtl ? "text-right" : "text-left")}
        dir={isRtl ? "rtl" : "ltr"}
      >
        <div className="text-center pb-2 border-b border-black mb-3">
          <h2 className="text-base font-bold">{t('settings_page.printer.test_print_title')}</h2>
          <p className="text-[10px]">{t('settings_page.printer.system_name')}</p>
          <p className="text-[10px] mt-1">{new Date().toLocaleString(isRtl ? 'ar-SA-u-nu-latn' : 'en-US')}</p>
        </div>
        <div className="space-y-1 mb-3">
          <p><strong>{t('settings_page.printer.printer_name_label')}</strong> {currentTestPrinter ? printerDisplayName(currentTestPrinter) : t('settings_page.printer.system_default_name')}</p>
          <p><strong>{t('settings_page.printer.paper_size_label')}</strong> {currentTestPrinter?.size || '80mm'}</p>
          <p><strong>{t('settings_page.printer.connection_type_label')}</strong> {currentTestPrinter ? transportLabel(currentTestPrinter.type) : '-'}</p>
        </div>
        <div className="border-t border-b border-black py-2 my-2 text-center font-bold">
          {t('settings_page.printer.test_success')}
        </div>
        <div className="text-center pt-2 text-[10px]">{t('settings_page.printer.thank_you')}</div>
      </div>

      {/* الترويسة */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-surface p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border border-border shadow-xs">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <div className="p-3 sm:p-3.5 bg-brand/10 text-brand rounded-2xl shrink-0">
            <Printer size={24} />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-2xl font-black text-content">{t('settings_page.printer.title')}</h1>
            <p className="text-xs text-content-muted mt-1 font-medium">
              {t('settings_page.printer.subtitle')}
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
            <span>{t('settings_page.printer.refresh')}</span>
          </button>
        </div>
      </div>

      {/* تنبيه المعاينة المضمنة (Iframe) */}
      {isInIframe && (
        <div className={cn("p-5 bg-brand/10 border border-brand/30 rounded-2xl flex items-start gap-3", isRtl ? "text-right" : "text-left")}>
          <Info size={20} className="text-brand shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-black text-brand">{t('settings_page.printer.iframe_notice_title')}</p>
            <p className="text-xs text-content-muted font-medium leading-relaxed">
              {t('settings_page.printer.iframe_notice_body1')}
            </p>
            <p className="text-xs text-content-muted font-medium leading-relaxed">
              {t('settings_page.printer.iframe_notice_body2')}
            </p>
          </div>
        </div>
      )}

      {/* تنبيه دعم المتصفح */}
      {support && !support.anyDiscovery && (
        <div className="p-5 bg-amber-500/10 border border-amber-500/40 rounded-2xl flex items-start gap-3">
          <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-black text-content">{t('settings_page.printer.no_direct_hardware_title')}</p>
            <p className="text-xs text-content-muted font-medium leading-relaxed">{support.reason}</p>
            <p className="text-xs text-content-muted font-medium leading-relaxed">
              {t('settings_page.printer.no_direct_hardware_fallback')}
            </p>
          </div>
        </div>
      )}

      {/* أزرار الربط الحقيقي */}
      <div className="bg-surface p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border border-border shadow-xs space-y-4">
        <div className="flex items-center gap-2">
          <Search size={20} className="text-brand" />
          <h3 className="text-base font-black text-content">{t('settings_page.printer.link_real_printer')}</h3>
        </div>
        <p className="text-xs text-content-muted font-medium leading-relaxed">
          {t('settings_page.printer.link_real_printer_hint')}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <ConnectButton
            icon={Usb}
            label={t('settings_page.printer.connect_usb')}
            hint={t('settings_page.printer.connect_usb_hint')}
            disabled={!support?.usb}
            loading={scanning === 'usb'}
            onClick={() => void handleConnect('usb')}
          />
          <ConnectButton
            icon={Search}
            label={t('settings_page.printer.connect_usb_any')}
            hint={t('settings_page.printer.connect_usb_any_hint')}
            disabled={!support?.usb}
            loading={false}
            onClick={() => void handleConnect('usb-any')}
          />
          <ConnectButton
            icon={Cable}
            label={t('settings_page.printer.connect_serial')}
            hint={t('settings_page.printer.connect_serial_hint')}
            disabled={!support?.serial}
            loading={scanning === 'serial'}
            onClick={() => void handleConnect('serial')}
          />
          <ConnectButton
            icon={Bluetooth}
            label={t('settings_page.printer.connect_bluetooth')}
            hint={t('settings_page.printer.connect_bluetooth_hint')}
            disabled={!support?.bluetooth}
            loading={scanning === 'bluetooth'}
            onClick={() => void handleConnect('bluetooth')}
          />
        </div>

        <div className="flex items-start gap-2 pt-2 border-t border-border text-[11px] text-content-muted font-medium leading-relaxed">
          <Info size={14} className="shrink-0 mt-0.5" />
          <span>{t('settings_page.printer.empty_browser_dialog_hint')}</span>
        </div>
      </div>

      {/* بطاقة الطابعة النشطة */}
      {activePrinter && (
        <div
          className={cn(
            'p-6 sm:p-8 rounded-[2.5rem] border-2 transition-all space-y-4 shadow-lg relative overflow-hidden',
            isRtl ? 'text-right' : 'text-left',
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
                  <span className="text-xs font-bold text-content-muted">{t('settings_page.printer.default_printer_label')}</span>
                  <h3 className="text-lg font-black text-content bg-surface px-3 py-1 rounded-xl border border-border shadow-xs">
                    {printerDisplayName(activePrinter)}
                  </h3>
                  <span
                    className={cn(
                      'text-[11px] font-black px-3 py-1 rounded-full flex items-center gap-1.5 shadow-xs text-white',
                      activePrinter.status === 'online' ? 'bg-emerald-600' : 'bg-amber-600'
                    )}
                  >
                    <span className="w-2 h-2 rounded-full bg-white" />
                    {activePrinter.status === 'online' ? t('settings_page.printer.status_ready') : t('settings_page.printer.status_offline')}
                  </span>
                  {activePrinter.isRealDevice && (
                    <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-brand text-white">
                      {t('settings_page.printer.directly_linked_device')}
                    </span>
                  )}
                </div>

                <p className="text-xs text-content-muted font-medium">
                  {t('settings_page.printer.paper_size_label')} <strong className="text-content">{activePrinter.size}</strong> | {t('settings_page.printer.connection_label')}{' '}
                  <strong className="text-content">{transportLabel(activePrinter.type)}</strong>
                  {activePrinter.ipAddress && ` | IP: ${activePrinter.ipAddress}`}
                </p>

                {activePrinter.status === 'offline' && (
                  <p className="text-xs text-amber-700 dark:text-amber-300 font-bold">
                    {t('settings_page.printer.device_unpaired_hint')}
                  </p>
                )}
                {activePrinter.type === 'system' && (
                  <p className="text-xs text-content-muted font-medium">
                    {t('settings_page.printer.system_printer_hint')}
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
                <span>{busyId === activePrinter.id ? t('settings_page.printer.testing') : t('settings_page.printer.print_test_invoice')}</span>
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
          <h3 className="text-base font-black text-content">{t('settings_page.printer.printers_heading', { count: printers.length })}</h3>
          <span className="text-xs text-content-muted font-bold">
            {realCount > 0
              ? t('settings_page.printer.directly_linked_count', { count: realCount })
              : t('settings_page.printer.no_directly_linked_yet')}
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
                    <h4 className="font-black text-sm text-content truncate">{printerDisplayName(p)}</h4>
                    {p.isDefault && (
                      <span className="text-[10px] bg-brand text-white font-black px-2 py-0.5 rounded-full">{t('settings_page.printer.badge_default')}</span>
                    )}
                    <span
                      className={cn(
                        'text-[10px] font-black px-2 py-0.5 rounded-full',
                        p.status === 'online' ? 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-400' : 'bg-amber-600/15 text-amber-700 dark:text-amber-400'
                      )}
                    >
                      {p.status === 'online' ? t('settings_page.printer.status_connected') : t('settings_page.printer.status_offline')}
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
                    {t('settings_page.printer.set_as_default')}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => void handleTestPrint(p)}
                  disabled={busyId === p.id}
                  className="px-3.5 py-2 bg-emerald-600/10 text-emerald-700 hover:bg-emerald-600 hover:text-white rounded-xl text-xs font-black transition-all disabled:opacity-50 flex items-center gap-1.5"
                >
                  {busyId === p.id && <Loader2 size={13} className="animate-spin" />}
                  <span>{t('settings_page.printer.test')}</span>
                </button>

                {p.id !== SYSTEM_PRINTER.id && (
                  <button
                    type="button"
                    onClick={() => handleDeletePrinter(p.id)}
                    className="p-2 text-danger hover:bg-danger/10 rounded-xl transition-all"
                    title={t('common.delete')}
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
          title={t('settings_page.printer.auto_print_title')}
          desc={t('settings_page.printer.auto_print_desc')}
          value={autoPrint}
          onChange={(v) => {
            setAutoPrint(v);
            localStorage.setItem('pos_auto_print', String(v));
          }}
        />
        <ToggleCard
          icon={Zap}
          title={t('settings_page.printer.fast_thermal_title')}
          desc={t('settings_page.printer.fast_thermal_desc')}
          value={fastThermalMode}
          onChange={(v) => {
            setFastThermalMode(v);
            localStorage.setItem('pos_fast_thermal_mode', String(v));
          }}
        />
      </div>

      {/* إرشادات حل المشاكل */}
      <div className="bg-surface p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border border-border shadow-xs space-y-4">
        <button
          type="button"
          onClick={() => setShowHelpGuide(!showHelpGuide)}
          className={cn("w-full flex items-center justify-between", isRtl ? "text-right" : "text-left")}
        >
          <div className="flex items-center gap-2">
            <Wrench size={20} className="text-brand" />
            <h3 className="text-base font-black text-content">{t('settings_page.printer.help_heading')}</h3>
          </div>
          <span className="text-xs text-brand font-black">{showHelpGuide ? t('settings_page.printer.hide') : t('settings_page.printer.show_details')}</span>
        </button>

        {showHelpGuide && (
          <div className="pt-3 border-t border-border space-y-3 text-xs text-content-muted leading-relaxed font-medium">
            <p>
              <strong className="text-content">{t('settings_page.printer.help_q1_title')}</strong> {t('settings_page.printer.help_q1_body')}
            </p>
            <p>
              <strong className="text-content">{t('settings_page.printer.help_q2_title')}</strong> {t('settings_page.printer.help_q2_body')}
            </p>
            <p>
              <strong className="text-content">{t('settings_page.printer.help_q3_title')}</strong> {t('settings_page.printer.help_q3_body')}
            </p>
            <p>
              <strong className="text-content">{t('settings_page.printer.help_q4_title')}</strong> {t('settings_page.printer.help_q4_body')}
            </p>
            <p>
              <strong className="text-content">{t('settings_page.printer.help_q5_title')}</strong> {t('settings_page.printer.help_q5_body')}
            </p>
          </div>
        )}
      </div>


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
  const { t, i18n } = useTranslation();
  const isRtl = isRtlLang(i18n.language);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      title={disabled ? t('settings_page.printer.unsupported_in_browser') : undefined}
      className={cn(
        'p-4 border rounded-2xl transition-all space-1.5 group',
        isRtl ? 'text-right' : 'text-left',
        'space-y-1.5',
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
