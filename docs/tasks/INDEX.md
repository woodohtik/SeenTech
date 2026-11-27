# فهرس المهام — المرجع الواحد

`seen-stability-guardrails-task.md`، المرحلة 4. آخر تحديث: 25 نوفمبر 2026.

## القاعدة

- **قبل بدء أي مهمة** يحدّث Claude Code حالتها هنا.
- **«منتهي»** يعني:
  - كل معايير القبول ✅.
  - اختباراتها مكتوبة.
  - الفحص أخضر.
- **«في الإنتاج»** يعني أن آخر commit للمهمة جزء من `main` المنشور.

## أين الملفات

- `docs/tasks/`: ملفات المهام (`seen-*-task.md`).
- `docs/reviews/`: المراجعات والتقارير.
- `docs/founder/`: ملفات المؤسس (قوائم المتابعة، النماذج، الجداول).

**المستودع عام** (`github.com/woodohtik/SeenTech`). لذلك محتوى المجلدات الثلاثة **لا يدخل git**، ما عدا هذا الفهرس والملفات التي كانت محفوظة فيه من قبل (`.gitignore`). مهمة جديدة يضعها المؤسس في الجذر، ثم تُنقل هنا حين تبدأ.

## المهام

| الملف | الحالة | آخر commit | في الإنتاج | ملاحظة |
| --- | --- | --- | --- | --- |
| `seen-stability-guardrails-task.md` | **منتهية** على staging | staging | المراحل 2–6 نعم؛ المسارات 7–10 على staging | المسارات الذهبية العشرة في CI (19 اختباراً مع مسار الصور): الدخول؛ البيع والفاتورة؛ إضافة موظف وخياط؛ التتبع؛ طلب تفصيل بالقص والمكوّنات؛ الرصيد الافتتاحي وأرقام المشتريات؛ المرتجع؛ إقفال الوردية؛ الصلاحيات؛ الدخول بالرمز. كشفت 4 أخطاء وأُصلحت. على المؤسس: جعل فحص golden إلزامياً لـ main |
| `seen-merchant-trial-test-2026-11-26.md` | **منتهية** (المراحل 1–4 + المسارات الذهبية) | `91c7d61` في الإنتاج؛ بعده على staging | 1–4 نعم؛ إصلاحات المسارات الذهبية على staging | سيناريوهاتها في المسارات الذهبية 3–6 (11 اختباراً، كلها تمر). المسار 5 كشف خللين وأُصلحا على staging: نوع التفصيل والكتف لا يُحفظان في الطلب، ونافذة الطلب المفتوحة لا تتحدث بعد نقل المرحلة |
| `seen-order-images-upload-task.md` | **منتهية** على staging (عدا تجربة الأجهزة الحقيقية) | staging | لا | migrations `20270122000000` (bucket خاص) و`20270122000001` (`set_order_images`). المسار الذهبي 11: صورة 3000px بـ GPS ← WebP ≤ 300 ك.ب بلا EXIF وبلا رابط عام. على المؤسس/المراجع: آيفون وأندرويد والتوقيع على 5 صور حقيقية |
| `seen-product-variants-barcode-po-price-task.md` | **منتهية** على staging | staging | لا | 4 migrations `20270123000000`–`000003`. المسار الذهبي 12 أخضر. **قبل الإنتاج:** يشغّل المؤسس `scripts/release/barcode-duplicates-report.sql` على الإنتاج ويشوف التقرير (صفر على staging) |
| `seen-open-verticals-task.md` | **المرحلة 0 منتهية** على staging؛ الموجات 1–3 لم تبدأ | staging | لا | التقارير وأداء الموظفين بالـ phase؛ اسم المرحلة الخاص بكل نشاط (كان «جاهز للاستلام» للأثاث)؛ محل اختبار ومسار ذهبي لكل نشاط في CI (مصطلحات بالكلمة الكاملة، بيع وفاتورة، طلب حتى التسليم) — كلها خضراء. حسابات مالك على staging ما انعملت (قاعدة لا حسابات تجريبية) |
| `seen-ui-responsive-alignment-audit-task.md` | **قيد التنفيذ** — المراحل 0–2 ومعظم 3–4 على staging | staging | لا | حارس التخطيط في CI (تقرير فقط): من 151 فشل إلى 12 (أهداف لمس صغيرة في رسم المقاسات). صفوف المؤسس الأربعة متحاذية، الحقول 48، النوافذ حوار حقيقي، المساعد يختفي وقت النوافذ. **باقي:** بطاقة الوردية سطر واحد في نقطة البيع، فلاتر لوحة التحكم في ورقة، PageHeader، شبكة أعمدة الطلبات على 1280، صفحة المقارنة، وتجربة أجهزة حقيقية (على المؤسس) |
| `seen-sentry-setup-task.md` | منتهي (ما تبقى خطوات المؤسس) | `52f947c` | نعم | التنبيهات، و2FA، وDPA، ونص سياسة الخصوصية: بانتظار المؤسس |
| `seen-blog-cta-to-signup-task.md` | منتهي | `4c17443` | نعم | |
| `seen-cutting-fabric-pos-orders-fix-task.md` | منتهي | `0db3424` | نعم (مع الهجرة) | |
| `seen-friendly-errors-everywhere-task.md` | منتهي | `c50a3a4` | نعم | يحل محل `seen-login-error-messages-task.md` |
| `seen-login-error-messages-task.md` | **ملغى، مستبدل بـ** `seen-friendly-errors-everywhere-task.md` | `7f8c28c` | نعم | نُفّذت مرحلته (شاشة الدخول) قبل الاستبدال |
| `seen-whatsapp-templates-task.md` | منتهي | `30fc0f1` | نعم (مع الهجرة) | |
| `seen-measurements-layout-fix-task.md` | منتهي | `369ac16` | نعم | |
| `seen-measurements-basic-advanced-task.md` | منتهي | `cdc4369` | نعم | |
| `seen-invoice-layout-settings-task.md` | منتهي | `f7192d5` | نعم | |
| `seen-search-appearance-task.md` | منتهي | `73be032` | نعم | |
| `seen-update-delivery-fix-task.md` | منتهي | `95ade80` | نعم | احذف كود الإنقاذ في `public/sw-extra.js` بعد 2 ديسمبر 2026 بطلب المؤسس |
| `seen-vercel-build-usage-task.md` | منتهي | `f5852d3` | نعم | |
| `seen-readiness-fixes-task.md` | منتهي | `a60ba7e` | نعم | التقرير الختامي في `docs/reviews/` |
| `seen-responsive-layout-task.md` | منتهي | `bc5cb78` | نعم | |
| `seen-permissions-fix-task.md` | منتهي | `bd996b7` | نعم | |
| `seen-verticals-readiness-task.md` | منتهي | `c7dd2cf` | نعم | |
| `seen-performance-first-open-login-task.md` | منتهي | `ac37b4f` | نعم | |
| `seen-tailoring-order-fabric-units-task.md` | منتهي | `88adf5c` | نعم | |
| `seen-security-fixes-task.md` | منتهي | دفعات `20270112000001`…`4` | نعم | المصدر `seen-security-audit-report-2026-11-22.md` |
| `seen-status-fix-regressions-task.md` | منتهي | `dd6de10` | نعم | اختبار رجوعه في `supabase/tests/regressions_test.sql` |
| `seen-cto-sprint4-design-quality-task.md` | منتهي | `7f232d0` | نعم | |
| `seen-cto-sprint4-permissions-task.md` | منتهي | `06e141d` | نعم | |
| `seen-cto-sprint2-pagination-task.md` | منتهي | `e473fc9` | نعم | |
| `seen-cto-sprint2-reports-engine-task.md` | منتهي | `f16bed5` | نعم | |
| `seen-cto-sprint1-financial-engine-task.md` | منتهي | `1727261` (PR #1) | نعم | |
| `seen-cto-sprint0-critical-fixes-task.md` | منتهي | `d00b539` | نعم | |
| `seen-pwa-update-detection-task.md` | منتهي، تكمّله `seen-update-delivery-fix-task.md` | `e7a2a00` | نعم | |
| `seen-fields-categories-referral-task.md` | منتهي | `f891876` | نعم | |
| `seen-blog-implementation-task.md` | منتهي (المدونة منشورة) | — | نعم | لا commit يذكره بالاسم |
| `seen-assistant-speed-task.md` | **لم يبدأ** | — | لا | جديد (25 نوفمبر) |
| `seen-free-daily-backup-task.md` | **لم يبدأ** | — | لا | جديد (25 نوفمبر). الإنتاج بلا نسخ احتياطية |
| `seen-ai-assistant-redesign-task.md` | غير مؤكد | — | — | لا commit يذكره بالاسم. يؤكده المؤسس |
| `seen-vercel-usage-print-agent-task.md` | غير مؤكد | — | — | لا commit يذكره بالاسم. يؤكده المؤسس |
| `seen-scalability-task.md` | غير مؤكد | — | — | لا commit يذكره بالاسم. يؤكده المؤسس |
| `seen-marketing-videos-task.md` | غير مؤكد | — | — | خارج الكود |

## خطط ودراسات (ليست مهام تنفيذ)

| الملف | ملاحظة |
| --- | --- |
| `seen-infrastructure-plan.md` | خطة 12 شهراً (22 نوفمبر) |
| `seen-supabase-migration-study.md` | دراسة نقل قاعدة البيانات داخل السعودية |
| `seen-zatca-phase2-requirements.md` | متطلبات المرحلة الثانية من زاتكا |
| `seen-zatca-service-process.md` | |

## المراجعات والتقارير (`docs/reviews/`)

- **التقارير:** `seen-security-audit-report-2026-11-22.md`، `seen-readiness-final-report-2026-11-23.md`، `seen-readiness-review-2026-11-21.md`، `seen-launch-readiness-report.md`.
- **المراجعات:** `seen-status-review-2026-11-17.md`، `seen-shop-owner-review-2026-11-18.md`، `seen-cto-code-review-2026-11-13.md`، `seen-super-admin-dashboard-review.md`، `seen-tablet-mobile-ux-review.md`، `seen-deep-technical-audit.md`، `AUDIT_SUMMARY.md`، `seen-weekly-dev-report-2026-11-10.md`.
- **مراجعات الفريق التقني الكامل:** `مراجعة-الفريق-التقني-الكامل-*.md` (أربع).

## مهام أقدم (سبتمبر وأكتوبر 2026، في `docs/tasks/` من قبل)

| الملف | الحالة | آخر commit |
| --- | --- | --- |
| `seen-whatsapp-auto-send-task.md` | **ملغى**: توقف في المرحلة 2 (Baileys/Evolution غير رسمي)، والتطبيق باقٍ على روابط `wa.me`. بعده `seen-whatsapp-templates-task.md` | `7008a00` |
| `seen-whatsapp-api-integration-task.md` | **ملغى** مع ما سبقه (لا commit يذكره) | — |
| `seen-zatca-readiness-task.md` | منتهي | `575ddb9` |
| `seen-offline-coverage-and-performance-task.md` (+ `_1`) | منتهي | `ae88075` |
| `seen-offline-sync-architecture-task.md` | منتهي | `3be6690` |
| `seen-comprehensive-review-fixes-task.md` | منتهي | `89301b7` |
| `seen-master-backlog-and-structure.md`، `security-fix-tasklist.md` | منتهي | `26b2af4` |
| `seen-companion-app-task_1.md`، `seen-companion-app-android-task.md`، `seen-customer-app-design-upgrade-task.md`، `repair-tasklist-corrupted-files.md` | منتهي | `9c8fa2c`، `4f32698`، `f1808ec`، `3764425` |
| `seen-fault-isolation-task.md`، `seen-responsive-audit-task.md` | منتهي | `bb4ee50`، `09a54e1` |
| `seen-activate-verticals-task.md`، `seen-new-verticals-task.md` | غير مؤكد (التخصصات موجودة، ولا commit يذكرهما بالاسم) | — |
| `seen-smart-assistant-full-task.md`، `-data-access-`، `-multi-provider-` | غير مؤكد (المساعد موجود، ولا commit يذكرها بالاسم) | — |
| `seen-design-professionalization-task.md`، `seen-icon-replacement-task.md` | غير مؤكد | — |
| `seen-bmad-method-integration.md`، `seen-dev-tools-integration-task.md`، `seen-graphify-agentskills-integration.md`، `seen-superpowers-stage3-task.md` | أدوات تطوير، غير مؤكد | — |
