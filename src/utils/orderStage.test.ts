import { describe, expect, test, vi } from 'vitest';

vi.mock('../lib/supabase/client', () => ({ supabase: {} }));
vi.mock('../lib/tenantRow', () => ({ readTenantRow: vi.fn() }));

import { getOrderPhase, getStageLabel, finishedStageKeys, LEGACY_STATUS_PHASE } from './orderStage';
import { statsFromRows, buildDashboardPlan } from '../components/dashboard/dashboardStats';
import type { WorkflowStage } from '../types/expansion';

const st = (vertical_key: string, stage_key: string, phase: WorkflowStage['phase'], extra: Partial<WorkflowStage> = {}): WorkflowStage => ({
  vertical_key, stage_key, label_ar: stage_key, sort: 1, is_terminal: phase === 'delivered' || phase === 'cancelled', phase, ...extra,
});

const fabric = [
  st('fabric_store', 'order_received', 'received'),
  st('fabric_store', 'cutting_measuring', 'in_progress'),
  st('fabric_store', 'ready_pickup', 'ready', { label_ar: 'جاهز للاستلام', label_en: 'Ready for pickup' }),
  st('fabric_store', 'delivered', 'delivered'),
];

// seen-verticals-readiness-task.md Phase 2.
describe('getOrderPhase', () => {
  test("a vertical's stage decides", () => {
    expect(getOrderPhase({ status_key: 'ready_pickup', status: 'ready' }, fabric)).toBe('ready');
    expect(getOrderPhase({ status_key: 'cutting_measuring' }, fabric)).toBe('in_progress');
  });

  test("men's tailoring: the enum's meaning, stages loaded or not", () => {
    for (const [k, p] of Object.entries(LEGACY_STATUS_PHASE)) {
      expect(getOrderPhase({ status: k }, [])).toBe(p);
      expect(getOrderPhase({ status_key: k, status: k }, [st('mens_tailoring', k, p)])).toBe(p);
    }
    expect(getOrderPhase({ status_key: null, status: 'partial_delivered' }, [])).toBe('in_progress');
  });

  test('labels and finished keys', () => {
    expect(getStageLabel('ready_pickup', fabric, 'en')).toBe('Ready for pickup');
    expect(getStageLabel('ready_pickup', fabric, 'ar')).toBe('جاهز للاستلام');
    expect(getStageLabel('sewing', fabric, 'ar', (k) => `old:${k}`)).toBe('old:sewing');
    expect([...finishedStageKeys(fabric)].sort()).toEqual(['delivered', 'ready', 'ready_pickup']);
  });
});

describe('the dashboard by phase', () => {
  test("a fabric store's ready_pickup is ready, not pending; its completion time is found", () => {
    const plan = buildDashboardPlan({ timeframe: 'all', customStartDate: '', customEndDate: '', revenueRange: 7, now: new Date('2026-11-20T12:00:00Z') });
    const order = (status: string, phase: any, history?: any[]) => ({
      status, phase, orderDate: '2026-11-19T10:00:00Z', paidAmount: 0, remainingAmount: 0, customerId: 'c', history,
    });
    const r = statsFromRows(plan, {
      orders: [
        order('ready_pickup', 'ready', [{ status: 'order_received', updatedAt: '2026-11-19T10:00:00Z' }, { status: 'ready_pickup', updatedAt: '2026-11-19T14:00:00Z' }]),
        order('cutting_measuring', 'in_progress'),
      ],
      customers: [], inventory: [], bInv: [],
    }, finishedStageKeys(fabric));
    expect(r.totals.ready).toBe(1);
    expect(r.totals.in_progress).toBe(1);
    expect(r.filtered.pending).toBe(1);
    expect(r.filtered.completion_count).toBe(1);
    expect(r.filtered.completion_hours).toBeCloseTo(4, 6);
    expect(r.filtered.status_counts).toEqual({ ready_pickup: 1, cutting_measuring: 1 });
  });
});
