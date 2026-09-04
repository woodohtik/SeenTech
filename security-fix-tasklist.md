# خطة إصلاح أمني تنفيذية — Seen POS

**لمن يقرأ هذا الملف (Claude Code أو أي وكيل برمجي):** هذا ليس تقرير قراءة فقط — نفّذ الإصلاحات المذكورة هنا مباشرة على هذا المستودع، مهمة تلو الأخرى، بالترتيب المذكور. كل مهمة نتيجة تحقق فعلي من الكود الحالي (تمت قراءته سطراً بسطر)، وليست تخميناً.

## قواعد العمل قبل البدء

1. **لا تثق بملف `تقرير-المراجعة-الأمنية.md`** الموجود في جذر المشروع — تحققنا أن عدة إصلاحات يدّعيها لم تُطبَّق فعلياً في الكود. هذا الملف الحالي هو المرجع الصحيح والمُحدَّث.
2. اعمل بفرع منفصل أو تأكد من `git status` نظيف قبل البدء؛ اعمل **commit منفصل لكل مهمة** برسالة تشرح الثغرة والإصلاح.
3. بعد كل تعديل TypeScript/TSX: شغّل `npm run lint` (يكافئ `tsc --noEmit`) وتأكد من عدم وجود أخطاء جديدة.
4. بعد كل تعديل SQL: لا تُنفِّذه مباشرة على قاعدة إنتاج — أنشئه كملف migration جديد في `supabase/migrations/` بتاريخ اليوم، واطلب من المستخدم تنفيذه يدوياً في Supabase SQL Editor (أو نفّذه إن كانت لديك بيانات اتصال بقاعدة تطوير آمنة فقط).
5. **قبل تعديل أي سياسة RLS أو دالة، تحقق أولاً من التعريف الحالي الفعلي في المستودع** (قد تختلف الأسطر المذكورة هنا قليلاً بسبب تعديلات لاحقة) — استخدم `grep`/بحث النص المقتبس أدناه لتحديد الموضع الدقيق قبل التعديل.
6. المهام في قسم "إجراءات بشرية" **لا يمكن للكود تنفيذها** — لا تحاول، فقط اعرضها على المستخدم بوضوح في ملخص نهائي.

---

## قسم أ — إجراءات بشرية (اعرضها للمستخدم، لا تنفّذها بنفسك)

- [ ] إلغاء مفتاح خدمة Firebase (`firebase-adminsdk-fbsvc@ai-studio-applet-webapp-70fe5`) من Google Cloud Console فوراً — لا يزال متاحاً للتنزيل من تاريخ Git العلني على GitHub (`woodohtik/SeenTech`, commit `88cbd00`).
- [ ] تنظيف تاريخ Git من `firebase-credentials.json` (`git filter-repo --path firebase-credentials.json --invert-paths`) ثم push --force لكل الفروع — بعد مراجعة أي كومِتات محلية غير مرفوعة أولاً.
- [ ] تدوير مفتاح `GEMINI_API_KEY` إن كان حقيقياً في بيئة الإنتاج (بعد تطبيق المهمة D-1 أدناه التي تمنع تسريبه مستقبلاً).

---

## قسم ب — قاعدة البيانات: كسر عزل المستأجرين (الأولوية القصوى)

### B-1 · حرِج: أي مستخدم مسجَّل يستطيع تنصيب نفسه "owner" لأي متجر
**الملف:** `fix-rls.sql`
**الكود الحالي (ابحث عنه لتأكيد الموضع):**
```sql
CREATE POLICY "staff_onboarding_insert" ON staff
    FOR INSERT WITH CHECK (uid = app_current_uid() OR app_is_super_admin());
```
**المشكلة:** لا تحقق من `tenant_id` ولا `role` — أي مستخدم يُدرج صف `staff` بأي `tenant_id` و`role='owner'` وينجح.

**المطلوب:** أنشئ migration جديدة تستبدل هذه السياسة. أولاً افحص `ForcePinSetup.tsx` (منطق "أول مستخدم في المتجر = owner") لفهم الحالة الشرعية الوحيدة التي يجب السماح بها لإدراج owner ذاتي. الاتجاه الموصى به (نفّذه أو عدّله إن اكتشفت تفصيلاً مغايراً في الشيفرة الفعلية):

1. أنشئ دالة `SECURITY DEFINER` تتحقق ذرّياً (بلا TOCTOU) من أن المتجر بلا أي staff نشط قبل السماح بإدراج owner:
```sql
CREATE OR REPLACE FUNCTION bootstrap_tenant_owner(p_tenant_id uuid)
RETURNS void AS $$
DECLARE
  existing_count int;
BEGIN
  IF app_current_uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  SELECT count(*) INTO existing_count FROM staff WHERE tenant_id = p_tenant_id;
  IF existing_count > 0 THEN
    RAISE EXCEPTION 'tenant already has staff — cannot self-bootstrap as owner';
  END IF;
  INSERT INTO staff (uid, tenant_id, role, status)
  VALUES (app_current_uid(), p_tenant_id, 'owner', 'active');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
REVOKE ALL ON FUNCTION bootstrap_tenant_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bootstrap_tenant_owner(uuid) TO authenticated;
```
2. استبدل سياسة INSERT الخام لتمنع تعيين `role` مميّز عبر الإدراج المباشر:
```sql
DROP POLICY IF EXISTS "staff_onboarding_insert" ON staff;
CREATE POLICY "staff_onboarding_insert" ON staff
    FOR INSERT WITH CHECK (
      app_is_super_admin()
      OR (uid = app_current_uid() AND role NOT IN ('owner','admin'))
    );
```
3. عدّل `src/components/ForcePinSetup.tsx` ليستدعي `supabase.rpc('bootstrap_tenant_owner', { p_tenant_id: tenantId })` بدل `supabase.from('staff').insert({..., role})` المباشر عند حالة "أول مستخدم".

**تحقق القبول:** بعد التطبيق، محاولة `supabase.from('staff').insert({uid: X, tenant_id: 'ضحية_لها_موظفون_بالفعل', role:'owner'})` يجب أن تُرفض من RLS.

### B-2 · حرِج: لا يوجد تريجر يمنع الموظف من ترقية نفسه (الثغرة التاريخية C-5 غير مُصلَحة فعلياً)
**تحقق:** بحثنا في كل ملفات SQL (22 ملفاً + كل migrations) عن أي تريجر "منع تصعيد ذاتي" — **لا وجود له**. سياسة `staff_tenant_update` (مولَّدة تلقائياً في `wdooh-database-schema.sql` ضمن حلقة `tenant_tables`) تتحقق من `tenant_id` فقط.

**المطلوب:** أنشئ migration جديدة:
```sql
CREATE OR REPLACE FUNCTION staff_no_self_escalation() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.uid = app_current_uid() AND NOT app_is_super_admin() THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.role_id IS DISTINCT FROM OLD.role_id
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'لا يمكن تعديل الدور أو الحالة أو المستأجر على حسابك الشخصي';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS staff_no_self_escalation_trigger ON staff;
CREATE TRIGGER staff_no_self_escalation_trigger
BEFORE UPDATE ON staff
FOR EACH ROW EXECUTE FUNCTION staff_no_self_escalation();
```
تحقق أولاً من الأسماء الفعلية للأعمدة (`role_id` موجود؟) بقراءة `wdooh-database-schema.sql` قبل التطبيق. اجعل الدالة `owner`/`admin` معفاة (استثنِ الحالة التي يكون فيها المنفّذ نفسه owner/admin يعدّل صفّاً آخر — الشرط أعلاه `OLD.uid = app_current_uid()` يتحقق فقط من "تعديل صف النفس"، وهذا صحيح ولا يمنع owner من تعديل موظف آخر).

**تحقق القبول:** حساب كاشير ينفّذ `UPDATE staff SET role='owner' WHERE id=<صفّه>` يجب أن يُرفض بخطأ.

### B-3 · حرِج: `saas_settings` مقروء لأي زائر anon، و`saas_security_logs` قابل للتزوير من anon
**الملف:** `wdooh-database-schema.sql`
```sql
CREATE POLICY saas_settings_read_any ON saas_settings FOR SELECT USING (TRUE);
CREATE POLICY saas_security_logs_insert ON saas_security_logs FOR INSERT WITH CHECK (TRUE);
```
كلتاهما بلا `TO authenticated` فتُطبَّقان على `PUBLIC` (يشمل anon). أنشئ migration:
```sql
DROP POLICY IF EXISTS saas_settings_read_any ON saas_settings;
CREATE POLICY saas_settings_read_any ON saas_settings FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS saas_security_logs_insert ON saas_security_logs;
CREATE POLICY saas_security_logs_insert ON saas_security_logs FOR INSERT TO authenticated
  WITH CHECK (user_id = app_current_uid());
```
راجع أولاً هل `saas_settings` يحوي مفاتيح حساسة (`temp_passwords` مذكور سابقاً) تستدعي تقييداً أشد (حصر القراءة على super_admin فقط لمفاتيح معينة) — إن كان الأمر كذلك أضف شرط إضافي بدل السماح الكامل لكل `authenticated`.

### B-4 · عالٍ: دوال اشتراك/تجربة مجانية بلا REVOKE — تفعيل مجاني عبر RPC مباشر
**الملف:** `PLG_trial_lifecycle.sql` — الدوال `activate_tenant_subscription`, `start_tenant_trial`, `trial_lock_sweep`, `trial_purge_sweep`, `slg_sweep`.
**المطلوب:** أضف في نفس الملف أو migration جديدة:
```sql
REVOKE ALL ON FUNCTION activate_tenant_subscription(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION start_tenant_trial(uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION trial_lock_sweep() FROM PUBLIC;
REVOKE ALL ON FUNCTION trial_purge_sweep() FROM PUBLIC;
REVOKE ALL ON FUNCTION slg_sweep() FROM PUBLIC;
```
ثم افحص من يستدعي `activate_tenant_subscription` فعلياً في الكود (`grep -rn "activate_tenant_subscription" src/`) — إن كانت واجهة العميل تستدعيها مباشرة لتفعيل اشتراك مدفوع فعلياً بعد الدفع، يجب أن تتحول لدالة `SECURITY DEFINER` تتحقق داخلياً من دليل دفع فعلي (سجل في `payments` بحالة مؤكدة) بدل الثقة بالمستدعي، أو تُقيَّد التنفيذ لدور `service_role` فقط وتُستدعى من الخادم (`server.ts`) لا من المتصفح مباشرة.

### B-5 · عالٍ: سياسة `tenants_owner_update` تسمح بتعديل عمود الخطة/الاشتراك مباشرة من العميل
**الملف:** `wdooh-database-schema.sql`
```sql
CREATE POLICY tenants_owner_update ON tenants
    FOR UPDATE USING (owner_uid = current_setting('app.current_uid', true))
    WITH CHECK (owner_uid = current_setting('app.current_uid', true));
```
ملاحظتان: (أ) تستخدم `current_setting('app.current_uid')` القديم غير المضبوط بعد الانتقال لـ Supabase Auth — تحقق هل ما زال يُستخدم فعلياً أو استُبدل بـ`app_current_uid()` في migration لاحقة (ابحث عن آخر `CREATE POLICY tenants_owner_update` في المخطط). (ب) بصرف النظر عن ذلك، لا يوجد أي قيد على الأعمدة القابلة للتحديث. أنشئ migration تُقيّد الأعمدة الحساسة عبر trigger بدل الاعتماد على `WITH CHECK` وحده (لأن RLS لا يدعم قيوداً بمستوى العمود مباشرة):
```sql
CREATE OR REPLACE FUNCTION tenants_block_client_plan_edit() RETURNS TRIGGER AS $$
BEGIN
  IF NOT app_is_super_admin() THEN
    IF NEW.plan_id IS DISTINCT FROM OLD.plan_id
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.subscription_end_date IS DISTINCT FROM OLD.subscription_end_date THEN
      RAISE EXCEPTION 'تعديل الخطة/الحالة/تاريخ الاشتراك يتطلب مساراً إدارياً، لا تحديثاً مباشراً';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tenants_block_client_plan_edit_trigger ON tenants;
CREATE TRIGGER tenants_block_client_plan_edit_trigger
BEFORE UPDATE ON tenants
FOR EACH ROW EXECUTE FUNCTION tenants_block_client_plan_edit();
```
بعدها راجع `src/services/subscriptionRequestService.ts` لتتأكد أن مسار الموافقة الإداري الشرعي (approveSubscriptionRequest) يعمل من جانب super_admin (الذي يتجاوز هذا التريجر) ولا ينكسر.

### B-6 · متوسط: `supplierAccountsService.ts` يُنتج كود SQL جاهزاً بسياسة `allow_all` كـ"تعليمات إعداد"
**الملف:** `src/services/supplierAccountsService.ts`, دالة `getLedgerSQLMigrationCode`
**المطلوب:** استبدل نص السياسة المولَّدة داخل هذه الدالة من:
```sql
CREATE POLICY allow_all ON public.supplier_transactions FOR ALL USING (true) WITH CHECK (true);
```
إلى سياسة معزولة فعلياً حسب tenant_id، على نمط بقية الجداول:
```sql
CREATE POLICY supplier_transactions_tenant_isolation ON public.supplier_transactions
    FOR ALL TO authenticated
    USING (app_is_super_admin() OR tenant_id = app_current_tenant_id())
    WITH CHECK (app_is_super_admin() OR tenant_id = app_current_tenant_id());
```
تحقق من اسم عمود tenant الفعلي في `supplier_transactions` (قد يكون `tenant_id` مباشرة أو عبر ربط بجدول `suppliers`) قبل النسخ الحرفي.

---

## قسم ج — الخادم (server.ts)

### C-1 · حرِج: نقطة الفاتورة العامة تسرّب صفوف كاملة (customers/tenants/orders) بلا فلترة
**الملف:** `server.ts`, نقطة `GET /api/public/invoices/:id` (ابحث عن `app.get("/api/public/invoices/:id"`)
**الكود الحالي (مؤكَّد بالقراءة المباشرة):**
```ts
res.json({
  order: { ...orderData, orderNumber: orderData.order_number, /* ... */ },
  tenant: tenantData ? { ...tenantData, /* ... */ } : null,
  customer: customerData || null
});
```
**استبدله بقائمة سماح صريحة** تطابق فقط ما تعرضه فعلياً `src/pages/PublicInvoice.tsx` (order.orderNumber, orderDate/order_date, items, totalAmount, vatAmount; tenant.storeName, storeNameEn, vatNumber, address, phone, logoUrl; customer.name فقط):
```ts
res.json({
  order: {
    orderNumber: orderData.order_number,
    orderDate: orderData.order_date,
    items: orderData.items,
    totalAmount: orderData.total_amount,
    vatAmount: orderData.vat_amount,
  },
  tenant: tenantData ? {
    storeName: tenantData.store_name,
    storeNameEn: tenantData.store_name_en,
    vatNumber: tenantData.vat_number,
    address: tenantData.address,
    logoUrl: tenantData.logo_url,
  } : null,
  customer: customerData ? { name: customerData.name } : null
});
```
تحقق من اسم عمود العناصر الفعلي (`items` قد يكون في جدول منفصل `order_items` لا عمود JSON على `orders` نفسها — افحص المخطط الفعلي وعدّل الاستعلام إن لزم لجلب العناصر من مكانها الصحيح دون توسيع الصلاحيات). لا تُزل `paymentMethod`/`branchId`/`createdBy` إلا إن كانت `PublicInvoice.tsx` لا تستخدمها فعلاً (تحقق قبل الحذف النهائي لتفادي كسر شيء تعرضه الواجهة فعلاً وأغفلناه).

**تحقق القبول:** استدعِ النقطة على فاتورة تجريبية وتأكد أن الاستجابة **لا تحوي** أي من: `phone`, `email`, `notes`, `measurements`, `owner_email`, `owner_uid`, `commercial_register`, `branch_id`, `created_by`, `images`.

---

## قسم د — الواجهة (Frontend)

### D-1 · حرِج: باب خلفي ببريد إلكتروني ثابت يمنح صلاحيات owner/super_admin كاملة
**الملف:** `src/services/permissionService.ts`
**احذف تماماً** هذين الشرطين (تحقق من الموقع الدقيق بالبحث عن النص، فقد يكون رقم السطر قد تغيّر):
```js
if (saasUser?.email?.toLowerCase() === 'nomansa2566512@gmail.com') { return true; }
// و
if (saasUser?.email?.toLowerCase() === 'nomansa2566512@gmail.com') { return DEFAULT_ROLES.owner.permissions; }
```
لا تستبدلهما بأي شيء — يجب أن تعتمد الدالتان (`checkSaasRole`, `getEffectivePermissions`) على صف `saas_users` الفعلي وحقل `is_active` فقط، دون أي استثناء بريد.
**تحقق القبول:** `grep -rn "nomansa2566512" src/` يجب أن يُرجع صفراً نتائج بعد الإصلاح.

### D-2 · عالٍ: صلاحيات مخزَّنة في localStorage تُستخدم بلا رجوع آمن عند فشل التحقق
**الملف:** `src/services/permissionService.ts`, دالة حساب الصلاحيات (ابحث عن `role_permissions_`)
**المطلوب:** في كتلة `catch` (أو أي مسار فشل لاستعلامات `roles_permissions`)، لا تُبقِ على قيمة الكاش القديمة كما هي — أعد التعيين صراحة إلى `DEFAULT_ROLES[staff.role]?.permissions ?? {}` (أدنى صلاحيات افتراضية آمنة)، ولا تعتمد على `localStorage.getItem(...)` كمصدر وحيد إن فشل أي استعلام من الاستعلامات الأربعة.

### D-3 · حرِج: لوحات إدارة SaaS بلا تحقق دور فعلي (أربعة ملفات منفصلة)
هذا النمط يتكرر في أربعة ملفات — أضف نفس الحارس في بداية كل دالة حساسة (وليس فقط تعطيل الزر):

```ts
if (!(dbUser?.role === 'super_admin')) {
  toast.error('غير مصرَّح — هذا الإجراء يتطلب صلاحية super_admin');
  return;
}
```
(عدّل شرط الدور حسب من يُفترض أن يملك الصلاحية في كل حالة — بعض الإجراءات قد يُسمح بها لـ`billing_admin` أيضاً حسب `ARCHITECTURE.md`، راجعه).

طبّق هذا في:
- **`src/components/SaaSSystemSettings.tsx`**: بداية `confirmWipeData` و`confirmDeleteTestData`.
- **`src/components/AdminTailors.tsx`**: بداية `handleUpdateTenantPlan`, `handleExtendTrial`, `handleRenewSubscription`, `handleActivateSubscription`, `handleToggleStatus`.
- **`src/components/SuperAdminDashboard.tsx`**: بداية `handleToggleStatus` و`handleStealthSupportLogin` (الأخيرة يجب أيضاً أن تتحقق من وجود موافقة فعلية في `support_access_requests` بدل تفعيل الانتحال الفوري — راجع تدفق الموافقة الموصوف في نفس الملف وأعد ربط الزر به بدل تجاوزه).
- **`src/components/SaaSTeamManagement.tsx`**: بداية `handleSubmit` (منع أي تعديل ما لم يكن `dbUser.role === 'super_admin'`، ومنع المستخدم من تعديل دوره الخاص).
- **`src/components/GlobalRoleManager.tsx`**: بداية `handleSaveRole` و`executeDeleteRole`.

**تنبيه مهم:** هذا حارس جانب-عميل فقط (defense in depth) — **الحماية الحقيقية يجب أن تكون RLS على الجداول المتأثرة (`tenants`, `saas_users`, `roles`)**. لا تكتفِ بهذه الخطوة؛ تحقق أن كل جدول تكتب إليه هذه الدوال محمي أيضاً بسياسة RLS تشترط `app_is_super_admin()` (وليس فقط تطابق tenant_id) — إن لم تكن كذلك أنشئ migration مماثلة لـ B-5 أعلاه لهذه الجداول.

### D-4 · متوسط: مفتاح Gemini لا يزال يُحقن في حزمة المتصفح
**الملف:** `vite.config.ts`
**احذف هذا السطر بالكامل:**
```ts
'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
```
(الكود المستهلك محمي أصلاً بفحص `typeof process !== 'undefined'` حسب التوثيق الموجود، فلن ينكسر شيء — تحقق فقط من أي استخدام مباشر لـ `process.env.GEMINI_API_KEY` في كود يعمل بالمتصفح فعلياً وانقله لاستدعاء API خادمي بدلاً من ذلك إن وُجد).

### D-5 · متوسط: PIN مخزَّن ومُقارَن كنص صريح ومُسرَّب عبر `select('*')`
**الملفات:** `src/contexts/AuthContext.tsx`, `src/components/PinLogin.tsx`, `src/components/ForcePinSetup.tsx`
**المطلوب الأدنى (سريع):** استبدل كل `select('*')` على جدول `staff` في هذه الملفات الثلاثة باستعلام أعمدة صريح **يستثني `pin_hash`**، مثال:
```ts
supabase.from('staff').select('id, uid, name, email, phone, role, role_id, tenant_id, branch_id, status, must_change_pin, tenant:tenants(*)').eq('uid', uid)
```
(حافظ على كل الأعمدة الأخرى المستخدمة فعلياً في الكود المحيط — افحص كل استخدام لاحق لنتيجة الاستعلام قبل حذف أي عمود). لا تُغيّر تخزين PIN كنص صريح نفسه في هذه المهمة (قرار منتج موثَّق ومقصود بحسب التعليقات في `staffService.ts`) — فقط أوقف تسريبه في استجابات الشبكة.

---

## قسم هـ — تحصين إضافي (أقل إلحاحاً، نفّذها بعد ما سبق)

### E-1 · تحديد محاولات على `/api/staff/verify-pin`
**الملف:** `server.ts`
أضف عدّاد محاولات في الذاكرة (على نمط `pairAttempts` الموجود فعلاً في `src/server/printRelay.ts` — انسخ نفس النمط) مفتاحه `${tenantId}:${uid}`، يقفل بعد 5 محاولات فاشلة متتالية لمدة تصاعدية (دقيقة، دقيقتان...، حتى 15 دقيقة)، مطبَّق داخل `app.post("/api/staff/verify-pin", ...)` قبل حلقة المقارنة.

### E-2 · ترويسات أمان HTTP + rate limiting عام
**الملف:** `server.ts`
ثبّت `helmet` و`express-rate-limit`:
```
npm install helmet express-rate-limit
```
أضف بعد إنشاء `app`:
```ts
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
app.use(helmet({ contentSecurityPolicy: false })); // اضبط CSP لاحقاً بعد اختبار Firebase Auth/Moyasar/الخطوط لتفادي كسرها
app.use(rateLimit({ windowMs: 60_000, max: 120 }));
```
اختبر تسجيل الدخول وربط Google OAuth والدفع بعد التفعيل قبل اعتماد CSP صارم.

### E-3 · استبدال `xlsx@0.18.5`
**الملف:** `package.json`
استبدل بـ`"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"` أو انقل لمكتبة `exceljs`، ثم راجع كل استيراد `from 'xlsx'` في المشروع للتأكد من توافق الواجهة البرمجية.

---

## ترتيب التنفيذ الموصى به
B-1 → B-2 → D-1 → C-1 → D-3 → B-3 → B-4 → B-5 → D-2 → D-5 → B-6 → D-4 → E-1 → E-2 → E-3

بعد إتمام كل مهام هذا الملف، اكتب ملخصاً نهائياً للمستخدم بصيغة: (المهمة، الحالة: تم/تعذّر ولماذا، الملفات المعدَّلة)، واذكر صراحة أن قسم "إجراءات بشرية" لا يزال بانتظار تنفيذه من طرف المستخدم نفسه.
