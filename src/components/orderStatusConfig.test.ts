import { describe, expect, it } from 'vitest';
import { getOrderStatusDisplay, STATUS_CONFIG } from './orderStatusConfig';
import type { WorkflowStage } from '../types/expansion';

// seen-open-verticals-task.md, phase 0 (terms): another vertical's stage that
// shares a key with men's tailoring (ready, cutting...) shows ITS name -- a
// furniture shop's «جاهز للتسليم», not men's «جاهز للاستلام». Found by the
// furniture golden path.
const stage = (vertical_key: string, stage_key: string, label_ar: string) =>
  ({ vertical_key, stage_key, label_ar, phase: 'ready', is_terminal: false } as unknown as WorkflowStage);

describe('getOrderStatusDisplay', () => {
  it("a furniture shop's ready stage keeps its own name and the ready look", () => {
    const d = getOrderStatusDisplay('ready', [stage('furniture', 'ready', 'جاهز للتسليم')]);
    expect(d.labelKey).toBe('جاهز للتسليم');
    expect(d.icon).toBe(STATUS_CONFIG.ready.icon);
  });

  it("men's tailoring is exactly as before", () => {
    expect(getOrderStatusDisplay('ready', [stage('mens_tailoring', 'ready', 'جاهز')])).toBe(STATUS_CONFIG.ready);
    expect(getOrderStatusDisplay('ready', [])).toBe(STATUS_CONFIG.ready);
  });
});
