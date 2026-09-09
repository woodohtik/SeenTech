# خطة إصلاح تنفيذية — استعادة ملفات تالفة في seen-repo

**لمن يقرأ هذا الملف (Claude Code أو أي وكيل برمجي):** هذا ليس تقرير قراءة فقط — نفّذ الخطوات أدناه مباشرة على هذا المستودع، مهمة تلو الأخرى، بالترتيب المذكور. كل خطوة فيها أمر تحقق (verification) يجب تشغيله فعليًا قبل أي تعديل، وليس افتراضه. لا تُنفِّذ أي أمر Git يمس التاريخ المرفوع (push --force، إعادة كتابة تاريخ) أو فرع `main` دون عرضه على المستخدم أولًا والحصول على موافقته الصريحة.

## السياق (من تحليل سابق بتاريخ 22 أغسطس 2026)

فرع العمل الحالي هو `staging` (آخر كومِت وقتها `a6ecc3b`). جميع إصلاحات ملف `security-fix-tasklist.md` (15 مهمة أمنية، من B-1 إلى E-3) **مُنفَّذة ومحفوظة بكومِتات سليمة في تاريخ Git** على هذا الفرع. المشكلة الحالية **ليست** أمنية — بل تلف مادي في نسخة العمل (working tree) على القرص لم يُحفظ بعد، لاحقًا لآخر كومِت.

**السبب المرجّح:** المستودع يحوي عشرات السكربتات المساعدة من نوع "لصق وإصلاح" في الجذر (`fix_*.py`, `patch_*.py`, `fix-*.cjs`, ...). النمط المتكرر في الملفات التالفة (قطع مفاجئ في منتصف كلمة/رمز، أحيانًا في منتصف حرف عربي UTF-8 متعدد البايت، بلا سطر نهاية) يطابق خطأ شائع في بايثون على Windows: فتح ملف بـ `open(path, 'w')` بدون `encoding='utf-8'` صراحة، فتتعطل الكتابة (`UnicodeEncodeError`) في منتصف كتابة نص عربي وتترك الملف مقطوعًا جزئيًا.

**الخبر الجيد:** نسخة Git المحفوظة (`HEAD`) سليمة وكاملة لكل هذه الملفات. الاستعادة هي `git checkout -- <file>` لكل ملف تالف — بعد التحقق أن التلف لا يخفي أي تعديل حقيقي مقصود تريد الاحتفاظ به.

---

## قواعد العمل قبل البدء

1. تأكد أن الفرع الحالي `staging` وأن `git status` يعكس ما هو موصوف هنا (قد تكون الأسطر/الملفات تغيّرت قليلاً منذ كتابة هذا الملف — أعد فحصها فعليًا، لا تفترض).
2. **لا تُشغّل `git checkout -- <file>` على أي ملف قبل تشغيل أمر التحقق الخاص به في المهمة 2** والتأكد أن الفرق (diff) بعد تجاهل المسافات/نهايات الأسطر لا يحوي إلا حذفًا (deletions) لا إضافات حقيقية. إن وجدت أي إضافة حقيقية (سطر جديد ذو معنى وليس بقايا مقطوعة)، **توقف عن هذا الملف تحديدًا** واعرضه على المستخدم بدل الكتابة فوقه.
3. اعمل بكومِتات منفصلة أو على الأقل تدرّج واضح، واكتب رسالة commit تشرح أن هذا استرجاع لتلف وليس تراجعًا عن عمل حقيقي (مثلاً: `chore: restore N files corrupted mid-write in working tree (no content lost — matches HEAD)`).
4. أي أمر يمسّ `origin/main` أو `push --force` أو تنظيف تاريخ Git — **قسم "إجراءات بشرية" أدناه فقط، لا تنفّذه بنفسك**.

---

## المهمة 1 · تشخيص أولي (تأكيد قبل الإصلاح)

```bash
cd <مسار المستودع>
git status --porcelain | wc -l
git diff --ignore-space-at-eol --ignore-all-space --stat
```

قارن ناتج الأمر الثاني بقائمة الملفات في المهمة 2 أدناه. إن كانت القائمة مطابقة تقريبًا (نفس الملفات أو مجموعة فرعية منها)، تابع للمهمة 2. إن ظهرت ملفات إضافية غير مذكورة هنا، عاملها بنفس منهجية التحقق في المهمة 2 قبل أي استعادة.

تحقق أيضًا من سلامة `.git/packed-refs` (كان تالفًا سابقًا وتم إصلاحه يدويًا، لكن تأكد):
```bash
git log --oneline -5
```
إن فشل هذا الأمر بخطأ `fatal: unterminated line in .git/packed-refs`، افتح الملف وابحث عن آخر سطر غير مكتمل (لا ينتهي بـ hash كامل + اسم مرجع + سطر جديد) واحذف ذلك السطر الجزئي فقط (لا تلمس الأسطر الكاملة قبله)، ثم أعد المحاولة.

---

## المهمة 2 · التحقق من كل ملف تالف واستعادته

القائمة التالية هي الملفات الـ46 التي وُجد أن فيها تغييرًا حقيقيًا (بعد تجاهل فروق CRLF/المسافات) وقت التحليل، وكلها بنمط "قطع مفاجئ بلا محتوى جديد مفيد":

```
allow-all-rls.sql
api/index.js
firestore.rules
package-lock.json
package.json
server.ts
src/components/AdminTailors.tsx
src/components/CashOperationsModal.tsx
src/components/ForcePinSetup.tsx
src/components/GlobalRoleManager.tsx
src/components/Inventory/InventoryManager.tsx
src/components/Inventory/WarehouseManagement.tsx
src/components/Login.tsx
src/components/PaymentVoucherModal.tsx
src/components/PinLogin.tsx
src/components/ReportPrintDocument.tsx
src/components/ResetPassword.tsx
src/components/SaaSSystemSettings.tsx
src/components/SaaSTeamManagement.tsx
src/components/SetupChecklistBar.tsx
src/components/Staff.tsx
src/components/SuperAdminDashboard.tsx
src/components/ui/WhatsAppPhoneModal.tsx
src/contexts/AuthContext.tsx
src/contexts/ConfirmContext.tsx
src/hooks/useSetupChecklist.ts
src/i18n/locales/ar.json
src/i18n/locales/en.json
src/i18n/locales/ur.json
src/lib/imageValidation.ts
src/services/permissionService.ts
src/services/staffService.ts
src/services/supabase/client.ts
src/services/supplierAccountsService.ts
src/utils/authErrorUtils.ts
supabase/email-templates/reset-password.html
supabase/migrations/20260815010000_staff_has_seen_onboarding.sql
supabase/migrations/20260815090000_supabase_auth_cutover.sql
supabase/migrations/20260815_remap_user_uid_function.sql
supabase/migrations/20260816120000_tenants_tax_columns.sql
supabase/migrations/20260816_referral_program_authz_fixes.sql
supabase/migrations/20260817090000_inventory_items_missing_columns.sql
supabase/migrations/20260817100000_schema_drift_full_reconciliation.sql
supabase/migrations/20260817110000_inventory_items_base_unit_nullable.sql
supabase/migrations/20260817120000_enable_realtime_publication.sql
vite.config.ts
```

تحققنا مباشرة (بالقراءة) وقت التحليل من 11 ملفًا منها وأكدنا أن التلف مجرد قطع بلا فقدان قصدي: `server.ts` (مقطوع عند "`rawTax?.notific`"، ناقص 128 سطرًا تشمل `export default app`)، `api/index.js` (مقطوع عند "`export default serv`")، `package.json`/`package-lock.json` (JSON غير صالح، مقطوع)، `vite.config.ts` (سطر مسافات زائد بلا سطر نهاية)، `src/contexts/AuthContext.tsx`, `src/components/Login.tsx`, `src/components/ForcePinSetup.tsx`, `src/services/permissionService.ts`, `src/services/staffService.ts`, `src/services/supplierAccountsService.ts`, `src/services/supabase/client.ts`, `src/utils/authErrorUtils.ts`, `src/lib/imageValidation.ts`. **باقي الملفات في القائمة لم تُفحص فرديًا بعد — نفّذ التحقق التالي على كل واحد منها قبل استعادته:**

لكل ملف `$f` في القائمة أعلاه:
```bash
git diff --ignore-space-at-eol --ignore-all-space -- "$f"
```
تحقق أن كل الأسطر الظاهرة كـ`-` (حذف) هي نهاية الملف فقط (لا حذف في المنتصف)، وأن أي سطر `+` هو إما فارغ/بقايا جزئية غير مفهومة، وليس منطق عمل جديد ذو معنى. عند التأكد:
```bash
git checkout -- "$f"
```

بعد الانتهاء من كل الملفات:
```bash
git status --porcelain
```
يجب ألا يظهر أي من الملفات الـ46 أعلاه كـ"modified". الملف الوحيد المتوقع ظهوره هو `security-fix-tasklist.md` (untracked — اتركه، أو اقترح على المستخدم نقله إلى `docs/` وعمل commit له كسجل تاريخي).

---

## المهمة 3 · تنظيف فروق CRLF المتبقية (تجميلي، منخفض الخطورة)

باقي الملفات "المعدَّلة" في `git status` (كانت ~290 ملفًا وقت التحليل) هي فروق CRLF/LF بحتة فقط (تأكدنا: صفر فرق حقيقي بعد `--ignore-all-space`). لا يوجد `.gitattributes` في المشروع، وهذا سبب تكرر المشكلة تلقائيًا مع أي محرر على Windows. نفّذ:

```bash
git checkout -- .
```
(آمن الآن بعد إتمام المهمة 2 — تأكدنا أنه لا يوجد أي محتوى حقيقي غير محفوظ في كامل الشجرة).

ثم أنشئ `.gitattributes` في الجذر بمحتوى:
```
* text=auto eol=lf
```
واعمل commit منفصلًا لهذه الإضافة. اشرح للمستخدم أن هذا سيمنع تكرار "336 ملف معدَّل وهميًا" في المستقبل، لكنه لن يغيّر نهايات الأسطر في نسخ العمل الحالية لأي متعاونين آخرين تلقائيًا (كل واحد يحتاج `git add --renormalize .` مرة واحدة عنده).

---

## المهمة 4 · التحقق من نجاح الاستعادة فعليًا

```bash
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json OK')"
tail -5 server.ts
tail -3 api/index.js
npm install
npm run lint
npm run build
```
- `tail -5 server.ts` يجب أن ينتهي بـ `export default app;`.
- `tail -3 api/index.js` يجب أن ينتهي بـ `export default serverModule.default;`.
- `npm run lint` (يكافئ `tsc --noEmit`) يجب أن يمر بلا أخطاء جديدة (قارن بعدد الأخطاء قبل وبعد إن وُجدت أخطاء ما قبل هذا الإصلاح أصلًا).
- `npm run build` يجب أن ينجح بلا أخطاء.

إن فشل أي أمر، **لا تخمّن الإصلاح** — الصق رسالة الخطأ كاملة وابحث عن الملف/السطر المذكور تحديدًا، فقد يكون هناك ملف تالف إضافي لم يظهر في `git diff` (مثلاً لو حُذف كليًا لا معدَّلًا).

---

## المهمة 5 · منع تكرار التلف — عزل سكربتات "الإصلاح" القديمة

المستودع يحوي أكثر من 40 سكربتًا في الجذر بنمط `fix_*.py`, `patch_*.py`, `fix-*.cjs`, `patch-*.cjs`, `update-*.sh`, وهي على الأرجح مصدر التلف (سكربتات one-off من جلسات سابقة، أنجزت عملها فعلًا حسب رسائل الكومِتات ذات الصلة). نفّذ:

1. `mkdir -p scripts/legacy-oneoff`
2. انقل إليه كل الملفات المطابقة للأنماط: `fix_*.py fix-*.cjs fix-*.sh fix.cjs fix_null.ts patch*.py patch*.cjs patch.js remove_*.py replace_*.ts replace-*.sh update-*.sh update-*.cjs clean.cjs get_schema.ts insert_free_plan.ts print-env.ts` — **باستثناء** `fix-rls.sql` إن كان لا يزال مرجعًا حيًا موثقًا من `security-fix-tasklist.md` (تحقق أولًا هل محتواه لا يزال مطلوبًا كمرجع أو صار قديمًا تمامًا بعد تطبيق المهام B-*؛ إن كان قديمًا انقله أيضًا).
3. احذف أيضًا الملفات الفارغة تمامًا غير المستخدمة: `schema.sql`, `untitled.tsx`, `env.local.tsx` (تحقق أولًا `grep -rn` عن أي استيراد لها في `src/` قبل الحذف؛ إن كانت 0 بايت وغير مستوردة فهي آمنة للحذف).
4. اعمل commit منفصلًا: `chore: archive one-off fix/patch scripts to scripts/legacy-oneoff/ (already applied; likely source of the working-tree corruption)`.

هذه خطوة وقائية وليست إلزامية لنجاح البناء، لكنها تمنع تكرار المشكلة.

---

## المهمة 6 · فجوة الفرعين `main`/`staging` (يحتاج قرارًا بشريًا قبل التنفيذ)

`origin/staging` يسبق `origin/main` بـ92 كومِتًا وقت التحليل، وتشمل كل إصلاحات الأمان (B-1 إلى E-3). **لا تدمج أو تدفع (push) إلى `main` من تلقائك.** بدل ذلك:
```bash
git fetch origin
git log origin/main..origin/staging --oneline | wc -l
```
اعرض الرقم والنتيجة على المستخدم، واسأله صراحة: هل Vercel ينشر الإنتاج من `main` أم `staging`؟ إن كان `main`، اقترح فتح Pull Request من `staging` إلى `main` (لا تدفع مباشرة) ليراجعه المستخدم قبل الدمج.

---

## قسم أ — إجراءات بشرية (اعرضها للمستخدم، لا تنفّذها بنفسك)

- [ ] إلغاء مفتاح خدمة Firebase المسرَّب (`firebase-adminsdk-fbsvc@ai-studio-applet-webapp-70fe5`) من Google Cloud Console — لا يزال قابلاً للتنزيل من تاريخ Git العلني على GitHub (`woodohtik/SeenTech`, commit `88cbd00`).
- [ ] تنظيف تاريخ Git من `firebase-credentials.json` (`git filter-repo --path firebase-credentials.json --invert-paths`) ثم `push --force` لكل الفروع — بعد مراجعة أي كومِتات محلية غير مرفوعة أولًا. **لا تُنفِّذ هذا بنفسك دون طلب صريح من المستخدم.**
- [ ] تدوير مفتاح `GEMINI_API_KEY` إن كان حقيقيًا في بيئة الإنتاج.
- [ ] تأكيد فرع الإنتاج الفعلي في إعدادات Vercel (Settings → Git → Production Branch) ودمج `staging` إلى `main` إن لزم (راجع المهمة 6).

---

## ترتيب التنفيذ الموصى به
المهمة 1 → المهمة 2 → المهمة 3 → المهمة 4 → المهمة 5 → المهمة 6 (عرض فقط) → عرض قسم "إجراءات بشرية" على المستخدم.

بعد إتمام كل مهمة، اكتب ملخصًا نهائيًا للمستخدم بصيغة: (المهمة، الحالة: تم/تعذّر ولماذا، الملفات المتأثرة، نتيجة `npm run build`)، واذكر صراحة أن قسم "إجراءات بشرية" وقرار فرع `main` لا يزالان بانتظار المستخدم.
