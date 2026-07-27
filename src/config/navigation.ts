import { 
  Home, 
  Monitor, 
  UserCircle, 
  ShoppingBag, 
  Package, 
  Briefcase, 
  BarChart3, 
  Settings, 
  LayoutDashboard, 
  Users,
  LucideIcon 
} from 'lucide-react';
import { UserRole } from '../types/supabase';

export interface NavItemConfig {
  id: string;
  to: string;
  labelKey: string;
  defaultLabel: string;
  icon: LucideIcon;
  allowedRoles: Array<UserRole | 'tenant_admin'>;
  permission?: string;
  permissions?: string[];
  group?: 'saas' | 'tenant';
}

/**
 * Role Normalization Helper
 * Maps 'tenant_admin' to 'owner'/'admin' and handles role aliases
 */
export function normalizeRole(role: string | null | undefined): UserRole | 'tenant_admin' {
  if (!role) return 'cashier';
  if (role === 'owner' || role === 'admin' || role === 'tenant_admin') {
    return 'tenant_admin';
  }
  return role as UserRole;
}

/**
 * Centralized Navigation Items Definition
 * Every view/tab defines explicit allowedRoles for Role-Based Access Control (RBAC).
 */
export const NAVIGATION_CONFIG: NavItemConfig[] = [
  // ==========================================
  // SaaS Admin Level Navigation
  // ==========================================
  {
    id: 'saas_dashboard',
    to: '/admin/dashboard',
    labelKey: 'sidebar.saas_dashboard',
    defaultLabel: 'لوحة التحكم السحابية',
    icon: LayoutDashboard,
    allowedRoles: ['super_admin', 'support_tech', 'billing_admin'],
    group: 'saas'
  },
  {
    id: 'saas_subscribers',
    to: '/admin/tailors',
    labelKey: 'sidebar.manage_subscribers',
    defaultLabel: 'إدارة المشتركين',
    icon: Users,
    allowedRoles: ['super_admin', 'support_tech'],
    group: 'saas'
  },

  // ==========================================
  // Tenant Level Navigation
  // ==========================================
  {
    id: 'dashboard',
    to: '/dashboard',
    labelKey: 'common.dashboard',
    defaultLabel: 'الرئيسية',
    icon: Home,
    allowedRoles: ['super_admin', 'tenant_admin', 'owner', 'admin', 'manager', 'branch_manager'],
    permission: 'dashboard.view',
    group: 'tenant'
  },
  {
    id: 'sales',
    to: '/sales',
    labelKey: 'common.sales',
    defaultLabel: 'نقطة البيع (POS)',
    icon: Monitor,
    allowedRoles: ['super_admin', 'tenant_admin', 'owner', 'admin', 'manager', 'cashier', 'branch_manager'],
    permission: 'sales.view',
    group: 'tenant'
  },
  {
    id: 'orders',
    to: '/orders',
    labelKey: 'common.orders',
    defaultLabel: 'سجل الطلبات',
    icon: ShoppingBag,
    allowedRoles: ['super_admin', 'tenant_admin', 'owner', 'admin', 'manager', 'cashier', 'tailor', 'branch_manager'],
    permission: 'orders.view',
    group: 'tenant'
  },
  {
    id: 'customers',
    to: '/customers',
    labelKey: 'common.customers',
    defaultLabel: 'إدارة العملاء',
    icon: UserCircle,
    allowedRoles: ['super_admin', 'tenant_admin', 'owner', 'admin', 'manager', 'cashier', 'branch_manager'],
    permission: 'customers.view',
    group: 'tenant'
  },
  {
    id: 'inventory',
    to: '/inventory',
    labelKey: 'common.inventory',
    defaultLabel: 'المخزون والأقمشة',
    icon: Package,
    allowedRoles: ['super_admin', 'tenant_admin', 'owner', 'admin', 'manager', 'warehouse_manager', 'branch_manager'],
    permission: 'inventory.view',
    group: 'tenant'
  },
  {
    id: 'suppliers',
    to: '/suppliers',
    labelKey: 'common.suppliers',
    defaultLabel: 'الموردين والمشتريات',
    icon: Briefcase,
    allowedRoles: ['super_admin', 'tenant_admin', 'owner', 'admin', 'manager', 'accountant'],
    permission: 'suppliers.manage',
    group: 'tenant'
  },
  {
    id: 'reports',
    to: '/reports',
    labelKey: 'common.reports',
    defaultLabel: 'التقارير المالية',
    icon: BarChart3,
    allowedRoles: ['super_admin', 'tenant_admin', 'owner', 'admin', 'manager', 'accountant'],
    permission: 'reports.view',
    group: 'tenant'
  },
  {
    id: 'settings',
    to: '/settings',
    labelKey: 'common.settings',
    defaultLabel: 'إعدادات المحل',
    icon: Settings,
    allowedRoles: ['super_admin', 'tenant_admin', 'owner', 'admin'],
    permission: 'settings.view',
    group: 'tenant'
  }
];

/**
 * Returns filtered navigation items for a specific user role.
 * Role-Based UX Rule: Items without permission are HIDDEN completely from the user.
 */
export function getFilteredNavItems(
  role: string | null | undefined,
  isActingAsSaaS: boolean = false,
  isImpersonatingSaaS: boolean = false
): NavItemConfig[] {
  const normRole = normalizeRole(role);

  return NAVIGATION_CONFIG.filter(item => {
    // SaaS Admin Section
    if (isActingAsSaaS) {
      if (item.group !== 'saas') return false;
      return item.allowedRoles.includes(normRole as any) || item.allowedRoles.includes(role as any);
    }

    // Tenant Section
    if (item.group === 'saas') return false;

    // Super Admin impersonating a tenant gets full tenant access
    if (isImpersonatingSaaS || role === 'super_admin') return true;

    // Return all tenant navigation items so fine-grained permissions (item.permission / item.permissions)
    // dynamically control tab visibility in Layout and Sidebar based on role configuration.
    return true;
  });
}

/**
 * Checks if a user role is allowed to access a specific route path
 */
export function isRouteAllowedForRole(
  path: string, 
  role: string | null | undefined, 
  isImpersonating: boolean = false
): boolean {
  if (!role) return false;
  if (role === 'super_admin' || isImpersonating) return true;

  const normRole = normalizeRole(role);

  // Find matching nav config item for this path
  const matchingItem = NAVIGATION_CONFIG.find(item => {
    if (path === item.to) return true;
    if (path.startsWith(item.to) && item.to !== '/') return true;
    return false;
  });

  if (!matchingItem) {
    // Default open for root/dashboard fallback if role is valid
    return true;
  }

  return (
    matchingItem.allowedRoles.includes(normRole as any) ||
    matchingItem.allowedRoles.includes(role as any) ||
    (normRole === 'tenant_admin' && (matchingItem.allowedRoles.includes('owner') || matchingItem.allowedRoles.includes('admin') || matchingItem.allowedRoles.includes('tenant_admin')))
  );
}
