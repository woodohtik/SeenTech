# حادثة أمنية: إعادة فتح الدوال المحمية (2026-11-21)

## ما حدث

**السبب:** مايقريشن `20261123010000_baseline_role_grants.sql` فيه السطر `GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated`، ويجعل ذلك افتراضياً لكل دالة جديدة. فأعاد فتح كل دالة سبق قفلها.

**الدوال المكشوفة، ومنها:**
- `remap_user_uid`: تنقل ملكية أي محل أو حساب سوبر أدمن إلى حساب آخر. يكفي لها المفتاح العام الموجود في حزمة الموقع، ومعرّف حساب الضحية.
- `assistant_get_*`: مبيعات أي محل وإيراداته وإقفاله اليومي، بمجرد معرفة معرّفه.
- `zatca_advance_chain_with_real_hash` و`allocate_tenant_*_number`: العبث بسلسلة فواتير زاتكا وبأرقام فواتير أي محل.
- `confirm_referral` و`confirm_partner_referral`: مكافأة إحالة بلا دفع.
- `record_pin_verify_failure` و`reset_pin_verify_attempts`: تصفير قفل محاولات الـ PIN.

**القياس على Staging:** 71 دالة بصلاحيات مرتفعة (SECURITY DEFINER) كان يستطيع الزائر المجهول (anon) تنفيذها.

## الإصلاح

مايقريشن `20270102000000_revoke_reopened_function_grants.sql`:
- **مُطبَّق على Staging:** 71 ← 6. الستة المتبقية دوال الهوية التي تستدعيها السياسات (ترجع لا شيء بلا تسجيل دخول)، و`has_used_trial` العامة عمداً.
- **حذف `remap_user_uid`** نهائياً.
- **قفل الدوال الداخلية عن المستخدم المسجّل أيضاً.** القائمة مولّدة آلياً من تاريخ كل GRANT/REVOKE في المايقريشنات.
- **منع المنح التلقائي للدوال الجديدة.**
- **قفل ثانٍ داخل الدوال التي تأخذ معرّف محل:** المتصفح لا يمرّر إلا محله.
- **قفل محاولات الـ PIN:** الرقم الصحيح لم يعد يصفّر العدّاد، والمحاولات تُنسى بعد 15 دقيقة هادئة.
- **التحقق الثنائي للسوبر أدمن:** صار مطلوباً في قاعدة البيانات أيضاً، لمن فعّله.
- **الاختبار الدائم:** `supabase/tests/function_grants_test.sql` (pgTAP، 10 فحوص)، ويعمل في CI.

## خطوات المؤسس (بالترتيب، لا ينفّذها Claude)

1. **تأكيد الثغرة على الإنتاج** (قراءة فقط):
   ```
   ! npx supabase db query --linked --project-ref bvvhxjrlwphvrmneieuk --file scripts/security/check-anon-functions.sql
   ```
   إن ظهرت `remap_user_uid` أو `assistant_get_*` أو `zatca_advance_chain_with_real_hash` أو `allocate_tenant_*`، فالثغرة مفتوحة على الإنتاج.
2. **تطبيق المايقريشن فوراً** (الاستثناء الوحيد المسموح به في المهمة دون انتظار باقي المراحل):
   ```
   ! npx supabase db push --linked --project-ref bvvhxjrlwphvrmneieuk --dry-run
   ! npx supabase db push --linked --project-ref bvvhxjrlwphvrmneieuk --yes
   ```
   المتوقع في التجربة ملف واحد: `20270102000000_revoke_reopened_function_grants.sql`.
3. **إعادة الفحص** (الخطوة 1): يجب ألا يظهر إلا الستة المسموحة.
4. **مراجعة السجلات:** في لوحة Supabase للإنتاج: Logs → API (PostgREST). ابحث عن طلبات `rpc/remap_user_uid` و`rpc/assistant_get_` و`rpc/zatca_advance_chain_with_real_hash` و`rpc/allocate_tenant_` و`rpc/confirm_referral` و`rpc/reset_pin_verify_attempts`، منذ تاريخ تطبيق `20261123010000`.
   - **أي طلب منها من المتصفح بمفتاح anon = استغلال.** يُسجَّل في هذا الملف، مع تاريخه وعنوانه.
5. **مقارنة الملكية** بنسخة سابقة: `tenants.owner_uid` و`saas_users.uid`. أي تغيير غير مفسَّر = حساب مُستولى عليه.
6. **ملف بيانات الإنتاج على الجهاز:** انقل أو احذف `backups/prod_full_data_export_*.csv`. هذا الجهاز غير مشفّر.

## النتيجة (يملؤها المؤسس)

- تاريخ تطبيق `20261123010000` على الإنتاج:
- نتيجة الفحص قبل الإصلاح:
- تاريخ تطبيق الإصلاح:
- استدعاءات مشبوهة في السجلات:
- تغييرات ملكية غير مفسَّرة:
