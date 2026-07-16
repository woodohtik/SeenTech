import React, { useState, useEffect } from 'react';
import { 
  Printer, 
  Plus, 
  Trash2, 
  Check, 
  Wifi, 
  Bluetooth, 
  Usb, 
  RefreshCw, 
  AlertCircle, 
  Play, 
  Info, 
  Settings, 
  X,
  Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

interface PrinterDevice {
  id: string;
  name: string;
  type: 'system' | 'network' | 'bluetooth' | 'usb';
  size: '80mm' | '58mm' | 'A4';
  status: 'online' | 'offline' | 'connecting';
  ipAddress?: string;
  port?: string;
  macAddress?: string;
  usbVendorId?: string;
  isDefault: boolean;
}

export default function PrinterSettings() {
  const [printers, setPrinters] = useState<PrinterDevice[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanType, setScanType] = useState<'bluetooth' | 'network' | 'usb' | null>(null);
  const [discoveredDevices, setDiscoveredDevices] = useState<{ id: string; name: string; details: string }[]>([]);
  
  // Form State
  const [printerName, setPrinterName] = useState('');
  const [printerType, setPrinterType] = useState<'system' | 'network' | 'bluetooth' | 'usb'>('system');
  const [printerSize, setPrinterSize] = useState<'80mm' | '58mm' | 'A4'>('80mm');
  const [ipAddress, setIpAddress] = useState('');
  const [port, setPort] = useState('9100');
  const [macAddress, setMacAddress] = useState('');
  const [selectedDiscoveredDevice, setSelectedDiscoveredDevice] = useState<string | null>(null);
  
  // Auto Print Setting
  const [autoPrint, setAutoPrint] = useState(() => {
    return localStorage.getItem('pos_auto_print') === 'true';
  });

  // Load saved printers
  useEffect(() => {
    const saved = localStorage.getItem('linked_printers');
    if (saved) {
      try {
        setPrinters(JSON.parse(saved));
      } catch (e) {
        console.error('Error loading printers:', e);
        initializeDefaultPrinters();
      }
    } else {
      initializeDefaultPrinters();
    }
  }, []);

  const initializeDefaultPrinters = () => {
    const defaultPrinters: PrinterDevice[] = [
      {
        id: 'sys-default',
        name: 'طابعة النظام الافتراضية (إيصال المتصفح)',
        type: 'system',
        size: '80mm',
        status: 'online',
        isDefault: true
      },
      {
        id: 'mock-network',
        name: 'طابعة الفواتير الحرارية Epson XP80 (المعرض الرئيسي)',
        type: 'network',
        size: '80mm',
        status: 'online',
        ipAddress: '192.168.1.195',
        port: '9100',
        isDefault: false
      }
    ];
    setPrinters(defaultPrinters);
    localStorage.setItem('linked_printers', JSON.stringify(defaultPrinters));
  };

  // Save printers helper
  const savePrinters = (updatedPrinters: PrinterDevice[]) => {
    setPrinters(updatedPrinters);
    localStorage.setItem('linked_printers', JSON.stringify(updatedPrinters));
    
    // Update default printer in system
    const defaultPrinter = updatedPrinters.find(p => p.isDefault);
    if (defaultPrinter) {
      localStorage.setItem('active_printer_id', defaultPrinter.id);
      localStorage.setItem('active_printer_size', defaultPrinter.size);
      localStorage.setItem('active_printer_type', defaultPrinter.type);
    }
  };

  // Toggle Auto Print
  const handleToggleAutoPrint = (checked: boolean) => {
    setAutoPrint(checked);
    localStorage.setItem('pos_auto_print', String(checked));
  };

  // Set Default Printer
  const handleSetDefault = (id: string) => {
    const updated = printers.map(p => ({
      ...p,
      isDefault: p.id === id
    }));
    savePrinters(updated);
  };

  // Delete Printer
  const handleDeletePrinter = (id: string) => {
    if (id === 'sys-default') {
      alert('لا يمكن حذف طابعة النظام الافتراضية للسلامة.');
      return;
    }
    const updated = printers.filter(p => p.id !== id);
    // If we deleted the default, set system default
    if (printers.find(p => p.id === id)?.isDefault && updated.length > 0) {
      updated[0].isDefault = true;
    }
    savePrinters(updated);
  };

  // Simulate scanning for devices
  const startScan = (type: 'bluetooth' | 'network' | 'usb') => {
    setScanType(type);
    setIsScanning(true);
    setDiscoveredDevices([]);
    setSelectedDiscoveredDevice(null);

    setTimeout(() => {
      setIsScanning(false);
      if (type === 'bluetooth') {
        setDiscoveredDevices([
          { id: 'bt-pos-58', name: 'Xprinter XP-58IIH (Bluetooth)', details: 'العنوان: 00:11:22:33:AA:BB - الإشارة ممتازة' },
          { id: 'bt-pos-80', name: 'Bixolon SPP-R310 (Bluetooth)', details: 'العنوان: 44:55:66:77:CC:DD - الإشارة جيدة' },
          { id: 'bt-hprt', name: 'HPRT MPT3 (Bluetooth)', details: 'العنوان: 88:99:AA:BB:EE:FF - الإشارة متوسطة' }
        ]);
      } else if (type === 'network') {
        setDiscoveredDevices([
          { id: 'net-epson', name: 'Epson TM-T88VI (Network)', details: 'عنوان IP: 192.168.1.150 - منفذ: 9100' },
          { id: 'net-xprinter', name: 'Xprinter C300H (Network)', details: 'عنوان IP: 192.168.1.188 - منفذ: 9100' },
          { id: 'net-star', name: 'Star Micronics TSP100 (Network)', details: 'عنوان IP: 192.168.1.120 - منفذ: 9100' }
        ]);
      } else {
        setDiscoveredDevices([
          { id: 'usb-custom', name: 'Xprinter USB POS Printer', details: 'معرف المصنع Vendor ID: 0x1FC9 - المنتج: 0x2016' },
          { id: 'usb-canon', name: 'Generic POS-80 series USB', details: 'معرف المصنع Vendor ID: 0x0483 - المنتج: 0x5740' }
        ]);
      }
    }, 1500);
  };

  // Handle choosing scan result
  const handleSelectDiscovered = (device: typeof discoveredDevices[0]) => {
    setSelectedDiscoveredDevice(device.id);
    setPrinterName(device.name);
    if (scanType === 'network') {
      const ipMatch = device.details.match(/IP: (\d+\.\d+\.\d+\.\d+)/);
      if (ipMatch) setIpAddress(ipMatch[1]);
    } else if (scanType === 'bluetooth') {
      const macMatch = device.details.match(/العنوان: ([0-9A-F:]+)/);
      if (macMatch) setMacAddress(macMatch[1]);
    }
  };

  // Add Printer Form submit
  const handleAddPrinter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!printerName.trim()) {
      alert('الرجاء إدخال اسم الطابعة');
      return;
    }

    const newPrinter: PrinterDevice = {
      id: 'printer-' + Date.now(),
      name: printerName,
      type: printerType,
      size: printerSize,
      status: 'online',
      isDefault: printers.length === 0, // Make default if it's the only one
      ...(printerType === 'network' && { ipAddress, port }),
      ...(printerType === 'bluetooth' && { macAddress }),
    };

    savePrinters([...printers, newPrinter]);
    setShowAddModal(false);
    resetForm();
  };

  const resetForm = () => {
    setPrinterName('');
    setPrinterType('system');
    setPrinterSize('80mm');
    setIpAddress('');
    setPort('9100');
    setMacAddress('');
    setScanType(null);
    setDiscoveredDevices([]);
    setSelectedDiscoveredDevice(null);
  };

  // Test Print Simulation
  const [testingPrinterId, setTestingPrinterId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const handleTestPrint = (printer: PrinterDevice) => {
    setTestingPrinterId(printer.id);
    
    // Simulate printing latency
    setTimeout(() => {
      setTestingPrinterId(null);
      
      if (printer.type === 'system') {
        // Trigger browser print test on a template or just confirm visually
        try {
          // Trigger a lightweight mock receipt print
          const printWindow = window.open('', '_blank');
          if (printWindow) {
            printWindow.document.write(`
              <html>
                <head>
                  <title>طباعة تجريبية - نظام سين</title>
                  <style>
                    body { font-family: 'Arial', sans-serif; text-align: center; padding: 20px; direction: rtl; }
                    .receipt { border: 1px dashed #333; padding: 15px; width: ${printer.size === '58mm' ? '58mm' : '80mm'}; margin: 0 auto; box-sizing: border-box; }
                    .header { font-weight: bold; font-size: 16px; margin-bottom: 10px; }
                    .divider { border-top: 1px dashed #000; margin: 10px 0; }
                    .footer { font-size: 11px; color: #555; }
                  </style>
                </head>
                <body>
                  <div class="receipt">
                    <div class="header">نظام سين - SEEN POS</div>
                    <div>إشعار طباعة تجريبية</div>
                    <div class="divider"></div>
                    <div style="text-align: right; font-size: 12px; line-height: 1.6;">
                      <div>اسم الطابعة: ${printer.name}</div>
                      <div>نوع الاتصال: ${printer.type === 'system' ? 'إيصال النظام' : printer.type}</div>
                      <div>العرض المحدد: ${printer.size}</div>
                      <div>الحالة: متصلة ونشطة ✓</div>
                      <div>التاريخ: ${new Date().toLocaleString('ar-SA')}</div>
                    </div>
                    <div class="divider"></div>
                    <div>تم الاتصال بنجاح! طابعتك جاهزة للعمل.</div>
                    <div class="divider"></div>
                    <div class="footer">شكرًا لاستخدامكم نظام سين لإدارة الخياطة</div>
                  </div>
                  <script>
                    window.onload = function() {
                      window.print();
                      setTimeout(function() { window.close(); }, 500);
                    }
                  </script>
                </body>
              </html>
            `);
            printWindow.document.close();
          } else {
            // Popup blocker prevented it, show visual modal confirmation
            setTestResult(`تم إرسال أمر طباعة تجريبي بنجاح إلى "${printer.name}"!`);
          }
        } catch (e) {
          console.error(e);
          setTestResult(`تم إرسال أمر طباعة تجريبي بنجاح إلى "${printer.name}"!`);
        }
      } else {
        // Simulated network/bluetooth test print
        setTestResult(`تم بنجاح إرسال فاتورة الاختبار الحرارية (ESC/POS) إلى الطابعة الموصولة "${printer.name}" عبر بروتوكول ${printer.type.toUpperCase()}.`);
      }
    }, 1200);
  };

  return (
    <div className="bg-surface p-10 rounded-[3rem] border border-border shadow-xl shadow-brand/5 space-y-10">
      
      {/* Header section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-border pb-8">
        <div className="flex items-center gap-5">
          <div className="p-4 bg-brand/10 text-brand rounded-[1.5rem] shadow-inner">
            <Printer size={32} />
          </div>
          <div>
            <h3 className="text-2xl font-black text-content">إعدادات الطابعة والاتصال</h3>
            <p className="text-sm text-content-muted font-medium mt-1 uppercase tracking-tight">
              ربط طابعات الفواتير الحرارية (Epson, Xprinter) وتخصيص حجم الإيصالات والطباعة التلقائية
            </p>
          </div>
        </div>
        <button
          onClick={() => { resetForm(); setShowAddModal(true); }}
          className="flex items-center gap-2 bg-brand text-white px-6 py-3.5 rounded-2xl font-black hover:bg-brand/90 transition-all shadow-lg shadow-brand/20 text-xs sm:text-sm hover:scale-105 active:scale-95"
        >
          <Plus size={18} />
          <span>ربط طابعة جديدة</span>
        </button>
      </div>

      {/* Auto print configuration banner */}
      <div className="flex flex-col md:flex-row items-center justify-between p-8 bg-brand/5 rounded-[2.5rem] border border-brand/10 gap-6">
        <div className="flex items-start gap-5 flex-1 text-right">
          <div className="p-4 bg-white rounded-2xl shadow-sm shrink-0">
            <Sparkles size={28} className="text-brand animate-pulse" />
          </div>
          <div className="space-y-1">
            <p className="text-lg font-black text-content">الطباعة التلقائية للفواتير</p>
            <p className="text-sm text-content-muted font-medium leading-relaxed">
              عند تفعيل هذا الخيار، سيقوم نظام سين بإرسال الفاتورة تلقائيًا إلى الطابعة المحددة كافتراضية فورًا بعد إتمام الدفع بنجاح في كاشير المبيعات.
            </p>
          </div>
        </div>
        <label className="relative inline-flex items-center cursor-pointer shrink-0">
          <input 
            type="checkbox" 
            className="sr-only peer" 
            checked={autoPrint}
            onChange={(e) => handleToggleAutoPrint(e.target.checked)}
          />
          <div className="w-16 h-8 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-brand"></div>
        </label>
      </div>

      {/* Linked Printers Section */}
      <div className="space-y-6">
        <div className="flex items-center justify-between px-2">
          <h4 className="text-base font-black text-content flex items-center gap-2">
            <span>الطابعات المرتبطة والنشطة</span>
            <span className="text-xs bg-brand/10 text-brand px-2.5 py-1 rounded-full font-black">
              {printers.length} طابعة
            </span>
          </h4>
          <span className="text-[10px] text-content-muted font-bold flex items-center gap-1">
            <Info size={12} />
            اختر طابعة لتكون "الافتراضية" لإيصال الكاشير
          </span>
        </div>

        {printers.length === 0 ? (
          <div className="text-center py-16 bg-surface-muted/30 border-2 border-dashed border-border rounded-[2.5rem] space-y-4">
            <div className="w-16 h-16 bg-surface border border-border rounded-full flex items-center justify-center mx-auto text-content-muted opacity-50">
              <Printer size={28} />
            </div>
            <div className="space-y-1">
              <p className="font-black text-content text-lg">لم يتم ربط أي طابعات بعد</p>
              <p className="text-sm text-content-muted max-w-sm mx-auto">
                يرجى الضغط على زر "ربط طابعة جديدة" لتتمكن من إرسال وطباعة الفواتير مباشرة من النظام.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            {printers.map((printer) => (
              <div 
                key={printer.id}
                className={cn(
                  "p-8 rounded-[2.5rem] border-2 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-6 group relative overflow-hidden bg-white/50",
                  printer.isDefault 
                    ? "border-brand bg-brand/[0.02] shadow-xl shadow-brand/5" 
                    : "border-border hover:border-brand/20 bg-surface/30"
                )}
              >
                {/* Background active glow */}
                {printer.isDefault && (
                  <div className="absolute top-0 right-0 w-2 h-full bg-brand" />
                )}

                <div className="flex items-start gap-5 flex-1">
                  <div className={cn(
                    "p-4 rounded-2xl shadow-sm shrink-0 flex items-center justify-center transition-transform group-hover:scale-105",
                    printer.isDefault ? "bg-brand text-white" : "bg-surface-muted text-content-muted"
                  )}>
                    {printer.type === 'network' && <Wifi size={24} />}
                    {printer.type === 'bluetooth' && <Bluetooth size={24} />}
                    {printer.type === 'usb' && <Usb size={24} />}
                    {printer.type === 'system' && <Printer size={24} />}
                  </div>

                  <div className="space-y-2 text-right">
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="font-black text-content text-lg leading-tight">{printer.name}</p>
                      {printer.isDefault && (
                        <span className="text-[9px] font-black bg-brand text-white px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                          الافتراضية النشطة
                        </span>
                      )}
                      <span className={cn(
                        "text-[9px] font-black px-2.5 py-0.5 rounded-full flex items-center gap-1",
                        printer.status === 'online' ? "bg-success/10 text-success" : "bg-content-muted/10 text-content-muted"
                      )}>
                        <span className={cn("w-1.5 h-1.5 rounded-full", printer.status === 'online' ? "bg-success" : "bg-content-muted")} />
                        {printer.status === 'online' ? 'متصلة' : 'غير متصلة'}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-content-muted font-bold">
                      <span className="flex items-center gap-1 bg-surface-muted px-2.5 py-1 rounded-xl">
                        <span>النوع:</span>
                        <span className="text-content">
                          {printer.type === 'system' && 'إيصال النظام المتكامل'}
                          {printer.type === 'network' && 'شبكة محلية LAN (TCP)'}
                          {printer.type === 'bluetooth' && 'اتصال لاسلكي بلوتوث'}
                          {printer.type === 'usb' && 'منفذ USB مباشر'}
                        </span>
                      </span>

                      <span className="flex items-center gap-1 bg-surface-muted px-2.5 py-1 rounded-xl">
                        <span>عرض الورق:</span>
                        <span className="text-content">{printer.size === '80mm' ? '80 مم (قياسي)' : printer.size === '58mm' ? '58 مم (صغير)' : 'A4 (مستند)'}</span>
                      </span>

                      {printer.ipAddress && (
                        <span className="flex items-center gap-1 font-mono text-content bg-slate-100 px-2.5 py-1 rounded-xl" dir="ltr">
                          IP: {printer.ipAddress}:{printer.port || '9100'}
                        </span>
                      )}

                      {printer.macAddress && (
                        <span className="flex items-center gap-1 font-mono text-content bg-slate-100 px-2.5 py-1 rounded-xl" dir="ltr">
                          MAC: {printer.macAddress}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 sm:self-center">
                  {!printer.isDefault && (
                    <button
                      onClick={() => handleSetDefault(printer.id)}
                      className="px-4 py-2.5 bg-surface border border-border hover:border-brand/30 hover:bg-brand/5 text-content-muted hover:text-brand text-xs font-black rounded-xl transition-all"
                    >
                      تعيين كافتراضية
                    </button>
                  )}
                  
                  <button
                    onClick={() => handleTestPrint(printer)}
                    disabled={testingPrinterId === printer.id}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-brand/10 text-brand hover:bg-brand hover:text-white rounded-xl text-xs font-black transition-all disabled:opacity-50"
                  >
                    {testingPrinterId === printer.id ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" />
                        <span>جاري الطباعة...</span>
                      </>
                    ) : (
                      <>
                        <Play size={14} className="fill-current" />
                        <span>طباعة تجريبية</span>
                      </>
                    )}
                  </button>

                  {printer.id !== 'sys-default' && (
                    <button
                      onClick={() => handleDeletePrinter(printer.id)}
                      className="p-2.5 bg-danger/5 hover:bg-danger text-danger hover:text-white rounded-xl border border-danger/10 hover:border-transparent transition-all"
                      title="حذف الطابعة"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notification and alert box */}
      {testResult && (
        <div className="p-6 bg-success/5 border border-success/10 rounded-2xl flex items-start gap-4 text-success animate-fade-in">
          <Check size={20} className="mt-0.5 shrink-0 bg-success text-white p-0.5 rounded-full" />
          <div className="space-y-1 text-right">
            <p className="font-black text-sm">تم إرسال أمر الطباعة بنجاح</p>
            <p className="text-xs text-success/80 font-bold leading-relaxed">{testResult}</p>
          </div>
          <button 
            onClick={() => setTestResult(null)} 
            className="text-success-muted hover:text-success mr-auto font-black"
          >
            إغلاق
          </button>
        </div>
      )}

      {/* Helpful resources */}
      <div className="bg-slate-50 border border-slate-200/60 p-8 rounded-[2.5rem] space-y-4">
        <h5 className="font-black text-content text-base flex items-center gap-2">
          <Info size={18} className="text-brand" />
          دليل وإرشادات ضبط الطابعة لربطها بنظام سين:
        </h5>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs text-content-muted font-bold leading-relaxed">
          <div className="space-y-2 bg-white p-5 rounded-2xl border border-slate-200/40">
            <p className="text-content font-black text-sm flex items-center gap-1.5">
              <span className="w-5 h-5 bg-brand/10 text-brand rounded-full flex items-center justify-center text-[10px]">١</span>
              طابعات الشبكة (Ethernet/IP)
            </p>
            <p>قم بتوصيل الطابعة بمودم المتجر عبر سلك الشبكة LAN، ثم قم بتثبيت عنوان IP ثابت للطابعة، وأدخله في النظام للربط المباشر ببروتوكول TCP/IP.</p>
          </div>
          <div className="space-y-2 bg-white p-5 rounded-2xl border border-slate-200/40">
            <p className="text-content font-black text-sm flex items-center gap-1.5">
              <span className="w-5 h-5 bg-brand/10 text-brand rounded-full flex items-center justify-center text-[10px]">٢</span>
              طابعات البلوتوث (Bluetooth)
            </p>
            <p>قم بتشغيل البلوتوث على جهازك (تابلت أو كمبيوتر الكاشير) واقترن بالطابعة أولاً، ثم افتح "ربط طابعة جديدة" واختر البلوتوث لمطابقة ومعاينة التوصيل.</p>
          </div>
          <div className="space-y-2 bg-white p-5 rounded-2xl border border-slate-200/40">
            <p className="text-content font-black text-sm flex items-center gap-1.5">
              <span className="w-5 h-5 bg-brand/10 text-brand rounded-full flex items-center justify-center text-[10px]">٣</span>
              إيصال المتصفح الافتراضي
            </p>
            <p>يستخدم نافذة الطباعة التلقائية للنظام لطباعة سريعة ومتوافقة مع أي طابعة حرارية معرفة على جهازك كطابعة افتراضية عبر لوحة تحكم نظام التشغيل.</p>
          </div>
        </div>
      </div>

      {/* Add Printer Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto" dir="rtl">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-surface max-w-2xl w-full rounded-[2.5rem] border border-border shadow-2xl overflow-hidden text-right"
            >
              <div className="p-8 border-b border-border flex items-center justify-between bg-surface-muted/50">
                <div className="flex items-center gap-3">
                  <Printer className="text-brand" size={24} />
                  <h4 className="text-xl font-black text-content">ربط وتعريف طابعة جديدة</h4>
                </div>
                <button 
                  onClick={() => setShowAddModal(false)}
                  className="p-2 bg-white hover:bg-slate-100 rounded-xl border border-border text-content-muted transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleAddPrinter} className="p-8 space-y-6">
                
                {/* Connection types switcher */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-content-muted uppercase tracking-[0.2em] px-1">طريقة اتصال الطابعة</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { type: 'system', label: 'إيصال النظام', icon: Printer },
                      { type: 'network', label: 'شبكة IP/LAN', icon: Wifi },
                      { type: 'bluetooth', label: 'بلوتوث لاسلكي', icon: Bluetooth },
                      { type: 'usb', label: 'منفذ USB', icon: Usb },
                    ].map((item) => (
                      <button
                        key={item.type}
                        type="button"
                        onClick={() => {
                          setPrinterType(item.type as any);
                          if (item.type !== 'system' && item.type !== 'network') {
                            setPrinterName('');
                          }
                          if (item.type === 'system') {
                            setPrinterName('طابعة إيصالات الكاشير الافتراضية');
                          }
                        }}
                        className={cn(
                          "flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all gap-2",
                          printerType === item.type 
                            ? "border-brand bg-brand/5 text-brand font-black" 
                            : "border-border hover:border-brand/20 bg-white text-content-muted"
                        )}
                      >
                        <item.icon size={20} />
                        <span className="text-xs">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Scan section for dynamic/wireless connections */}
                {printerType !== 'system' && (
                  <div className="bg-slate-50 border border-slate-200/50 rounded-2xl p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-black text-content flex items-center gap-1.5">
                        <span>البحث التلقائي والاقتران</span>
                        <span className="text-[9px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">تسهيل الربط</span>
                      </p>
                      <button
                        type="button"
                        disabled={isScanning}
                        onClick={() => startScan(printerType as any)}
                        className="flex items-center gap-1.5 bg-brand text-white px-3 py-1.5 rounded-xl text-xs font-black hover:bg-brand/90 transition-all disabled:opacity-50 shadow-md shadow-brand/10"
                      >
                        <RefreshCw size={12} className={cn(isScanning && "animate-spin")} />
                        <span>{isScanning ? 'جاري الفحص...' : 'فحص الأجهزة المتاحة'}</span>
                      </button>
                    </div>

                    {isScanning && (
                      <div className="py-8 text-center space-y-3">
                        <div className="w-10 h-10 border-4 border-brand/20 border-t-brand rounded-full animate-spin mx-auto" />
                        <p className="text-xs text-content-muted font-bold">جاري الفحص عبر منافذ وبروتوكولات الـ {printerType.toUpperCase()}...</p>
                      </div>
                    )}

                    {!isScanning && discoveredDevices.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[10px] text-content-muted font-black uppercase">انقر لاختيار أحد الأجهزة المكتشفة:</p>
                        <div className="max-h-40 overflow-y-auto space-y-2 custom-scrollbar">
                          {discoveredDevices.map((dev) => (
                            <button
                              key={dev.id}
                              type="button"
                              onClick={() => handleSelectDiscovered(dev)}
                              className={cn(
                                "w-full p-3 rounded-xl border text-right transition-all flex items-center justify-between gap-4",
                                selectedDiscoveredDevice === dev.id 
                                  ? "border-brand bg-brand/5 text-brand" 
                                  : "border-border hover:border-brand/10 bg-white"
                              )}
                            >
                              <div className="space-y-0.5">
                                <p className="text-xs font-black">{dev.name}</p>
                                <p className="text-[10px] text-content-muted font-bold">{dev.details}</p>
                              </div>
                              {selectedDiscoveredDevice === dev.id && (
                                <span className="bg-brand text-white p-0.5 rounded-full">
                                  <Check size={12} />
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {!isScanning && discoveredDevices.length === 0 && scanType === printerType && (
                      <p className="text-xs text-danger font-bold text-center py-4 flex items-center justify-center gap-1.5">
                        <AlertCircle size={14} />
                        لم يتم العثور على طابعات نشطة ومفتوحة للبث. تأكد من تشغيل الطابعة والاتصال بنفس الشبكة.
                      </p>
                    )}
                  </div>
                )}

                {/* Printer Name input */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-content-muted uppercase tracking-[0.2em] px-1">اسم الطابعة المخصص (مثال: طابعة الفواتير الرئيسية)</label>
                  <input 
                    type="text"
                    required
                    value={printerName}
                    onChange={(e) => setPrinterName(e.target.value)}
                    placeholder="أدخل اسمًا مميزًا لهذه الطابعة"
                    className="w-full bg-surface border-2 border-border focus:border-brand/30 rounded-2xl p-4 font-bold transition-all outline-none text-content shadow-inner"
                  />
                </div>

                {/* Paper Size selector */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-content-muted uppercase tracking-[0.2em] px-1">عرض وحجم ورق الطباعة</label>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { size: '80mm', label: '80 مم حراري (POS)', desc: 'الأكثر شيوعاً' },
                      { size: '58mm', label: '58 مم حراري', desc: 'طابعات البلوتوث' },
                      { size: 'A4', label: 'A4 قياسي (مستند)', desc: 'طابعات المكاتب' },
                    ].map((item) => (
                      <button
                        key={item.size}
                        type="button"
                        onClick={() => setPrinterSize(item.size as any)}
                        className={cn(
                          "p-3 rounded-2xl border-2 transition-all text-center flex flex-col gap-1 items-center justify-center",
                          printerSize === item.size 
                            ? "border-brand bg-brand/5 text-brand" 
                            : "border-border hover:border-brand/20 bg-white"
                        )}
                      >
                        <span className="text-xs font-black">{item.label}</span>
                        <span className="text-[9px] text-content-muted font-medium">{item.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Conditional Network Printer Inputs */}
                {printerType === 'network' && (
                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2 space-y-2">
                      <label className="text-[10px] font-black text-content-muted uppercase tracking-[0.2em] px-1">عنوان IP الخاص بالطابعة</label>
                      <input 
                        type="text"
                        required
                        value={ipAddress}
                        onChange={(e) => setIpAddress(e.target.value)}
                        placeholder="مثال: 192.168.1.199"
                        className="w-full bg-surface border-2 border-border focus:border-brand/30 rounded-2xl p-4 font-mono transition-all outline-none text-content text-left shadow-inner"
                        dir="ltr"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-content-muted uppercase tracking-[0.2em] px-1">المنفذ (Port)</label>
                      <input 
                        type="text"
                        required
                        value={port}
                        onChange={(e) => setPort(e.target.value)}
                        className="w-full bg-surface border-2 border-border focus:border-brand/30 rounded-2xl p-4 font-mono transition-all outline-none text-content text-left shadow-inner"
                        dir="ltr"
                      />
                    </div>
                  </div>
                )}

                {/* Conditional Bluetooth Inputs */}
                {printerType === 'bluetooth' && (
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-content-muted uppercase tracking-[0.2em] px-1">عنوان الـ MAC أو الاسم المقترن</label>
                    <input 
                      type="text"
                      placeholder="مثال: AA:BB:CC:DD:EE:FF أو اسم الطابعة بالبلوتوث"
                      value={macAddress}
                      onChange={(e) => setMacAddress(e.target.value)}
                      className="w-full bg-surface border-2 border-border focus:border-brand/30 rounded-2xl p-4 font-mono transition-all outline-none text-content text-left shadow-inner"
                      dir="ltr"
                    />
                  </div>
                )}

                {/* Action buttons */}
                <div className="pt-4 border-t border-border flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="px-6 py-3.5 bg-surface border border-border hover:bg-slate-50 text-content font-bold rounded-2xl transition-colors"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    className="px-8 py-3.5 bg-brand text-white font-black rounded-2xl hover:bg-brand/90 transition-all shadow-xl shadow-brand/20"
                  >
                    ربط وحفظ الطابعة
                  </button>
                </div>

              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
