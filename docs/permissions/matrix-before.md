# مصفوفة الصلاحيات — النتيجة الفعلية (2026-11-21)

مقيسة على Staging بـ `supabase/staging-checks/permissions_matrix.sql` (معاملة واحدة تُلغى بالكامل، بلا حسابات دخول). الوضع (أ): الموظف بهويته. الوضع (ب): جهاز بحساب المالك والموظف داخل بالـ PIN.

✅ سماح · ⛔ منع · ⚠️ خطأ (بنصّه)

### الوضع (أ) — الموظف بهويته

| الإجراء | owner | accountant | admin | branch_manager | cashier | cashier+override | custom:senior_cashier | manager | tailor | warehouse_manager |
|---|---|---|---|---|---|---|---|---|---|---|
| إنشاء طلب `orders.create` | ✅ | ⛔ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| تعديل طلب `orders.edit` | ✅ | ⛔ | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ⛔ |
| تغيير حالة طلب `orders.update_status` | ✅ | ⛔ | ✅ | ⛔ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ |
| استلام دفعة `order.payment` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| بيع POS `pos.sale` | ✅ | ⛔ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| بيع POS بخصم `pos.discount` | ✅ | ⛔ | ✅ | ✅ | ✅ | ⛔ | ✅ | ✅ | ⛔ | ⛔ |
| البيع يُنسب للموظف نفسه `pos.sale_attributed_to_actor` | ✅ | ⛔ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| مرتجع `action.refund` | ✅ | ✅ | ✅ | ✅ | ⛔ | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| حذف طلب `orders.delete` | ✅ | ⛔ | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ⛔ |
| حذف عميل `customers.delete` | ✅ | ⛔ | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ⛔ |
| حذف صنف `inventory.delete` | ✅ | ⛔ | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ✅ |
| إضافة عميل `customers.create` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| تعديل عميل `customers.edit` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| إضافة صنف `inventory.create` | ✅ | ⛔ | ✅ | ✅ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ✅ |
| تعديل صنف `inventory.edit` | ✅ | ⛔ | ✅ | ✅ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ✅ |
| اعتماد جرد `inventory.reconcile` | ✅ | ⛔ | ✅ | ✅ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ✅ |
| تحويل مخزون `inventory.transfer` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| إغلاق وردية `shifts.close` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| قراءة الملخص المالي `read.financial_summary` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| مبالغ اللوحة `read.dashboard_money` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| صفحة العملاء `read.customers_page` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| إضافة موظف `staff.create` | ✅ | ⛔ | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| تعديل صلاحيات `staff.permissions` | ✅ | ⛔ | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| إضافة مورد `suppliers.manage` | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ✅ |
| سند صرف لمورد `supplier.payment` | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ✅ |
| طلب اشتراك (الفوترة) `settings.billing` | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| تعديل عميل محل آخر `isolation.other_shop_customer_edit` | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |

### الوضع (ب) — جهاز المالك + الموظف بالـ PIN

| الإجراء | owner | accountant | admin | branch_manager | cashier | cashier+override | custom:senior_cashier | manager | tailor | warehouse_manager |
|---|---|---|---|---|---|---|---|---|---|---|
| إنشاء طلب `orders.create` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| تعديل طلب `orders.edit` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| تغيير حالة طلب `orders.update_status` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| استلام دفعة `order.payment` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| بيع POS `pos.sale` | ✅ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| بيع POS بخصم `pos.discount` | ✅ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| البيع يُنسب للموظف نفسه `pos.sale_attributed_to_actor` | ✅ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| مرتجع `action.refund` | ✅ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| حذف طلب `orders.delete` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| حذف عميل `customers.delete` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| حذف صنف `inventory.delete` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| إضافة عميل `customers.create` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| تعديل عميل `customers.edit` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| إضافة صنف `inventory.create` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| تعديل صنف `inventory.edit` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| اعتماد جرد `inventory.reconcile` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| تحويل مخزون `inventory.transfer` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| إغلاق وردية `shifts.close` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| قراءة الملخص المالي `read.financial_summary` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| مبالغ اللوحة `read.dashboard_money` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| صفحة العملاء `read.customers_page` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| إضافة موظف `staff.create` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| تعديل صلاحيات `staff.permissions` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| إضافة مورد `suppliers.manage` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| سند صرف لمورد `supplier.payment` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| طلب اشتراك (الفوترة) `settings.billing` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| تعديل عميل محل آخر `isolation.other_shop_customer_edit` | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |

## الفرق عن المتوقع (185 خانة)

| الوضع | الموظف | الإجراء | المتوقع | الفعلي |
|---|---|---|---|---|
| a | accountant | استلام دفعة `order.payment` | ⛔ | ✅ |
| a | accountant | إضافة عميل `customers.create` | ⛔ | ✅ |
| a | accountant | تعديل عميل `customers.edit` | ⛔ | ✅ |
| a | accountant | تحويل مخزون `inventory.transfer` | ⛔ | ✅ |
| a | accountant | إغلاق وردية `shifts.close` | ⛔ | ✅ |
| a | accountant | صفحة العملاء `read.customers_page` | ⛔ | ✅ |
| a | branch_manager | تعديل طلب `orders.edit` | ✅ | ⛔ |
| a | branch_manager | تغيير حالة طلب `orders.update_status` | ✅ | ⛔ |
| a | branch_manager | تحويل مخزون `inventory.transfer` | ⛔ | ✅ |
| a | branch_manager | إضافة موظف `staff.create` | ✅ | ⛔ |
| a | cashier | تغيير حالة طلب `orders.update_status` | ⛔ | ✅ |
| a | cashier | تعديل عميل `customers.edit` | ⛔ | ✅ |
| a | cashier | تحويل مخزون `inventory.transfer` | ⛔ | ✅ |
| a | cashier | قراءة الملخص المالي `read.financial_summary` | ⛔ | ✅ |
| a | cashier | مبالغ اللوحة `read.dashboard_money` | ⛔ | ✅ |
| a | cashier+override | تغيير حالة طلب `orders.update_status` | ⛔ | ✅ |
| a | cashier+override | تعديل عميل `customers.edit` | ⛔ | ✅ |
| a | cashier+override | تحويل مخزون `inventory.transfer` | ⛔ | ✅ |
| a | cashier+override | قراءة الملخص المالي `read.financial_summary` | ⛔ | ✅ |
| a | cashier+override | مبالغ اللوحة `read.dashboard_money` | ⛔ | ✅ |
| a | custom:senior_cashier | تحويل مخزون `inventory.transfer` | ⛔ | ✅ |
| a | custom:senior_cashier | قراءة الملخص المالي `read.financial_summary` | ⛔ | ✅ |
| a | custom:senior_cashier | مبالغ اللوحة `read.dashboard_money` | ⛔ | ✅ |
| a | manager | إضافة موظف `staff.create` | ✅ | ⛔ |
| a | tailor | استلام دفعة `order.payment` | ⛔ | ✅ |
| a | tailor | إضافة عميل `customers.create` | ⛔ | ✅ |
| a | tailor | تعديل عميل `customers.edit` | ⛔ | ✅ |
| a | tailor | تحويل مخزون `inventory.transfer` | ⛔ | ✅ |
| a | tailor | إغلاق وردية `shifts.close` | ⛔ | ✅ |
| a | tailor | قراءة الملخص المالي `read.financial_summary` | ⛔ | ✅ |
| a | tailor | مبالغ اللوحة `read.dashboard_money` | ⛔ | ✅ |
| a | warehouse_manager | استلام دفعة `order.payment` | ⛔ | ✅ |
| a | warehouse_manager | إضافة عميل `customers.create` | ⛔ | ✅ |
| a | warehouse_manager | تعديل عميل `customers.edit` | ⛔ | ✅ |
| a | warehouse_manager | إغلاق وردية `shifts.close` | ⛔ | ✅ |
| a | warehouse_manager | قراءة الملخص المالي `read.financial_summary` | ⛔ | ✅ |
| a | warehouse_manager | مبالغ اللوحة `read.dashboard_money` | ⛔ | ✅ |
| a | warehouse_manager | صفحة العملاء `read.customers_page` | ⛔ | ✅ |
| b | accountant | إنشاء طلب `orders.create` | ⛔ | ✅ |
| b | accountant | تعديل طلب `orders.edit` | ⛔ | ✅ |
| b | accountant | تغيير حالة طلب `orders.update_status` | ⛔ | ✅ |
| b | accountant | استلام دفعة `order.payment` | ⛔ | ✅ |
| b | accountant | بيع POS `pos.sale` | ⛔ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | accountant | بيع POS بخصم `pos.discount` | ⛔ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | accountant | البيع يُنسب للموظف نفسه `pos.sale_attributed_to_actor` | ⛔ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | accountant | مرتجع `action.refund` | ✅ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | accountant | حذف طلب `orders.delete` | ⛔ | ✅ |
| b | accountant | حذف عميل `customers.delete` | ⛔ | ✅ |
| b | accountant | حذف صنف `inventory.delete` | ⛔ | ✅ |
| b | accountant | إضافة عميل `customers.create` | ⛔ | ✅ |
| b | accountant | تعديل عميل `customers.edit` | ⛔ | ✅ |
| b | accountant | إضافة صنف `inventory.create` | ⛔ | ✅ |
| b | accountant | تعديل صنف `inventory.edit` | ⛔ | ✅ |
| b | accountant | اعتماد جرد `inventory.reconcile` | ⛔ | ✅ |
| b | accountant | تحويل مخزون `inventory.transfer` | ⛔ | ✅ |
| b | accountant | إغلاق وردية `shifts.close` | ⛔ | ✅ |
| b | accountant | صفحة العملاء `read.customers_page` | ⛔ | ✅ |
| b | accountant | إضافة موظف `staff.create` | ⛔ | ✅ |
| b | accountant | تعديل صلاحيات `staff.permissions` | ⛔ | ✅ |
| b | accountant | طلب اشتراك (الفوترة) `settings.billing` | ⛔ | ✅ |
| b | admin | بيع POS `pos.sale` | ✅ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | admin | بيع POS بخصم `pos.discount` | ✅ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | admin | البيع يُنسب للموظف نفسه `pos.sale_attributed_to_actor` | ✅ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | admin | مرتجع `action.refund` | ✅ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | admin | طلب اشتراك (الفوترة) `settings.billing` | ⛔ | ✅ |
| b | branch_manager | بيع POS `pos.sale` | ✅ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | branch_manager | بيع POS بخصم `pos.discount` | ✅ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | branch_manager | البيع يُنسب للموظف نفسه `pos.sale_attributed_to_actor` | ✅ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | branch_manager | مرتجع `action.refund` | ✅ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | branch_manager | حذف طلب `orders.delete` | ⛔ | ✅ |
| b | branch_manager | حذف عميل `customers.delete` | ⛔ | ✅ |
| b | branch_manager | حذف صنف `inventory.delete` | ⛔ | ✅ |
| b | branch_manager | تحويل مخزون `inventory.transfer` | ⛔ | ✅ |
| b | branch_manager | تعديل صلاحيات `staff.permissions` | ⛔ | ✅ |
| b | branch_manager | طلب اشتراك (الفوترة) `settings.billing` | ⛔ | ✅ |
| b | cashier | تعديل طلب `orders.edit` | ⛔ | ✅ |
| b | cashier | تغيير حالة طلب `orders.update_status` | ⛔ | ✅ |
| b | cashier | بيع POS `pos.sale` | ✅ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | cashier | بيع POS بخصم `pos.discount` | ✅ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | cashier | البيع يُنسب للموظف نفسه `pos.sale_attributed_to_actor` | ✅ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | cashier | مرتجع `action.refund` | ⛔ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | cashier | حذف طلب `orders.delete` | ⛔ | ✅ |
| b | cashier | حذف عميل `customers.delete` | ⛔ | ✅ |
| b | cashier | حذف صنف `inventory.delete` | ⛔ | ✅ |
| b | cashier | تعديل عميل `customers.edit` | ⛔ | ✅ |
| b | cashier | إضافة صنف `inventory.create` | ⛔ | ✅ |
| b | cashier | تعديل صنف `inventory.edit` | ⛔ | ✅ |
| b | cashier | اعتماد جرد `inventory.reconcile` | ⛔ | ✅ |
| b | cashier | تحويل مخزون `inventory.transfer` | ⛔ | ✅ |
| b | cashier | قراءة الملخص المالي `read.financial_summary` | ⛔ | ✅ |
| b | cashier | مبالغ اللوحة `read.dashboard_money` | ⛔ | ✅ |
| b | cashier | إضافة موظف `staff.create` | ⛔ | ✅ |
| b | cashier | تعديل صلاحيات `staff.permissions` | ⛔ | ✅ |
| b | cashier | إضافة مورد `suppliers.manage` | ⛔ | ✅ |
| b | cashier | سند صرف لمورد `supplier.payment` | ⛔ | ✅ |
| b | cashier | طلب اشتراك (الفوترة) `settings.billing` | ⛔ | ✅ |
| b | cashier+override | تعديل طلب `orders.edit` | ⛔ | ✅ |
| b | cashier+override | تغيير حالة طلب `orders.update_status` | ⛔ | ✅ |
| b | cashier+override | بيع POS `pos.sale` | ✅ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | cashier+override | بيع POS بخصم `pos.discount` | ⛔ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | cashier+override | البيع يُنسب للموظف نفسه `pos.sale_attributed_to_actor` | ✅ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | cashier+override | مرتجع `action.refund` | ✅ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | cashier+override | حذف طلب `orders.delete` | ⛔ | ✅ |
| b | cashier+override | حذف عميل `customers.delete` | ⛔ | ✅ |
| b | cashier+override | حذف صنف `inventory.delete` | ⛔ | ✅ |
| b | cashier+override | تعديل عميل `customers.edit` | ⛔ | ✅ |
| b | cashier+override | إضافة صنف `inventory.create` | ⛔ | ✅ |
| b | cashier+override | تعديل صنف `inventory.edit` | ⛔ | ✅ |
| b | cashier+override | اعتماد جرد `inventory.reconcile` | ⛔ | ✅ |
| b | cashier+override | تحويل مخزون `inventory.transfer` | ⛔ | ✅ |
| b | cashier+override | قراءة الملخص المالي `read.financial_summary` | ⛔ | ✅ |
| b | cashier+override | مبالغ اللوحة `read.dashboard_money` | ⛔ | ✅ |
| b | cashier+override | إضافة موظف `staff.create` | ⛔ | ✅ |
| b | cashier+override | تعديل صلاحيات `staff.permissions` | ⛔ | ✅ |
| b | cashier+override | إضافة مورد `suppliers.manage` | ⛔ | ✅ |
| b | cashier+override | سند صرف لمورد `supplier.payment` | ⛔ | ✅ |
| b | cashier+override | طلب اشتراك (الفوترة) `settings.billing` | ⛔ | ✅ |
| b | custom:senior_cashier | تعديل طلب `orders.edit` | ⛔ | ✅ |
| b | custom:senior_cashier | بيع POS `pos.sale` | ✅ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | custom:senior_cashier | بيع POS بخصم `pos.discount` | ✅ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | custom:senior_cashier | البيع يُنسب للموظف نفسه `pos.sale_attributed_to_actor` | ✅ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | custom:senior_cashier | مرتجع `action.refund` | ✅ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | custom:senior_cashier | حذف طلب `orders.delete` | ⛔ | ✅ |
| b | custom:senior_cashier | حذف عميل `customers.delete` | ⛔ | ✅ |
| b | custom:senior_cashier | حذف صنف `inventory.delete` | ⛔ | ✅ |
| b | custom:senior_cashier | إضافة صنف `inventory.create` | ⛔ | ✅ |
| b | custom:senior_cashier | تعديل صنف `inventory.edit` | ⛔ | ✅ |
| b | custom:senior_cashier | اعتماد جرد `inventory.reconcile` | ⛔ | ✅ |
| b | custom:senior_cashier | تحويل مخزون `inventory.transfer` | ⛔ | ✅ |
| b | custom:senior_cashier | قراءة الملخص المالي `read.financial_summary` | ⛔ | ✅ |
| b | custom:senior_cashier | مبالغ اللوحة `read.dashboard_money` | ⛔ | ✅ |
| b | custom:senior_cashier | إضافة موظف `staff.create` | ⛔ | ✅ |
| b | custom:senior_cashier | تعديل صلاحيات `staff.permissions` | ⛔ | ✅ |
| b | custom:senior_cashier | إضافة مورد `suppliers.manage` | ⛔ | ✅ |
| b | custom:senior_cashier | سند صرف لمورد `supplier.payment` | ⛔ | ✅ |
| b | custom:senior_cashier | طلب اشتراك (الفوترة) `settings.billing` | ⛔ | ✅ |
| b | manager | بيع POS `pos.sale` | ✅ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | manager | بيع POS بخصم `pos.discount` | ✅ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | manager | البيع يُنسب للموظف نفسه `pos.sale_attributed_to_actor` | ✅ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | manager | مرتجع `action.refund` | ✅ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | manager | تعديل صلاحيات `staff.permissions` | ⛔ | ✅ |
| b | manager | طلب اشتراك (الفوترة) `settings.billing` | ⛔ | ✅ |
| b | tailor | إنشاء طلب `orders.create` | ⛔ | ✅ |
| b | tailor | تعديل طلب `orders.edit` | ⛔ | ✅ |
| b | tailor | استلام دفعة `order.payment` | ⛔ | ✅ |
| b | tailor | بيع POS `pos.sale` | ⛔ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | tailor | بيع POS بخصم `pos.discount` | ⛔ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | tailor | البيع يُنسب للموظف نفسه `pos.sale_attributed_to_actor` | ⛔ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | tailor | مرتجع `action.refund` | ⛔ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | tailor | حذف طلب `orders.delete` | ⛔ | ✅ |
| b | tailor | حذف عميل `customers.delete` | ⛔ | ✅ |
| b | tailor | حذف صنف `inventory.delete` | ⛔ | ✅ |
| b | tailor | إضافة عميل `customers.create` | ⛔ | ✅ |
| b | tailor | تعديل عميل `customers.edit` | ⛔ | ✅ |
| b | tailor | إضافة صنف `inventory.create` | ⛔ | ✅ |
| b | tailor | تعديل صنف `inventory.edit` | ⛔ | ✅ |
| b | tailor | اعتماد جرد `inventory.reconcile` | ⛔ | ✅ |
| b | tailor | تحويل مخزون `inventory.transfer` | ⛔ | ✅ |
| b | tailor | إغلاق وردية `shifts.close` | ⛔ | ✅ |
| b | tailor | قراءة الملخص المالي `read.financial_summary` | ⛔ | ✅ |
| b | tailor | مبالغ اللوحة `read.dashboard_money` | ⛔ | ✅ |
| b | tailor | إضافة موظف `staff.create` | ⛔ | ✅ |
| b | tailor | تعديل صلاحيات `staff.permissions` | ⛔ | ✅ |
| b | tailor | إضافة مورد `suppliers.manage` | ⛔ | ✅ |
| b | tailor | سند صرف لمورد `supplier.payment` | ⛔ | ✅ |
| b | tailor | طلب اشتراك (الفوترة) `settings.billing` | ⛔ | ✅ |
| b | warehouse_manager | إنشاء طلب `orders.create` | ⛔ | ✅ |
| b | warehouse_manager | تعديل طلب `orders.edit` | ⛔ | ✅ |
| b | warehouse_manager | تغيير حالة طلب `orders.update_status` | ⛔ | ✅ |
| b | warehouse_manager | استلام دفعة `order.payment` | ⛔ | ✅ |
| b | warehouse_manager | بيع POS `pos.sale` | ⛔ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | warehouse_manager | بيع POS بخصم `pos.discount` | ⛔ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | warehouse_manager | البيع يُنسب للموظف نفسه `pos.sale_attributed_to_actor` | ⛔ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | warehouse_manager | مرتجع `action.refund` | ⛔ | ⚠️ 22023:الوردية المحدَّدة غير مفتوحة أو لا تخصّك |
| b | warehouse_manager | حذف طلب `orders.delete` | ⛔ | ✅ |
| b | warehouse_manager | حذف عميل `customers.delete` | ⛔ | ✅ |
| b | warehouse_manager | إضافة عميل `customers.create` | ⛔ | ✅ |
| b | warehouse_manager | تعديل عميل `customers.edit` | ⛔ | ✅ |
| b | warehouse_manager | إغلاق وردية `shifts.close` | ⛔ | ✅ |
| b | warehouse_manager | قراءة الملخص المالي `read.financial_summary` | ⛔ | ✅ |
| b | warehouse_manager | مبالغ اللوحة `read.dashboard_money` | ⛔ | ✅ |
| b | warehouse_manager | صفحة العملاء `read.customers_page` | ⛔ | ✅ |
| b | warehouse_manager | إضافة موظف `staff.create` | ⛔ | ✅ |
| b | warehouse_manager | تعديل صلاحيات `staff.permissions` | ⛔ | ✅ |
| b | warehouse_manager | طلب اشتراك (الفوترة) `settings.billing` | ⛔ | ✅ |
