# دليل النشر — سِين (Seen)

مرجع واحد لبناء ونشر كل هدف في هذا المستودع. مكتوب لأن هذه المعرفة كانت متناثرة بين تعليقات كود وملفات README فرعية فقط لجزء الطباعة — راجع [مراجعة-الفريق-التقني-الكامل-2026-09-17.md](../مراجعة-الفريق-التقني-الكامل-2026-09-17.md) للسياق الكامل لهذا القرار.

**القاعدة الثابتة لهذا المشروع:** كل عمل تطويري جديد يُنشر على **staging فقط** (`staging.seentech.io`، الفرع `staging`). النشر على **production** (`www.seentech.io`، الفرع `main`) لا يتم إلا بطلب صريح ومنفصل.

---

## 1) الويب — Vercel (الهدف الرئيسي)

**البنية:** تطبيق React (Vite) + خادم Express (`server.ts`) يُبنى كملف واحد (`dist/server.cjs`) ويُنشر كـVercel Serverless Function عبر `api/index.js`. التوجيه في `vercel.json`: كل طلب لـ`/api/*` يذهب لـ`api/index.js`، وكل ما عداه يُخدَم كملف ثابت (`index.html` + SPA fallback).

**النشر:** تلقائي عبر تكامل Vercel-GitHub — أي push لفرع `staging` أو `main` يُنشر تلقائياً على الرابط المطابق. لا توجد خطوة نشر يدوية أو ضمن CI (`.github/workflows/ci.yml` يفحص وbnي فقط، لا ينشر).

**البناء محلياً (للتحقق قبل الدفع):**
```bash
npm run build            # يبني dist/ + dist/server.cjs
npm run build:customer   # يبني dist-customer/ (تطبيق العملاء، مُستخدَم لاحقاً في capacitor-customer/)
```

**متغيرات البيئة:** تُضبَط في لوحة Vercel (Project Settings → Environment Variables)، بنفس المتغيرات الموثَّقة في `.env.example` بجذر المستودع. أهم نقطة: **`VITE_CUSTOMER_API_ORIGIN` لا علاقة له بهذا الهدف** (خاص فقط ببناء تطبيق العملاء Android، انظر القسم 3).

**ملاحظة تاريخية مهمة (`api/index.js`):** يجب أن يبقى ملف `.js` من نوع ESM عادي (وليس `.cjs` أو استيراد `server.ts` مباشرة) — كلا البديلين جُرِّبا وفشلا فعلياً في الإنتاج سابقاً (تفاصيل التعليق داخل الملف نفسه). لا تُغيِّر هذا الملف دون فهم كامل لذلك السياق.

---

## 2) قاعدة البيانات — Supabase

كل تغيير في المخطط يجب أن يمر عبر `supabase/migrations/` (ملف SQL جديد لكل تغيير، لا تعديل ملفات قديمة بعد تطبيقها). التطبيق يتم عبر:
```bash
npx supabase db push
```
هذا يطبّق كل الترحيلات غير المُسجَّلة بعد على المشروع المرتبط حالياً بـSupabase CLI (`npx supabase projects list` لمعرفة أيّها).

**تحذيرات مهمة مستخلَصة من هذا المستودع تحديداً:**
- **`supabase/legacy-setup/*.sql`** يحتوي المخطط الأساسي التاريخي (تنزيلات يدوية قديمة) — **غير مُدار كترحيلات متتبَّعة بالكامل بعد**؛ بعض أجزائه (`wdooh-database-schema.sql`) صار مُتتبَّعاً (`20240601000000_track_base_schema.sql`)، لكن ملفات أخرى (`MARKETPLACE_foundation.sql`, `PLG_trial_lifecycle.sql`, إلخ) لا تزال تحتاج تحققاً يدوياً قبل الاعتماد عليها في بيئة جديدة تماماً.
- **دوال `SECURITY DEFINER` التي تفحص `current_user`**: هذا النمط معطوب — `current_user` داخل دالة `SECURITY DEFINER` يعكس *مالك الدالة* لا المستدعي الفعلي. استُخدِم هذا النمط الخاطئ مرتين في هذا المشروع واكتُشِف وأُصلِح (`20260920020000`, `20260920090000`) — لا تكرّره في أي دالة جديدة.
- **التحقق الآمن من الحي دون تعديل بيانات حقيقية**: النمط المُتَّبَع في هذا المستودع هو كتابة migration مؤقت بصيغة `DO $$ ... RAISE EXCEPTION 'LABEL: %', value; END $$;`، تشغيله بـ`db push` (يقرأ الخطأ الناتج كمخرجات)، ثم حذف الملف فوراً — المعاملة لا تُلتزَم أبداً فتبقى آمنة تماماً على بيانات حقيقية.

---

## 3) تطبيق الموظفين Android (`android/`)

**appId:** `io.seentech.staff` — توزيع مباشر (APK موقَّع)، **ليس** على متجر Google Play.

**الطبيعة:** غلاف Capacitor حول الموقع الحي مباشرة (`capacitor.config.ts` في جذر المستودع، `server.url` يشير لـ`staging.seentech.io/login` افتراضياً) — **ليس** بناءً مُجمَّعاً (`webDir` غير مُستخدَم فعلياً هنا). أي تعديل على الموقع ينعكس فوراً في التطبيق المثبَّت بلا حاجة لإعادة بناء APK.

**البناء:**
```bash
npx cap sync android
cd android && ./gradlew assembleRelease   # أو assembleDebug للتجربة
```

**التوقيع:** `android/keystore/keystore.properties` (غير متتبَّع في git، `.gitignore` يستثنيه صراحة) يحمل بيانات التوقيع الفعلية — يجب توفيره يدوياً على أي جهاز بناء جديد، لا يُشارَك عبر المستودع.

**التحكم بالوجهة:** متغيّر بيئة `CAPACITOR_SERVER_URL` وقت البناء (وليس `.env`/Vite) يبدّل الوجهة عن الافتراضي (staging) — استخدامه لتوجيه نحو الإنتاج يخضع لنفس قاعدة "لا نشر إنتاج إلا بطلب صريح".

---

## 4) تطبيق العملاء Android (`capacitor-customer/`)

**appId:** `io.seentech.customer` — **على متجر Google Play** (توزيع عام)، بخلاف تطبيق الموظفين.

**الطبيعة:** بناء مُجمَّع بالكامل (`webDir: '../dist-customer'`) لا غلاف على موقع حي — سياسة Google Play للحد الأدنى من الوظائف تفضّل تطبيقاً حقيقياً مُجمَّعاً على غلاف WebView لموقع خارجي.

**خطوات البناء الكاملة:**
```bash
npm run build:customer          # يبني dist-customer/
npx cap sync android --project capacitor-customer
cd capacitor-customer/android && ./gradlew bundleRelease   # .aab لرفعه على Play Console
```

**متغيّر بيئة حرِج — `VITE_CUSTOMER_API_ORIGIN`:** التطبيق مُجمَّع بلا أصل صفحة حي، فيحتاج أصل API مطلق صريح وقت البناء (`src/lib/apiBase.ts`) ليعمل. **القيمة الافتراضية عند غيابه هي `staging.seentech.io`** — أي بناء إنتاجي فعلي (للرفع على Play Store) **يجب** أن يضبط هذا المتغيّر صراحة على `https://www.seentech.io` وقت `npm run build:customer`، وإلا سيتصل التطبيق المنشور فعلياً بـstaging بصمت بلا أي خطأ ظاهر.
```bash
VITE_CUSTOMER_API_ORIGIN="https://www.seentech.io" npm run build:customer
```

---

## 5) وسيط الطباعة الصامتة (`print-agent/`)

يعمل على **جهاز الكاشير نفسه** (ويندوز أساساً، ويدعم ماك/لينكس عبر Node.js) — لا يحتاج نشراً على Vercel أو أي خادم؛ يتصل خارجاً بسيرفر سين وينتظر مهام الطباعة (long-poll)، فلا حاجة لفتح أي منفذ أو التعامل مع قيود CORS/Local-Network-Access الحديثة في المتصفحات.

**التوزيع:** ملف تنفيذي واحد (`seen-print-agent.exe`, غير موقَّع رقمياً — SmartScreen يحذّر مرة واحدة لكل جهاز) أو نسخة PowerShell بديلة بلا تحذير. كلاهما يُحمَّل من داخل التطبيق نفسه (إعدادات الطابعة → "الطباعة الصامتة").

**بناء نسخة `.exe` جديدة:**
```powershell
cd print-agent
./build-exe.ps1
```
راجع [print-agent/README.md](../print-agent/README.md) للتفاصيل الكاملة حول بروتوكول الاتصال والأمان (رموز اقتران 6 محارف، حد محاولات، عزل tenant).

---

## 6) وضع الطباعة الكاملة المقاسات (`kiosk-print/`)

لا يحتاج بناءً أو نشراً مستقلاً — هو أسلوب تشغيل بديل (فتح النظام عبر ملف `.bat` مرفق يشغّل المتصفح في وضع kiosk-printing) يُستخدَم فقط حين تحتاج مقاسات طباعة غير مدعومة بالطباعة الصامتة المباشرة (A4/A5 بدل الحراري 80mm/58mm فقط). راجع [kiosk-print/README.md](../kiosk-print/README.md).

---

## 7) CI (`.github/workflows/ci.yml`)

يعمل تلقائياً على كل push/PR لفرعي `staging` و`main`: فحص أنواع (`tsc --noEmit` — **وليس ESLint حقيقياً**، رغم اسم السكربت `lint`)، اختبارات الوحدة (Vitest)، بناء التطبيقين (الرئيسي والعملاء)، واختبارات Playwright (تعمل دائماً بلا شروط — كل استدعاءات الخادم فيها مموَّهة عبر `page.route()`، لا تلمس بيانات حقيقية ولا تحتاج تسجيل دخول). **لا توجد خطوة نشر ضمن CI** — النشر منفصل تماماً عبر تكامل Vercel التلقائي (القسم 1).

---

## 8) مرجع سريع لمتغيرات البيئة

كل المتغيرات موثَّقة بالتفصيل (من أين تُستخرَج، متى تكون ضرورية فعلاً) في [`.env.example`](../.env.example) بجذر المستودع — هذا فقط تصنيف سريع:

| الفئة | أمثلة | ملاحظة |
|---|---|---|
| Supabase | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` | أساسية لكل شيء |
| Firebase | `VITE_FIREBASE_*`, `FIREBASE_SERVICE_ACCOUNT` | بعضها انتقالي مؤقت (مصادقة)، بعضها دائم (إشعارات push) |
| تشفير خادمي | `ZATCA_ENCRYPTION_KEY`, `ASSISTANT_ENCRYPTION_KEY` | مفتاحان منفصلان عمداً — تسرّب أحدهما لا يكشف الآخر |
| الدفع | `PAYMENT_PROVIDER`, `MOYASAR_SECRET_KEY`, `PAYMOB_API_KEY` | البوابة غير محسومة بعد، اضبط مفتاح المزوّد المُختار فقط |
| تطبيق العملاء | `VITE_CUSTOMER_API_ORIGIN` | حرِج عند البناء الإنتاجي — راجع القسم 4 |
| مراقبة | `VITE_SENTRY_DSN` | اختياري، يعمل فقط في بناء إنتاجي فعلي |
| هجرة بيانات لمرة واحدة | `FIREBASE_AUTH_EXPORT_PATH`, `FIREBASE_SCRYPT_*` | لتشغيل `scripts/migrate.ts` يدوياً فقط، ليست جزءاً من تشغيل التطبيق |
