# سبرنت 4 — صلاحيات حقيقية (JWT/الخادم)

مصدر: `seen-cto-code-review-2026-11-13.md` قسم 6 بند 3 ("صلاحيات حقيقية: الدور وصلاحياته داخل JWT أو تُفحص في الدوال"). المؤسس اختار البدء بهذا الملف الفرعي أولاً من بين 3 مشاريع سبرنت 4 (الآخران: تفكيك الملفات العملاقة، نظام تصميم+جودة).

## تصحيح جوهري عن افتراض المراجعة الأصلية (قبل التنفيذ)

المراجعة الأصلية افترضت فجوة شاملة ("الثقة بمتغيرات المتصفح" بشكل عام). تدقيق فعلي (subagent أمني، قراءة مباشرة لكل migrations/RLS + كل استخدامات `ProtectedRoute permission=`) أظهر: **~70% من المسارات المالية الحرجة (`create_pos_sale`, `process_sales_return`, `close_shift`, `approve_stock_take`, `issue_supplier_payment`, إدارة `staff`, `tax_invoices`) مُغطّاة فعلاً** بفحص دور خادمي حقيقي عبر `app_current_role()` (دالة SECURITY DEFINER تشتق الدور من `auth.uid()` مباشرة من جدول `staff` في كل استدعاء — **ليست** JWT claim ثابتة قد تَفسَد) — هذا أُنجِز في سبرنتات سابقة (20261114/20261115xxxxx). الفجوة المتبقية محدَّدة وأصغر بكثير من "أعد فحص كل شيء".

## البنود الثلاثة المتبقية (من تقرير التدقيق)

### 1. `increment_supplier_balance` + `supplier_transactions` — حرجة ❌ لم يُنفَّذ بعد

- **الحالة الحالية**: `increment_supplier_balance` (`supabase/migrations/20261019040000_increment_supplier_balance_idempotency.sql:30-49`) تتحقق فقط من `app_current_tenant_id()` — بلا أي `app_current_role()`. أي كاشير بجلسة صالحة لنفس المستأجر يستدعي `supabase.rpc('increment_supplier_balance', {p_supplier_id, p_delta: -999999})` من console المتصفح مباشرة ويُصفّي/يُضخِّم رصيد مورّد بلا أي بوابة.
- `supplier_transactions_tenant_isolation` (`20261019020000_missing_tables_schema_drift.sql:46-51`) سياسة `FOR ALL` واحدة تفحص المستأجر فقط — أي موظف يملك INSERT/UPDATE/DELETE مباشر على دفتر حسابات الموردين.
- `addSupplierTransaction` في `src/services/supplierAccountsService.ts:63-110` بلا أي فحص دور client-side حتى.
- **الخطة**: migration جديدة — (أ) أضف فحص `app_current_role() IN ('owner','admin','manager','accountant')` في `increment_supplier_balance` (نفس مجموعة الأدوار المستخدَمة في `issue_supplier_payment` الموجودة فعلاً — للاتساق). (ب) قسّم `supplier_transactions_tenant_isolation` لسياستين: SELECT لكل الموظفين (تطابق مستأجر فقط، كما هي)، وINSERT/UPDATE/DELETE لنفس مجموعة الأدوار أعلاه فقط. (ج) `supplierAccountsService.ts`: لا تغيير منطقي مطلوب (الخادم سيرفض الآن) لكن أضف معالجة خطأ واضحة للمستخدم بدل رسالة Postgres الخام.
- **تقدير**: نصف يوم.

### 2. UPDATE على 6 جداول مالية (orders/order_items/payments/shifts/shift_entries/sales_returns) — عالية ❌ لم يُنفَّذ بعد

- **الحالة الحالية**: `20261114000001_staff_column_protection_and_delete_guards.sql:174-189` ضيّقت **فقط DELETE** (owner/admin/manager) على هذه الجداول الستة، وتركت UPDATE صراحة بلا لمس (تعليق السطر 19 في نفس الملف). لا توجد أي migration لاحقة أعادت تعريف سياسات UPDATE لهذه الجداول — لا تزال من الحلقة العامة `tenant_tables` (`20240601000000:1116-1127`، تطابق `tenant_id` فقط). لا column-guard trigger على `payments`/`shift_entries` (فقط `orders.is_test` و`sales_returns`/`credit_note_total_guard` محميان جزئياً).
- **سيناريو الاستغلال**: كاشير يستدعي `supabase.from('payments').update({amount: 999999}).eq('id', X)` مباشرة من المتصفح، متجاوزاً `create_pos_sale`/`close_shift` بالكامل — تلاعب مالي مباشر.
- **الخطة**: migration جديدة بنفس نمط `20261114000001` (الذي أثبت نجاحه للـDELETE) — لكل جدول من الستة: (أ) سياسة UPDATE جديدة تقيّد التعديل المباشر لـowner/admin/manager فقط (نفس مجموعة DELETE الموجودة)، (ب) قبل التضييق، يجب فحص كل مسار كتابة شرعي حالي (RPCs: `create_pos_sale`, `process_sales_return`, `close_shift`, إلخ — كلها SECURITY DEFINER فتتجاوز RLS أصلاً فلن تتأثر) للتأكد من عدم كسر أي تحديث مباشر مشروع من الواجهة (مثلاً تعديل ملاحظة طلب من موظف عادي — إن وُجد مسار كهذا، يحتاج استثناء صريح بعمود محدَّد لا فتح الجدول بالكامل). (ج) column-guard trigger على `payments`/`shift_entries` على نمط `staff_column_protection_guard` يسمح فقط بالأعمدة التي تكتبها RPCs الشرعية.
- **تقدير**: يوم إلى يومين — يحتاج مسحاً دقيقاً لمسارات الكتابة المباشرة الحالية من الواجهة قبل التضييق (خطر كسر وظيفة حقيقية أعلى من البند 1).

### 3. `roles.permissions` (الصلاحيات المرنة) — قرار معماري، ليس حقيقة تقنية بحتة ⏸️ بانتظار قرار المؤسس

- **الحالة الحالية**: جدول `roles.permissions JSONB` موجود (`20240601000000:288-300`) ويرتبط بـ `staff.role_id`، ويُعرَض/يُحرَّر في الواجهة (`usePermissions.ts`/`ProtectedRoute.tsx`/قيم `permission="X.Y"` في `App.tsx`) — **لكن لا أي RPC حرجة (`create_pos_sale`, `close_shift`, `approve_stock_take`, `issue_supplier_payment`) تقرأ `role_id`/`permissions` إطلاقاً** — كلها تفحص فقط enum `staff.role` الثابت عبر `app_current_role()`. نفس الأمر لكل جداول القراءة (`customers`, `suppliers`, `payments`...) — لا فحص دور على SELECT أصلاً (تطابق مستأجر فقط)، فموظف يُحجَب عن `reports.view`/`suppliers.manage` في الواجهة يمكنه استدعاء `supabase.from('suppliers').select('*')` مباشرة ويحصل على البيانات كاملة.
- **القرار المطلوب من المؤسس**: هل enum `staff.role` الثابت هو مصدر الحقيقة الوحيد فعلياً تجارياً (ونظام `roles.permissions` المرن تجميلي/واجهة فقط، ويُوثَّق كذلك صراحة)، أم يجب أن يُنفَّذ فعلياً على الخادم (كل RPC حرجة تمرّر وتفحص `role_id`/`permissions`، وكل سياسة SELECT حساسة تُعاد كتابتها لتفحص JSONB بدل enum)؟ الخيار الثاني أكبر من "إصلاح" — أسبوع+ تقديراً، يلمس عدداً كبيراً من الجداول وRPCs.
- **لا تنفيذ حتى يُحسَم القرار.**

## ترتيب التنفيذ المتفق عليه

1. ✅ **البدء الآن**: البند 1 (`increment_supplier_balance`/`supplier_transactions`) — الأخطر والأسرع.
2. البند 2 (UPDATE على الجداول الستة) بعده.
3. البند 3 معلَّق لقرار المؤسس — لا يحجب تنفيذ 1 و2.

## التحقق لكل بند قبل الإنتاج

كالعادة: migration + معاملة قابلة للتراجع على staging DB (محاكاة سيناريو الاستغلال فعلياً: استدعاء مباشر بدور cashier يجب أن يُرفَض، بدور owner/admin/manager يجب أن ينجح) + `npx tsc --noEmit` + `npx vitest run` + دفع staging + اختبار حي في المتصفح + **بلا نقل للإنتاج قبل موافقة صريحة**.
