import { describe, expect, test, vi } from 'vitest';

vi.mock('../lib/supabase/client', () => ({ supabase: {} }));
vi.mock('../lib/tenantRow', () => ({ readTenantRow: vi.fn() }));

import { verticalTermKey } from './useVerticalTerms';
import { effectiveModules, isOrdersModuleOn, MENS_CAPABILITIES, DEFAULT_MODULES } from '../services/verticalService';

const keys = new Set(['common.roles.tailor__technician', 'pos.custom_tailor__piece']);
const exists = (k: string) => keys.has(k);

// seen-verticals-readiness-task.md Phase 6.
describe("the shop's own words", () => {
  test("men's tailoring always reads the key itself", () => {
    expect(verticalTermKey('common.roles.tailor', MENS_CAPABILITIES, exists)).toBe('common.roles.tailor');
    expect(verticalTermKey('pos.custom_tailor', MENS_CAPABILITIES, exists)).toBe('pos.custom_tailor');
  });

  test('a technician / piece activity reads the alternative when it exists', () => {
    const furniture = { workshop_term: 'technician' as const, item_term: 'piece' as const };
    expect(verticalTermKey('common.roles.tailor', furniture, exists)).toBe('common.roles.tailor__technician');
    expect(verticalTermKey('pos.custom_tailor', furniture, exists)).toBe('pos.custom_tailor__piece');
    expect(verticalTermKey('orders.other', furniture, exists)).toBe('orders.other');
    const womens = { workshop_term: 'tailor' as const, item_term: 'piece' as const };
    expect(verticalTermKey('common.roles.tailor', womens, exists)).toBe('common.roles.tailor');
    expect(verticalTermKey('pos.custom_tailor', womens, exists)).toBe('pos.custom_tailor__piece');
  });
});

describe("the shop's modules", () => {
  test("men's tailoring: its stored modules, or all of them", () => {
    expect(effectiveModules(null, MENS_CAPABILITIES)).toEqual(DEFAULT_MODULES);
    expect(effectiveModules(['pos', 'orders'], MENS_CAPABILITIES)).toEqual(['pos', 'orders']);
  });

  test('an activity that takes no orders has no orders module', () => {
    expect(effectiveModules(DEFAULT_MODULES, { orders_module: false })).not.toContain('orders');
    expect(isOrdersModuleOn(effectiveModules(null, { orders_module: false }))).toBe(false);
  });

  test('nothing is hidden while the modules are not known yet', () => {
    expect(isOrdersModuleOn([])).toBe(true);
  });
});
