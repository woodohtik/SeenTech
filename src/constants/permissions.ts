import i18n from 'i18next';

export interface Permission {
  id: string;
  /** i18n key for the permission's display name. */
  nameKey: string;
  /** i18n key for the permission's description. */
  descriptionKey: string;
  /** i18n key for the permission's category label. */
  categoryKey: string;
  /** Display name in the active language (resolved lazily on access). */
  readonly name: string;
  /** Description in the active language (resolved lazily on access). */
  readonly description: string;
  /** Category label in the active language (resolved lazily on access). */
  readonly category: string;
}

const definePermission = (id: string, slug: string, categoryKey: string): Permission => {
  const nameKey = `permissions.items.${slug}.name`;
  const descriptionKey = `permissions.items.${slug}.description`;
  return {
    id,
    nameKey,
    descriptionKey,
    categoryKey,
    get name() { return i18n.t(nameKey); },
    get description() { return i18n.t(descriptionKey); },
    get category() { return i18n.t(categoryKey); },
  };
};

export const SYSTEM_PERMISSIONS: Permission[] = [
  // Navigation Tabs
  definePermission('dashboard.view', 'tabs_screens.dashboard_view', 'permissions.categories.tabs_screens'),
  definePermission('sales.view', 'tabs_screens.sales_view', 'permissions.categories.tabs_screens'),
  definePermission('orders.view', 'tabs_screens.orders_view', 'permissions.categories.tabs_screens'),
  definePermission('customers.view', 'tabs_screens.customers_view', 'permissions.categories.tabs_screens'),
  definePermission('inventory.view', 'tabs_screens.inventory_view', 'permissions.categories.tabs_screens'),
  definePermission('suppliers.manage', 'tabs_screens.suppliers_manage', 'permissions.categories.tabs_screens'),
  definePermission('reports.view', 'tabs_screens.reports_view', 'permissions.categories.tabs_screens'),
  definePermission('settings.view', 'tabs_screens.settings_view', 'permissions.categories.tabs_screens'),

  // Orders
  definePermission('orders.create', 'orders.orders_create', 'permissions.categories.orders'),
  definePermission('orders.view', 'orders.orders_view', 'permissions.categories.orders'),
  definePermission('orders.view_details', 'orders.orders_view_details', 'permissions.categories.orders'),
  definePermission('orders.update_status', 'orders.orders_update_status', 'permissions.categories.orders'),
  definePermission('orders.edit', 'orders.orders_edit', 'permissions.categories.orders'),
  definePermission('orders.delete', 'orders.orders_delete', 'permissions.categories.orders'),
  definePermission('invoices.view', 'orders.invoices_view', 'permissions.categories.orders'),

  // Payments
  definePermission('payments.collect', 'financial.payments_collect', 'permissions.categories.financial'),
  definePermission('payments.view_prices', 'financial.payments_view_prices', 'permissions.categories.financial'),
  definePermission('action.refund', 'financial.action_refund', 'permissions.categories.financial'),
  definePermission('action.discount', 'financial.action_discount', 'permissions.categories.financial'),
  definePermission('shifts.manage', 'financial.shifts_manage', 'permissions.categories.financial'),

  // Inventory
  definePermission('inventory.view', 'inventory.inventory_view', 'permissions.categories.inventory'),
  definePermission('inventory.manage', 'inventory.inventory_manage', 'permissions.categories.inventory'),
  definePermission('inventory.create', 'inventory.inventory_create', 'permissions.categories.inventory'),
  definePermission('inventory.edit', 'inventory.inventory_edit', 'permissions.categories.inventory'),
  definePermission('inventory.delete', 'inventory.inventory_delete', 'permissions.categories.inventory'),
  definePermission('inventory.reconcile', 'inventory.inventory_reconcile', 'permissions.categories.inventory'),
  definePermission('inventory.transfer', 'inventory.inventory_transfer', 'permissions.categories.inventory'),
  definePermission('suppliers.manage', 'inventory.suppliers_manage', 'permissions.categories.inventory'),

  // Customers
  definePermission('customers.create', 'customers.customers_create', 'permissions.categories.customers'),
  definePermission('customers.view', 'customers.customers_view', 'permissions.categories.customers'),
  definePermission('customers.edit', 'customers.customers_edit', 'permissions.categories.customers'),
  definePermission('customers.delete', 'customers.customers_delete', 'permissions.categories.customers'),

  // Dashboard
  definePermission('dashboard.view', 'dashboard.dashboard_view', 'permissions.categories.dashboard'),
  definePermission('dashboard.revenue', 'dashboard.dashboard_revenue', 'permissions.categories.dashboard'),
  definePermission('dashboard.orders', 'dashboard.dashboard_orders', 'permissions.categories.dashboard'),
  definePermission('dashboard.inventory', 'dashboard.dashboard_inventory', 'permissions.categories.dashboard'),
  definePermission('dashboard.customers', 'dashboard.dashboard_customers', 'permissions.categories.dashboard'),

  // Reports
  definePermission('reports.view', 'reports.reports_view', 'permissions.categories.reports'),
  definePermission('reports.financial', 'reports.reports_financial', 'permissions.categories.reports'),
  definePermission('reports.tax', 'reports.reports_tax', 'permissions.categories.reports'),
  definePermission('reports.export', 'reports.reports_export', 'permissions.categories.reports'),

  // Staff & Settings
  definePermission('settings.view', 'settings.settings_view', 'permissions.categories.settings'),
  definePermission('settings.edit', 'settings.settings_edit', 'permissions.categories.settings'),
  definePermission('settings.manage', 'settings.settings_manage', 'permissions.categories.settings'),
  definePermission('settings.billing', 'settings.settings_billing', 'permissions.categories.settings'),
  definePermission('settings.tax', 'settings.settings_tax', 'permissions.categories.settings'),
  definePermission('settings.whatsapp', 'settings.settings_whatsapp', 'permissions.categories.settings'),
  definePermission('settings.notifications', 'settings.settings_notifications', 'permissions.categories.settings'),
  definePermission('staff.view', 'settings.staff_view', 'permissions.categories.settings'),
  definePermission('staff.create', 'settings.staff_create', 'permissions.categories.settings'),
  definePermission('staff.edit', 'settings.staff_edit', 'permissions.categories.settings'),
  definePermission('staff.delete', 'settings.staff_delete', 'permissions.categories.settings'),
  definePermission('staff.manage', 'settings.staff_manage', 'permissions.categories.settings'),
  definePermission('staff.permissions', 'settings.staff_permissions', 'permissions.categories.settings'),
  definePermission('branches.view', 'settings.branches_view', 'permissions.categories.settings'),
  definePermission('branches.manage', 'settings.branches_manage', 'permissions.categories.settings'),
  definePermission('system.delete', 'settings.system_delete', 'permissions.categories.settings'),
];
