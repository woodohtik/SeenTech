/**
 * Counting orders for reports and staff performance by where they stand --
 * the stage's phase -- not the stored status (seen-open-verticals-task.md,
 * phase 0 item 5; note 3 of docs/verticals-readiness-report-2026-11-21.md).
 * Before, a furniture order at «اعتماد التصميم» counted as "received" here
 * while the dashboard said "in progress". Men's tailoring's stages are the
 * old statuses, so its numbers mean what they meant.
 */
import type { OrderPhase, WorkflowStage } from '../types/expansion';
import { getOrderPhase, isFinishedPhase, type OrderStatusLike } from './orderStage';

export type PhaseCounts = Record<OrderPhase, number>;

export function countByPhase(orders: ReadonlyArray<OrderStatusLike>, stages: ReadonlyArray<WorkflowStage>): PhaseCounts {
  const counts: PhaseCounts = { received: 0, in_progress: 0, ready: 0, delivered: 0, cancelled: 0 };
  for (const o of orders) counts[getOrderPhase(o, stages)] += 1;
  return counts;
}

/** Ready or delivered: the work is finished. */
export const isCompletedOrder = (o: OrderStatusLike, stages: ReadonlyArray<WorkflowStage>) => isFinishedPhase(getOrderPhase(o, stages));
export const isDeliveredOrder = (o: OrderStatusLike, stages: ReadonlyArray<WorkflowStage>) => getOrderPhase(o, stages) === 'delivered';
/** Still being worked on: not finished, not cancelled. */
export function isActiveOrder(o: OrderStatusLike, stages: ReadonlyArray<WorkflowStage>): boolean {
  const p = getOrderPhase(o, stages);
  return !isFinishedPhase(p) && p !== 'cancelled';
}
