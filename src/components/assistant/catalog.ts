/**
 * What the assistant offers, as data: the questions it suggests, the follow-ups
 * after each kind of answer, and what each tool's card links to.
 *
 * Two rules hold everywhere in here:
 *  - a question is offered only if a tool can answer it, and
 *  - it is offered only to someone the server would not refuse. The server's
 *    own rules (src/server/assistantTools.ts) are mirrored below: three
 *    reports are for owner/admin/manager only, the rest follow the same
 *    permission keys the screens use.
 */

export type AssistantAccess = {
  /** owner / admin / manager: the roles assistantTools.ts calls admin. */
  isAdmin: boolean;
  /** The app's own permission check (usePermissions). */
  can: (permission: string) => boolean;
};

const ADMIN_ROLES = new Set(['owner', 'admin', 'manager', 'super_admin']);
export const isAssistantAdminRole = (role: string | null | undefined): boolean =>
  Boolean(role) && ADMIN_ROLES.has(String(role));

export type PageKey = 'home' | 'sales' | 'orders' | 'customers' | 'inventory' | 'suppliers' | 'reports' | 'settings';

/** The page a path belongs to, for "you are in" and for choosing suggestions. */
export function pageKeyForPath(pathname: string): PageKey {
  const first = '/' + (pathname.split('/')[1] || '');
  switch (first) {
    case '/sales': return 'sales';
    case '/orders': return 'orders';
    case '/customers': return 'customers';
    case '/inventory': return 'inventory';
    case '/suppliers': return 'suppliers';
    case '/reports': return 'reports';
    case '/settings': return 'settings';
    default: return 'home';
  }
}

export type IconKey =
  | 'orders' | 'sales' | 'stock' | 'customers' | 'suppliers' | 'compare' | 'report' | 'invoice' | 'guide' | 'top';

type Requirement = 'admin' | { permission: string } | null;

export interface AssistantQuestion {
  id: string;
  /** i18n key of the full question, sent as the user's message. */
  textKey: string;
  /** i18n key of a shorter label for a follow-up chip; the full question is still what is sent. */
  shortKey?: string;
  icon: IconKey;
  requires: Requirement;
  /** A "how do I..." question, answered with an explanation and a guided tour offer. */
  isHowTo?: boolean;
}

const q = (id: string, icon: IconKey, requires: Requirement, extra: Partial<AssistantQuestion> = {}): AssistantQuestion => ({
  id, icon, requires, textKey: `ai.ask.${id}`, ...extra,
});

/** Every question the assistant may suggest. Each one maps to a tool in assistantTools.ts. */
export const QUESTIONS: Record<string, AssistantQuestion> = {
  // getPendingOrders, searchInvoices
  pending_orders: q('pending_orders', 'orders', { permission: 'orders.view' }, { shortKey: 'ai.ask_short.pending_orders' }),
  find_invoice: q('find_invoice', 'invoice', { permission: 'orders.view' }),
  // getSalesSummary: open to every role (a non-admin gets today only)
  sales_today: q('sales_today', 'sales', null, { shortKey: 'ai.ask_short.sales_today' }),
  // getLowStockAlerts
  low_stock: q('low_stock', 'stock', { permission: 'inventory.view' }, { shortKey: 'ai.ask_short.low_stock' }),
  // getTopSellingItems
  top_selling: q('top_selling', 'top', { permission: 'reports.view' }, { shortKey: 'ai.ask_short.top_selling' }),
  top_selling_today: q('top_selling_today', 'top', { permission: 'reports.view' }, { shortKey: 'ai.ask_short.top_selling_today' }),
  // getCustomerStats
  customer_stats: q('customer_stats', 'customers', { permission: 'customers.view' }, { shortKey: 'ai.ask_short.customer_stats' }),
  // getSupplierBalance
  supplier_balance: q('supplier_balance', 'suppliers', { permission: 'suppliers.manage' }, { shortKey: 'ai.ask_short.supplier_balance' }),
  // getRevenueReport, getDailyClosingReport, comparePeriods: admin only on the server
  revenue_month: q('revenue_month', 'report', 'admin', { shortKey: 'ai.ask_short.revenue_month' }),
  daily_closing: q('daily_closing', 'report', 'admin', { shortKey: 'ai.ask_short.daily_closing' }),
  compare_months: q('compare_months', 'compare', 'admin', { shortKey: 'ai.ask_short.compare_months' }),
  compare_yesterday: q('compare_yesterday', 'compare', 'admin', { shortKey: 'ai.ask_short.compare_yesterday' }),
  // guidedTour topics (GUIDED_TOUR_TOPICS): each needs the page it points at
  how_new_order: q('how_new_order', 'guide', { permission: 'orders.view' }, { isHowTo: true }),
  how_add_customer: q('how_add_customer', 'guide', { permission: 'customers.view' }, { isHowTo: true }),
  how_inventory: q('how_inventory', 'guide', { permission: 'inventory.view' }, { isHowTo: true }),
  how_pos_shift: q('how_pos_shift', 'guide', { permission: 'sales.view' }, { isHowTo: true }),
  how_suppliers: q('how_suppliers', 'guide', { permission: 'suppliers.manage' }, { isHowTo: true }),
  how_reports: q('how_reports', 'guide', { permission: 'reports.view' }, { isHowTo: true }),
};

export function isAllowed(question: AssistantQuestion, access: AssistantAccess): boolean {
  if (question.requires === null) return true;
  if (question.requires === 'admin') return access.isAdmin;
  return access.isAdmin || access.can(question.requires.permission);
}

/** Per page: data questions most relevant first, then the page's own "how do I". */
const PAGE_SUGGESTIONS: Record<PageKey, { data: string[]; howTo: string[] }> = {
  home: { data: ['sales_today', 'pending_orders', 'low_stock', 'customer_stats'], howTo: ['how_new_order', 'how_add_customer'] },
  sales: { data: ['sales_today', 'top_selling_today', 'daily_closing', 'pending_orders', 'low_stock'], howTo: ['how_pos_shift', 'how_new_order'] },
  orders: { data: ['pending_orders', 'sales_today', 'low_stock', 'find_invoice', 'customer_stats'], howTo: ['how_new_order', 'how_add_customer'] },
  customers: { data: ['customer_stats', 'pending_orders', 'sales_today', 'low_stock'], howTo: ['how_add_customer', 'how_new_order'] },
  inventory: { data: ['low_stock', 'top_selling', 'pending_orders', 'sales_today'], howTo: ['how_inventory', 'how_suppliers'] },
  suppliers: { data: ['supplier_balance', 'low_stock', 'sales_today', 'pending_orders'], howTo: ['how_suppliers', 'how_inventory'] },
  reports: { data: ['revenue_month', 'compare_months', 'top_selling', 'sales_today', 'daily_closing'], howTo: ['how_reports', 'how_new_order'] },
  settings: { data: ['sales_today', 'pending_orders', 'low_stock', 'customer_stats'], howTo: ['how_new_order', 'how_add_customer'] },
};

const HOW_TO_FALLBACKS = ['how_new_order', 'how_add_customer', 'how_inventory', 'how_pos_shift', 'how_suppliers', 'how_reports'];

/**
 * The welcome screen's suggestions for this page and this person: up to three
 * data questions, then exactly one "how do I" when one is available to them.
 */
export function suggestionsFor(pathname: string, access: AssistantAccess, limit = 4): AssistantQuestion[] {
  const page = PAGE_SUGGESTIONS[pageKeyForPath(pathname)];
  const allowed = (ids: string[]) => ids.map((id) => QUESTIONS[id]).filter((x) => x && isAllowed(x, access));

  const howTo = allowed([...page.howTo, ...HOW_TO_FALLBACKS])[0];
  const data = allowed(page.data).slice(0, howTo ? limit - 1 : limit);
  return howTo ? [...data, howTo] : data;
}

export interface ToolMeta {
  titleKey: string;
  icon: IconKey;
  /** i18n key of the line shown while the tool runs. */
  progressKey: string;
  /** Where "open in ..." leads, and the permission that page needs. */
  route?: { path: string; page: PageKey; permission: string };
  followUps: string[];
}

export const TOOLS: Record<string, ToolMeta> = {
  getSalesSummary: {
    titleKey: 'ai.card.sales_summary', icon: 'sales', progressKey: 'ai.progress.getSalesSummary',
    route: { path: '/reports', page: 'reports', permission: 'reports.view' },
    followUps: ['compare_yesterday', 'top_selling_today', 'daily_closing', 'pending_orders'],
  },
  getRevenueReport: {
    titleKey: 'ai.card.revenue_report', icon: 'report', progressKey: 'ai.progress.getRevenueReport',
    route: { path: '/reports', page: 'reports', permission: 'reports.view' },
    followUps: ['compare_months', 'top_selling', 'daily_closing'],
  },
  getDailyClosingReport: {
    titleKey: 'ai.card.daily_closing', icon: 'report', progressKey: 'ai.progress.getDailyClosingReport',
    route: { path: '/reports', page: 'reports', permission: 'reports.view' },
    followUps: ['compare_yesterday', 'top_selling_today', 'pending_orders'],
  },
  searchInvoices: {
    titleKey: 'ai.card.invoices', icon: 'invoice', progressKey: 'ai.progress.searchInvoices',
    route: { path: '/sales', page: 'sales', permission: 'sales.view' },
    followUps: ['sales_today', 'pending_orders'],
  },
  getTopSellingItems: {
    titleKey: 'ai.card.top_selling', icon: 'top', progressKey: 'ai.progress.getTopSellingItems',
    route: { path: '/reports', page: 'reports', permission: 'reports.view' },
    followUps: ['low_stock', 'sales_today', 'compare_months'],
  },
  getLowStockAlerts: {
    titleKey: 'ai.card.low_stock', icon: 'stock', progressKey: 'ai.progress.getLowStockAlerts',
    route: { path: '/inventory', page: 'inventory', permission: 'inventory.view' },
    followUps: ['top_selling', 'supplier_balance', 'how_inventory'],
  },
  getInventoryStatus: {
    titleKey: 'ai.card.inventory_status', icon: 'stock', progressKey: 'ai.progress.getInventoryStatus',
    route: { path: '/inventory', page: 'inventory', permission: 'inventory.view' },
    followUps: ['low_stock', 'top_selling'],
  },
  getCustomerHistory: {
    titleKey: 'ai.card.customer_history', icon: 'customers', progressKey: 'ai.progress.getCustomerHistory',
    route: { path: '/customers', page: 'customers', permission: 'customers.view' },
    followUps: ['pending_orders', 'customer_stats'],
  },
  getPendingOrders: {
    titleKey: 'ai.card.pending_orders', icon: 'orders', progressKey: 'ai.progress.getPendingOrders',
    route: { path: '/orders', page: 'orders', permission: 'orders.view' },
    followUps: ['sales_today', 'low_stock', 'how_new_order'],
  },
  getSupplierBalance: {
    titleKey: 'ai.card.supplier_balance', icon: 'suppliers', progressKey: 'ai.progress.getSupplierBalance',
    route: { path: '/suppliers', page: 'suppliers', permission: 'suppliers.manage' },
    followUps: ['low_stock', 'how_suppliers'],
  },
  comparePeriods: {
    titleKey: 'ai.card.period_comparison', icon: 'compare', progressKey: 'ai.progress.comparePeriods',
    route: { path: '/reports', page: 'reports', permission: 'reports.view' },
    followUps: ['top_selling', 'revenue_month', 'daily_closing'],
  },
  getCustomerStats: {
    titleKey: 'ai.card.customer_stats', icon: 'customers', progressKey: 'ai.progress.getCustomerStats',
    route: { path: '/customers', page: 'customers', permission: 'customers.view' },
    followUps: ['pending_orders', 'how_add_customer'],
  },
  guidedTour: { titleKey: 'ai.card.guided_tour', icon: 'guide', progressKey: 'ai.progress.guidedTour', followUps: [] },
};

/** The line shown while the assistant works: the running tool's, or a general one before the first part arrives. */
export function progressKeyFor(toolName: string | null | undefined): string {
  return (toolName && TOOLS[toolName]?.progressKey) || 'ai.progress.preparing';
}

/** What a refused person is offered instead. */
const DENIED_ALTERNATIVES = ['sales_today', 'pending_orders', 'low_stock'];

/**
 * Up to three next questions after a finished reply, from the last tool it
 * used. After a refusal: things this person can ask. Nothing after a tour offer
 * or a plain text reply.
 */
export function followUpsFor(
  toolResults: ReadonlyArray<{ name: string; result: any }> | undefined,
  access: AssistantAccess,
  limit = 3
): AssistantQuestion[] {
  const results = (toolResults || []).filter((r) => r && r.name !== 'guidedTour');
  if (results.length === 0) return [];
  const last = results[results.length - 1];
  const ids = last.result?.denied ? DENIED_ALTERNATIVES : TOOLS[last.name]?.followUps || [];
  return ids.map((id) => QUESTIONS[id]).filter((x) => x && isAllowed(x, access)).slice(0, limit);
}

/** The card's "open in ..." target, or nothing when this person cannot open that page. */
export function openRouteFor(toolName: string, access: AssistantAccess): ToolMeta['route'] | undefined {
  const route = TOOLS[toolName]?.route;
  if (!route) return undefined;
  return access.isAdmin || access.can(route.permission) ? route : undefined;
}
