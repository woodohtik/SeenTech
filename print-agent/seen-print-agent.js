#!/usr/bin/env node
/**
 * ============================================================================
 *  وسيط سين للطباعة  —  SEEN POS Print Agent  (إصدار 2 — اتصال صادر)
 * ============================================================================
 *
 *  ما تغيّر عن الإصدار 1 ولماذا؟
 *  ------------------------------
 *  الإصدار 1 كان يفتح خادماً محلياً على http://127.0.0.1:9110 وينتظر
 *  المتصفح. هذا التصميم توقّف عن العمل في المتصفحات الحديثة:
 *
 *   • Local Network Access (Chrome M130+): الصفحات على الإنترنت ممنوعة من
 *     مخاطبة loopback أو الشبكة المحلية بدون إذن صريح، وترويسة
 *     Access-Control-Allow-Private-Network القديمة لم تعد كافية. الـ fetch
 *     يفشل بـ "Failed to fetch" — وهو ما ظهر للمستخدم كرسالة مضلِّلة:
 *     «الوسيط غير مُشغَّل» رغم أن الوسيط كان يعمل فعلاً.
 *
 *   • Mixed Content: Firefox و Safari يحجبان https ← http://127.0.0.1 كلياً.
 *
 *   • الأندرويد: لا يوجد وسيط محلي إطلاقاً، فلم يكن هناك أي مسار للطباعة
 *     الصامتة من تابلت الكاشير.
 *
 *  الإصدار 2 يقلب اتجاه الاتصال: الوسيط **يتصل خارجاً** بسيرفر سين وينتظر
 *  المهام (long-poll). لا اتصال بـ localhost ⇒ لا mixed content، لا CORS،
 *  لا Local Network Access، ولا حاجة لفتح منفذ في جدار الحماية. والنتيجة أن
 *  الطباعة تعمل من الويندوز ومن الأندرويد بنفس الطريقة.
 *
 *  المتطلبات: Node.js 18+، أو استخدم النسخة المبنيّة seen-print-agent.exe
 *  التي لا تحتاج Node.js إطلاقاً (انظر build-exe.ps1).
 *  البديل بدون أي تنصيب: seen-print-agent.ps1 (PowerShell — موجود في كل ويندوز).
 *
 *  التشغيل:
 *      node seen-print-agent.js --server=https://app.example.com
 *
 *  الخيارات:
 *      --server=<url>       رابط نظام سين (إلزامي أول مرة، ثم يُحفظ)
 *      --printer="الاسم"     الطابعة الافتراضية للوسيط
 *      --log                إظهار تفاصيل كل مهمة
 * ============================================================================
 */

'use strict';

const os = require('os');
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const VERSION = '2.0.0';
const PLATFORM = process.platform; // 'win32' | 'darwin' | 'linux'

/* ============================ الخيارات والإعدادات ============================ */

const argOf = (name, fallback = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  return process.argv.includes(`--${name}`) ? true : fallback;
};

const CONFIG_DIR = path.join(
  process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir(),
  'SeenPrintAgent'
);
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const VERBOSE = argOf('log', false) === true;

const log = (...a) => console.log(`[${new Date().toLocaleTimeString('ar-SA-u-nu-latn')}]`, ...a);
const vlog = (...a) => VERBOSE && log(...a);

const loadConfig = () => {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return { serverUrl: '', stationId: '', agentToken: '', defaultPrinter: '' };
  }
};

const saveConfig = (cfg) => {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (e) {
    log('⚠️  تعذر حفظ الإعدادات:', e.message);
  }
};

const config = loadConfig();

{
  const cliServer = argOf('server', null);
  if (typeof cliServer === 'string' && cliServer) {
    config.serverUrl = cliServer.replace(/\/+$/, '');
  }
  const cliPrinter = argOf('printer', null);
  if (typeof cliPrinter === 'string' && cliPrinter) config.defaultPrinter = cliPrinter;
}

if (config.serverUrl && !/^https?:\/\//i.test(config.serverUrl)) {
  config.serverUrl = `https://${config.serverUrl}`;
}

/* ============================ أدوات تنفيذ الأوامر ============================ */

const run = (cmd, args, options = {}) =>
  new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { maxBuffer: 16 * 1024 * 1024, windowsHide: true, ...options },
      (err, stdout, stderr) => {
        if (err) {
          err.stdout = String(stdout || '');
          err.stderr = String(stderr || '');
          return reject(err);
        }
        resolve(String(stdout || ''));
      }
    );
  });

const tmpFile = (ext) =>
  path.join(os.tmpdir(), `seen-print-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);

const safeUnlink = (p) => {
  try {
    fs.unlinkSync(p);
  } catch {
    /* تجاهل */
  }
};

/* ============================================================================
   قائمة الطابعات المثبتة في نظام التشغيل
   ============================================================================ */

const listPrintersWindows = async () => {
  // Win32_Printer يعمل من ويندوز 7 حتى 11 — أوسع توافقاً من Get-Printer
  try {
    const ps = `
$ErrorActionPreference='Stop'
Get-CimInstance -ClassName Win32_Printer | ForEach-Object {
  New-Object PSObject -Property ([ordered]@{
    name = $_.Name; isDefault = [bool]$_.Default; status = $(if($_.WorkOffline){'Offline'}else{'Normal'});
    driver = $_.DriverName; port = $_.PortName
  })
} | ConvertTo-Json -Compress -Depth 3
`;
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
    const parsed = JSON.parse(out.trim() || '[]');
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    if (arr.length) return arr;
  } catch (e) {
    vlog('CIM فشل، سيتم تجربة wmic:', e.message);
  }

  // wmic — قديم لكنه موجود على الأنظمة الأقدم
  const out = await run('cmd.exe', ['/c', 'wmic printer get name,default /format:csv']);
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^Node,/i.test(l))
    .map((l) => {
      const parts = l.split(',');
      const isDefault = /true/i.test(parts[1] || '');
      const name = (parts[2] || '').trim();
      return name ? { name, isDefault, status: 'unknown', driver: '', port: '' } : null;
    })
    .filter(Boolean);
};

const listPrintersCups = async () => {
  let defaultName = '';
  try {
    const d = await run('lpstat', ['-d']);
    const m = d.match(/:\s*(\S+)/);
    if (m) defaultName = m[1];
  } catch {
    /* تجاهل */
  }

  const out = await run('lpstat', ['-p']);
  return out
    .split(/\r?\n/)
    .map((l) => l.match(/^printer\s+(\S+)\s+(.*)$/))
    .filter(Boolean)
    .map((m) => ({
      name: m[1],
      isDefault: m[1] === defaultName,
      status: /disabled/i.test(m[2]) ? 'Offline' : 'Normal',
      driver: '',
      port: '',
    }));
};

// الطابعات الوهمية التي لا تُخرج ورقاً — نميّزها حتى لا يربطها المستخدم بالخطأ
const S = '[\\s_-]*';
const VIRTUAL_RE = new RegExp(
  [
    `Microsoft${S}Print${S}to${S}PDF`,
    `Microsoft${S}XPS${S}Document${S}Writer`,
    'OneNote',
    '\\bFax\\b',
    'PDF24',
    `Adobe${S}PDF`,
    'CutePDF',
    'doPDF',
    `Print${S}to${S}File`,
    '\\bXPS\\b',
  ].join('|'),
  'i'
);

const listPrinters = async () => {
  let raw = [];
  try {
    raw = PLATFORM === 'win32' ? await listPrintersWindows() : await listPrintersCups();
  } catch (e) {
    log('⚠️  تعذر قراءة قائمة الطابعات:', e.message);
    return [];
  }

  return raw
    .filter((p) => p && p.name)
    .map((p) => ({
      name: String(p.name),
      isDefault: !!p.isDefault,
      status: String(p.status || 'unknown'),
      driver: String(p.driver || ''),
      port: String(p.port || ''),
      isVirtual: VIRTUAL_RE.test(String(p.name)),
    }));
};

/* ============================================================================
   الطباعة الخام عبر سبولر نظام التشغيل
   ----------------------------------------------------------------------------
   نستخدم تعريف الطابعة الرسمي المثبّت بنوع البيانات "RAW" — لذلك لا تظهر
   مشكلة "Access Denied" التي يواجهها WebUSB (السبولر هو المالك الشرعي
   للجهاز)، ولا حاجة لاستبدال التعريف بـ WinUSB عبر Zadig.
   ============================================================================ */

const RAW_PRINT_PS1 = `param(
  [Parameter(Mandatory=$true)][string]$PrinterName,
  [Parameter(Mandatory=$true)][string]$FilePath,
  [string]$DocName = "SEEN POS Receipt"
)
$ErrorActionPreference = "Stop"

$source = @"
using System;
using System.IO;
using System.Runtime.InteropServices;

public class SeenRawPrinter
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFOW
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPWStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    private static string Explain(int code, string printerName)
    {
        switch (code)
        {
            case 1801: return "اسم الطابعة \\"" + printerName + "\\" غير موجود في ويندوز.";
            case 5:    return "تم رفض الوصول للطابعة. شغّل الوسيط بنفس حساب المستخدم الذي ثبّت الطابعة.";
            case 1804: return "نوع البيانات RAW غير مدعوم من تعريف هذه الطابعة.";
            case 63:   return "الطابعة مشغولة أو الطابور متوقف. امسح المهام المعلّقة من طابور الطباعة.";
            default:   return "رمز خطأ ويندوز " + code + ".";
        }
    }

    public static void SendFile(string printerName, string filePath, string docName)
    {
        byte[] bytes = File.ReadAllBytes(filePath);
        IntPtr hPrinter = IntPtr.Zero;
        int written = 0;

        DOCINFOW di = new DOCINFOW();
        di.pDocName = docName;
        di.pDataType = "RAW";

        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
            throw new Exception("فشل فتح الطابعة: " + Explain(Marshal.GetLastWin32Error(), printerName));

        try
        {
            if (!StartDocPrinter(hPrinter, 1, di))
                throw new Exception("فشل بدء المستند: " + Explain(Marshal.GetLastWin32Error(), printerName));
            try
            {
                if (!StartPagePrinter(hPrinter))
                    throw new Exception("فشل بدء الصفحة: " + Explain(Marshal.GetLastWin32Error(), printerName));

                IntPtr unmanaged = Marshal.AllocCoTaskMem(bytes.Length);
                try
                {
                    Marshal.Copy(bytes, 0, unmanaged, bytes.Length);
                    if (!WritePrinter(hPrinter, unmanaged, bytes.Length, out written))
                        throw new Exception("فشل إرسال البيانات: " + Explain(Marshal.GetLastWin32Error(), printerName));
                }
                finally { Marshal.FreeCoTaskMem(unmanaged); }
            }
            finally { EndPagePrinter(hPrinter); }
        }
        finally
        {
            EndDocPrinter(hPrinter);
            ClosePrinter(hPrinter);
        }

        if (written != bytes.Length)
            throw new Exception("تم إرسال " + written + " بايت فقط من " + bytes.Length + ".");

        Console.WriteLine("OK " + written);
    }
}
"@

Add-Type -TypeDefinition $source -Language CSharp
[SeenRawPrinter]::SendFile($PrinterName, $FilePath, $DocName)
`;

let cachedPs1Path = null;
const ensurePs1 = () => {
  if (cachedPs1Path && fs.existsSync(cachedPs1Path)) return cachedPs1Path;
  const p = path.join(os.tmpdir(), 'seen-raw-print.ps1');
  fs.writeFileSync(p, RAW_PRINT_PS1, 'utf8');
  cachedPs1Path = p;
  return p;
};

const printRawWindows = async (printerName, buffer, docName) => {
  const dataPath = tmpFile('.bin');
  fs.writeFileSync(dataPath, buffer);
  try {
    const out = await run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      ensurePs1(),
      '-PrinterName',
      printerName,
      '-FilePath',
      dataPath,
      '-DocName',
      docName,
    ]);
    vlog('نتيجة السبولر:', out.trim());
    return buffer.length;
  } catch (e) {
    const detail = (e.stderr || e.stdout || e.message || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 4)
      .join(' ');
    throw new Error(`فشل الإرسال إلى "${printerName}": ${detail}`);
  } finally {
    safeUnlink(dataPath);
  }
};

const printRawCups = async (printerName, buffer) => {
  const dataPath = tmpFile('.bin');
  fs.writeFileSync(dataPath, buffer);
  try {
    await run('lp', ['-d', printerName, '-o', 'raw', dataPath]);
    return buffer.length;
  } catch (e) {
    throw new Error(`فشل الإرسال إلى "${printerName}" عبر CUPS: ${(e.stderr || e.message || '').trim()}`);
  } finally {
    // نمنح CUPS وقتاً لقراءة الملف قبل حذفه
    setTimeout(() => safeUnlink(dataPath), 5000);
  }
};

const printToSpooler = (printerName, buffer, docName) =>
  PLATFORM === 'win32'
    ? printRawWindows(printerName, buffer, docName)
    : printRawCups(printerName, buffer);

/* ============================================================================
   الطباعة الخام على طابعة شبكة (TCP 9100)
   ----------------------------------------------------------------------------
   الوسيط داخل شبكة المتجر فيستطيع الوصول لعناوين 192.168.x.x التي لا
   يستطيع السيرفر السحابي الوصول إليها.
   ============================================================================ */

const printToTcp = (host, port, buffer, timeoutMs = 8000) =>
  new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (err) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* تجاهل */
      }
      err ? reject(err) : resolve(buffer.length);
    };

    socket.setTimeout(timeoutMs);
    socket.once('timeout', () =>
      done(new Error(`انتهت مهلة الاتصال بالطابعة ${host}:${port}. تأكد أنها مشغّلة وعلى نفس الشبكة.`))
    );
    socket.once('error', (e) => {
      const hint =
        e.code === 'ECONNREFUSED'
          ? 'الطابعة رفضت الاتصال — تأكد أن منفذ الطباعة الخام (9100) مفعّل في إعداداتها.'
          : e.code === 'EHOSTUNREACH' || e.code === 'ENETUNREACH'
          ? 'لا يمكن الوصول للطابعة — تأكد أن جهاز الوسيط والطابعة على نفس الشبكة.'
          : e.message;
      done(new Error(`فشل الاتصال بـ ${host}:${port}: ${hint}`));
    });

    socket.connect(port, host, () => {
      socket.write(buffer, (writeErr) => {
        if (writeErr) return done(writeErr);
        setTimeout(() => {
          socket.end();
          done();
        }, 400);
      });
    });
  });

/* ============================================================================
   تنفيذ مهمة طباعة واحدة
   ============================================================================ */

const executeJob = async (job) => {
  const buffer = Buffer.from(String(job.dataBase64 || ''), 'base64');
  if (!buffer.length) throw new Error('بيانات الطباعة فارغة.');

  const copies = Math.min(Math.max(1, Number(job.copies) || 1), 5);
  const docName = String(job.docName || 'SEEN POS Receipt');
  let total = 0;

  if (job.target === 'tcp') {
    const port = Number(job.port) || 9100;
    for (let i = 0; i < copies; i++) total += await printToTcp(String(job.host), port, buffer);
    log(`🖨️  طُبعت مهمة على طابعة الشبكة ${job.host}:${port} (${total} بايت)`);
  } else {
    const printerName = String(job.printer || config.defaultPrinter || '').trim();
    if (!printerName) {
      throw new Error('لم يتم تحديد اسم الطابعة، ولا توجد طابعة افتراضية للوسيط.');
    }
    for (let i = 0; i < copies; i++) total += await printToSpooler(printerName, buffer, docName);
    log(`🖨️  طُبعت مهمة على "${printerName}" (${total} بايت)`);
  }

  return total;
};

/* ============================================================================
   الاتصال بالسيرفر
   ============================================================================ */

const api = async (pathname, { method = 'GET', body = null, headers = {}, timeoutMs = 40_000 } = {}) => {
  const url = `${config.serverUrl}${pathname}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (res.status === 204) return { status: 204, data: null };

    let data = null;
    try {
      data = await res.json();
    } catch {
      /* رد بلا JSON */
    }
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
};

const registerStation = async () => {
  const printers = await listPrinters();

  const { status, data } = await api('/api/print/agent/hello', {
    method: 'POST',
    body: {
      stationId: config.stationId || undefined,
      agentToken: config.agentToken || undefined,
      hostname: os.hostname(),
      platform: PLATFORM,
      agentVersion: VERSION,
      printers,
    },
    timeoutMs: 25_000,
  });

  if (status !== 200 || !data?.ok) {
    throw new Error(data?.error || `رفض السيرفر التسجيل (رمز ${status}).`);
  }

  config.stationId = data.stationId;
  config.agentToken = data.agentToken;
  saveConfig(config);

  return { pairCode: data.pairCode, resumed: !!data.resumed, printers };
};

/* ============================================================================
   الإقلاع والحلقة الرئيسية
   ============================================================================ */

const banner = (pairCode, printers) => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════════╗');
  console.log('  ║           وسيط سين للطباعة  —  SEEN Print Agent          ║');
  console.log('  ╚══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  الإصدار  : ${VERSION}`);
  console.log(`  الجهاز   : ${os.hostname()}  (${PLATFORM})`);
  console.log(`  السيرفر  : ${config.serverUrl}`);
  console.log('');

  if (!printers.length) {
    console.log('  ⚠️  لم يتم العثور على أي طابعة مثبتة في النظام.');
    console.log('     ثبّت تعريف الطابعة أولاً وتأكد أنها تطبع صفحة اختبار.');
  } else {
    console.log(`  الطابعات المثبتة (${printers.length}):`);
    printers.forEach((p) => {
      const tags = [p.isDefault ? 'افتراضية' : null, p.isVirtual ? 'وهمية' : null]
        .filter(Boolean)
        .join(' / ');
      console.log(`    • ${p.name}${tags ? `   [${tags}]` : ''}`);
    });
  }

  console.log('');
  console.log('  ┌────────────────────────────────────────────────────────┐');
  console.log('  │  رمز الاقتران — أدخله في: إعدادات الطابعة ← اقتران     │');
  console.log('  │                                                        │');
  console.log(`  │                    ${String(pairCode).padEnd(8)}                            │`);
  console.log('  └────────────────────────────────────────────────────────┘');
  console.log('');
  console.log('  ✅ الوسيط متصل وينتظر مهام الطباعة.');
  console.log('     اترك هذه النافذة مفتوحة أثناء العمل.  (Ctrl+C للإيقاف)');
  console.log('');
};

const main = async () => {
  if (!config.serverUrl) {
    console.error('');
    console.error('  ❌ لم يتم تحديد رابط السيرفر.');
    console.error('     شغّل الوسيط مرة واحدة بهذه الصيغة (يُحفظ الرابط بعدها):');
    console.error('');
    console.error('       node seen-print-agent.js --server=https://app.example.com');
    console.error('');
    process.exit(1);
  }

  if (typeof fetch !== 'function') {
    console.error('');
    console.error('  ❌ إصدار Node.js قديم جداً (fetch غير متاح). ثبّت Node.js 18 أو أحدث،');
    console.error('     أو استخدم النسخة التي لا تحتاج تنصيباً: seen-print-agent.ps1');
    console.error('');
    process.exit(1);
  }

  // التسجيل مع إعادة المحاولة بتباطؤ تدريجي
  let reg = null;
  for (let attempt = 1; !reg; attempt++) {
    try {
      reg = await registerStation();
    } catch (e) {
      const wait = Math.min(60, 5 * attempt);
      log(`⚠️  تعذر الاتصال بالسيرفر (${e.message}). إعادة المحاولة بعد ${wait} ثانية.`);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }

  banner(reg.pairCode, reg.printers);

  let failStreak = 0;
  let lastPrinterNames = reg.printers.map((p) => p.name).join('|');
  let lastPrinterCheck = Date.now();

  // الحلقة الرئيسية: long-poll لا ينتهي
  for (;;) {
    try {
      const { status, data } = await api(
        `/api/print/agent/poll?stationId=${encodeURIComponent(config.stationId)}`,
        { headers: { Authorization: `Bearer ${config.agentToken}` }, timeoutMs: 40_000 }
      );

      // السيرفر أُعيد تشغيله ولم يعد يعرف المحطة → نعيد التسجيل
      if (status === 409) {
        log('⚠️  السيرفر لم يتعرّف على المحطة — إعادة التسجيل.');
        try {
          const again = await registerStation();
          console.log('');
          console.log(`  ⚠️  رمز اقتران جديد: ${again.pairCode}`);
          console.log('     أعد الاقتران من إعدادات الطابعة في النظام.');
          console.log('');
        } catch {
          await new Promise((r) => setTimeout(r, 10_000));
        }
        continue;
      }

      failStreak = 0;

      // 204 = لا توجد مهمة خلال فترة الانتظار — طبيعي، نعيد الاستماع
      if (status === 204 || !data?.job) {
        // كل 5 دقائق: هل تغيّرت الطابعات المثبتة؟
        if (Date.now() - lastPrinterCheck > 5 * 60_000) {
          lastPrinterCheck = Date.now();
          const names = (await listPrinters()).map((p) => p.name).join('|');
          if (names !== lastPrinterNames) {
            lastPrinterNames = names;
            log('تغيّرت قائمة الطابعات — يتم تحديث السيرفر.');
            try {
              await registerStation();
            } catch {
              /* سيُعاد في الدورة القادمة */
            }
          }
        }
        continue;
      }

      const job = data.job;
      vlog(`استُلمت مهمة ${job.id} (هدف: ${job.target})`);

      let ok = false;
      let error = '';
      let bytes = 0;

      try {
        bytes = await executeJob(job);
        ok = true;
      } catch (e) {
        error = e?.message || 'فشل غير محدد.';
        log(`❌ فشلت المهمة ${job.id}: ${error}`);
      }

      // إبلاغ السيرفر بالنتيجة حتى تظهر للكاشير فوراً
      try {
        await api('/api/print/agent/result', {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.agentToken}` },
          body: { stationId: config.stationId, jobId: job.id, ok, error, bytes },
          timeoutMs: 20_000,
        });
      } catch (e) {
        log(`⚠️  تعذر إبلاغ السيرفر بنتيجة المهمة: ${e.message}`);
      }
    } catch (e) {
      // انتهاء المهلة أمر متوقع في long-poll — لا نعتبره خطأ
      if (e?.name === 'AbortError') continue;

      failStreak++;
      const wait = Math.min(60, 3 * failStreak);
      log(`⚠️  انقطع الاتصال بالسيرفر (${e.message}). إعادة المحاولة بعد ${wait} ثانية.`);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }
};

const shutdown = () => {
  console.log('\n  إيقاف وسيط الطباعة...');
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (e) => log('⚠️  خطأ غير معالَج:', e?.message || e));

main().catch((e) => {
  console.error('❌ خطأ قاتل في الوسيط:', e?.message || e);
  process.exit(1);
});
