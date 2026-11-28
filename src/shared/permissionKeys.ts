/**
 * seen-readiness-fixes-task.md P6 (CODEHEALTH-07): the permission keys, as a
 * type. The one source is src/shared/permissionsMatrix.json (it also
 * generates the database's defaults); this list is that file's `keys`, and
 * src/shared/permissionKeys.test.ts fails if the two ever differ. The type
 * used to be a hand-written union that had drifted from the matrix.
 */
export const PERMISSION_KEYS = [
  'dashboard.view',
  'sales.view',
  'orders.view',
  'customers.view',
  'inventory.view',
  'suppliers.manage',
  'reports.view',
  'settings.view',
  'orders.create',
  'orders.view_details',
  'orders.update_status',
  'orders.edit',
  'orders.delete',
  'invoices.view',
  'payments.collect',
  'payments.view_prices',
  'action.refund',
  'action.discount',
  'shifts.manage',
  'inventory.manage',
  'inventory.create',
  'inventory.edit',
  'inventory.delete',
  'inventory.reconcile',
  'inventory.transfer',
  'customers.create',
  'customers.edit',
  'customers.delete',
  'customers.view_measurements',
  'dashboard.revenue',
  'dashboard.orders',
  'dashboard.inventory',
  'dashboard.customers',
  'reports.financial',
  'reports.tax',
  'reports.export',
  'settings.edit',
  'settings.manage',
  'settings.billing',
  'settings.tax',
  'settings.whatsapp',
  'settings.notifications',
  'staff.view',
  'staff.create',
  'staff.edit',
  'staff.delete',
  'staff.manage',
  'staff.permissions',
  'branches.view',
  'branches.manage',
  'system.delete',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const isPermissionKey = (key: string): key is PermissionKey => (PERMISSION_KEYS as readonly string[]).includes(key);
