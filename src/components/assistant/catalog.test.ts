import { describe, expect, it } from 'vitest';
import {
  QUESTIONS, TOOLS, followUpsFor, isAssistantAdminRole, openRouteFor, pageKeyForPath, progressKeyFor,
  suggestionsFor, type AssistantAccess,
} from './catalog';

const owner: AssistantAccess = { isAdmin: true, can: () => true };
// The default cashier: sells and takes orders, sees customers and stock, no reports or suppliers.
const cashierPerms = new Set(['sales.view', 'orders.view', 'customers.view', 'inventory.view']);
const cashier: AssistantAccess = { isAdmin: false, can: (p) => cashierPerms.has(p) };
const nobody: AssistantAccess = { isAdmin: false, can: () => false };

const ADMIN_ONLY = ['revenue_month', 'daily_closing', 'compare_months', 'compare_yesterday'];
const ids = (list: { id: string }[]) => list.map((x) => x.id);

describe('pageKeyForPath', () => {
  it('reads the page from the first path segment', () => {
    expect(pageKeyForPath('/')).toBe('home');
    expect(pageKeyForPath('/orders')).toBe('orders');
    expect(pageKeyForPath('/inventory/transfers')).toBe('inventory');
    expect(pageKeyForPath('/settings/tax')).toBe('settings');
    expect(pageKeyForPath('/something-else')).toBe('home');
  });
});

describe('suggestionsFor', () => {
  it('an owner on the inventory page is offered a stock question first', () => {
    const list = suggestionsFor('/inventory', owner);
    expect(list).toHaveLength(4);
    expect(list[0].id).toBe('low_stock');
  });

  it('an owner on the orders page gets the pending orders first and one how-to last', () => {
    const list = suggestionsFor('/orders', owner);
    expect(list[0].id).toBe('pending_orders');
    expect(list.filter((x) => x.isHowTo)).toHaveLength(1);
    expect(list[list.length - 1].id).toBe('how_new_order');
  });

  it('a cashier is never offered an admin-only report, on any page', () => {
    for (const path of ['/', '/sales', '/orders', '/customers', '/inventory', '/suppliers', '/reports', '/settings']) {
      const offered = ids(suggestionsFor(path, cashier));
      expect(offered.filter((id) => ADMIN_ONLY.includes(id))).toEqual([]);
      expect(offered).not.toContain('supplier_balance');
      expect(offered).not.toContain('top_selling');
    }
  });

  it('on the reports page a cashier still gets what they can ask', () => {
    expect(ids(suggestionsFor('/reports', cashier))).toEqual(['sales_today', 'how_new_order']);
  });

  it('someone with no permissions is offered only the open question', () => {
    expect(ids(suggestionsFor('/orders', nobody))).toEqual(['sales_today']);
  });
});

describe('followUpsFor', () => {
  it('after a sales summary an owner is offered the comparison, top sellers and the closing report', () => {
    expect(ids(followUpsFor([{ name: 'getSalesSummary', result: {} }], owner)))
      .toEqual(['compare_yesterday', 'top_selling_today', 'daily_closing']);
  });

  it('after a sales summary a cashier is offered no admin report', () => {
    const offered = ids(followUpsFor([{ name: 'getSalesSummary', result: {} }], cashier));
    expect(offered).toEqual(['pending_orders']);
  });

  it('after a refusal the alternatives are things this person can ask', () => {
    const denied = [{ name: 'getRevenueReport', result: { denied: true, message: 'x' } }];
    expect(ids(followUpsFor(denied, cashier))).toEqual(['sales_today', 'pending_orders', 'low_stock']);
    expect(ids(followUpsFor(denied, nobody))).toEqual(['sales_today']);
  });

  it('offers nothing after a tour offer or a reply with no data', () => {
    expect(followUpsFor([{ name: 'guidedTour', result: { topic: 'orders_new', action: 'offer' } }], owner)).toEqual([]);
    expect(followUpsFor([], owner)).toEqual([]);
    expect(followUpsFor(undefined, owner)).toEqual([]);
  });

  it('uses the last data tool of the reply', () => {
    const results = [{ name: 'getSalesSummary', result: {} }, { name: 'getPendingOrders', result: { orders: [] } }];
    expect(ids(followUpsFor(results, owner))).toEqual(['sales_today', 'low_stock', 'how_new_order']);
  });
});

describe('the catalog itself', () => {
  it('every question a page or tool refers to exists', () => {
    for (const meta of Object.values(TOOLS)) {
      for (const id of meta.followUps) expect(QUESTIONS[id], id).toBeDefined();
    }
  });

  it('covers the twelve data tools and the tour', () => {
    expect(Object.keys(TOOLS).sort()).toEqual([
      'comparePeriods', 'getCustomerHistory', 'getCustomerStats', 'getDailyClosingReport', 'getInventoryStatus',
      'getLowStockAlerts', 'getPendingOrders', 'getRevenueReport', 'getSalesSummary', 'getSupplierBalance',
      'getTopSellingItems', 'guidedTour', 'searchInvoices',
    ]);
  });

  it('links only to existing pages, and hides the link from someone who cannot open the page', () => {
    const paths = new Set(Object.values(TOOLS).map((m) => m.route?.path).filter(Boolean));
    expect([...paths].sort()).toEqual(['/customers', '/inventory', '/orders', '/reports', '/sales', '/suppliers']);
    expect(openRouteFor('getPendingOrders', cashier)?.path).toBe('/orders');
    expect(openRouteFor('getSalesSummary', cashier)).toBeUndefined();
    expect(openRouteFor('getSalesSummary', owner)?.path).toBe('/reports');
    expect(openRouteFor('guidedTour', owner)).toBeUndefined();
  });

  it('names the running tool in the progress line, with a general line before any tool', () => {
    expect(progressKeyFor('comparePeriods')).toBe('ai.progress.comparePeriods');
    expect(progressKeyFor(null)).toBe('ai.progress.preparing');
    expect(progressKeyFor('unknownTool')).toBe('ai.progress.preparing');
  });

  it('treats owner, admin and manager as admin, like the server', () => {
    expect(['owner', 'admin', 'manager'].every(isAssistantAdminRole)).toBe(true);
    expect(['cashier', 'tailor', 'accountant', undefined, null].some(isAssistantAdminRole)).toBe(false);
  });
});
