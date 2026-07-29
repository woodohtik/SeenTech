@echo off
chcp 65001 >nul
rem setlocal بلا EnableDelayedExpansion مقصود: التوسيع المؤجل يحذف علامة "!"
rem من أي عنوان يُمرَّر كوسيط، ولا نحتاجه هنا لعدم استخدام !VAR!.
setlocal

rem ===================================================================
rem  نظام سين — تشغيل بوضع الطباعة الفورية (بدون نافذة طابعة)
rem ===================================================================
rem
rem  يفتح هذا الملف المتصفح بوضع "--kiosk-printing".
rem  في هذا الوضع تُطبع الفاتورة فوراً على الطابعة الافتراضية للويندوز
rem  بلا أي نافذة طباعة ولا أي نقرة إضافية — ويشمل كل المقاسات
rem  (80mm و 58mm و A4 و A5).
rem
rem  ملاحظة مهمة: يجب فتح النظام من هذا الملف تحديداً. فتحه من اختصار
rem  المتصفح العادي سيُظهر نافذة الطباعة كالمعتاد.
rem
rem  ✅ اضبط الطابعة المطلوبة كـ "الطابعة الافتراضية" في ويندوز أولاً:
rem     Settings > Bluetooth & devices > Printers & scanners
rem     ثم اختر الطابعة > Set as default
rem ===================================================================

rem ── (1) عنوان النظام. عدّله إن كان مختلفاً عندك ──────────────────
set "APP_URL=https://app.seen.sa"

rem يمكن أيضاً تمرير العنوان كوسيط:  طباعة-فورية-بدون-نافذة.bat  http://...
if not "%~1"=="" set "APP_URL=%~1"

rem ── (2) مجلد بيانات منفصل ──────────────────────────────────────────
rem  ضروري: كروم لا يطبّق وسائط سطر الأوامر على نافذة جديدة داخل
rem  جلسة مفتوحة أصلاً. المجلد المنفصل يضمن بدء جلسة مستقلة يسري
rem  عليها وضع الطباعة الفورية فعلاً.
set "PROFILE_DIR=%LOCALAPPDATA%\SeenKioskPrint"
if not exist "%PROFILE_DIR%" mkdir "%PROFILE_DIR%" >nul 2>&1

rem ── (3) البحث عن كروم ثم إيدج ──────────────────────────────────────
set "BROWSER="

for %%P in (
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%LocalAppData%\Google\Chrome\Application\chrome.exe"
) do (
  if exist %%P if not defined BROWSER set "BROWSER=%%~P"
)

if not defined BROWSER (
  for %%P in (
    "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
    "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
  ) do (
    if exist %%P if not defined BROWSER set "BROWSER=%%~P"
  )
)

if not defined BROWSER (
  echo.
  echo [خطأ] لم يتم العثور على متصفح كروم أو إيدج على هذا الجهاز.
  echo        ثبّت Google Chrome ثم أعد تشغيل هذا الملف.
  echo.
  pause
  exit /b 1
)

rem ── (4) التشغيل ────────────────────────────────────────────────────
echo.
echo   نظام سين — وضع الطباعة الفورية
echo   ------------------------------------------------
echo   المتصفح : %BROWSER%
echo   العنوان : %APP_URL%
echo.
echo   ستُطبع الفواتير فوراً بلا نافذة طباعة.
echo   لا تغلق هذه النافذة السوداء قبل إغلاق المتصفح.
echo.

start "" "%BROWSER%" ^
  --kiosk-printing ^
  --user-data-dir="%PROFILE_DIR%" ^
  --no-first-run ^
  --no-default-browser-check ^
  --disable-features=Translate ^
  --start-maximized ^
  "%APP_URL%"

endlocal
exit /b 0
