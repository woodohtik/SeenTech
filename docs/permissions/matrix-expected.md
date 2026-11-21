# مصفوفة الصلاحيات — المتوقع من الواجهة (2026-11-21)

من `src/shared/permissionsMatrix.json` (القيم الافتراضية للأدوار)، ودور الاختبار المخصص «كاشير أول»، واستثناء الكاشير الفردي (مرتجع ✅، خصم ⛔). الوضعان (أ) و(ب) متوقعان متطابقين.

### المتوقع (لكلا الوضعين)

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

