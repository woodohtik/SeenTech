<#
=============================================================================
  بناء  seen-print-agent.exe  —  ملف واحد مستقل بدون Node.js
=============================================================================

  لمن هذا الملف؟
  --------------
  لك أنت (المطوّر)، لا للعميل. تُشغّله مرة واحدة على جهازك فينتج ملفاً
  واحداً `seen-print-agent.exe` تُوزّعه على المتاجر. العميل لا يحتاج
  Node.js ولا PowerShell ولا أي تنصيب — نقرة مزدوجة فقط.

  ملاحظة: إن لم ترغب ببناء EXE إطلاقاً فاستخدم `seen-print-agent.ps1`
  مباشرةً — PowerShell موجود في كل نسخ ويندوز، وهو خيار «صفر تنصيب»
  الأبسط. ملف EXE أفضل فقط للتوزيع الواسع (لا يتأثر بسياسة تنفيذ
  السكربتات، ويبدو أكثر احترافية للعميل).

  المتطلبات
  ---------
  Node.js 22 أو أحدث على جهاز البناء (ميزة SEA أصبحت مستقرة فيه).
  تحقّق:  node --version

  التشغيل
  -------
      .\build-exe.ps1

  الناتج
  ------
      dist\seen-print-agent.exe

  توقيع الملف (مستحسن جداً)
  --------------------------
  بدون توقيع رقمي سيعرض SmartScreen تحذير «تطبيق غير معروف» لأول
  المستخدمين. إن كان لديك شهادة Code Signing:

      signtool sign /fd SHA256 /tr http://timestamp.digicert.com `
        /td SHA256 /f cert.pfx /p <password> dist\seen-print-agent.exe
=============================================================================
#>

[CmdletBinding()]
param(
    [string] $OutDir = (Join-Path $PSScriptRoot 'dist')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$entry     = Join-Path $PSScriptRoot 'seen-print-agent.js'
$buildDir  = Join-Path $PSScriptRoot '.build'
$blobPath  = Join-Path $buildDir 'sea-prep.blob'
$seaConfig = Join-Path $buildDir 'sea-config.json'
$exeName   = 'seen-print-agent.exe'
$exePath   = Join-Path $OutDir $exeName

function Fail([string] $Message) {
    Write-Host ''
    Write-Host "  ❌ $Message" -ForegroundColor Red
    Write-Host ''
    exit 1
}

Write-Host ''
Write-Host '  ══ بناء وسيط سين للطباعة (ملف EXE مستقل) ══' -ForegroundColor Cyan
Write-Host ''

# ---------------------------------------------------------------- التحقق
if (-not (Test-Path $entry)) { Fail "لم يتم العثور على $entry" }

$nodeExe = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $nodeExe) { Fail 'Node.js غير مثبّت على جهاز البناء. حمّله من https://nodejs.org (نسخة 22+).' }

$versionText = (& node --version).Trim()          # مثال: v22.14.0
$major = 0
if ($versionText -match '^v(\d+)\.') { $major = [int]$Matches[1] }

if ($major -lt 22) {
    Fail "إصدار Node.js الحالي $versionText. ميزة SEA تحتاج 22 أو أحدث. حدّث Node.js ثم أعد المحاولة."
}

Write-Host "  Node.js  : $versionText" -ForegroundColor Gray

# ---------------------------------------------------------------- التحضير
New-Item -ItemType Directory -Path $buildDir -Force | Out-Null
New-Item -ItemType Directory -Path $OutDir   -Force | Out-Null

# SEA يحتاج ملف إعداد يصف نقطة الدخول والـ blob الناتج
@{
    main                                = 'seen-print-agent.js'
    output                              = 'sea-prep.blob'
    disableExperimentalSEAWarning       = $true
    useSnapshot                         = $false
    useCodeCache                        = $true
} | ConvertTo-Json -Depth 3 | Set-Content -Path $seaConfig -Encoding UTF8

# المسارات داخل sea-config نسبية لمجلد التشغيل، فننسخ نقطة الدخول جواره
Copy-Item $entry (Join-Path $buildDir 'seen-print-agent.js') -Force

# --------------------------------------------------- 1) توليد الـ blob
Write-Host '  [1/4] توليد حِزمة SEA...' -ForegroundColor Gray
Push-Location $buildDir
try {
    & node --experimental-sea-config 'sea-config.json'
    if ($LASTEXITCODE -ne 0) { Fail 'فشل توليد حِزمة SEA.' }
} finally {
    Pop-Location
}
if (-not (Test-Path $blobPath)) { Fail 'لم يُنتج ملف sea-prep.blob.' }

# ------------------------------------------- 2) نسخ ملف node التنفيذي
Write-Host '  [2/4] نسخ ملف Node التنفيذي...' -ForegroundColor Gray
Copy-Item $nodeExe.Source $exePath -Force

# -------------------- 3) إزالة التوقيع (إن وُجد) قبل حقن البيانات
# حقن البيانات يُبطل توقيع Microsoft الأصلي، فنزيله أولاً لتجنّب ملف تالف.
Write-Host '  [3/4] تجهيز الملف للحقن...' -ForegroundColor Gray
$signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
if ($signtool) {
    & signtool.exe remove /s $exePath 2>$null | Out-Null
} else {
    Write-Host '        (signtool غير متاح — يمكن تجاهل هذه الخطوة)' -ForegroundColor DarkGray
}

# ----------------------------------------------- 4) حقن الـ blob
Write-Host '  [4/4] حقن الحِزمة في الملف التنفيذي...' -ForegroundColor Gray

# postject هو الأداة الرسمية التي توصي بها Node لحقن حِزم SEA
& npx --yes postject $exePath NODE_SEA_BLOB $blobPath `
    --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

if ($LASTEXITCODE -ne 0) { Fail 'فشل حقن الحِزمة (postject). تأكد من اتصال الإنترنت لتحميل الأداة.' }

# ---------------------------------------------------------------- تنظيف
Remove-Item $buildDir -Recurse -Force -ErrorAction SilentlyContinue

$sizeMb = [Math]::Round((Get-Item $exePath).Length / 1MB, 1)

Write-Host ''
Write-Host "  ✅ تم البناء: $exePath  ($sizeMb ميغابايت)" -ForegroundColor Green
Write-Host ''
Write-Host '  الاستخدام على جهاز العميل (أول مرة فقط):' -ForegroundColor Cyan
Write-Host '      seen-print-agent.exe --server=https://app.example.com' -ForegroundColor White
Write-Host ''
Write-Host '  بعدها يُحفظ الرابط، فتكفي نقرة مزدوجة على الملف.' -ForegroundColor Gray
Write-Host ''
Write-Host '  ⚠️  بدون توقيع رقمي سيُظهر SmartScreen تحذير «تطبيق غير معروف».' -ForegroundColor Yellow
Write-Host '     راجع تعليمات signtool في أعلى هذا الملف.' -ForegroundColor Yellow
Write-Host ''
