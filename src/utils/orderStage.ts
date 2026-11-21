/**
 * Where an order stands, whatever its vertical calls the stage
 * (seen-verticals-readiness-task.md Phase 2). Screens compare phases --
 * received / in_progress / ready / delivered / cancelled -- instead of the
 * fixed 'ready' / 'delivered' names, so a fabric store's «جاهز للاستلام»
 * (ready_pickup) is ready and a sofa at «اعتماد التصميم» is in progress.
 * The database's public.order_phase applies the same rules.
 */
import type { OrderPhase, WorkflowStage } from '../types/expansion';
import { localizedLabel } from './verticalLabels';

/** The old enum's meaning -- men's tailoring's stages are the enum itself. */
export const LEGACY_STATUS_PHASE: Readonly<Record<string, OrderPhase>> = {
  measurements_taken: 'received',
  cutting: 'in_progress',
  sewing: 'in_progress',
  embroidery: 'in_progress',
  ironing_packaging: 'in_progress',
  partial_delivered: 'in_progress',
  ready: 'ready',
  delivered: 'delivered',
  cancelled: 'cancelled',
};

export interface OrderStatusLike {
  /** The stage key (free text, any vertical) -- or, on older rows, the enum. */
  status_key?: string | null;
  statusKey?: string | null;
  /** The stored orders.status (enum), or what a screen put in `status`. */
  status?: string | null;
  legacyStatus?: string | null;
}

/**
 * The order's phase: its stage's phase when the vertical defines that key;
 * otherwise the old enum's meaning of the key (or of the stored status) --
 * exactly what the screens computed for men's tailoring before.
 */
export function getOrderPhase(order: OrderStatusLike | null | undefined, stages: ReadonlyArray<WorkflowStage>): OrderPhase {
  if (!order) return 'in_progress';
  const key = order.status_key ?? order.statusKey ?? order.status ?? null;
  if (key) {
    const stage = stages.find((s) => s.stage_key === key);
    if (stage?.phase) return stage.phase;
  }
  const fallback = key ?? order.legacyStatus ?? null;
  return (fallback && LEGACY_STATUS_PHASE[fallback]) || (order.legacyStatus && LEGACY_STATUS_PHASE[order.legacyStatus]) || 'in_progress';
}

/** ready or delivered (the work is finished). */
export const isFinishedPhase = (p: OrderPhase) => p === 'ready' || p === 'delivered';

/** The stage keys whose phase is ready / delivered (+ the enum's), for history look-ups. */
export function finishedStageKeys(stages: ReadonlyArray<WorkflowStage>): Set<string> {
  const keys = new Set<string>(['ready', 'delivered']);
  for (const s of stages) if (s.phase === 'ready' || s.phase === 'delivered') keys.add(s.stage_key);
  return keys;
}

/** A stage's name in the screen's language; `fallback` (e.g. the old dictionary) when the vertical does not define it. */
export function getStageLabel(
  stageKey: string | null | undefined,
  stages: ReadonlyArray<WorkflowStage>,
  lang: string,
  fallback?: (key: string) => string,
): string {
  if (!stageKey) return '';
  const stage = stages.find((s) => s.stage_key === stageKey);
  if (stage) return localizedLabel(stage, lang);
  return fallback ? fallback(stageKey) : stageKey;
}
