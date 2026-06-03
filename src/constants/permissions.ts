export interface Permission {
  id: string;
  name: string;
  description: string;
  category: string;
}

export const SYSTEM_PERMISSIONS: Permission[] = [
  // Orders
  { id: 'orders.create', name: 'إنشاء طلب', description: 'السماح بإنشاء طلبات جديدة للعملاء', category: 'الطلبات' },
  { id: 'orders.view', name: 'عرض الطلبات', description: 'السماح باستعراض قائمة الطلبات', category: 'الطلبات' },
  { id: 'orders.view_details', name: 'رؤية تفاصيل الطلب', description: 'السماح برؤية المقاسات والتفاصيل الفنية', category: 'الطلبات' },
  { id: 'orders.update_status', name: 'تحديث حالة الطلب', description: 'السماح بتغيير حالة الطلب (قص، خياطة، إلخ)', category: 'الطلبات' },
  { id: 'orders.delete', name: 'حذف الفواتير', description: 'السماح بحذف الفواتير والطلبات من النظام', category: 'الطلبات' },
  { id: 'invoices.view', name: 'عرض الفواتير', description: 'السماح باستعراض فواتير المبيعات', category: 'الطلبات' },
  
  // Payments
  { id: 'payments.collect', name: 'تحصيل الدفعة', description: 'السماح بتسجيل المبالغ المدفوعة', category: 'المالية' },
  { id: 'payments.view_prices', name: 'رؤية الأسعار', description: 'السماح برؤية أسعار الخدمات والمبالغ المالية', category: 'المالية' },
  { id: 'action.refund', name: 'إجراء استرجاع', description: 'السماح بعمليات استرجاع المبالغ', category: 'المالية' },
  { id: 'action.discount', name: 'إضافة خصم', description: 'السماح بإضافة خصومات على الطلبات', category: 'المالية' },

  // Inventory
  { id: 'inventory.view', name: 'عرض المخزون', description: 'السماح باستعراض قائمة المخزون', category: 'المخزون' },
  { id: 'inventory.manage', name: 'التعديل على المخزون', description: 'السماح بإضافة وتعديل وحذف أصناف المخزون', category: 'المخزون' },
  { id: 'inventory.reconcile', name: 'تسوية المخزون', description: 'السماح بإجراء تسويات جردية', category: 'المخزون' },
  { id: 'inventory.transfer', name: 'تحويل المخزون', description: 'السماح بتحويل المخزون بين الفروع', category: 'المخزون' },

  // Customers
  { id: 'customers.create', name: 'إضافة عميل', description: 'السماح بإضافة عملاء جدد للنظام', category: 'العملاء' },
  { id: 'customers.view', name: 'عرض العملاء', description: 'السماح باستعراض بيانات العملاء ومقاساتهم', category: 'العملاء' },
  { id: 'customers.edit', name: 'تعديل العملاء', description: 'السماح بتعديل بيانات ومقاسات العملاء', category: 'العملاء' },

  // Dashboard
  { id: 'dashboard.view', name: 'عرض لوحة التحكم', description: 'السماح بالوصول للوحة التحكم الرئيسية', category: 'لوحة التحكم' },
  { id: 'dashboard.revenue', name: 'رؤية الإيرادات', description: 'السماح برؤية إجمالي الإيرادات والرسوم البيانية المالية', category: 'لوحة التحكم' },
  { id: 'dashboard.orders', name: 'إحصائيات الطلبات', description: 'السماح برؤية عدد الطلبات وحالاتها', category: 'لوحة التحكم' },
  { id: 'dashboard.inventory', name: 'حالة المخزون', description: 'السماح برؤية تنبيهات المخزون المنخفض', category: 'لوحة التحكم' },
  { id: 'dashboard.customers', name: 'إحصائيات العملاء', description: 'السماح برؤية عدد العملاء ونموهم', category: 'لوحة التحكم' },

  // Reports
  { id: 'reports.view', name: 'مركز التقارير', description: 'السماح بالوصول لشاشة التقارير والتحليلات', category: 'التقارير' },
  { id: 'reports.financial', name: 'التقارير المالية', description: 'السماح برؤية التقارير المالية والإيرادات', category: 'التقارير' },
  { id: 'reports.tax', name: 'تقارير الضرائب', description: 'السماح باستخراج تقارير القيمة المضافة والضرائب', category: 'التقارير' },

  // Staff & Settings
  { id: 'staff.view', name: 'عرض الموظفين', description: 'السماح باستعراض بيانات الموظفين', category: 'الإعدادات' },
  { id: 'staff.create', name: 'إضافة موظف', description: 'السماح بإضافة موظفين جدد للنظام', category: 'الإعدادات' },
  { id: 'staff.edit', name: 'تعديل موظف', description: 'السماح بتعديل بيانات الموظفين', category: 'الإعدادات' },
  { id: 'staff.delete', name: 'حذف موظف', description: 'السماح بحذف موظفين من النظام', category: 'الإعدادات' },
  { id: 'staff.manage', name: 'إدارة المكون والمهن', description: 'السماح بإدارة المهن والصلاحيات العامة', category: 'الإعدادات' },
  { id: 'staff.permissions', name: 'إدارة صلاحيات المدير', description: 'صلاحية حصرية للمالك لتعديل صلاحيات المديرين', category: 'الإعدادات' },
  { id: 'branches.view', name: 'عرض الفروع', description: 'السماح باستعراض قائمة الفروع', category: 'الإعدادات' },
  { id: 'branches.manage', name: 'إدارة الفروع', description: 'السماح بإضافة وتعديل وحذف الفروع', category: 'الإعدادات' },
  { id: 'settings.manage', name: 'إعدادات النظام', description: 'السماح بتعديل إعدادات المتجر والفرع', category: 'الإعدادات' },
  { id: 'settings.billing', name: 'إدارة الاشتراك', description: 'السماح بترقية أو إلغاء الاشتراك وفواتير Seen', category: 'الإعدادات' },
  { id: 'settings.tax', name: 'إعدادات الضريبة', description: 'السماح بتعديل نسب الضريبة والإعدادات الضريبية', category: 'الإعدادات' },
  { id: 'system.delete', name: 'حذف مساحة العمل', description: 'صلاحية حصرية لحذف كامل بيانات النظام ومساحة العمل', category: 'الإعدادات' },
  { id: 'shifts.manage', name: 'إدارة الورديات', description: 'السماح بفتح وإغلاق وردية الصندوق', category: 'المالية' },
];
