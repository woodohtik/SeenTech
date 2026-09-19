# سِين (Seen)

نظام كاشير سحابي (SaaS) متعدد المستأجرين لمحلات التفصيل والأقمشة في السعودية والخليج — نقطة بيع، إدارة طلبات وقياسات، مخزون، موردين، فوترة ضريبية متوافقة مع زاتكا (قيد الإنجاز)، ومزامنة أوفلاين كاملة.

- **staging:** https://staging.seentech.io
- **production:** https://www.seentech.io

## البنية التقنية الفعلية

- **الواجهة:** React 19 + TypeScript + Vite + Tailwind CSS v4.
- **الخادم:** Express (`server.ts`) — يعمل محلياً عبر `tsx`، ويُبنى ويُنشر على Vercel كـ Serverless Function (`api/index.js`) في الإنتاج.
- **قاعدة البيانات:** Supabase (Postgres + Auth + Realtime + Storage)، عبر ملفات `supabase/migrations/`.
- **المصادقة:** Supabase Auth أساساً، مع مسار احتياطي مؤقت لـFirebase Auth أثناء فترة انتقالية (يُزال لاحقاً — راجع تعليقات `authMiddleware.ts`).
- **الأوفلاين:** Dexie (IndexedDB) لتخزين مؤقت وطابور مزامنة (`src/lib/offline/`) — البيع والطلبات تعمل بلا اتصال وتُزامَن تلقائياً عند عودته.
- **التطبيقات الأصلية:** Capacitor — تطبيق الموظفين (`android/`) وتطبيق العملاء (`capacitor-customer/`).
- **الطباعة:** وسيط طباعة صامتة على جهاز الكاشير (`print-agent/`) + وضع kiosk للطباعة الكاملة المقاسات (`kiosk-print/`).

للتفاصيل الكاملة حول بناء ونشر كل هدف من هذه الأهداف، راجع **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

## التشغيل محلياً

1. **التبعيات:**
   ```bash
   npm install
   ```

2. **متغيرات البيئة:** انسخ `.env.example` إلى `.env.local` واملأ القيم الحقيقية (تعليقات كل متغير توضح من أين تُستخرَج ومتى تكون ضرورية فعلاً).
   ```bash
   cp .env.example .env.local
   ```

3. **تشغيل الخادم (يشمل الواجهة عبر Vite في وضع Middleware):**
   ```bash
   npm run dev
   ```

## الأوامر الرئيسية

| الأمر | الوصف |
|---|---|
| `npm run dev` | تشغيل محلي (`tsx server.ts`، يخدم الواجهة عبر Vite middleware) |
| `npm run build` | بناء تطبيق الموظفين + حزم `server.ts` لنشر Vercel |
| `npm run build:customer` | بناء تطبيق العملاء (لتضمينه في `capacitor-customer/`) |
| `npm run lint` | فحص الأنواع (`tsc --noEmit`) — هذا **ليس** ESLint فعلياً |
| `npm run test` | اختبارات الوحدة (Vitest) |
| `npm run test:e2e` | اختبارات Playwright |
| `npm run db:migrate` | سكربت ترحيل بيانات مرحلة 2 (Firebase → Supabase)، لتشغيل المُشغِّل يدوياً فقط، ليس جزءاً من التشغيل العادي |

## سير العمل والنشر

- **الفرع `staging`** → `staging.seentech.io` (كل عمل تطويري جديد يُدفع هنا أولاً).
- **الفرع `main`** → `www.seentech.io` (الإنتاج — لا يُنشر عليه إلا بطلب صريح).
- CI (`.github/workflows/ci.yml`) يعمل على كل push/PR لكلا الفرعين: فحص أنواع، اختبارات وحدة، بناء التطبيقين، واختبارات Playwright.

## هيكل المستودع (مختصر)

```
src/               تطبيق الموظفين (React) — المكوّنات، الخدمات، الأوفلاين
server.ts          خادم Express (API + وسيط الطباعة + تكامل المساعد الذكي)
api/index.js       نقطة دخول Vercel Function (تُحمّل dist/server.cjs المبني)
supabase/          ترحيلات قاعدة البيانات (migrations/) والملفات القديمة (legacy-setup/)
android/           تطبيق الموظفين Capacitor (WebView حي على staging/production)
capacitor-customer/ تطبيق العملاء Capacitor (حزمة مضمَّنة، متجر Google Play)
print-agent/       وسيط الطباعة الصامتة (Windows/عبر منصات)
kiosk-print/       وضع الطباعة الكاملة المقاسات بلا نافذة طباعة
docs/DEPLOYMENT.md دليل النشر الكامل لكل الأهداف أعلاه
```
