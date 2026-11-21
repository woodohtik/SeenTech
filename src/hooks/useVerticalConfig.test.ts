import { describe, expect, test, vi } from 'vitest';

vi.mock('../lib/supabase/client', () => ({ supabase: {} }));
vi.mock('../lib/tenantRow', () => ({ readTenantRow: vi.fn() }));

import { configAfterFailure } from './useVerticalConfig';
import { MENS_CAPABILITIES } from '../services/verticalService';

// seen-verticals-readiness-task.md Phase 1.6 / bug 6: no silent fall back to
// men's tailoring for a shop whose activity is known.
const savedFurniture = {
  vertical: 'furniture', verticalInfo: null, modules: [], capabilities: { ...MENS_CAPABILITIES, body_measurements: null },
  workflowStages: [{ vertical_key: 'furniture', stage_key: 'upholstery', label_ar: 'تنجيد', sort: 4, is_terminal: false }],
  orderItemFields: [], inventoryCategories: [],
} as any;

describe('settings that could not be loaded', () => {
  test("the shop's saved settings are used (offline furniture shop sees its own stages)", () => {
    const s = configAfterFailure(savedFurniture, 'furniture');
    expect(s.vertical).toBe('furniture');
    expect(s.workflowStages[0].stage_key).toBe('upholstery');
    expect(s.isLegacyVertical).toBe(false);
    expect(s.unavailable).toBe(false);
    expect(s.loading).toBe(false);
  });

  test('saved settings of another activity are not used', () => {
    const s = configAfterFailure(savedFurniture, 'fabric_store');
    expect(s.unavailable).toBe(true);
    expect(s.vertical).toBe('fabric_store');
  });

  test('a non-men\'s shop with nothing saved is "unavailable", never men\'s', () => {
    const s = configAfterFailure(null, 'furniture');
    expect(s.unavailable).toBe(true);
    expect(s.isLegacyVertical).toBe(false);
  });

  test("a men's shop (or an unknown activity) with nothing saved works as before", () => {
    for (const known of ['mens_tailoring', null]) {
      const s = configAfterFailure(null, known);
      expect(s.unavailable).toBe(false);
      expect(s.isLegacyVertical).toBe(true);
      expect(s.capabilities).toEqual(MENS_CAPABILITIES);
    }
  });
});
