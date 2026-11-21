# مصفوفة الصلاحيات — النتيجة الفعلية (2026-11-21)

مقيسة على Staging بـ `supabase/staging-checks/permissions_matrix.sql` (معاملة واحدة تُلغى بالكامل، بلا حسابات دخول). الوضع (أ): الموظف بهويته. الوضع (ب): جهاز بحساب المالك والموظف داخل بالـ PIN.

✅ سماح · ⛔ منع · ⚠️ خطأ (بنصّه)

### الوضع (أ) — الموظف بهويته

| الإجراء | owner | accountant | admin | branch_manager | cashier | cashier+override | custom:senior_cashier | manager | tailor | warehouse_manager |
|---|---|---|---|---|---|---|---|---|---|---|
| إنشاء طلب `orders.create` | ✅ | ⛔ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| تعديل طلب `orders.edit` | ✅ | ⛔ | ✅ | ✅ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ⛔ |
| تغيير حالة طلب `orders.update_status` | ✅ | ⛔ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ |
| استلام دفعة `order.payment` | ✅ | ⛔ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| بيع POS `pos.sale` | ✅ | ⛔ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| بيع POS بخصم `pos.discount` | ✅ | ⛔ | ✅ | ✅ | ✅ | ⛔ | ✅ | ✅ | ⛔ | ⛔ |
| البيع يُنسب للموظف نفسه `pos.sale_attributed_to_actor` | ✅ | ⛔ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| مرتجع `action.refund` | ✅ | ✅ | ✅ | ✅ | ⛔ | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| حذف طلب `orders.delete` | ✅ | ⛔ | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ⛔ |
| حذف عميل `customers.delete` | ✅ | ⛔ | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ⛔ |
| حذف صنف `inventory.delete` | ✅ | ⛔ | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ✅ |
| إضافة عميل `customers.create` | ✅ | ⛔ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| تعديل عميل `customers.edit` | ✅ | ⛔ | ✅ | ✅ | ⛔ | ⛔ | ✅ | ✅ | ⛔ | ⛔ |
| إضافة صنف `inventory.create` | ✅ | ⛔ | ✅ | ✅ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ✅ |
| تعديل صنف `inventory.edit` | ✅ | ⛔ | ✅ | ✅ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ✅ |
| اعتماد جرد `inventory.reconcile` | ✅ | ⛔ | ✅ | ✅ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ✅ |
| تحويل مخزون `inventory.transfer` | ✅ | ⛔ | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ✅ |
| إغلاق وردية (ورديته) `shifts.close` | ✅ | ⛔ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| قراءة الملخص المالي `read.financial_summary` | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ⛔ |
| مبالغ اللوحة `read.dashboard_money` | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ⛔ |
| صفحة العملاء `read.customers_page` | ✅ | ⛔ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ |
| إضافة موظف `staff.create` | ✅ | ⛔ | ✅ | ✅ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ⛔ |
| تعديل صلاحيات `staff.permissions` | ✅ | ⛔ | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| إضافة مورد `suppliers.manage` | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ✅ |
| سند صرف لمورد `supplier.payment` | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ✅ |
| طلب اشتراك (الفوترة) `settings.billing` | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| تعديل إعدادات المحل مباشرة `settings.direct_edit` | ✅ | ⛔ | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ⛔ |
| تعديل الرقم الضريبي مباشرة `settings.direct_tax` | ✅ | ⛔ | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| حفظ مقاسات من نموذج الطلب `customers.save_measurements` | ✅ | ⛔ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| تعديل عميل محل آخر `isolation.other_shop_customer_edit` | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |

### الوضع (ب) — جهاز المالك + الموظف بالـ PIN

| الإجراء | owner | accountant | admin | branch_manager | cashier | cashier+override | custom:senior_cashier | manager | tailor | warehouse_manager |
|---|---|---|---|---|---|---|---|---|---|---|
| إنشاء طلب `orders.create` | ✅ | ⛔ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| تعديل طلب `orders.edit` | ✅ | ⛔ | ✅ | ✅ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ⛔ |
| تغيير حالة طلب `orders.update_status` | ✅ | ⛔ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ |
| استلام دفعة `order.payment` | ✅ | ⛔ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| بيع POS `pos.sale` | ✅ | ⛔ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| بيع POS بخصم `pos.discount` | ✅ | ⛔ | ✅ | ✅ | ✅ | ⛔ | ✅ | ✅ | ⛔ | ⛔ |
| البيع يُنسب للموظف نفسه `pos.sale_attributed_to_actor` | ✅ | ⛔ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| مرتجع `action.refund` | ✅ | ✅ | ✅ | ✅ | ⛔ | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| حذف طلب `orders.delete` | ✅ | ⛔ | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ⛔ |
| حذف عميل `customers.delete` | ✅ | ⛔ | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ⛔ |
| حذف صنف `inventory.delete` | ✅ | ⛔ | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ✅ |
| إضافة عميل `customers.create` | ✅ | ⛔ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| تعديل عميل `customers.edit` | ✅ | ⛔ | ✅ | ✅ | ⛔ | ⛔ | ✅ | ✅ | ⛔ | ⛔ |
| إضافة صنف `inventory.create` | ✅ | ⛔ | ✅ | ✅ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ✅ |
| تعديل صنف `inventory.edit` | ✅ | ⛔ | ✅ | ✅ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ✅ |
| اعتماد جرد `inventory.reconcile` | ✅ | ⛔ | ✅ | ✅ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ✅ |
| تحويل مخزون `inventory.transfer` | ✅ | ⛔ | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ✅ |
| إغلاق وردية (ورديته) `shifts.close` | ✅ | ⛔ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| قراءة الملخص المالي `read.financial_summary` | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ⛔ |
| مبالغ اللوحة `read.dashboard_money` | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ⛔ |
| صفحة العملاء `read.customers_page` | ✅ | ⛔ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ |
| إضافة موظف `staff.create` | ✅ | ⛔ | ✅ | ✅ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ⛔ |
| تعديل صلاحيات `staff.permissions` | ✅ | ⛔ | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| إضافة مورد `suppliers.manage` | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ✅ |
| سند صرف لمورد `supplier.payment` | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ✅ |
| طلب اشتراك (الفوترة) `settings.billing` | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| تعديل إعدادات المحل مباشرة `settings.direct_edit` | ✅ | ⛔ | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ✅ | ⛔ | ⛔ |
| تعديل الرقم الضريبي مباشرة `settings.direct_tax` | ✅ | ⛔ | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| حفظ مقاسات من نموذج الطلب `customers.save_measurements` | ✅ | ⛔ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| تعديل عميل محل آخر `isolation.other_shop_customer_edit` | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |

## الفرق عن المتوقع (0 خانة)

| الوضع | الموظف | الإجراء | المتوقع | الفعلي |
|---|---|---|---|---|

