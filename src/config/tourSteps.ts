/**
 * ============================================================
 *  Seen Smart System — Professional Onboarding Tour Definition
 * ============================================================
 *
 * A single source of truth for the first-run guided tour.
 * Every step declares:
 *   - which route it lives on (the tour navigates there automatically)
 *   - which DOM element to spotlight (with graceful fallbacks)
 *   - which permission / role is required to see it
 *
 * Steps the current user cannot access are silently dropped, so a
 * cashier, a tailor and an owner each get a tour tailored to what
 * they actually see in the sidebar.
 */

export type TourStepKind = 'spotlight' | 'welcome' | 'finish';

export interface TourStepDef {
  /** Stable identifier — also used as the i18n key: tour.steps.<id>.title / .desc */
  id: string;
  kind?: TourStepKind;
  /** Route the tour navigates to before highlighting. Omit to stay put. */
  route?: string;
  /** Primary CSS selector to spotlight. */
  element?: string;
  /** Extra selectors tried in order when the primary one is missing. */
  fallbacks?: string[];
  /** Selector used instead of `element` on small screens (< 1024px). */
  mobileElement?: string;
  /** Drop this step entirely on small screens. */
  desktopOnly?: boolean;
  /**
   * Skip this step entirely when none of its selectors resolve, instead of
   * degrading to a centred popover. Use for anchors that only exist in some
   * states (e.g. the shift bar, which needs an open shift).
   */
  optional?: boolean;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** Fine-grained permission key required for this step. */
  permission?: string;
  /** Restrict the step to specific roles (normalized, lowercase). */
  roles?: string[];
  /** Small icon name (lucide) rendered in the popover heading. */
  icon?: string;
  /** Milliseconds to wait for the element after navigation (default 3500). */
  timeout?: number;
}

export const TOUR_STEPS: TourStepDef[] = [
  // ── 0. Welcome ─────────────────────────────────────────────
  {
    id: 'welcome',
    kind: 'welcome',
  },

  // ── 1. Orientation: the sidebar ────────────────────────────
  // No `route` on purpose: the sidebar exists on every page, and pinning this
  // step to /dashboard would drop it for roles that cannot see the dashboard.
  {
    id: 'sidebar',
    element: '#tour-sidebar',
    mobileElement: '#tour-mobile-menu-btn',
    // Grid layout mode replaces the sidebar with a launcher grid on the home
    // screen, so that becomes the navigation anchor there.
    fallbacks: ['#tour-mobile-menu-btn', '#tour-grid-launcher'],
    side: 'right',
    align: 'start',
    icon: 'Compass',
    timeout: 1500,
  },

  // ── 2. Dashboard ───────────────────────────────────────────
  {
    id: 'dashboard',
    route: '/dashboard',
    element: '#tour-dashboard-container',
    fallbacks: ['#tour-dashboard-nav'],
    side: 'top',
    align: 'center',
    permission: 'dashboard.view',
    icon: 'LayoutDashboard',
  },

  // ── 3-5. Point of sale ─────────────────────────────────────
  {
    id: 'pos_intro',
    route: '/sales',
    element: '#tour-pos-tabs',
    fallbacks: ['#tour-pos-nav'],
    side: 'bottom',
    align: 'start',
    permission: 'sales.view',
    icon: 'Monitor',
  },
  {
    // The shift bar only exists while a shift is open — on a brand-new tenant
    // there is nothing to point at, so this step drops out rather than
    // mislabelling the tab strip.
    id: 'pos_shift',
    route: '/sales',
    element: '#tour-pos-shift',
    optional: true,
    timeout: 1500,
    side: 'bottom',
    align: 'center',
    permission: 'sales.view',
    icon: 'Clock',
  },
  {
    id: 'pos_subtabs',
    route: '/sales',
    element: '#tour-pos-subtabs',
    fallbacks: ['#tour-pos-tabs'],
    side: 'bottom',
    align: 'start',
    permission: 'sales.view',
    icon: 'Receipt',
  },

  // ── 6-8. Orders ────────────────────────────────────────────
  {
    id: 'orders_new',
    route: '/orders',
    element: '#tour-orders-new-btn',
    fallbacks: ['#tour-orders-tabs', '#tour-orders-nav'],
    side: 'bottom',
    align: 'end',
    permission: 'orders.view',
    icon: 'Plus',
  },
  {
    id: 'orders_tabs',
    route: '/orders',
    element: '#tour-orders-tabs',
    fallbacks: ['#tour-orders-nav'],
    side: 'bottom',
    align: 'center',
    permission: 'orders.view',
    icon: 'ShoppingBag',
  },
  {
    id: 'orders_search',
    route: '/orders',
    element: '#tour-orders-search',
    fallbacks: ['#tour-orders-tabs'],
    side: 'bottom',
    align: 'start',
    permission: 'orders.view',
    icon: 'Search',
  },

  // ── 9-10. Customers ───────────────────────────────────────
  {
    id: 'customers_add',
    route: '/customers',
    element: '#tour-customers-add-btn',
    fallbacks: ['#tour-customers-search', '#tour-customers-nav'],
    side: 'bottom',
    align: 'end',
    permission: 'customers.view',
    icon: 'UserPlus',
  },
  {
    id: 'customers_search',
    route: '/customers',
    element: '#tour-customers-search',
    fallbacks: ['#tour-customers-nav'],
    side: 'bottom',
    align: 'start',
    permission: 'customers.view',
    icon: 'Users',
  },

  // ── 11-12. Inventory ──────────────────────────────────────
  {
    id: 'inventory_tabs',
    route: '/inventory',
    element: '#tour-inventory-tabs',
    fallbacks: ['#tour-inventory-nav'],
    side: 'bottom',
    align: 'start',
    permission: 'inventory.view',
    icon: 'Package',
  },
  {
    id: 'inventory_actions',
    route: '/inventory',
    element: '#tour-inventory-actions',
    fallbacks: ['#tour-inventory-tabs'],
    side: 'bottom',
    align: 'end',
    permission: 'inventory.view',
    icon: 'ArrowRightLeft',
  },

  // ── 13. Suppliers & procurement ───────────────────────────
  {
    id: 'suppliers',
    route: '/suppliers',
    element: '#tour-suppliers-tabs',
    fallbacks: ['#tour-suppliers-nav'],
    side: 'bottom',
    align: 'start',
    permission: 'suppliers.manage',
    icon: 'Briefcase',
  },

  // ── 14-15. Reports ────────────────────────────────────────
  // Filters first: in the DOM the filter bar sits above the tab strip, so this
  // order avoids scrolling down and then back up again.
  {
    id: 'reports_filters',
    route: '/reports',
    element: '#reports-filters-bar',
    fallbacks: ['#reports-tabs-nav-container'],
    side: 'bottom',
    align: 'center',
    permission: 'reports.view',
    icon: 'SlidersHorizontal',
  },
  {
    id: 'reports_tabs',
    route: '/reports',
    element: '#reports-tabs-nav-container',
    fallbacks: ['#reports-filters-bar'],
    side: 'bottom',
    align: 'start',
    permission: 'reports.view',
    icon: 'BarChart3',
  },

  // ── 16. Settings ──────────────────────────────────────────
  {
    id: 'settings',
    route: '/settings',
    element: '#tour-settings-panel',
    mobileElement: '#tour-settings-nav-mobile',
    fallbacks: ['#tour-settings-nav-mobile', '#tour-settings-panel'],
    side: 'right',
    align: 'start',
    permission: 'settings.view',
    icon: 'Settings',
  },

  // ── 17. Personal preferences (language / theme / lock) ────
  {
    id: 'preferences',
    element: '#tour-user-menu',
    mobileElement: '#tour-user-menu-mobile',
    fallbacks: ['#tour-user-menu-mobile', '#tour-user-menu', '#tour-user-menu-grid'],
    side: 'bottom',
    align: 'start',
    icon: 'UserCircle',
    timeout: 1500,
  },

  // ── 18. AI assistant ──────────────────────────────────────
  {
    id: 'ai_assistant',
    element: '#tour-ai-fab',
    side: 'top',
    align: 'center',
    icon: 'Bot',
    timeout: 1500,
  },

  // ── 19. Finish ────────────────────────────────────────────
  {
    id: 'finish',
    kind: 'finish',
  },
];

/**
 * Quick-start checklist shown on the completion screen.
 * Each entry deep-links the user to where the action happens.
 */
export interface TourChecklistItem {
  id: string;
  route: string;
  icon: string;
  permission?: string;
}

export const TOUR_CHECKLIST: TourChecklistItem[] = [
  { id: 'shop_profile', route: '/settings', icon: 'Store', permission: 'settings.view' },
  { id: 'add_stock', route: '/inventory', icon: 'Package', permission: 'inventory.view' },
  { id: 'add_customer', route: '/customers', icon: 'UserPlus', permission: 'customers.view' },
  { id: 'first_order', route: '/orders', icon: 'Scissors', permission: 'orders.view' },
  { id: 'first_sale', route: '/sales', icon: 'Monitor', permission: 'sales.view' },
];

/**
 * Builds the effective step list for the current user.
 */
export function buildTourSteps(opts: {
  hasPermission: (key: string) => boolean;
  role?: string | null;
  isMobile: boolean;
  availableRoutes?: string[];
}): TourStepDef[] {
  const { hasPermission, role, isMobile, availableRoutes } = opts;
  const normalizedRole = (role || '').toLowerCase();

  return TOUR_STEPS.filter((step) => {
    if (step.desktopOnly && isMobile) return false;

    if (step.roles && step.roles.length > 0) {
      if (!step.roles.includes(normalizedRole)) return false;
    }

    if (step.permission && !hasPermission(step.permission)) return false;

    // Drop steps whose route is not reachable for this user
    if (step.route && availableRoutes && availableRoutes.length > 0) {
      if (!availableRoutes.includes(step.route)) return false;
    }

    return true;
  });
}

/**
 * Ordered list of selectors to try for a step: the mobile override first on
 * small screens, then the primary anchor, then the declared fallbacks.
 *
 * Resolution deliberately does NOT happen here — pages are lazy-loaded, so the
 * primary anchor is often absent for a few hundred milliseconds after a route
 * change while sidebar fallbacks are present from the start. Picking a winner
 * synchronously would always land on the fallback. The tour engine walks this
 * list and gives the primary candidate time to mount first.
 */
export function getStepSelectors(step: TourStepDef, isMobile: boolean): string[] {
  const candidates: string[] = [];

  if (isMobile && step.mobileElement) candidates.push(step.mobileElement);
  if (step.element) candidates.push(step.element);
  if (step.fallbacks) candidates.push(...step.fallbacks);

  // De-duplicate while preserving order
  return candidates.filter((sel, i) => candidates.indexOf(sel) === i);
}

/**
 * True when the element is actually laid out and on screen — an element can
 * exist in the DOM yet be hidden (`hidden lg:block`) or parked off-canvas
 * (the mobile sidebar drawer), and neither makes a usable spotlight.
 */
export function isUsableAnchor(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;

  const box = el.getBoundingClientRect();
  if (box.width <= 1 || box.height <= 1) return false;

  // Must overlap the viewport horizontally (catches the off-canvas drawer)
  const vw = window.innerWidth;
  return box.right > 4 && box.left < vw - 4;
}
