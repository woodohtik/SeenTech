@echo off
chcp 65001 >nul
setlocal

rem ==========================================================================
rem   وسيط سين للطباعة  —  مشغّل بنقرة واحدة
rem   --------------------------------------------------------------------
rem   لا يحتاج Node.js ولا أي تنصيب يدوي. PowerShell موجود في كل نسخ ويندوز.
rem   رابط السيرفر مضبوط افتراضياً على النسخة السحابية الموحّدة، وبعد أول
rem   اقتران ناجح يُفعَّل التشغيل التلقائي مع ويندوز تلقائياً — نقرة مزدوجة
rem   واحدة على هذا الملف، للأبد.
rem
rem   للاتصال بسيرفر مختلف (بيئة تجريبية فقط): اكتب رابطه بين علامتي
rem   التنصيص في السطر التالي.
rem ==========================================================================

set "SEEN_SERVER_URL="

title وسيط سين للطباعة - SEEN Print Agent
cd /d "%~dp0"

echo.
echo   ================================================
echo      وسيط سين للطباعة  -  SEEN Print Agent
echo   ================================================
echo.

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo   [خطأ] لم يتم العثور على PowerShell على هذا الجهاز.
  echo   هذا غير معتاد - تأكد أن نسخة ويندوز سليمة.
  echo.
  pause
  exit /b 1
)

set "AGENT=%~dp0seen-print-agent.ps1"

if not exist "%AGENT%" (
  echo   [خطأ] الملف seen-print-agent.ps1 غير موجود بجوار هذا الملف.
  echo   انسخ مجلد print-agent بالكامل ولا تفصل ملفاته.
  echo.
  pause
  exit /b 1
)

echo   جاري تشغيل الوسيط... اترك هذه النافذة مفتوحة أثناء العمل.
echo.

if defined SEEN_SERVER_URL (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%AGENT%" -ServerUrl "%SEEN_SERVER_URL%" %*
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%AGENT%" %*
)

echo.
echo   توقف الوسيط. اضغط أي مفتاح للإغلاق.
pause >nul
