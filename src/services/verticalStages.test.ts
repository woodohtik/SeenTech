import { describe, expect, test, vi } from 'vitest';

vi.mock('../lib/supabase/client', () => ({ supabase: {} }));
vi.mock('../lib/tenantRow', () => ({ readTenantRow: vi.fn() }));

import { legacyOrderStatusFor } from './verticalService';
import { getOrderPhase, LEGACY_STATUS_PHASE } from '../utils/orderStage';
import { MEASUREMENT_SETS } from '../constants/measurementFields';
import type { WorkflowStage } from '../types/expansion';
// vertical_workflow_stages as migration 20261231000001 leaves it (dumped from staging).
import stagesJson from './__fixtures__/verticalStages.json';

const ALL = stagesJson as unknown as WorkflowStage[];
const verticals = [...new Set(ALL.map((s) => s.vertical_key))];

// seen-verticals-readiness-task.md Phase 8.3: every one of the 41 stages.
describe('legacy_status of every stage', () => {
  test('41 stages across the five activities', () => {
    expect(ALL).toHaveLength(41);
    expect(verticals.sort()).toEqual(['fabric_store', 'furniture', 'mens_tailoring', 'specialty_clothing', 'womens_tailoring']);
  });

  test.each(ALL.map((s) => [`${s.vertical_key}/${s.stage_key}`, s] as const))('%s', (_name, stage) => {
    const own = ALL.filter((s) => s.vertical_key === stage.vertical_key);
    const legacy = legacyOrderStatusFor(stage.stage_key, own);
    expect(legacy).toBe(stage.legacy_status);
    // ready / delivered / cancelled are written only at their own stage. Work
    // stages before the consuming one write measurements_taken on purpose (the
    // fabric leaves at cutting), so their stored phase may read "received".
    for (const end of ['ready', 'delivered', 'cancelled'] as const) {
      expect(LEGACY_STATUS_PHASE[legacy] === end).toBe(stage.phase === end);
    }
    // And the order is read back in the stage's phase.
    expect(getOrderPhase({ status: legacy, status_key: stage.stage_key }, own)).toBe(stage.phase);
    if (stage.vertical_key === 'mens_tailoring') expect(legacy).toBe(stage.stage_key);
  });

  test('each activity has one stage that consumes materials, and one of each terminal phase', () => {
    for (const v of verticals) {
      const own = ALL.filter((s) => s.vertical_key === v);
      expect(own.filter((s) => s.consumes_materials), v).toHaveLength(1);
      expect(own.filter((s) => s.phase === 'ready'), v).toHaveLength(1);
      expect(own.filter((s) => s.phase === 'delivered'), v).toHaveLength(1);
      expect(own.filter((s) => s.phase === 'cancelled'), v).toHaveLength(1);
    }
  });
});

describe("men's measurement set", () => {
  test('the thobe set is unchanged (snapshot)', () => {
    expect(MEASUREMENT_SETS.thobe.map((f: { key: string }) => f.key)).toMatchInlineSnapshot(`
      [
        "length",
        "shoulder",
        "sleeveCuff",
        "sleeve",
        "sleeveTopWidth",
        "handWidth",
        "sleeveHem",
        "cuffLength",
        "cuffWidth",
        "waist",
        "chest",
        "bottomHem",
        "bottomWidth",
        "neck",
        "neckFold",
      ]
    `);
  });
});
