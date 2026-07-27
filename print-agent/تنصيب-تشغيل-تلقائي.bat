@echo off
chcp 65001 >nul
setlocal

rem ==========================================================================
rem   تنصيب وسيط سين للطباعة ليعمل تلقائياً مع تشغيل ويندوز
rem   يُنشئ مهمة مجدولة تعمل عند تسجيل دخول المستخدم، بنافذة مخفية.
rem   لا يحتاج صلاحيات مسؤول.
rem ==========================================================================

title تنصيب وسيط سين للطباعة
cd /d "%~dp0"

set "AGENT=%~dp0seen-print-agent.ps1"

if not exist "%AGENT%" (
  echo   [خطأ] الملف seen-print-agent.ps1 غير موجود بجوار هذا الملف.
  pause
  exit /b 1
)

echo.
echo   ================================================
echo      تنصيب التشغيل التلقائي
echo   ================================================
echo.
echo   ملاحظة: انقل مجلد print-agent إلى مكان دائم قبل التنصيب
echo   (مثل C:\SeenPrintAgent) - لأن المهمة ستشير لهذا المسار.
echo.
echo   المسار الحالي: %~dp0
echo.

set "URL="
set /p URL="   أدخل رابط نظام سين (مثال https://app.seen.sa): "

if "%URL%"=="" (
  echo.
  echo   [خطأ] لا يمكن التنصيب بدون رابط السيرفر.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%AGENT%" -ServerUrl "%URL%" -Install

echo.
echo   سيبدأ الوسيط تلقائياً في المرة القادمة التي تشغّل فيها الجهاز.
echo   لتشغيله الآن: اضغط مزدوجاً على  تشغيل-وسيط-الطباعة.bat
echo.
pause
