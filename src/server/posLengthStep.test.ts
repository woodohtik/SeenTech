// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { savePosLengthStep } from './posLengthStep';

// seen-open-verticals-task.md, wave 1 (fabric stores): the shop sets its POS ±
// step for lengths; only that column changes (the settings route rewrites
// the whole shop, so it has its own small route).
describe('savePosLengthStep', () => {
  it('saves an offered step on the shop, nothing else', async () => {
    const update = vi.fn().mockResolvedValue({ error: null });
    const res = await savePosLengthStep({ update }, 'tenant-1', 0.1);
    expect(res).toEqual({ ok: true, step: 0.1 });
    expect(update).toHaveBeenCalledWith('tenant-1', { pos_length_step: 0.1 });
  });
  it('refuses any other number', async () => {
    const update = vi.fn();
    expect(await savePosLengthStep({ update }, 'tenant-1', 0.3)).toEqual({ ok: false, error: 'invalid_step' });
    expect(await savePosLengthStep({ update }, 'tenant-1', 'x')).toEqual({ ok: false, error: 'invalid_step' });
    expect(update).not.toHaveBeenCalled();
  });
});
