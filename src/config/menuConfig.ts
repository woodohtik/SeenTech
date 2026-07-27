import { 
  NAVIGATION_CONFIG, 
  getFilteredNavItems, 
  isRouteAllowedForRole, 
  normalizeRole, 
  NavItemConfig 
} from './navigation';

export type MenuItemConfig = NavItemConfig;

/**
 * Centralized Menu Configuration for Role-Based Access Control (RBAC)
 * Defines allowedRoles for every path in the application.
 */
export const menuConfig: MenuItemConfig[] = NAVIGATION_CONFIG;

export const MENU_CONFIG = menuConfig;

/**
 * Filter menu items based on current active user role.
 * Security & UX Rule: Items where user is not allowed are HIDDEN completely (filtered out).
 */
export function getFilteredMenuItems(
  role: string | null | undefined,
  isActingAsSaaS: boolean = false,
  isImpersonatingSaaS: boolean = false
): MenuItemConfig[] {
  return getFilteredNavItems(role, isActingAsSaaS, isImpersonatingSaaS);
}

export { isRouteAllowedForRole as isPathAllowedForRole, normalizeRole };
export default menuConfig;
