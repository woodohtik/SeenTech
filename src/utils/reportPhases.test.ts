import { describe, expect, it } from 'vitest';
import { countByPhase, isActiveOrder, isCompletedOrder, isDeliveredOrder } from './reportPhases';
import type { WorkflowStage } from '../types/expansion';

// seen-open-verticals-task.md, phase 0 item 5 (note 3 of the 21 Nov report):
// reports and staff performance count by the stage's phase, so a furniture
// order at «اعتماد التصميم» is in progress -- not "received" because its
// stored status is the old measurements_taken.
const furniture = [
  { stage_key: 'measurement_visit', phase: 'received' },
  { stage_key: 'design_approval', phase: 'in_progress' },
  { stage_key: 'ready_install', phase: 'ready' },
  { stage_key: 'installed', phase: 'delivered' },
] as unknown as WorkflowStage[];

describe('reports by phase', () => {
  it('a furniture order at design approval is in progress', () => {
    const o = { status: 'measurements_taken', status_key: 'design_approval' };
    expect(countByPhase([o], furniture).in_progress).toBe(1);
    expect(countByPhase([o], furniture).received).toBe(0);
    expect(isActiveOrder(o, furniture)).toBe(true);
    expect(isCompletedOrder(o, furniture)).toBe(false);
  });

  it("a vertical's own ready and delivered stages count as such", () => {
    expect(isCompletedOrder({ status: 'ready', status_key: 'ready_install' }, furniture)).toBe(true);
    expect(isDeliveredOrder({ status: 'delivered', status_key: 'installed' }, furniture)).toBe(true);
  });

  it("men's tailoring keeps the old meaning (no stages needed)", () => {
    const orders = [{ status: 'measurements_taken' }, { status: 'cutting' }, { status: 'embroidery' }, { status: 'ready' }, { status: 'delivered' }, { status: 'cancelled' }];
    expect(countByPhase(orders, [])).toEqual({ received: 1, in_progress: 2, ready: 1, delivered: 1, cancelled: 1 });
    expect(isActiveOrder({ status: 'cancelled' }, [])).toBe(false);
  });
});
