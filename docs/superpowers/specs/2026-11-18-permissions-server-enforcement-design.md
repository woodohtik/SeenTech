# تنفيذ فعلي على الخادم لنظام الصلاحيات المرنة (roles.permissions) — تصميم

**الحالة:** مُوافَق عليه من المؤسس (محادثة 2026-11-18) — جاهز لخطة التنفيذ.

**المصدر:** `seen-cto-sprint4-permissions-task.md` البند 3، الخيار (ب) المؤجَّل سابقاً. القرار
السابق (2026-11-17) كان التوثيق فقط (enum `staff.role` هو الحدود الأمنية الفعلية،
و`roles.permissions` تجميل واجهة). هذا المستند يطبّق الخيار (ب): تنفيذ فعلي للجزء
الحرج مالياً من هذا النظام على الخادم.

---

## 1. السياق

النظام الحالي (موثَّق في `permissionService.ts` وموجود فعلياً في الإنتاج):

- جدول `roles` (`tenant_id` NULL لأدوار النظام، أو UUID لدور مخصَّص للتاجر) بعمود
  `permissions JSONB`.
- `staff.role_id` (FK لـ`roles.id`، **قابل للـNULL** — بعض صفوف `staff` القديمة لم
  تُربَط بصف `roles` حقيقي، فقط `staff.role` (enum ثابت) هو الموجود).
- `user_permission_overrides` (استثناء فردي لكل موظف، يعدّل فوق صلاحيات دوره).
- `getEffectivePermissions()` في العميل يحسم الصلاحية الفعلية بثلاث طبقات: الدور
  الافتراضي المُبرمَج (`DEFAULT_ROLES`) ← دور مخصَّص للتاجر (`roles.permissions`) ←
  استثناء فردي (`user_permission_overrides`).
- **لا شيء من هذا يصل للخادم اليوم.** كل RPC حرجة وكل سياسة RLS تفحص فقط
  `app_current_role()` (enum ثابت). نتيجة ذلك: تعطيل صلاحية من شاشة "صلاحيات
  الأدوار" يُخفيها من الواجهة فقط — استدعاء نفس الإجراء مباشرة عبر الـRPC/الجدول
  ينجح رغم ذلك.

### 1.1 نطاق هذا التنفيذ (قرار المؤسس)

من ٤٣ مفتاح صلاحية في `SYSTEM_PERMISSIONS`، **١١ فقط** حرجة مالياً/أمنياً ويُنفَّذ
فحصها على الخادم الآن:

`payments.collect`, `action.refund`, `action.discount`, `orders.delete`,
`customers.delete`, `inventory.delete`, `staff.permissions`, `settings.billing`,
`suppliers.manage`, `inventory.reconcile`, `shifts.manage`

الـ٣٢ المتبقية (`dashboard.view`, `sales.view`, إظهار/إخفاء تبويبات، إلخ) تبقى
UI-only كما هي اليوم — لا قيمة أمنية حقيقية من فرضها على الخادم.

---

## 2. الآلية المركزية: `app_has_permission(p_permission_key text)`

دالة SQL جديدة، **STABLE SECURITY DEFINER** (نفس نمط `app_current_role()`):

```sql
CREATE OR REPLACE FUNCTION public.app_has_permission(p_permission_key TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_staff_id   uuid;
  v_role       text;
  v_role_id    uuid;
  v_permissions jsonb;
  v_override    boolean;
  v_default     boolean;
BEGIN
  IF app_is_super_admin() THEN RETURN true; END IF;

  v_role := app_current_role();
  IF v_role = 'owner' THEN RETURN true; END IF;
  IF v_role IS NULL THEN RETURN false; END IF;

  v_staff_id := app_current_staff_id();
  SELECT role_id INTO v_role_id FROM staff WHERE id = v_staff_id;

  -- 1. دور حقيقي مرتبط (role_id موجود): اقرأ roles.permissions.
  IF v_role_id IS NOT NULL THEN
    SELECT permissions INTO v_permissions FROM roles WHERE id = v_role_id;
  END IF;

  -- 2. لا role_id (صفوف staff قديمة) أو لم يُعثَر على الدور: استخدم
  --    الجدول الافتراضي الثابت (مطابق لـ DEFAULT_ROLES في permissionService.ts
  --    لنفس الـ11 مفتاحاً فقط) بدل الفشل أو الرفض الكامل.
  IF v_permissions IS NULL OR NOT (v_permissions ? p_permission_key) THEN
    v_default := app_default_permission(v_role, p_permission_key);
  ELSE
    v_default := COALESCE((v_permissions->>p_permission_key)::boolean, false);
  END IF;

  -- 3. استثناء فردي للموظف يعدّل فوق كل ما سبق.
  SELECT (overrides->>p_permission_key)::boolean INTO v_override
    FROM user_permission_overrides WHERE staff_id = v_staff_id;

  RETURN COALESCE(v_override, v_default);
END $$;
```

ودالة مساعدة ثابتة `app_default_permission(p_role text, p_permission_key text)`
(SQL بسيط، `CASE` على الدور ثم المفتاح) تطابق **حرفياً** جدول `DEFAULT_ROLES`
الحالي للـ١١ مفتاحاً فقط، محسوبة أدناه من الكود الفعلي:

| الدور | payments.collect | action.refund | action.discount | orders.delete | customers.delete | inventory.delete | staff.permissions | settings.billing | suppliers.manage | inventory.reconcile | shifts.manage |
|---|---|---|---|---|---|---|---|---|---|---|---|
| owner | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |
| manager | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |
| branch_manager | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| accountant | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| warehouse_manager | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |
| cashier | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| tailor | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

(owner بالفعل يُحسَم بسطر منفصل في `app_has_permission` قبل الوصول لهذا الجدول —
مُدرَج هنا للتوثيق فقط.)

---

## 3. التفعيل على كل هدف

| الهدف | الصلاحية | التغيير بالضبط |
|---|---|---|
| `create_pos_sale` | `payments.collect` | فحص جديد بالكامل — لا يوجد فحص دور على تحصيل الدفعة اليوم. `IF NOT app_has_permission('payments.collect') THEN RAISE EXCEPTION '...' USING ERRCODE='42501'`. |
| `create_pos_sale` (الخصم) | `action.discount` | إن كانت `false`، أي `discount_value > 0` مُرسَل من العميل يُرفَض (`v_discount_gross := 0` فعلياً، أو استثناء صريح) — **قبل** تطبيق سقف `app_max_discount_percent()` الرقمي الحالي، الذي يبقى كما هو كطبقة إضافية. |
| `close_shift` (إغلاق وردية غير وردية الموظف نفسه) | `shifts.manage` | يستبدل `v_role NOT IN ('owner','admin','manager')`. |
| `approve_stock_take` (اعتماد الجرد) | `inventory.reconcile` | يستبدل `v_role NOT IN ('owner','admin','manager')`. |
| `issue_supplier_payment` | `suppliers.manage` | يستبدل `v_role NOT IN ('owner','admin','manager','accountant')`. **تغيير سلوك مقصود (موافَق عليه):** `branch_manager`/`warehouse_manager` سيصبح بإمكانهما الدفع فعلياً (يطابقان الصلاحية الظاهرة لهما بالواجهة اليوم، إصلاح فجوة لا توسيع). |
| `increment_supplier_balance` | `suppliers.manage` | نفس الاستبدال (دالة موجودة بالفعل بفحص دور مشابه من سبرنت 4 بند 1). |
| سياسة DELETE: `orders` | `orders.delete` | يستبدل قائمة الأدوار الحالية في سياسة RLS. |
| سياسة DELETE: `customers` | `customers.delete` | **جديدة** — لا قيد دور على حذف عميل اليوم إطلاقاً. |
| سياسة DELETE: `inventory_items` | `inventory.delete` | **جديدة**، نفس المنطق. |
| سياسة SELECT: `suppliers`, `supplier_transactions` | `suppliers.manage` | **جديدة** — تبقى `tenant_id` شرطاً أساسياً، تُضاف صلاحية هذا المفتاح فوقه. لا تغيير على INSERT (يبقى عبر RPCs فقط). |
| `roles` UPDATE، `user_permission_overrides` UPDATE/INSERT | `staff.permissions` | يستبدل الفحص الحالي (owner فقط من جهة العميل، بلا RLS فعلية فعلياً اليوم). |
| `tenants` UPDATE لحقول الفوترة (`plan_id`, `subscription_*`) | `settings.billing` | يستبدل فحص `tenants_no_self_billing_escalation` الحالي (owner/admin). |

### تغييرات سلوك معروفة (تُوثَّق صراحة، لا تُكتشَف لاحقاً)

1. **`issue_supplier_payment`/`increment_supplier_balance`**: `branch_manager` و
   `warehouse_manager` يكتسبان القدرة الفعلية على دفع مورّد (كانا يملكان
   `suppliers.manage=true` بالواجهة لكن يُرفَضان على الخادم) — **موافَق عليه
   صراحة من المؤسس** كتصحيح فجوة، لا توسيع.
2. أي تاجر عدَّل دوراً مخصَّصاً عبر شاشة "صلاحيات الأدوار" لأحد هذه الـ١١ مفتاحاً
   سابقاً (بافتراض أنه تجميلي فقط) سيجد الآن أن هذا التعديل **يُنفَّذ فعلياً**. هذا
   هو الهدف المقصود من المشروع، لكنه يستحق سطراً في الإشعار إلى المؤسس عند
   النقل للإنتاج (قد يكون تاجر عدَّل خطأً من قبل بلا قصد).

---

## 4. معالجة الأخطاء

- فشل فحص صلاحية داخل RPC → `RAISE EXCEPTION` برسالة عربية واضحة، `ERRCODE='42501'`
  (نفس نمط كل استثناء مشابه بالمشروع).
- فشل على مستوى RLS (SELECT) → صفر صفوف بصمت (سلوك RLS الطبيعي).
- أي خطأ غير متوقَّع داخل `app_has_permission`/`app_default_permission` نفسها
  (مثلاً JSONB تالف) **يفشل مغلقاً (fail-closed)** — لا `EXCEPTION WHEN OTHERS`
  يُعيد `true` افتراضياً؛ الاستثناء يتصاعد كما هو ويمنع الإجراء، مطابقاً لبقية
  فحوصات الأدوار بالمشروع.

---

## 5. خارج النطاق (صراحة)

- الـ٣٢ مفتاح صلاحية المتبقية (تبويبات/شاشات) — تبقى UI-only.
- أي backfill لـ`staff.role_id` الفارغ — الجدول الافتراضي الثابت يغطي هذه الحالة
  بلا حاجة لتعديل بيانات.
- `reports`/`customers`/`payments` SELECT — تبقى `tenant_id` فقط كما هي (قرار
  صريح: القراءة المقيَّدة بصلاحية تقتصر على `suppliers`/`supplier_transactions`
  فقط — `payments.view_prices` ليس من الـ١١ مفتاحاً المعتمَدة أصلاً، ولوحظ هذا
  التناقض أثناء كتابة الخطة وصُحِّح هنا).

---

## 6. التحقق قبل الإنتاج (لكل بند من القسم 3)

نفس بروتوكول المشروع المتَّبع طوال هذا الملف:
معاملة قابلة للتراجع على staging (دور بلا الصلاحية → يُرفَض؛ دور يملكها → ينجح)
+ `npx tsc --noEmit` + `npx vitest run` + دفع staging + اختبار حي بالمتصفح
(تحديداً: اختبار `issue_supplier_payment` بحساب `branch_manager` حقيقي، التغيير
السلوكي الوحيد المتعمَّد) + **بلا نقل للإنتاج قبل موافقة صريحة**.
