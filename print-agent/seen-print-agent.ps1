<#
=============================================================================
  وسيط سين للطباعة  —  SEEN POS Print Agent  (PowerShell / بدون تنصيب)
=============================================================================

  ما هذا؟
  --------
  برنامج صغير يعمل على جهاز الكاشير. يتصل **خارجاً** بسيرفر نظام سين
  وينتظر مهام الطباعة، ثم يطبعها عبر تعريف الطابعة الرسمي في ويندوز —
  طباعة صامتة تماماً بدون أي مربع حوار.

  لماذا اتصال خارجي وليس منفذ محلي؟
  ----------------------------------
  الإصدار السابق كان يستمع على http://127.0.0.1:9110 وينتظر المتصفح.
  هذه الطريقة توقفت عن العمل لأن:

    • Chrome (M130+) يمنع أي صفحة على الإنترنت من مخاطبة loopback أو
      الشبكة المحلية إلا بإذن Local Network Access صريح. الترويسة القديمة
      Access-Control-Allow-Private-Network لم تعد كافية. النتيجة كانت
      "Failed to fetch" الذي ظهر للمستخدم كرسالة «الوسيط غير مُشغَّل».
    • Firefox و Safari يحجبان https ← http://127.0.0.1 حجباً كاملاً
      باعتباره Mixed Content.
    • الأندرويد لا يملك وسيطاً محلياً إطلاقاً.

  بقلب اتجاه الاتصال تنتهي هذه القيود كلها، وتعمل الطباعة من جهاز أندرويد
  في يد الكاشير على طابعة موصولة بكمبيوتر ويندوز في المتجر.

  المتطلبات
  ---------
  • ويندوز 7 أو أحدث. PowerShell مثبّت مسبقاً في كل نسخ ويندوز.
  • لا يحتاج Node.js ولا أي تنصيب ولا صلاحيات مسؤول.
  • الطابعة مثبّتة في ويندوز وتطبع صفحة اختبار من إعدادات ويندوز.

  التشغيل
  -------
      .\seen-print-agent.ps1 -ServerUrl https://app.example.com

  الخيارات
  --------
      -ServerUrl <url>     رابط نظام سين (إلزامي في أول تشغيل، ثم يُحفظ)
      -Printer <name>      الطابعة الافتراضية للوسيط
      -Install             تنصيب الوسيط كمهمة تعمل تلقائياً مع تشغيل ويندوز
      -Uninstall           إزالة التشغيل التلقائي
      -Verbose             إظهار تفاصيل كل مهمة

  الإعدادات تُحفظ في: %LOCALAPPDATA%\SeenPrintAgent\config.json
=============================================================================
#>

[CmdletBinding()]
param(
    [string] $ServerUrl = '',
    [string] $Printer   = '',
    [switch] $Install,
    [switch] $Uninstall,
    [switch] $Quiet
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$AGENT_VERSION = '2.0.0'
$CONFIG_DIR    = Join-Path $env:LOCALAPPDATA 'SeenPrintAgent'
$CONFIG_PATH   = Join-Path $CONFIG_DIR 'config.json'
$LOG_PATH      = Join-Path $CONFIG_DIR 'agent.log'
$TASK_NAME     = 'SeenPrintAgent'

# TLS 1.2 — ويندوز 7/8 و PowerShell 5.1 يستخدمان افتراضياً بروتوكولات
# قديمة ترفضها السيرفرات الحديثة، فنفرض 1.2 صراحةً.
try {
    [Net.ServicePointManager]::SecurityProtocol =
        [Net.SecurityProtocolType]::Tls12 -bor [Net.ServicePointManager]::SecurityProtocol
} catch { }

# شريط تقدم Invoke-WebRequest يبطئ العمل كثيراً في PowerShell 5.1
$ProgressPreference = 'SilentlyContinue'

#==============================================================================
#  السجل والعرض
#==============================================================================

if (-not (Test-Path $CONFIG_DIR)) {
    New-Item -ItemType Directory -Path $CONFIG_DIR -Force | Out-Null
}

function Write-Log {
    param(
        [string] $Message,
        [ValidateSet('info', 'ok', 'warn', 'error')] [string] $Level = 'info'
    )

    $stamp = Get-Date -Format 'HH:mm:ss'
    $line  = "[$stamp] $Message"

    try {
        # تدوير السجل عند تجاوز 1 ميغابايت حتى لا يكبر بلا حدود
        if ((Test-Path $LOG_PATH) -and (Get-Item $LOG_PATH).Length -gt 1MB) {
            Move-Item $LOG_PATH "$LOG_PATH.old" -Force
        }
        Add-Content -Path $LOG_PATH -Value $line -Encoding UTF8
    } catch { }

    if ($Quiet) { return }

    $color = switch ($Level) {
        'ok'    { 'Green' }
        'warn'  { 'Yellow' }
        'error' { 'Red' }
        default { 'Gray' }
    }
    Write-Host $line -ForegroundColor $color
}

#==============================================================================
#  الإعدادات
#==============================================================================

function Get-Config {
    if (-not (Test-Path $CONFIG_PATH)) {
        return [ordered]@{
            serverUrl      = ''
            stationId      = ''
            agentToken     = ''
            defaultPrinter = ''
        }
    }
    try {
        $raw = Get-Content $CONFIG_PATH -Raw -Encoding UTF8
        $obj = $raw | ConvertFrom-Json
        return [ordered]@{
            serverUrl      = [string]$obj.serverUrl
            stationId      = [string]$obj.stationId
            agentToken     = [string]$obj.agentToken
            defaultPrinter = [string]$obj.defaultPrinter
        }
    } catch {
        Write-Log "ملف الإعدادات تالف، سيتم إنشاء ملف جديد." 'warn'
        return [ordered]@{
            serverUrl = ''; stationId = ''; agentToken = ''; defaultPrinter = ''
        }
    }
}

function Save-Config {
    param([hashtable] $Config)
    try {
        ($Config | ConvertTo-Json -Depth 4) |
            Set-Content -Path $CONFIG_PATH -Encoding UTF8
    } catch {
        Write-Log "تعذر حفظ الإعدادات: $($_.Exception.Message)" 'warn'
    }
}

#==============================================================================
#  الطباعة الخام عبر سبولر ويندوز  (winspool.drv)
#------------------------------------------------------------------------------
#  هذه هي الطريقة الرسمية لتمرير أوامر ESC/POS عبر السبولر بنوع البيانات
#  "RAW" بحيث لا يعيد تعريف الطابعة تشكيل البايتات.
#  المهم: نستخدم نفس التعريف الرسمي المثبّت — لا حاجة لـ WinUSB أو Zadig،
#  ولا تظهر مشكلة "Access Denied" التي يواجهها WebUSB لأن السبولر هو
#  المالك الشرعي للجهاز.
#==============================================================================

$RawPrinterSource = @'
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

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true,
        CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPWStr)] string szPrinter,
        out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true,
        ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true,
        CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level,
        [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true,
        ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true,
        ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true,
        ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true,
        ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount,
        out int dwWritten);

    // شرح أكواد الأخطاء الشائعة بالعربية بدل رقم مجرد
    private static string Explain(int code, string printerName)
    {
        switch (code)
        {
            case 1801: return "اسم الطابعة \"" + printerName + "\" غير موجود في ويندوز.";
            case 5:    return "تم رفض الوصول للطابعة. شغّل الوسيط بنفس حساب المستخدم الذي ثبّت الطابعة.";
            case 1804: return "نوع البيانات RAW غير مدعوم من تعريف هذه الطابعة.";
            case 63:   return "الطابعة مشغولة أو الطابور متوقف. افتح طابور الطباعة وامسح المهام المعلّقة.";
            case 1784: return "بيانات الطباعة غير صالحة.";
            default:   return "رمز خطأ ويندوز " + code + ".";
        }
    }

    public static int SendBytes(string printerName, byte[] bytes, string docName)
    {
        if (bytes == null || bytes.Length == 0)
            throw new Exception("بيانات الطباعة فارغة.");

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

        return written;
    }
}
'@

if (-not ('SeenRawPrinter' -as [type])) {
    Add-Type -TypeDefinition $RawPrinterSource -Language CSharp
}

#==============================================================================
#  الطباعة الخام على طابعة شبكة  (TCP 9100 / RAW / JetDirect)
#------------------------------------------------------------------------------
#  الوسيط داخل شبكة المتجر، فيستطيع الوصول لعنوان 192.168.x.x الذي لا
#  يستطيع السيرفر السحابي الوصول إليه. لهذا نمرر مهام طابعات الشبكة
#  عبر الوسيط أيضاً.
#==============================================================================

function Send-RawToTcpPrinter {
    param(
        [Parameter(Mandatory)] [string] $TcpHost,
        [Parameter(Mandatory)] [int]    $Port,
        [Parameter(Mandatory)] [byte[]] $Bytes,
        [int] $TimeoutMs = 8000
    )

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $connect = $client.BeginConnect($TcpHost, $Port, $null, $null)
        if (-not $connect.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) {
            throw "انتهت مهلة الاتصال بالطابعة $TcpHost`:$Port. تأكد أنها مشغّلة وعلى نفس الشبكة."
        }
        $client.EndConnect($connect)

        $client.SendTimeout = $TimeoutMs
        $stream = $client.GetStream()
        $stream.Write($Bytes, 0, $Bytes.Length)
        $stream.Flush()
        # مهلة قصيرة لضمان تفريغ المخزن قبل الإغلاق
        Start-Sleep -Milliseconds 400
        return $Bytes.Length
    } finally {
        try { $client.Close() } catch { }
    }
}

#==============================================================================
#  قائمة الطابعات المثبتة
#==============================================================================

# الطابعات الوهمية التي لا تُخرج ورقاً — نميّزها حتى لا يربطها المستخدم بالخطأ
$VIRTUAL_PRINTER_RE =
    'Microsoft[\s_-]*Print[\s_-]*to[\s_-]*PDF|Microsoft[\s_-]*XPS|OneNote|\bFax\b|' +
    'PDF24|Adobe[\s_-]*PDF|CutePDF|doPDF|Print[\s_-]*to[\s_-]*File|\bXPS\b'

function Get-InstalledPrinters {
    $result = @()

    try {
        $defaultName = ''
        try {
            $def = Get-CimInstance -ClassName Win32_Printer -ErrorAction Stop |
                   Where-Object { $_.Default -eq $true } | Select-Object -First 1
            if ($def) { $defaultName = [string]$def.Name }
        } catch { }

        # Win32_Printer يعمل من ويندوز 7 حتى 11 — أوسع توافقاً من Get-Printer
        $printers = Get-CimInstance -ClassName Win32_Printer -ErrorAction Stop

        foreach ($p in $printers) {
            $name = [string]$p.Name
            if ([string]::IsNullOrWhiteSpace($name)) { continue }

            $result += [ordered]@{
                name      = $name
                isDefault = ($name -eq $defaultName)
                isVirtual = ($name -match $VIRTUAL_PRINTER_RE)
                driver    = [string]$p.DriverName
                port      = [string]$p.PortName
                status    = if ($p.WorkOffline) { 'Offline' } else { 'Normal' }
            }
        }
    } catch {
        Write-Log "تعذر قراءة قائمة الطابعات: $($_.Exception.Message)" 'warn'
    }

    # مسار احتياطي لأنظمة قديمة جداً لا يعمل فيها CIM
    if ($result.Count -eq 0) {
        try {
            Add-Type -AssemblyName System.Drawing -ErrorAction Stop
            foreach ($name in [System.Drawing.Printing.PrinterSettings]::InstalledPrinters) {
                $result += [ordered]@{
                    name = [string]$name; isDefault = $false
                    isVirtual = ([string]$name -match $VIRTUAL_PRINTER_RE)
                    driver = ''; port = ''; status = 'unknown'
                }
            }
        } catch { }
    }

    return $result
}

#==============================================================================
#  تنفيذ مهمة طباعة
#==============================================================================

function Invoke-PrintJob {
    param([Parameter(Mandatory)] $Job, [hashtable] $Config)

    $bytes = [Convert]::FromBase64String([string]$Job.dataBase64)
    if ($bytes.Length -eq 0) { throw 'بيانات الطباعة فارغة.' }

    $copies = 1
    try { $copies = [int]$Job.copies } catch { }
    if ($copies -lt 1) { $copies = 1 }
    if ($copies -gt 5) { $copies = 5 }

    $docName = 'SEEN POS Receipt'
    try { if ($Job.docName) { $docName = [string]$Job.docName } } catch { }

    $total = 0

    if ([string]$Job.target -eq 'tcp') {
        $tcpHost = [string]$Job.host
        $tcpPort = 9100
        try { if ($Job.port) { $tcpPort = [int]$Job.port } } catch { }

        for ($i = 0; $i -lt $copies; $i++) {
            $total += Send-RawToTcpPrinter -TcpHost $tcpHost -Port $tcpPort -Bytes $bytes
        }
        Write-Log "طُبعت مهمة على طابعة الشبكة $tcpHost`:$tcpPort ($total بايت)" 'ok'
    }
    else {
        $printerName = [string]$Job.printer
        if ([string]::IsNullOrWhiteSpace($printerName)) {
            $printerName = [string]$Config.defaultPrinter
        }
        if ([string]::IsNullOrWhiteSpace($printerName)) {
            throw 'لم يتم تحديد اسم الطابعة، ولا توجد طابعة افتراضية للوسيط.'
        }

        for ($i = 0; $i -lt $copies; $i++) {
            $total += [SeenRawPrinter]::SendBytes($printerName, $bytes, $docName)
        }
        Write-Log "طُبعت مهمة على `"$printerName`" ($total بايت)" 'ok'
    }

    return $total
}

#==============================================================================
#  الاتصال بالسيرفر
#==============================================================================

function Invoke-Api {
    param(
        [Parameter(Mandatory)] [string] $Url,
        [string] $Method = 'GET',
        $Body = $null,
        [hashtable] $Headers = @{},
        [int] $TimeoutSec = 40
    )

    $params = @{
        Uri             = $Url
        Method          = $Method
        Headers         = $Headers
        TimeoutSec      = $TimeoutSec
        UseBasicParsing = $true
    }

    if ($null -ne $Body) {
        $params.ContentType = 'application/json; charset=utf-8'
        # نرمّز يدوياً بـ UTF8 — Invoke-WebRequest يفسد العربية افتراضياً
        $json = $Body | ConvertTo-Json -Depth 6 -Compress
        $params.Body = [System.Text.Encoding]::UTF8.GetBytes($json)
    }

    return Invoke-WebRequest @params
}

function Register-Station {
    param([hashtable] $Config)

    $printers = Get-InstalledPrinters
    $body = @{
        stationId    = $Config.stationId
        agentToken   = $Config.agentToken
        hostname     = $env:COMPUTERNAME
        platform     = 'win32'
        agentVersion = $AGENT_VERSION
        printers     = $printers
    }

    $res  = Invoke-Api -Url "$($Config.serverUrl)/api/print/agent/hello" -Method POST -Body $body -TimeoutSec 25
    $data = $res.Content | ConvertFrom-Json

    if (-not $data.ok) { throw "رفض السيرفر التسجيل: $($data.error)" }

    $Config.stationId  = [string]$data.stationId
    $Config.agentToken = [string]$data.agentToken
    Save-Config $Config

    return @{
        pairCode = [string]$data.pairCode
        resumed  = [bool]$data.resumed
        printers = $printers
    }
}

#==============================================================================
#  التنصيب / الإزالة  (مهمة مجدولة تعمل مع تشغيل ويندوز)
#==============================================================================

function Install-AutoStart {
    param([string] $Url)

    $scriptPath = $PSCommandPath
    $arguments  = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`" -Quiet"
    if ($Url) { $arguments += " -ServerUrl `"$Url`"" }

    try {
        # schtasks متاح في كل نسخ ويندوز — أوثق من Register-ScheduledTask
        # الذي لا يوجد في PowerShell 2.0/ويندوز 7
        & schtasks.exe /Create /TN $TASK_NAME /SC ONLOGON /RL LIMITED /F `
            /TR "powershell.exe $arguments" | Out-Null

        Write-Host ''
        Write-Host '  ✅ تم تنصيب الوسيط للتشغيل التلقائي مع ويندوز.' -ForegroundColor Green
        Write-Host "     اسم المهمة: $TASK_NAME" -ForegroundColor Gray
        Write-Host '     للإزالة:  .\seen-print-agent.ps1 -Uninstall' -ForegroundColor Gray
        Write-Host ''
    } catch {
        Write-Host ''
        Write-Host "  ❌ فشل التنصيب: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host '     بديل: انسخ اختصاراً للملف إلى المجلد الذي يفتحه  shell:startup' -ForegroundColor Yellow
        Write-Host ''
    }
}

function Uninstall-AutoStart {
    try {
        & schtasks.exe /Delete /TN $TASK_NAME /F | Out-Null
        Write-Host '  ✅ تم إلغاء التشغيل التلقائي.' -ForegroundColor Green
    } catch {
        Write-Host '  ⚠️  لم يكن الوسيط منصّباً للتشغيل التلقائي.' -ForegroundColor Yellow
    }
}

#==============================================================================
#  البداية
#==============================================================================

$config = Get-Config

if ($Uninstall) { Uninstall-AutoStart; return }

# رابط السيرفر: من الوسيط الحالي، أو المحفوظ، أو نسأل المستخدم
if ($ServerUrl) { $config.serverUrl = $ServerUrl.TrimEnd('/') }
if ($Printer)   { $config.defaultPrinter = $Printer }

if (-not $config.serverUrl) {
    if ($Quiet) {
        Write-Log 'لا يوجد رابط سيرفر محفوظ. شغّل الوسيط مرة واحدة بـ -ServerUrl.' 'error'
        return
    }
    Write-Host ''
    Write-Host '  أدخل رابط نظام سين (مثال: https://app.seen.sa)' -ForegroundColor Cyan
    $entered = Read-Host '  الرابط'
    $config.serverUrl = $entered.Trim().TrimEnd('/')
    if (-not $config.serverUrl) {
        Write-Host '  ❌ لا يمكن المتابعة بدون رابط السيرفر.' -ForegroundColor Red
        return
    }
}

if ($config.serverUrl -notmatch '^https?://') {
    $config.serverUrl = "https://$($config.serverUrl)"
}

Save-Config $config

if ($Install) { Install-AutoStart -Url $config.serverUrl; return }

#------------------------------------------------------------------------------
#  الترويسة
#------------------------------------------------------------------------------

if (-not $Quiet) {
    Write-Host ''
    Write-Host '  ╔══════════════════════════════════════════════════════════╗' -ForegroundColor Cyan
    Write-Host '  ║           وسيط سين للطباعة  —  SEEN Print Agent          ║' -ForegroundColor Cyan
    Write-Host '  ╚══════════════════════════════════════════════════════════╝' -ForegroundColor Cyan
    Write-Host ''
    Write-Host "  الإصدار  : $AGENT_VERSION"
    Write-Host "  الجهاز   : $env:COMPUTERNAME"
    Write-Host "  السيرفر  : $($config.serverUrl)"
    Write-Host ''
}

#------------------------------------------------------------------------------
#  التسجيل مع إعادة المحاولة بتباطؤ تدريجي
#------------------------------------------------------------------------------

$registration = $null
$attempt = 0

while ($null -eq $registration) {
    $attempt++
    try {
        $registration = Register-Station $config
    } catch {
        $wait = [Math]::Min(60, 5 * $attempt)
        Write-Log "تعذر الاتصال بالسيرفر ($($_.Exception.Message)). إعادة المحاولة بعد $wait ثانية." 'warn'
        Start-Sleep -Seconds $wait
    }
}

if (-not $Quiet) {
    $printers = $registration.printers
    if ($printers.Count -eq 0) {
        Write-Host '  ⚠️  لم يتم العثور على أي طابعة مثبتة في ويندوز.' -ForegroundColor Yellow
        Write-Host '     ثبّت تعريف الطابعة أولاً وتأكد أنها تطبع صفحة اختبار.' -ForegroundColor Yellow
    } else {
        Write-Host "  الطابعات المثبتة ($($printers.Count)):" -ForegroundColor Gray
        foreach ($p in $printers) {
            $tags = @()
            if ($p.isDefault) { $tags += 'افتراضية' }
            if ($p.isVirtual) { $tags += 'وهمية' }
            $suffix = if ($tags.Count) { "   [$($tags -join ' / ')]" } else { '' }
            Write-Host "    • $($p.name)$suffix" -ForegroundColor Gray
        }
    }

    Write-Host ''
    Write-Host '  ┌────────────────────────────────────────────────────────┐' -ForegroundColor Green
    Write-Host '  │  رمز الاقتران — أدخله في: إعدادات الطابعة ← اقتران     │' -ForegroundColor Green
    Write-Host '  │                                                        │' -ForegroundColor Green
    Write-Host ("  │                    {0,-8}                            │" -f $registration.pairCode) -ForegroundColor White
    Write-Host '  └────────────────────────────────────────────────────────┘' -ForegroundColor Green
    Write-Host ''
    Write-Host '  ✅ الوسيط متصل وينتظر مهام الطباعة.' -ForegroundColor Green
    Write-Host '     اترك هذه النافذة مفتوحة أثناء العمل.  (Ctrl+C للإيقاف)' -ForegroundColor Gray
    Write-Host ''
    Write-Host '     للتشغيل التلقائي مع ويندوز:  .\seen-print-agent.ps1 -Install' -ForegroundColor DarkGray
    Write-Host ''
}

Write-Log "الوسيط جاهز. رمز الاقتران: $($registration.pairCode)" 'ok'

#------------------------------------------------------------------------------
#  الحلقة الرئيسية: انتظار المهام (long-poll)
#------------------------------------------------------------------------------

$pollUrl        = "$($config.serverUrl)/api/print/agent/poll?stationId=$($config.stationId)"
$resultUrl      = "$($config.serverUrl)/api/print/agent/result"
$authHeaders    = @{ Authorization = "Bearer $($config.agentToken)" }
$failStreak     = 0
$lastPrinterHash = ''

# بصمة قائمة الطابعات — نُحدّث السيرفر فقط عند التغيير الفعلي
function Get-PrinterHash {
    $names = (Get-InstalledPrinters | ForEach-Object { $_.name }) -join '|'
    return $names
}
$lastPrinterHash = Get-PrinterHash
$lastPrinterCheck = Get-Date

while ($true) {
    try {
        $res = Invoke-Api -Url $pollUrl -Method GET -Headers $authHeaders -TimeoutSec 40
        $failStreak = 0

        # 204 = لا توجد مهمة خلال فترة الانتظار — طبيعي تماماً، نعيد الاستماع
        if ($res.StatusCode -eq 204 -or -not $res.Content) {

            # كل 5 دقائق: هل تغيّرت الطابعات المثبتة؟
            if ((Get-Date) - $lastPrinterCheck -gt [TimeSpan]::FromMinutes(5)) {
                $lastPrinterCheck = Get-Date
                $hash = Get-PrinterHash
                if ($hash -ne $lastPrinterHash) {
                    $lastPrinterHash = $hash
                    Write-Log 'تغيّرت قائمة الطابعات — يتم تحديث السيرفر.' 'info'
                    try { Register-Station $config | Out-Null } catch { }
                }
            }
            continue
        }

        $data = $res.Content | ConvertFrom-Json
        if (-not $data.ok -or -not $data.job) { continue }

        $job = $data.job
        Write-Log "استُلمت مهمة $($job.id) (هدف: $($job.target))" 'info'

        $ok = $false; $err = ''; $bytes = 0
        try {
            $bytes = Invoke-PrintJob -Job $job -Config $config
            $ok = $true
        } catch {
            $err = $_.Exception.Message
            Write-Log "فشلت المهمة $($job.id): $err" 'error'
        }

        # إبلاغ السيرفر بالنتيجة حتى تظهر للكاشير فوراً
        try {
            Invoke-Api -Url $resultUrl -Method POST -Headers $authHeaders -TimeoutSec 20 -Body @{
                stationId = $config.stationId
                jobId     = $job.id
                ok        = $ok
                error     = $err
                bytes     = $bytes
            } | Out-Null
        } catch {
            Write-Log "تعذر إبلاغ السيرفر بنتيجة المهمة: $($_.Exception.Message)" 'warn'
        }
    }
    catch {
        $status = 0
        try { $status = [int]$_.Exception.Response.StatusCode } catch { }

        # 409 = السيرفر لا يعرف هذه المحطة (أعيد تشغيله مثلاً) → نعيد التسجيل
        if ($status -eq 409) {
            Write-Log 'السيرفر لم يتعرّف على المحطة — إعادة التسجيل.' 'warn'
            try {
                $reg = Register-Station $config
                $pollUrl     = "$($config.serverUrl)/api/print/agent/poll?stationId=$($config.stationId)"
                $authHeaders = @{ Authorization = "Bearer $($config.agentToken)" }
                Write-Log "تمت إعادة التسجيل. رمز الاقتران: $($reg.pairCode)" 'ok'
                if (-not $Quiet) {
                    Write-Host ''
                    Write-Host "  ⚠️  رمز اقتران جديد: $($reg.pairCode)" -ForegroundColor Yellow
                    Write-Host '     أعد الاقتران من إعدادات الطابعة في النظام.' -ForegroundColor Yellow
                    Write-Host ''
                }
            } catch {
                Start-Sleep -Seconds 10
            }
            continue
        }

        # انتهاء المهلة أمر متوقع في long-poll — لا نعتبره خطأ
        $isTimeout = $_.Exception.Message -match 'timed out|timeout|operation has timed out'
        if ($isTimeout) { continue }

        $failStreak++
        $wait = [Math]::Min(60, 3 * $failStreak)
        Write-Log "انقطع الاتصال بالسيرفر ($($_.Exception.Message)). إعادة المحاولة بعد $wait ثانية." 'warn'
        Start-Sleep -Seconds $wait
    }
}
