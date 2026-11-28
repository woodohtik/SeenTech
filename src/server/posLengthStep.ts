import { LENGTH_STEPS } from '../utils/lengthSale';

/**
 * The fabric store's ± step at the POS (seen-open-verticals-task.md, wave 1):
 * tenants.pos_length_step, one of LENGTH_STEPS. Its own route, because
 * /api/tenant/settings rewrites every field of the shop on each save.
 */
export interface PosLengthStepDeps {
  update: (tenantId: string, patch: { pos_length_step: number }) => Promise<{ error: unknown }>;
}

export async function savePosLengthStep(deps: PosLengthStepDeps, tenantId: string, value: unknown):
  Promise<{ ok: true; step: number } | { ok: false; error: 'invalid_step' | 'save_failed' }> {
  const step = Number(value);
  if (!LENGTH_STEPS.includes(step)) return { ok: false, error: 'invalid_step' };
  const { error } = await deps.update(tenantId, { pos_length_step: step });
  if (error) return { ok: false, error: 'save_failed' };
  return { ok: true, step };
}
