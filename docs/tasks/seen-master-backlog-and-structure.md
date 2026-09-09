# سِين — القائمة الرئيسية الموحَّدة (كل ما يحتاج معالجة) + خطة تنظيم بنية المستودع

> هذا الملف **فهرس وتوليف**، لا يُلغي الملفات التفصيلية الأخرى (`security-fix-tasklist.md`، `seen-comprehensive-review-fixes-task.md`، `seen-round2-findings-task.md`) — بل يرتّبها كلها في أولوية واحدة، ويضيف قسماً جديداً بالكامل: تنظيم بنية المستودع نفسها (لم يكن جزءاً من أي تقرير سابق).

---

## 🎭 الأدوار

- **أنت (جلسة Claude Code التنفيذية):** تنفّذ كل ما أدناه مباشرة على `D:\seen-repo` / `G:\seen-repo`، بالترتيب المذكور.
- **أنا (محلل المراجعة):** جمعت كل نتيجة من 4 جولات مراجعة سابقة + هذه الجولة الخامسة (فحص بنية المستودع) في مكان واحد، برابط لكل بند لمصدره الأصلي.
- **صاحب المشروع (سِين):** بندان فقط يحتاجان قرارك أنت تحديداً (مُعلَّمان أدناه) — لا تنفَّذ كمهام، بل كقرار.

---

## 🎯 السياق — من أين جاء كل هذا

خمس جولات مراجعة منفصلة أُجريت على هذا المشروع: (1) تحقق من `security-fix-tasklist.md` الذاتي (12 بنداً)، (2) مراجعة شاملة لكل ملفات `src/` (37 مشكلة جديدة)، (3) تحقق من تنفيذ الإصلاحات بعد أن نفّذتها جلستك (29/30 مؤكَّد)، (4) اكتشاف `remap_user_uid` أثناء مسح نصي لكل الـ53 migration بحثاً عن نمط `REVOKE ALL FROM PUBLIC` غير الفعّال، (5) هذه الجولة: فحص بنية المستودع نفسها بناءً على طلبك. كل بند أدناه يحمل مصدره.

---

## 📋 القائمة الموحَّدة — بالأولوية الفعلية

### 🚨 P0 — عاجل، ينفَّذ الآن قبل أي شيء آخر

| # | البند | المصدر | الحالة |
|---|---|---|---|
| 1 | `remap_user_uid` — `REVOKE EXECUTE ... FROM anon, authenticated` | جولة 4 (اليوم) | إصلاح جاهز في `seen-round2-findings-task.md`، لم يُؤكَّد التنفيذ بعد |
| 2 | فحص حي شامل (`information_schema.routine_privileges`) على **كل** دالة في المشروع، لا فقط الست المُكتشَفة اليوم — النمط قد يتكرر في دوال لم تُفحَص | جولة 4 (توصية) | لم يبدأ |
| 3 | تأكيد تدوير مفتاح خدمة Firebase المسرَّب في تاريخ GitHub العام (+ تدوير `GEMINI_API_KEY` المرافق) | جولة 1 (القسم A) | غير مؤكَّد — إجراء بشري خارج الكود |
| 4 | تسريب الإيرادات لكل الأدوار — `DashboardOwner.tsx`/`Dashboard.tsx` (شارة النمو، بطاقة المالية، مبالغ الطلبات الأخيرة) | جولة 3 | لم يُصلَح بعد — التفصيل في `seen-round2-findings-task.md` |

### ⚠️ يحتاج قرارك أنت — ليس إصلاح كود

| # | البند | المصدر |
|---|---|---|
| 5 | تخزين PIN كنص صريح — مؤكَّد كقرار منتج بتاريخ 2026-09-08، لكنه يحتاج توثيقاً واحداً صريحاً بدل تعليقين متعارضين، وقرارك: هل يكفي هذا أم يحتاج تشفيراً حقيقياً؟ | جولة 1+3، تفصيل كامل في `seen-round2-findings-task.md` |

### 🔴 P1 — أولوية عالية (كود)

| # | البند | الملف | المصدر |
|---|---|---|---|
| 6 | نطاق `gmail.com` في `officialDomains` — عبوة موقوتة معطّلة حالياً | `src/services/saasSecurityService.ts` | جولة 3 |
| 7 | خلل idempotency (`Math.random()` كمعرّف بديل) | `scripts/migrate.ts` | جولة 3 |

### 🟡 P2 — تنظيف/تصليب (لا يحجب الإطلاق)

| # | البند | الملف | المصدر |
|---|---|---|---|
| 8 | لا إعادة ضبط كاملة لحالة الموظف عند logout | `src/contexts/StaffContext.tsx` | جولة 3 |
| 9 | `onError` لا يُبطل ذاكرة الاستعلام | `src/hooks/useSafeMutation.ts` | جولة 3 |
| 10 | كتابة بلا إلزام `tenant_id` صريح (RLS فقط كطبقة وحيدة) | `src/lib/api/factory.ts` | جولة 3 |
| 11 | لا إعادة محاولة عند تصادم رقم الطلب التلقائي | `generateOrderNumber` | جولة 3 |
| 12 | مفتاح صلاحية مكرَّر بقيمتين مختلفتين | `src/constants/permissions.ts` | جولة 3 |
| 13 | ومضة محتوى غير مصرَّح (منخفض — المكوّن غير مستخدَم حالياً) | `src/components/PermissionGuard.tsx` | جولة 3 |
| 14 | ~7 بنود تنظيف منخفضة لم تُعَد مراجعتها تحديداً هذه الجولة (استيراد Excel يُفسِد سجل التدقيق، console.log لبيانات شخصية، لا حارس تزامن عند إغلاق الوردية، مسار رفع بلا تحقق تينانت صريح) | متفرّقة | جولة 2، لم تُتحقَّق في جولة 3 — افترض قائمة كما وُصِفت |

### 🔵 P3 — فجوات اختبار وعمليات (مُكتشَفة هذه الجولة)

| # | البند | الدليل |
|---|---|---|
| 15 | **لا يوجد أي CI/CD إطلاقاً** — مجلد `.github/workflows` غير موجود بالكامل | تحقّقت بالبحث المباشر — لا نتيجة |
| 16 | ملف اختبار e2e الوحيد (`order-tracking-notifications.spec.ts`) لا يُشغَّله أحد فعلياً — لا CI، ولا تشغيل يدوي مؤكَّد | نتيجة مباشرة من غياب CI |
| 17 | Vitest غير مثبَّت — لا اختبارات وحدة آلية على الإطلاق، رغم أنها أول خطوة في `seen-superpowers-stage3-task.md` | جولة 1 (تقرير الجاهزية) |
| 18 | Sentry (مراقبة أخطاء إنتاج) غير مثبَّت | جولة 1 |

### ⚪ P4 — ميزات مُخطَّطة لم تبدأ (ملفات جاهزة، ليست أخطاء)

| # | البند | الملف الجاهز |
|---|---|---|
| 19 | تكامل واتساب API حقيقي (لا يزال `wa.me` فقط) | `seen-whatsapp-api-integration-task.md` |
| 20 | تحسين تصميم تطبيق العميل | `seen-customer-app-design-upgrade-task.md` |
| 21 | تفعيل CSP فعلياً (معطّل عمداً وموثَّق حالياً) | جولة 1 (خطوة 6 في المسار السابق) |

---

## 🏗️ تنظيم بنية المستودع — قسم جديد بالكامل

فحصت جذر `G:\seen-repo` مباشرة (لا مقتطفات). الكود نفسه منظَّم جيداً (`src/`, `supabase/`, `scripts/`, `e2e/`...)، لكن **جذر المستودع نفسه** متراكم بملفات من مراحل عمل متتالية بلا مجلدات تصنّفها. هذا لا يُبطئ التطبيق، لكنه يُصعِّب على أي مطوّر جديد (أو عليك أنت) معرفة أي ملف لا يزال معتمَداً وأيها أرشيف.

### ما وجدته تحديداً

**أ) 18 ملف "seen-*-task.md" + تقارير متفرقة في الجذر مباشرة** — كلها ملفات مهام/تقارير سلّمتها هذه الجلسة أو جلسات سابقة، بلا أي مجلد يجمعها: `security-fix-tasklist.md`، `seen-comprehensive-review-fixes-task.md`، `seen-round2-findings-task.md`، وهذا الملف نفسه، إضافة لـ14 ملف "seen-*-task.md" أقدم (بعضها منفَّذ بالكامل، بعضها لم يبدأ بعد — القائمة في قسم "اكتمال الميزات" من تقرير الجاهزية)، بالإضافة لتقريرين عربيين مستقلين أقدم (`تقرير-المراجعة-الأمنية.md`، `تقرير-مراجعة-الجرد-وتحويل-الوحدات.md`) و6 ملفات توثيق إنجليزية (`ANALYTICS_PLAN.md`، `ARCHITECTURE.md`، `I18N_FIX_REPORT.md`، `PLG_FLOW_README.md`، `PUBLIC_TRACKING_SPEC.md`، `MIGRATION_STAGE1.md`) وملف `repair-tasklist-corrupted-files.md` (يبدو أثراً من حادثة تلف ملفات سابقة).

**ب) 8 ملفات SQL مستقلة في الجذر** خارج `supabase/migrations/`: `allow-all-rls.sql`، `INVENTORY_FIX.sql`، `LANDING_leads.sql`، `MARKETPLACE_foundation.sql`، `MIGRATION_extensibility_stage1/2/3.sql`، `PLG_trial_lifecycle.sql`، `REFERRAL_program.sql`، و`wdooh-database-schema.sql` (53 كيلوبايت — مخطط قاعدة البيانات الكامل الأصلي). هذه على الأرجح سكربتات إعداد لمرة واحدة سبقت نظام الـmigrations المرتَّب الحالي (53 ملف مرقَّم بالتاريخ في `supabase/migrations/`) — لكن بقاءها بلا تصنيف يخلق التباساً: هل لا تزال مطلوبة لإعداد قاعدة بيانات جديدة من الصفر، أم كل منطقها منقول فعلاً لملفات الـmigrations؟ **لا تحذفها قبل التأكد** — تحقّق أولاً (انظر خطوة 3 أدناه).

**ج) `allow-all-rls.sql` — طمأنة لا تحذير:** فتحته وقرأته كاملاً. هو مُعطَّل فعلياً وعمداً (`RAISE EXCEPTION` فور التشغيل) بتعليق يشرح أنه كان يفتح كل الجداول لأي قراءة/كتابة، ونُيِّط لمنع تشغيله بالخطأ. هذا إصلاح جيد موجود بالفعل — لا حاجة لأي إجراء عاجل، فقط يستحق نقله لمجلد أرشيف أوضح بدل الجذر مباشرة.

**د) `_to_delete/` في الجذر نفسه** — أثر من محاولة سابقة لحذف ملفات بلا صلاحية حذف مباشرة (نمط معروف). يحتوي 4 ملفات ZIP (تثبيت مهارات تصميم/واجهة، ~3.4 ميغابايت إجمالاً) + ملف اختبار فارغ. آمن الحذف الفعلي بالكامل.

**هـ) `firebase-debug.log` في الجذر** — ملف سجل تصحيح فعلي (3.4 كيلوبايت). `.gitignore` يستثني `*.log` بالفعل، فمن المفترض ألا يكون مُتتبَّعاً بـgit — لكن **تحقّق فعلياً** (`git ls-files | grep firebase-debug.log`) لأنه قد يكون أُضيف قبل قاعدة الاستثناء؛ إن كان مُتتبَّعاً، احذفه من git بـ`git rm --cached`.

**و) `dist/`, `dist-customer/`, `test-results/`, `playwright-report/`, `.vercel/`, `node_modules/`** — كلها مُستثناة بشكل صحيح في `.gitignore` بالفعل. لا حاجة لأي إجراء — ذكرتها فقط لأؤكد أنها **ليست** جزءاً من المشكلة.

**ز) لا يوجد أي CI/CD** — تكرار للبند 15 أعلاه، لكنه بند بنية تحتية بامتياز: لا `.github/workflows/`، فلا شيء يُشغِّل `npm run lint` أو `npm run build` أو `npm run test:e2e` تلقائياً عند أي push أو pull request.

### الخطة المقترحة

**الخطوة 1 — إنشاء مجلدي أرشفة، بلا حذف أي شيء:**
```bash
mkdir -p docs/tasks docs/reports supabase/legacy-setup
```

**الخطوة 2 — نقل ملفات المهام والتقارير (كل الـmd) إلى `docs/tasks/` و`docs/reports/`:**
```bash
git mv security-fix-tasklist.md seen-comprehensive-review-fixes-task.md seen-round2-findings-task.md \
       seen-master-backlog-and-structure.md seen-activate-verticals-task.md seen-bmad-method-integration.md \
       seen-companion-app-android-task.md seen-companion-app-task_1.md seen-customer-app-design-upgrade-task.md \
       seen-dev-tools-integration-task.md seen-fault-isolation-task.md seen-graphify-agentskills-integration.md \
       seen-new-verticals-task.md seen-responsive-audit-task.md seen-smart-assistant-data-access-task.md \
       seen-smart-assistant-full-task.md seen-smart-assistant-multi-provider-task.md seen-superpowers-stage3-task.md \
       seen-whatsapp-api-integration-task.md repair-tasklist-corrupted-files.md \
       docs/tasks/

git mv تقرير-المراجعة-الأمنية.md تقرير-مراجعة-الجرد-وتحويل-الوحدات.md ANALYTICS_PLAN.md ARCHITECTURE.md \
       I18N_FIX_REPORT.md PLG_FLOW_README.md PUBLIC_TRACKING_SPEC.md MIGRATION_STAGE1.md \
       docs/reports/
```
(أبقِ `README.md` في الجذر — هو نقطة الدخول المتوقَّعة لأي مطوّر أو أداة.)

**الخطوة 3 — قبل نقل ملفات الـSQL: تحقّق أن منطقها موجود فعلاً في `supabase/migrations/`.** لكل ملف من الثمانية، افتحه وقارن جداوله/دوالّه بمخرجات `supabase migration list` أو بحث سريع عن اسم الجدول الرئيسي في `supabase/migrations/`. إن وجدت منطقاً **غير منقول** لأي migration، لا تنقل ذلك الملف — حوّله أولاً لـmigration جديدة مرقّمة بالتاريخ (هذا يعني أن هناك جزءاً من قاعدة البيانات موثَّقاً فقط في ملف قديم غير رسمي، وهي فجوة توثيق حقيقية تستحق إصلاحاً منفصلاً لو وُجدت). بعد التأكد:
```bash
git mv allow-all-rls.sql INVENTORY_FIX.sql LANDING_leads.sql MARKETPLACE_foundation.sql \
       MIGRATION_extensibility_stage1.sql MIGRATION_extensibility_stage2.sql MIGRATION_extensibility_stage3_new_verticals.sql \
       PLG_trial_lifecycle.sql REFERRAL_program.sql wdooh-database-schema.sql \
       supabase/legacy-setup/
```

**الخطوة 4 — تنظيف فعلي (بعد نسخة احتياطية أو تأكيد أنك لا تحتاجها):**
```bash
rm -rf _to_delete/
git rm --cached firebase-debug.log 2>/dev/null || true   # فقط إن ظهر متتبَّعاً فعلاً
```

**الخطوة 5 — أضف CI حقيقياً.** أنشئ `.github/workflows/ci.yml` يُشغِّل عند كل push/PR: `npm ci`، `npm run lint` (فحص TypeScript)، `npm run build` و`npm run build:customer`. أضف `npm run test:e2e` كخطوة منفصلة تعمل فقط إن كان `PLAYWRIGHT_BASE_URL`/الوصول لبيئة staging متاحاً من عامل CI (GitHub Actions يصل للإنترنت عادة بخلاف بيئتي الحالية) — هذا يحل فجوة "لا أحد يُشغِّل اختبار e2e الوحيد الموجود" نهائياً بدل الاعتماد على تشغيل يدوي.

**الخطوة 6 — بعد النقل، حدّث أي مرجع داخلي** (روابط في README.md أو تعليقات كود تشير لمسار قديم لأحد هذه الملفات) بالمسار الجديد — بحث سريع بـ`grep -rn "wdooh-database-schema.sql\|INVENTORY_FIX.sql"` كافٍ للتأكد.

---

## ✅ معايير القبول

- [ ] البنود P0 الأربعة منفَّذة أو مؤكَّدة (خصوصاً #1 و#2).
- [ ] قرار PIN موثَّق في مكان واحد يعكس اختيارك الفعلي.
- [ ] جذر المستودع لا يحتوي أي ملف `.md` سوى `README.md` (البقية تحت `docs/`).
- [ ] لا ملف `.sql` مستقل في الجذر خارج `supabase/` (بعد التحقق من الخطوة 3).
- [ ] `_to_delete/` غير موجود.
- [ ] `.github/workflows/ci.yml` موجود، ويُشغِّل build + lint على الأقل عند كل push.
- [ ] `git status` بعد كل خطوة نظيف (لا ملفات غير متتبَّعة غير مقصودة).
